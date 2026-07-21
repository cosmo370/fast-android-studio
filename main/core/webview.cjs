const CDP = require("chrome-remote-interface");
const { exec } = require("./adb.cjs");

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function parseWebViewSockets(output, pid) {
  const sockets = [...String(output).matchAll(/@((?:[^\s@]*_)?webview_devtools_remote(?:_[^\s]+)?)/g)]
    .map((match) => match[1]);
  const unique = [...new Set(sockets)];
  if (!pid) return unique;
  return unique.sort((left, right) => Number(!left.endsWith(`_${pid}`)) - Number(!right.endsWith(`_${pid}`)));
}

function remoteValue(value) {
  if (Object.prototype.hasOwnProperty.call(value, "value")) {
    if (typeof value.value === "string") return value.value;
    try { return JSON.stringify(value.value); } catch { return String(value.value); }
  }
  return value.description || value.unserializableValue || value.type || "undefined";
}

class WebViewInspector {
  constructor({ adb, serial, packageId, emit, log }) {
    this.adb = adb;
    this.serial = serial;
    this.packageId = packageId;
    this.emit = emit;
    this.log = log;
    this.client = null;
    this.forwardPort = null;
    this.target = null;
    this.stopped = false;
    this.reconnectTimer = null;
    this.reconnecting = false;
  }

  async discoverSocket() {
    const pidResult = await exec(this.adb, ["-s", this.serial, "shell", "pidof", this.packageId]).catch(() => ({ stdout: "" }));
    const pid = String(pidResult.stdout).trim().split(/\s+/)[0];
    const unix = await exec(this.adb, ["-s", this.serial, "shell", "cat", "/proc/net/unix"]);
    return parseWebViewSockets(unix.stdout, pid)[0] || null;
  }

  async connect(timeout = 15000) {
    const started = Date.now();
    while (!this.stopped && Date.now() - started < timeout) {
      const socket = await this.discoverSocket().catch(() => null);
      if (!socket) { await wait(500); continue; }
      try {
        const forwarded = await exec(this.adb, ["-s", this.serial, "forward", "tcp:0", `localabstract:${socket}`]);
        this.forwardPort = Number(String(forwarded.stdout).trim());
        const targets = await CDP.List({ host: "127.0.0.1", port: this.forwardPort });
        const target = targets.find((item) => item.type === "page" && !item.url.startsWith("devtools://")) || targets[0];
        if (!target) throw new Error("The WebView has no inspectable page yet.");
        // Android WebView does not expose Chrome's /json/protocol endpoint.
        this.client = await CDP({ target: target.webSocketDebuggerUrl, local: true });
        this.target = target;
        await this.enableDomains();
        this.emit("webview-status", { status: "connected", detail: target.title || target.url, url: target.url });
        this.log(`Connected to WebView DevTools: ${target.url || target.title}`);
        this.client.on("disconnect", () => {
          if (this.stopped) return;
          this.client = null;
          this.emit("webview-status", { status: "disconnected", detail: "WebView target changed; reconnecting" });
          this.removeForward().finally(() => this.scheduleReconnect());
        });
        return target;
      } catch (error) {
        await this.removeForward();
        if (Date.now() - started >= timeout) throw error;
        await wait(750);
      }
    }
    throw new Error("No debuggable Android WebView was found. Use a debug build with WebView debugging enabled.");
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer || this.reconnecting) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.reconnecting = true;
      try {
        await this.connect(30000);
      } catch (error) {
        if (!this.stopped) {
          this.emit("webview-status", { status: "unavailable", detail: error.message });
          this.log(error.message);
        }
      } finally {
        this.reconnecting = false;
      }
    }, 500);
  }

  async enableDomains() {
    const { Runtime, Log, Network } = this.client;
    await Promise.all([Runtime.enable(), Log.enable(), Network.enable()]);

    Runtime.consoleAPICalled(({ type, args, timestamp }) => {
      const level = type === "error" || type === "assert" ? "error" : type === "warning" ? "warn" : "info";
      this.emit("webview-console", { level, text: args.map(remoteValue).join(" "), timestamp });
    });
    Runtime.exceptionThrown(({ exceptionDetails, timestamp }) => {
      const exception = exceptionDetails.exception?.description || exceptionDetails.text;
      this.emit("webview-console", { level: "error", text: exception, timestamp });
    });
    Log.entryAdded(({ entry }) => {
      this.emit("webview-console", { level: entry.level === "warning" ? "warn" : entry.level, text: entry.text, url: entry.url, timestamp: entry.timestamp });
    });
    Network.requestWillBeSent(({ requestId, request, type, timestamp }) => {
      this.emit("network", { phase: "request", requestId, method: request.method, url: request.url, resourceType: type, timestamp });
    });
    Network.responseReceived(({ requestId, response, type, timestamp }) => {
      this.emit("network", { phase: "response", requestId, method: response.requestHeadersText ? undefined : "", url: response.url, status: response.status, statusText: response.statusText, resourceType: type, timestamp });
    });
    Network.loadingFailed(({ requestId, errorText, type, canceled, timestamp }) => {
      this.emit("network", { phase: "failed", requestId, errorText, resourceType: type, canceled, timestamp });
    });
  }

  async removeForward() {
    if (!this.forwardPort) return;
    const port = this.forwardPort;
    this.forwardPort = null;
    await exec(this.adb, ["-s", this.serial, "forward", "--remove", `tcp:${port}`]).catch(() => {});
  }

  async close() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.client) await this.client.close().catch(() => {});
    this.client = null;
    await this.removeForward();
  }
}

module.exports = { WebViewInspector, parseWebViewSockets, remoteValue };
