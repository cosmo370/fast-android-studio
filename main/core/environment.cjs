const fs = require("node:fs");
const path = require("node:path");

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function commandPath(name) {
  const directories = (process.env.PATH || "")
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  const hasExtension = Boolean(path.extname(name));
  const extensions = process.platform === "win32" && !hasExtension
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension.toLowerCase()}`);
      const alternate = path.join(directory, `${name}${extension.toUpperCase()}`);
      if (fs.existsSync(candidate)) return candidate;
      if (alternate !== candidate && fs.existsSync(alternate)) return alternate;
    }
  }
  return null;
}

function diagnoseEnvironment() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const local = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const sdk = firstExisting([
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    path.join(local, "Android", "Sdk"),
    path.join(home, "Android", "Sdk"),
  ]);
  const exe = process.platform === "win32" ? ".exe" : "";
  const adb = firstExisting([commandPath("adb"), sdk && path.join(sdk, "platform-tools", `adb${exe}`)]);
  const emulator = firstExisting([commandPath("emulator"), sdk && path.join(sdk, "emulator", `emulator${exe}`)]);
  const java = firstExisting([
    commandPath("java"),
    process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, "bin", `java${exe}`),
    path.join(programFiles, "Android", "Android Studio", "jbr", "bin", `java${exe}`),
  ]);
  const node = commandPath("node");

  const tools = [
    { id: "node", label: "Node.js", path: node, required: true },
    { id: "android-sdk", label: "Android SDK", path: sdk, required: false },
    { id: "adb", label: "ADB", path: adb, required: false },
    { id: "java", label: "JDK", path: java, required: false },
    { id: "emulator", label: "Android Emulator", path: emulator, required: false },
  ].map((tool) => ({ ...tool, status: tool.path ? "ready" : "missing" }));

  return { sdk, adb, emulator, java, node, tools };
}

module.exports = { commandPath, diagnoseEnvironment };
