const fs = require("node:fs");
const path = require("node:path");

const SOURCE_FRAME = /(?:\(|\s|^)((?:webpack-internal:\/\/\/)?(?:\.\/)?[^\s()]+?\.(?:[cm]?[jt]sx?|java|kt)):(\d+):(\d+)\)?/g;

function normalizeSourcePath(value) {
  return String(value)
    .replace(/^webpack-internal:\/\/\//, "")
    .replace(/^\([^)]*\)\//, "")
    .replace(/^\.\//, "")
    .replace(/[?#].*$/, "")
    .replaceAll("/", path.sep);
}

function findSourceFrames(text, projectRoot, limit = 3) {
  if (!projectRoot || !text) return [];
  const root = path.resolve(projectRoot);
  const frames = [];
  const seen = new Set();
  for (const match of String(text).matchAll(SOURCE_FRAME)) {
    const relativePath = normalizeSourcePath(match[1]);
    if (/^[a-z]+:/i.test(relativePath) || path.isAbsolute(relativePath)) continue;
    const file = path.resolve(root, relativePath);
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    const key = `${file}:${match[2]}:${match[3]}`;
    if (seen.has(key) || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    seen.add(key);
    frames.push({ file, relativePath: relative.replaceAll(path.sep, "/"), line: Number(match[2]), column: Number(match[3]) });
    if (frames.length >= limit) break;
  }
  return frames;
}

function formatSourceContext(frame, radius = 2) {
  const contents = fs.readFileSync(frame.file, "utf8");
  if (contents.length > 2_000_000) return "";
  const lines = contents.split(/\r?\n/);
  const target = Math.max(1, Math.min(frame.line, lines.length));
  const start = Math.max(1, target - radius);
  const end = Math.min(lines.length, target + radius);
  const width = String(end).length;
  const excerpt = [];
  for (let number = start; number <= end; number += 1) {
    excerpt.push(`${number === target ? ">" : " "} ${String(number).padStart(width)} | ${lines[number - 1]}`);
  }
  return `Source: ${frame.relativePath}:${frame.line}:${frame.column}\n${excerpt.join("\n")}`;
}

function enrichErrorText(text, projectRoot) {
  const value = String(text || "");
  const contexts = findSourceFrames(value, projectRoot).map((frame) => formatSourceContext(frame)).filter(Boolean);
  return contexts.length ? `${value}\n\n${contexts.join("\n\n")}` : value;
}

module.exports = { enrichErrorText, findSourceFrames, formatSourceContext, normalizeSourcePath };
