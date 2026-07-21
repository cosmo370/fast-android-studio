const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { detectProject, findPackageManager } = require("../main/core/project.cjs");
const { parseDevices } = require("../main/core/adb.cjs");
const { classify, genericProblem, redactSecrets } = require("../main/core/errors.cjs");
const { commandPath, diagnoseEnvironment } = require("../main/core/environment.cjs");
const { formatStackTrace, parseWebViewSockets, remoteValue } = require("../main/core/webview.cjs");
const { enrichErrorText, findSourceFrames } = require("../main/core/source-context.cjs");

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-console-"));
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return root;
}

test("detects a Capacitor project and its commands", () => {
  const root = fixture({
    "package.json": JSON.stringify({ name: "sample-app", scripts: { dev: "vite" }, dependencies: { "@capacitor/core": "1.0.0", vite: "1.0.0" } }),
    "capacitor.config.ts": "export default { appId: 'com.example.app' }",
    "android/gradlew.bat": "",
  });
  const project = detectProject(root);
  assert.equal(project.adapter, "capacitor");
  assert.equal(project.name, "sample-app");
  assert.equal(project.commands.sync.command, "npx");
  assert.equal(project.commands.build.args[0], "installDebug");
});

test("prefers the lockfile package manager", () => {
  const root = fixture({ "package.json": "{}", "pnpm-lock.yaml": "lockfileVersion: 9" });
  assert.equal(findPackageManager(root), "pnpm");
});

test("parses authorized, unauthorized, and emulator devices", () => {
  const devices = parseDevices(`List of devices attached\nR5CT device product:dm3q model:SM_S918N transport_id:1\nemulator-5554 device product:sdk model:sdk_gphone64_x86_64 transport_id:2\nABC unauthorized transport_id:3\n`);
  assert.equal(devices.length, 3);
  assert.equal(devices[0].model, "SM S918N");
  assert.equal(devices[1].kind, "emulator");
  assert.equal(devices[2].state, "unauthorized");
});

test("classifies high-value runtime errors", () => {
  assert.equal(classify("React hydration failed with error #418").id, "react-hydration");
  assert.equal(classify("GET /api/session status: 401").id, "api-401");
  assert.equal(classify("[DM] background upload failed Error: Unauthorized").id, "api-401");
  assert.equal(classify("FAILURE: Build failed with an exception.").id, "gradle");
  assert.equal(classify("GET /missing status 404").id, "http-error");
  assert.equal(classify("HTTP/1.1 503 Service Unavailable").id, "http-error");
  assert.equal(classify("MainActivity.java:105: error: cannot find symbol").id, "javac");
  assert.equal(classify('[Supabase] Native auth storage read failed; using localStorage').severity, "warn");
  assert.equal(classify("ordinary console output"), null);
});

test("creates a generic problem for otherwise unclassified errors", () => {
  assert.deepEqual(genericProblem(), {
    id: "unclassified-error",
    severity: "error",
    title: "Unclassified error",
  });
});

test("diagnoses the environment without spawning a shell", () => {
  assert.ok(commandPath("node"));
  const environment = diagnoseEnvironment();
  assert.ok(environment.node);
  assert.equal(environment.tools.find((tool) => tool.id === "node").status, "ready");
});

test("redacts auth secrets before logs reach the renderer", () => {
  const line = String.raw`{"access_token":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature","refresh_token":"secret-refresh"}`;
  const redacted = redactSecrets(line);
  assert.doesNotMatch(redacted, /signature|secret-refresh/);
  assert.match(redacted, /REDACTED/);
  assert.equal(redactSecrets("https://example.test/?access_token=secret&ok=1"), "https://example.test/?access_token=[REDACTED]&ok=1");
});

test("discovers the WebView DevTools socket for the active process", () => {
  const output = "00000000: 00000002 00000000 00010000 0001 01 12345 @webview_devtools_remote_42\n" +
    "00000000: 00000002 00000000 00010000 0001 01 12346 @webview_devtools_remote_99\n";
  assert.deepEqual(parseWebViewSockets(output, "99"), ["webview_devtools_remote_99", "webview_devtools_remote_42"]);
  assert.equal(remoteValue({ value: { ok: true } }), '{"ok":true}');
});

test("formats CDP call frames with browser-style source locations", () => {
  const stack = formatStackTrace({ callFrames: [{ functionName: "upload", url: "lib/upload/xhr-upload.ts", lineNumber: 48, columnNumber: 15 }] });
  assert.equal(stack, "    at upload (lib/upload/xhr-upload.ts:49:16)");
});

test("adds local source context to a captured browser stack", () => {
  const root = fixture({ "lib/upload/xhr-upload.ts": "line one\nline two\nreject(new Error(message));\nline four\nline five" });
  const detail = enrichErrorText("Error: Unauthorized\n    at xhr.onload (lib/upload/xhr-upload.ts:3:8)", root);
  assert.match(detail, /Source: lib\/upload\/xhr-upload\.ts:3:8/);
  assert.match(detail, /> 3 \| reject\(new Error\(message\)\);/);
  assert.equal(findSourceFrames("at x (../outside.ts:1:1)", root).length, 0);
});
