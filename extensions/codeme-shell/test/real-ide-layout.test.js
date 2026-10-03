const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { renderComposer } = require("../composer-view");

const shellRoot = path.join(__dirname, "..");

test("Composer routes approved mock controls to real IDE surfaces", () => {
  const html = renderComposer("test-nonce");
  assert.match(html, /type: "open-explorer"/);
  assert.match(html, /type: "open-terminal"/);
  assert.match(html, /type: "open-preview"/);
  assert.match(html, /type: "open-file"/);
  assert.match(html, /View technical activity/);
  assert.doesNotMatch(html, /class="fake-editor"/);
  assert.doesNotMatch(html, /class="fake-explorer"/);
  assert.doesNotMatch(html, /class="fake-terminal"/);
});

test("extension bridges Composer to native Code OSS commands", () => {
  const source = fs.readFileSync(path.join(shellRoot, "extension.js"), "utf8");
  assert.match(source, /workbench\.view\.explorer/);
  assert.match(source, /workbench\.action\.terminal\.focus/);
  assert.match(source, /simpleBrowser\.show/);
  assert.match(source, /vscode\.open/);
  assert.match(source, /message\.type === "open-file"/);
});

test("manifest keeps Explorer, Terminal, Preview and secondary chat as real workbench surfaces", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(shellRoot, "package.json"), "utf8"));
  const commands = new Set((manifest.contributes.commands || []).map((item) => item.command));
  assert.ok(commands.has("codeme.openExplorer"));
  assert.ok(commands.has("codeme.openTerminal"));
  assert.ok(commands.has("codeme.openPreview"));
  assert.ok(commands.has("codeme.openFile"));
  assert.equal(manifest.contributes.configurationDefaults["workbench.secondarySideBar.defaultVisibility"], "visible");
  assert.equal(manifest.contributes.configurationDefaults["workbench.panel.defaultLocation"], "bottom");
  assert.equal(manifest.contributes.configurationDefaults["explorer.compactFolders"], false);
});
