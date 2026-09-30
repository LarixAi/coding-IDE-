#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { runtimeRoots, MARKER } = require("./patch-codeme-microphone");

function restorePermissionHandlers(source) {
  let text = String(source || "");
  let changed = false;

  const patchedRequest = [
    `if (isUrlFromWebview(details.requestingUrl)) {`,
    `\t\t\t// ${MARKER}: only the CodeMe Composer may request microphone audio.`,
    `\t\t\tif (permission === 'media' && String(details.requestingUrl || '').includes('extensionId=codeme.codeme-shell')) {`,
    `\t\t\t\tconst mediaTypes = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];`,
    `\t\t\t\treturn callback(!mediaTypes.length || mediaTypes.every(type => type === 'audio'));`,
    `\t\t\t}`,
    `\t\t\treturn callback(allowedPermissionsInWebview.has(permission));`,
    `\t\t}`,
  ].join("\n");

  const originalRequest = [
    `if (isUrlFromWebview(details.requestingUrl)) {`,
    `\t\t\treturn callback(allowedPermissionsInWebview.has(permission));`,
    `\t\t}`,
  ].join("\n");

  if (text.includes(patchedRequest)) {
    text = text.replace(patchedRequest, originalRequest);
    changed = true;
  }

  const patchedCheck = [
    `if (isUrlFromWebview(details.requestingUrl)) {`,
    `\t\t\tif (permission === 'media' && String(details.requestingUrl || '').includes('extensionId=codeme.codeme-shell')) return true;`,
    `\t\t\treturn allowedPermissionsInWebview.has(permission);`,
    `\t\t}`,
  ].join("\n");

  const originalCheck = [
    `if (isUrlFromWebview(details.requestingUrl)) {`,
    `\t\t\treturn allowedPermissionsInWebview.has(permission);`,
    `\t\t}`,
  ].join("\n");

  if (text.includes(patchedCheck)) {
    text = text.replace(patchedCheck, originalCheck);
    changed = true;
  }

  return { text, changed };
}

function restorePermissionPolicy(source) {
  let text = String(source || "");
  let changed = false;

  text = text.replace(
    /const\s+allowRules\s*=\s*\[([^\]]*?),\s*'microphone;'\s*\];/g,
    (_match, body) => {
      changed = true;
      return `const allowRules = [${body}];`;
    },
  );

  text = text.replace(
    /const\s+allowRules\s*=\s*\[([^\]]*?),\s*'microphone'\s*\];/g,
    (_match, body) => {
      changed = true;
      return `const allowRules = [${body}];`;
    },
  );

  return { text, changed };
}

function walk(root, output = []) {
  if (!root || !fs.existsSync(root)) return output;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walk(full, output);
    } else if (entry.isFile() && /\.(?:js|mjs|html)$/i.test(entry.name)) {
      output.push(full);
    }
  }
  return output;
}

function restoreRuntime(root) {
  const discovered = runtimeRoots(root);
  if (!discovered.roots.length) {
    throw new Error("Code - OSS runtime output was not found.");
  }

  const restoredFiles = [];
  for (const runtimeRoot of discovered.roots) {
    for (const file of walk(runtimeRoot)) {
      let source;
      try {
        source = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (!source.includes(MARKER) && !/allowRules[\s\S]{0,500}microphone/.test(source)) continue;

      const handlers = restorePermissionHandlers(source);
      const policy = restorePermissionPolicy(handlers.text);
      if (handlers.changed || policy.changed) {
        fs.writeFileSync(file, policy.text);
        restoredFiles.push(path.relative(root, file));
      }
    }
  }

  const markerFile = path.join(root, ".tools", "codeme-microphone-patch.json");
  try {
    if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile);
  } catch {}

  return {
    runtimeRoots: discovered.roots.map((item) => path.relative(root, item)),
    restoredFiles,
  };
}

function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const result = restoreRuntime(root);
  process.stdout.write(
    result.restoredFiles.length
      ? `CodeMe webview runtime restored (${result.restoredFiles.length} file(s)).\n`
      : "CodeMe webview runtime already clean.\n",
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`CodeMe webview restore failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = {
  restorePermissionHandlers,
  restorePermissionPolicy,
  restoreRuntime,
};
