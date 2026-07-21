const fs = require("node:fs");
const path = require("node:path");

const exists = (root, name) => fs.existsSync(path.join(root, name));

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function findPackageManager(root) {
  if (exists(root, "pnpm-lock.yaml")) return "pnpm";
  if (exists(root, "yarn.lock")) return "yarn";
  if (exists(root, "bun.lock") || exists(root, "bun.lockb")) return "bun";
  return "npm";
}

function packageRun(manager, script) {
  if (manager === "npm") return { command: "npm", args: ["run", script] };
  return { command: manager, args: ["run", script] };
}

function detectProject(root) {
  if (!root || !fs.existsSync(root)) throw new Error("Project folder does not exist.");
  const pkg = readJson(path.join(root, "package.json"));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const scripts = pkg.scripts || {};
  const manager = findPackageManager(root);
  let adapter = "unknown";

  if (exists(root, "capacitor.config.ts") || exists(root, "capacitor.config.json") || deps["@capacitor/core"]) adapter = "capacitor";
  else if (exists(root, "pubspec.yaml")) adapter = "flutter";
  else if (deps.expo) adapter = "expo";
  else if (deps["react-native"] || exists(root, "react-native.config.js")) adapter = "react-native";
  else if (exists(root, "settings.gradle") || exists(root, "settings.gradle.kts") || exists(root, "android/settings.gradle")) adapter = "android";
  else if (deps.next || exists(root, "next.config.js") || exists(root, "next.config.mjs")) adapter = "next";
  else if (deps.vite || exists(root, "vite.config.ts") || exists(root, "vite.config.js")) adapter = "vite";
  else if (Object.keys(pkg).length) adapter = "web";

  const devScript = scripts.dev ? "dev" : scripts.start ? "start" : null;
  const preview = devScript ? packageRun(manager, devScript) : null;
  const androidRoot = exists(root, "android") ? path.join(root, "android") : root;
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";

  return {
    root,
    name: pkg.name || path.basename(root),
    adapter,
    packageManager: manager,
    scripts: Object.keys(scripts),
    capabilities: {
      preview: Boolean(preview) && !["android", "flutter"].includes(adapter),
      android: ["capacitor", "android", "react-native", "expo", "flutter"].includes(adapter),
    },
    commands: {
      install: manager === "npm" ? { command: "npm", args: ["install"] } : { command: manager, args: ["install"] },
      preview,
      sync: adapter === "capacitor" ? { command: "npx", args: ["cap", "sync", "android"] } : null,
      build: fs.existsSync(path.join(androidRoot, gradlew))
        ? { command: path.join(androidRoot, gradlew), args: ["installDebug"], cwd: androidRoot }
        : null,
    },
  };
}

module.exports = { detectProject, findPackageManager };
