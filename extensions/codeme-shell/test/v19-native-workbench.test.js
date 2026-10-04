"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { parseAddedLines, collectChangedLines } = require("../v19-native-diff");

const root = path.join(__dirname, "..");

const diff = [
  "diff --git a/src/app.js b/src/app.js",
  "--- a/src/app.js",
  "+++ b/src/app.js",
  "@@ -3,3 +3,5 @@",
  " const a = 1;",
  "-const oldName = true;",
  "+const newName = true;",
  "+const added = 2;",
  " return a;",
].join("\n");

assert.deepEqual(parseAddedLines(diff), [3, 4]);

const changed = collectChangedLines(
  [{ path: "src/app.js", diff }],
  ["src/app.js", "src/styles.css"],
);
assert.deepEqual(changed.get("src/app.js"), [3, 4]);
assert.deepEqual(changed.get("src/styles.css"), []);

const source = fs.readFileSync(path.join(root, "v19-native-workbench.js"), "utf8");
assert.ok(source.includes("createTextEditorDecorationType"));
assert.ok(source.includes("registerCodeLensProvider"));
assert.ok(source.includes("codeme.v19.applyLayout"));
assert.ok(source.includes("workbench.action.positionSideBarLeft"));
assert.ok(source.includes("workbench.action.positionPanelBottom"));
assert.ok(source.includes("workbench.action.positionAuxiliaryBarRight"));
assert.ok(source.includes("codeme.agent.focus"));

const extension = fs.readFileSync(path.join(root, "extension.js"), "utf8");
assert.ok(extension.includes('require("./v19-native-workbench")'));
assert.ok(extension.includes("v19NativeWorkbench.update(snapshot)"));
assert.ok(extension.includes("v19NativeWorkbench.applyLayout()"));

const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const defaults = manifest.contributes.configurationDefaults;
assert.equal(defaults["workbench.colorTheme"], "CodeMe V19");
assert.equal(defaults["workbench.secondarySideBar.defaultVisibility"], "visible");
assert.equal(defaults["workbench.panel.defaultLocation"], "bottom");
assert.equal(defaults["workbench.sideBar.location"], "left");
assert.equal(defaults["workbench.activityBar.location"], "default");

const commands = new Set((manifest.contributes.commands || []).map((item) => item.command));
assert.ok(commands.has("codeme.v19.applyLayout"));
assert.ok(commands.has("codeme.v19.clearChangeMarkers"));

const theme = JSON.parse(fs.readFileSync(path.join(root, "themes", "codeme-dark-color-theme.json"), "utf8"));
assert.equal(theme.name, "CodeMe V19");
assert.equal(theme.colors["activityBar.background"], "#181818");
assert.equal(theme.colors["sideBar.background"], "#1b1b1b");
assert.equal(theme.colors["editor.background"], "#1e1e1e");
assert.equal(theme.colors["panel.background"], "#181818");
assert.equal(theme.colors["secondarySideBar.background"], "#191919");

console.log("ok V19 native workbench");
