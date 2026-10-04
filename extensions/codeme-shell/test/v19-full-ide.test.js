"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "media", "codeme-ide-v19-full-ide.html"), "utf8");
const panel = fs.readFileSync(path.join(root, "v19-full-ide-panel.js"), "utf8");
const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

for (const marker of [
  'class="ideShell"',
  'class="explorerPanel"',
  'class="centerStage"',
  'class="terminalPanel"',
  'class="browserPanel"',
  'class="chatColumn"',
  "V19 Full IDE desktop integration",
]) {
  assert.ok(html.includes(marker), "missing V19 HTML marker: " + marker);
}

for (const marker of [
  "v19-submit",
  "v19-select-mode",
  "v19-select-model",
  "v19-read-file",
  "v19-save-file",
  "v19-run-command",
  "codeme-v19-state",
  "collectWorkspaceEntries",
]) {
  assert.ok(panel.includes(marker), "missing V19 runtime bridge marker: " + marker);
}

assert.ok(extension.includes('require("./v19-full-ide-panel")'));
assert.ok(extension.includes('registerCommand("codeme.openV19FullIde"'));
assert.ok(extension.includes("v19FullIde.open()"));

const commands = new Set((manifest.contributes.commands || []).map((item) => item.command));
assert.ok(commands.has("codeme.openV19FullIde"));
assert.equal(manifest.contributes.configuration.properties["codeme.v19FullIde.enabled"].default, true);
assert.equal(manifest.contributes.configurationDefaults["workbench.activityBar.location"], "hidden");
assert.equal(manifest.contributes.configurationDefaults["workbench.statusBar.visible"], false);

console.log("ok V19 full IDE experiment wiring");
