const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  EXTENSION_ID,
  MARKER,
  patchPermissionHandlers,
  patchPermissionPolicy,
  runtimeRoots,
  patchBuiltFiles,
} = require("./patch-codeme-microphone");

const permissionFixture = `
const allowedPermissionsInWebview = new Set([
  ...alwaysAllowedPermissions,
  'clipboard-read',
  'clipboard-sanitized-write',
]);
session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
  if (isUrlFromWebview(details.requestingUrl)) {
    return callback(allowedPermissionsInWebview.has(permission));
  }
  return callback(false);
});
session.defaultSession.setPermissionCheckHandler((webContents, permission, origin, details) => {
  if (isUrlFromWebview(details.requestingUrl)) {
    return allowedPermissionsInWebview.has(permission);
  }
  return false;
});
`;

const patchedPermissions = patchPermissionHandlers(permissionFixture);
assert.strictEqual(patchedPermissions.changed, true);
assert.strictEqual(patchedPermissions.count, 2);
assert.ok(patchedPermissions.text.includes(MARKER));
assert.ok(patchedPermissions.text.includes(`extensionId=${EXTENSION_ID}`));
assert.ok(patchedPermissions.text.includes("mediaTypes.every(type => type === 'audio')"));
assert.ok(patchedPermissions.text.includes("permission === 'media'"));

const idempotentPermissions = patchPermissionHandlers(patchedPermissions.text);
assert.strictEqual(idempotentPermissions.changed, false);
assert.strictEqual(idempotentPermissions.text, patchedPermissions.text);

const policyFixture = `
const allowRules = ['cross-origin-isolated', 'autoplay', 'local-network-access'];
element.setAttribute('allow', allowRules.join('; '));
const other = true;
const allowRules = ['cross-origin-isolated;', 'autoplay;', 'local-network-access;'];
newFrame.setAttribute('allow', allowRules.join(' '));
`;

const patchedPolicy = patchPermissionPolicy(policyFixture);
assert.strictEqual(patchedPolicy.changed, true);
assert.strictEqual(patchedPolicy.count, 2);
assert.ok(patchedPolicy.text.includes("'microphone'"));
assert.ok(patchedPolicy.text.includes("'microphone;'"));

const idempotentPolicy = patchPermissionPolicy(patchedPolicy.text);
assert.strictEqual(idempotentPolicy.changed, false);
assert.strictEqual(idempotentPolicy.text, patchedPolicy.text);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-mic-path-"));
const devOut = path.join(tempRoot, "code-oss", "out");
fs.mkdirSync(devOut, { recursive: true });
const discoveredDev = runtimeRoots(tempRoot);
assert.deepStrictEqual(discoveredDev.roots, [devOut]);

const packagedOut = path.join(
  tempRoot,
  "code-oss",
  ".build",
  "electron",
  "Code - OSS.app",
  "Contents",
  "Resources",
  "app",
  "out",
);
fs.mkdirSync(packagedOut, { recursive: true });
const discoveredBoth = runtimeRoots(tempRoot);
assert.deepStrictEqual(discoveredBoth.roots, [devOut, packagedOut]);

// Full repeat-run regression: the launcher executes this patch on every start.
// A second run must recognize the already-patched handler/policy as valid.
const repeatRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-mic-repeat-"));
const repeatOut = path.join(repeatRoot, "code-oss", "out");
fs.mkdirSync(repeatOut, { recursive: true });
fs.writeFileSync(path.join(repeatOut, "electron-main.js"), permissionFixture);
fs.writeFileSync(path.join(repeatOut, "webview.js"), policyFixture);

const firstRun = patchBuiltFiles(repeatRoot);
assert.ok(firstRun.permissionHandlerPatches >= 1);
assert.ok(firstRun.permissionPolicyPatches >= 1);
assert.ok(firstRun.changedFiles.length >= 2);

const secondRun = patchBuiltFiles(repeatRoot);
assert.ok(secondRun.permissionHandlerPatches >= 1);
assert.ok(secondRun.permissionPolicyPatches >= 1);
assert.strictEqual(secondRun.changedFiles.length, 0);

console.log("ok CodeMe microphone host patch");
