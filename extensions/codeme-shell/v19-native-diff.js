"use strict";

function collectChangedLines(fileDiffs, filesChanged) {
  const map = new Map();

  for (const item of Array.isArray(fileDiffs) ? fileDiffs : []) {
    const path = normalizePath(item && item.path);
    if (!path) continue;
    map.set(path, parseAddedLines(item && item.diff));
  }

  for (const file of Array.isArray(filesChanged) ? filesChanged : []) {
    const path = normalizePath(file);
    if (path && !map.has(path)) map.set(path, []);
  }

  return map;
}

function normalizePath(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function parseAddedLines(diff) {
  const lines = [];
  let newLine = 0;
  let inHunk = false;

  for (const raw of String(diff || "").split(/\r?\n/)) {
    const hunk = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(raw);
    if (hunk) {
      newLine = Math.max(0, Number(hunk[1]) - 1);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith("+++")) continue;
    if (raw.startsWith("---")) continue;

    if (raw.startsWith("+")) {
      lines.push(newLine);
      newLine += 1;
      continue;
    }
    if (raw.startsWith("-")) continue;
    if (raw.startsWith("\\ No newline at end of file")) continue;

    newLine += 1;
  }

  return [...new Set(lines)];
}

module.exports = { collectChangedLines, normalizePath, parseAddedLines };
