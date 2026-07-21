const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { detectProject } = require("./project.cjs");
const { diagnoseEnvironment } = require("./environment.cjs");
const { exec, listDevices, listAvds } = require("./adb.cjs");
const { classify, genericProblem, redactSecrets } = require("./errors.cjs");
const { WebViewInspector } = require("./webview.cjs");
const { enrichErrorText } = require("./source-context.cjs");

const STEPS = ["environment", "dependencies", "target", "server", "bridge", "sync", "build", "launch", "logs"];

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

class Runner {
  constructor(emit) {
    this.emit = emit;
    this.processes = new Map();
    this.active = null;
    this.running = false;
    this.inspector = null;
  }

  event(type, payload = {}) { this.emit({ type, at: new Date().toISOString(), ...payload }); }

  log(source, text, level = "info") {
    for (const line of String(text).split(/\r?\n/).filter(Boolean)) {
      const safeLine = redactSecrets(line);
      const problem = classify(safeLine) || (level === "error" ? genericProblem() : null);
      this.event("log", { source, level: problem ? problem.severity : level, text: safeLine, problem });
    }
  }

  step(id, status, detail = "") { this.event("step", { id, status, detail }); }

  spawnProcess(key, command, args, options = {}) {
    this.log(key, `$ ${command} ${args.join(" ")}`, "command");
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      shell: process.platform === "win32",
      windowsHide: true,
    });
    this.processes.set(key, child);
    child.stdout?.on("data", (chunk) => this.log(key, chunk.toString()));
    child.stderr?.on("data", (chunk) => this.log(key, chunk.toString(), "warn"));
    child.on("close", (code) => {
      if (this.processes.get(key) === child) this.processes.delete(key);
      this.event("process", { key, status: "closed", code });
    });
    child.on("error", (error) => this.log(key, error.message, "error"));
    return child;
  }

  runCommand(stepId, command, cwd, env) {
    if (!command) return Promise.resolve();
    this.step(stepId, "running", command.command);
    const child = this.spawnProcess(stepId, command.command, command.args, { cwd: command.cwd || cwd, env });
    return new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) { this.step(stepId, "complete"); resolve(); }
        else { this.step(stepId, "failed", `Exit code ${code}`); reject(new Error(`${stepId} failed with exit code ${code}`)); }
      });
    });
  }

  async waitForPort(port, timeout = 60000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const open = await new Promise((resolve) => {
        const socket = net.createConnection({ host: "127.0.0.1", port }, () => { socket.destroy(); resolve(true); });
        socket.once("error", () => resolve(false));
        socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
      });
      if (open) return;
      await wait(500);
    }
    throw new Error(`Development server did not open port ${port}.`);
  }

  async waitForDevice(adb, timeout = 120000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const devices = await listDevices(adb);
      const ready = devices.find((device) => device.state === "device");
      if (ready) return ready;
      await wait(1000);
    }
    throw new Error("Android device did not become ready.");
  }

  async resolveTarget(requested, env) {
    const devices = await listDevices(env.adb);
    if (requested && requested !== "auto" && requested !== "preview") {
      const selected = devices.find((device) => device.serial === requested || device.kind === requested);
      if (selected) return selected;
    }
    const readyUsb = devices.find((device) => device.kind === "usb" && device.state === "device");
    const readyEmulator = devices.find((device) => device.kind === "emulator" && device.state === "device");
    if (requested === "auto" && readyUsb) return readyUsb;
    if (readyEmulator) return readyEmulator;
    if (requested === "usb") throw new Error("No authorized USB device is connected.");

    const avds = await listAvds(env.emulator);
    if (!env.emulator || avds.length === 0) throw new Error("No Android target is available. Create an AVD or connect a USB device.");
    this.log("emulator", `Starting ${avds[0]} with Quick Boot`);
    this.spawnProcess("emulator", env.emulator, ["-avd", avds[0], "-no-boot-anim", "-no-audio"]);
    return this.waitForDevice(env.adb);
  }

  findPackageId(project) {
    const candidates = [
      "capacitor.config.ts", "capacitor.config.js", "capacitor.config.json",
      path.join("android", "app", "build.gradle"), path.join("android", "app", "build.gradle.kts"),
      path.join("app", "build.gradle"), path.join("app", "build.gradle.kts"),
    ];
    for (const relative of candidates) {
      const file = path.join(project.root, relative);
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      const match = text.match(/(?:appId\s*[:=]|applicationId\s*[=(]?)\s*["']([^"']+)["']/);
      if (match) return match[1];
    }
    return null;
  }

  async start(config) {
    if (this.running) throw new Error("A run is already active.");
    this.running = true;
    STEPS.forEach((id) => this.step(id, "pending"));
    this.event("run", { status: "running" });
    try {
      const project = detectProject(config.projectPath);
      const env = diagnoseEnvironment();
      this.active = { project, env, config, device: null };
      this.step("environment", "running");
      if (!env.node) throw new Error("Node.js is required.");
      if (config.target !== "preview" && (!env.adb || !env.java)) throw new Error("Android SDK platform-tools and a JDK are required.");
      this.step("environment", "complete");

      if (!fs.existsSync(path.join(project.root, "node_modules")) && fs.existsSync(path.join(project.root, "package.json"))) {
        await this.runCommand("dependencies", project.commands.install, project.root);
      } else this.step("dependencies", "skipped", "Already installed");

      const port = Number(config.port || (project.adapter === "vite" ? 5173 : 3000));
      if (project.commands.preview && config.mode !== "production") {
        this.step("server", "running", `Port ${port}`);
        this.spawnProcess("server", project.commands.preview.command, project.commands.preview.args, {
          cwd: project.root,
          env: { PORT: String(port) },
        });
        await this.waitForPort(port);
        this.step("server", "complete", `http://127.0.0.1:${port}`);
        this.event("preview", { url: `http://127.0.0.1:${port}` });
      } else this.step("server", "skipped");

      const activeTargets = env.adb ? await listDevices(env.adb).catch(() => []) : [];
      const autoPreview = config.target === "auto" && config.mode !== "production" &&
        project.capabilities.preview && !activeTargets.some((device) => device.state === "device");
      if (config.target === "preview" || autoPreview) {
        if (!project.capabilities.preview) throw new Error(`${project.adapter} does not support browser preview.`);
        ["target", "bridge", "sync", "build", "launch", "logs"].forEach((id) => this.step(id, "skipped"));
        this.event("run", { status: "running", detail: autoPreview ? "Auto-selected Quick Preview" : "Preview ready" });
        return;
      }

      this.step("target", "running");
      const device = await this.resolveTarget(config.target, env);
      if (device.state !== "device") throw new Error(`Device ${device.serial} is ${device.state}.`);
      this.active.device = device;
      this.step("target", "complete", `${device.model} (${device.serial})`);

      if (config.mode !== "production") {
        this.step("bridge", "running");
        await exec(env.adb, ["-s", device.serial, "reverse", `tcp:${port}`, `tcp:${port}`]);
        this.step("bridge", "complete", `tcp:${port}`);
      } else this.step("bridge", "skipped", "Production mode");

      const capEnv = config.mode !== "production" ? { CAP_DEV_URL: `http://localhost:${port}` } : {};
      if (project.commands.sync) await this.runCommand("sync", project.commands.sync, project.root, capEnv);
      else this.step("sync", "skipped");

      if (!project.commands.build) throw new Error(`No Android build command was found for ${project.adapter}.`);
      await this.runCommand("build", project.commands.build, project.root, { JAVA_HOME: path.dirname(path.dirname(env.java)) });

      const packageId = config.packageId || this.findPackageId(project);
      if (!packageId) throw new Error("The Android application ID could not be detected.");
      this.step("launch", "running", packageId);
      await exec(env.adb, ["-s", device.serial, "shell", "monkey", "-p", packageId, "-c", "android.intent.category.LAUNCHER", "1"]);
      this.step("launch", "complete", packageId);

      this.inspector = new WebViewInspector({
        adb: env.adb,
        serial: device.serial,
        packageId,
        emit: (type, payload) => {
          const safePayload = { ...payload };
          if (safePayload.text) {
            safePayload.text = redactSecrets(enrichErrorText(safePayload.text, project.root));
            const problem = classify(safePayload.text) || (safePayload.level === "error" ? genericProblem("WebView console error", "webview-error") : null);
            if (problem) {
              safePayload.problem = problem;
              safePayload.level = problem.severity;
            }
          }
          if (safePayload.url) safePayload.url = redactSecrets(safePayload.url);
          if (type === "network" && Number(safePayload.status) >= 400) {
            const summary = `${safePayload.url || "request"} status ${safePayload.status}`;
            safePayload.problem = classify(summary) || genericProblem(`HTTP ${safePayload.status}`, "http-error");
            safePayload.level = "error";
          }
          if (type === "network" && safePayload.phase === "failed") {
            safePayload.problem = safePayload.problem || genericProblem("Network loading failure", "network-failure");
            safePayload.level = "error";
          }
          this.event(type, safePayload);
        },
        log: (text) => this.log("devtools", text),
      });
      this.inspector.connect().catch((error) => {
        this.event("webview-status", { status: "unavailable", detail: error.message });
        this.log("devtools", error.message, "warn");
      });

      this.step("logs", "running");
      this.spawnProcess("logcat", env.adb, ["-s", device.serial, "logcat", "-v", "threadtime"]);
      this.step("logs", "complete", "Streaming");
      this.event("run", { status: "running", detail: "App running" });
    } catch (error) {
      this.log("system", error.message || String(error), "error");
      this.event("run", { status: "failed", detail: error.message || String(error) });
      this.running = false;
      throw error;
    }
  }

  async restart() {
    if (!this.active?.device) throw new Error("No Android app is active.");
    const { env, device, project, config } = this.active;
    const packageId = config.packageId || this.findPackageId(project);
    await exec(env.adb, ["-s", device.serial, "shell", "am", "force-stop", packageId]);
    await exec(env.adb, ["-s", device.serial, "shell", "monkey", "-p", packageId, "1"]);
    this.log("system", `Restarted ${packageId} without clearing data.`);
  }

  async stop() {
    if (this.inspector) await this.inspector.close();
    this.inspector = null;
    const children = [...this.processes.values()];
    this.processes.clear();
    for (const child of children) {
      if (child.exitCode !== null) continue;
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill("SIGTERM");
    }
    if (this.active?.device) {
      const packageId = this.active.config.packageId || this.findPackageId(this.active.project);
      if (packageId) await exec(this.active.env.adb, ["-s", this.active.device.serial, "shell", "am", "force-stop", packageId]).catch(() => {});
    }
    this.running = false;
    this.active = null;
    this.event("run", { status: "stopped" });
  }
}

module.exports = { Runner, STEPS };
