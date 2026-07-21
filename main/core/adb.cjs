const { execFile } = require("node:child_process");

function exec(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8", windowsHide: true, ...options }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

function parseDevices(output) {
  return output.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [serial, state, ...details] = line.split(/\s+/);
    const fields = Object.fromEntries(details.filter((item) => item.includes(":"))
      .map((item) => { const index = item.indexOf(":"); return [item.slice(0, index), item.slice(index + 1)]; }));
    return {
      serial,
      state,
      model: (fields.model || serial).replaceAll("_", " "),
      product: fields.product || "",
      transportId: fields.transport_id || "",
      kind: serial.startsWith("emulator-") ? "emulator" : "usb",
    };
  });
}

async function listDevices(adb) {
  if (!adb) return [];
  const { stdout } = await exec(adb, ["devices", "-l"]);
  return parseDevices(stdout);
}

async function listAvds(emulator) {
  if (!emulator) return [];
  const { stdout } = await exec(emulator, ["-list-avds"]);
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

module.exports = { exec, parseDevices, listDevices, listAvds };
