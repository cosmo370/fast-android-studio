const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const executable = process.execPath;
const cli = require.resolve("electron-builder/out/cli/cli.js");
const electronDist = path.join(process.cwd(), "node_modules", "electron", "dist");
const args = [cli, "--win", "nsis", "--x64", "--publish", "never"];

// Reusing the installed runtime avoids Windows antivirus locks during archive extraction.
// CI installations that omit the binary fall back to electron-builder's normal download.
if (fs.existsSync(path.join(electronDist, "electron.exe"))) {
  args.push(`--config.electronDist=${electronDist}`);
}

const result = spawnSync(executable, args, {
  cwd: process.cwd(),
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  stdio: "inherit",
  shell: false,
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
