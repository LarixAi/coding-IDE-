#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const lockPath = path.join(root, ".codeme", "pipeline-lock.json");

function fail(message) {
  console.error("\nPIPELINE LOCK FAILED\n" + message + "\n");
  process.exit(1);
}

function gitBlobSha(file) {
  try {
    return execFileSync("git", ["hash-object", file], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error && error.stderr ? String(error.stderr).trim() : "";
    fail("Could not hash " + file + (detail ? ": " + detail : ""));
  }
}

if (!fs.existsSync(lockPath)) {
  fail("Missing .codeme/pipeline-lock.json");
}

let lock;
try {
  lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
} catch (error) {
  fail("pipeline-lock.json is not valid JSON: " + (error instanceof Error ? error.message : String(error)));
}

const protectedFiles = lock && lock.protectedFiles && typeof lock.protectedFiles === "object"
  ? lock.protectedFiles
  : null;

if (!protectedFiles || !Object.keys(protectedFiles).length) {
  fail("pipeline-lock.json does not define protectedFiles.");
}

const mismatches = [];
for (const [relative, expected] of Object.entries(protectedFiles)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) {
    mismatches.push({ file: relative, expected, actual: "(missing)" });
    continue;
  }
  const actual = gitBlobSha(relative);
  if (actual !== expected) mismatches.push({ file: relative, expected, actual });
}

if (mismatches.length) {
  console.error("\nCanonical CodeMe pipeline v2 is LOCKED.");
  console.error("These protected files differ from the approved baseline:");
  for (const item of mismatches) {
    console.error(" - " + item.file);
    console.error("   expected: " + item.expected);
    console.error("   actual:   " + item.actual);
  }
  console.error("\nDo not update the lock hashes automatically.");
  console.error("A pipeline change requires explicit owner approval first.");
  console.error("Add-on work should use the documented extension points without changing the protected core.\n");
  process.exit(1);
}

console.log(
  "ok pipeline lock: " + Object.keys(protectedFiles).length
  + " protected files match baseline "
  + String(lock.baselineCommit || "").slice(0, 7)
);
