#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const EXTENSION_ID = "codeme.codeme-shell";
const MARKER = "CODEME_VOICE_MEDIA_PERMISSION";
const MICROPHONE_DESCRIPTION = "CodeMe uses the microphone only when you press Voice to dictate a prompt.";

function patchPermissionHandlers(source) {
  if (!source || source.includes(MARKER)) return { text: source, changed: false, count: 0 };
  let text = source;
  let count = 0;

  const requestPattern = /if\s*\(\s*isUrlFromWebview\(details\.requestingUrl\)\s*\)\s*\{\s*return\s+callback\(allowedPermissionsInWebview\.has\(permission\)\);\s*\}/;
  if (requestPattern.test(text)) {
    text = text.replace(requestPattern, [
      `if (isUrlFromWebview(details.requestingUrl)) {`,
      `\t\t\t// ${MARKER}: only the CodeMe Composer may request microphone audio.`,
      `\t\t\tif (permission === 'media' && String(details.requestingUrl || '').includes('extensionId=${EXTENSION_ID}')) {`,
      `\t\t\t\tconst mediaTypes = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];`,
      `\t\t\t\treturn callback(!mediaTypes.length || mediaTypes.every(type => type === 'audio'));`,
      `\t\t\t}`,
      `\t\t\treturn callback(allowedPermissionsInWebview.has(permission));`,
      `\t\t}`,
    ].join("\n"));
    count += 1;
  }

  const checkPattern = /if\s*\(\s*isUrlFromWebview\(details\.requestingUrl\)\s*\)\s*\{\s*return\s+allowedPermissionsInWebview\.has\(permission\);\s*\}/;
  if (checkPattern.test(text)) {
    text = text.replace(checkPattern, [
      `if (isUrlFromWebview(details.requestingUrl)) {`,
      `\t\t\tif (permission === 'media' && String(details.requestingUrl || '').includes('extensionId=${EXTENSION_ID}')) return true;`,
      `\t\t\treturn allowedPermissionsInWebview.has(permission);`,
      `\t\t}`,
    ].join("\n"));
    count += 1;
  }

  return { text, changed: count > 0, count };
}

function patchPermissionPolicy(source) {
  if (!source) return { text: source, changed: false, count: 0 };
  let text = source;
  let count = 0;

  // Workbench -> webview preload iframe.
  const outerPattern = /const\s+allowRules\s*=\s*\[([^\]]*?local-network-access[^\]]*?)\];/g;
  text = text.replace(outerPattern, (match, body) => {
    if (/microphone/.test(body)) return match;
    count += 1;
    return `const allowRules = [${body}, 'microphone'];`;
  });

  // Webview preload -> extension content iframe.
  const innerPattern = /const\s+allowRules\s*=\s*\[([^\]]*?local-network-access;[^\]]*?)\];/g;
  text = text.replace(innerPattern, (match, body) => {
    if (/microphone/.test(body)) return match;
    count += 1;
    return `const allowRules = [${body}, 'microphone;'];`;
  });

  return { text, changed: count > 0, count };
}

function walk(root, output = []) {
  if (!root || !fs.existsSync(root)) return output;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
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

function patchBuiltFiles(root) {
  const appBundle = path.join(root, "code-oss", ".build", "electron", "Code - OSS.app");
  const resourcesOut = path.join(appBundle, "Contents", "Resources", "app", "out");
  if (!fs.existsSync(resourcesOut)) {
    throw new Error(`Code - OSS built resources were not found at ${resourcesOut}`);
  }

  let permissionHandlerPatches = 0;
  let permissionPolicyPatches = 0;
  const changedFiles = [];

  for (const file of walk(resourcesOut)) {
    let source;
    try {
      const stat = fs.statSync(file);
      if (stat.size > 80 * 1024 * 1024) continue;
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    if (!source.includes("allowedPermissionsInWebview") && !source.includes("local-network-access")) continue;

    const handler = patchPermissionHandlers(source);
    const policy = patchPermissionPolicy(handler.text);
    if (handler.changed || policy.changed) {
      fs.writeFileSync(file, policy.text);
      changedFiles.push(path.relative(root, file));
      permissionHandlerPatches += handler.count;
      permissionPolicyPatches += policy.count;
    }
  }

  return { appBundle, permissionHandlerPatches, permissionPolicyPatches, changedFiles };
}

function ensureMicrophoneUsageDescription(appBundle) {
  if (process.platform !== "darwin") return { changed: false, skipped: true };
  const plist = path.join(appBundle, "Contents", "Info.plist");
  if (!fs.existsSync(plist)) throw new Error(`Info.plist was not found at ${plist}`);

  const plutil = "/usr/bin/plutil";
  try {
    execFileSync(plutil, ["-replace", "NSMicrophoneUsageDescription", "-string", MICROPHONE_DESCRIPTION, plist], { stdio: "ignore" });
  } catch {
    execFileSync(plutil, ["-insert", "NSMicrophoneUsageDescription", "-string", MICROPHONE_DESCRIPTION, plist], { stdio: "ignore" });
  }
  return { changed: true, plist };
}

function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const result = patchBuiltFiles(root);
  ensureMicrophoneUsageDescription(result.appBundle);

  const markerFile = path.join(root, ".tools", "codeme-microphone-patch.json");
  fs.mkdirSync(path.dirname(markerFile), { recursive: true });
  fs.writeFileSync(markerFile, JSON.stringify({
    extensionId: EXTENSION_ID,
    permissionHandlerPatches: result.permissionHandlerPatches,
    permissionPolicyPatches: result.permissionPolicyPatches,
    changedFiles: result.changedFiles,
    at: new Date().toISOString(),
  }, null, 2));

  if (result.permissionHandlerPatches < 1) {
    throw new Error("Could not patch Code - OSS webview media permission handler. The built shell layout may have changed.");
  }
  if (result.permissionPolicyPatches < 1) {
    throw new Error("Could not patch Code - OSS webview microphone Permissions Policy. The built shell layout may have changed.");
  }

  process.stdout.write(`CodeMe microphone patch ready (handler=${result.permissionHandlerPatches}, policy=${result.permissionPolicyPatches}).\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`CodeMe microphone patch failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = {
  EXTENSION_ID,
  MARKER,
  MICROPHONE_DESCRIPTION,
  patchPermissionHandlers,
  patchPermissionPolicy,
  patchBuiltFiles,
};
