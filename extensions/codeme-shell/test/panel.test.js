const assert = require("assert");
const { renderComposer } = require("../composer-view");
const { renderWelcome } = require("../welcome");
const { renderEmptyEditor } = require("../empty-editor");

const html = renderComposer("nonce-value");
assert.ok(html.includes("nonce-nonce-value"));
assert.ok(html.includes("composerKeyAction"));
assert.ok(html.includes("Describe the change"));
assert.ok(html.includes(">CodeMe<"));
assert.ok(html.includes(">Send<"));
assert.ok(html.includes(">Attach<"));
assert.ok(html.includes("select-mode"));
assert.ok(html.includes("ResourceURLs"));
assert.ok(!html.includes("qwen3.5:9b"));
assert.ok(!html.includes("File edits stay off"));
assert.ok(!html.includes("workbench.action.chat.open"));

const welcome = renderWelcome({ detail: "A local model is selected." }, "n");
assert.ok(welcome.includes(">CodeMe<"));
assert.ok(welcome.includes("Open Folder"));
assert.ok(welcome.includes("A local model is selected."));
assert.ok(!welcome.includes("GitHub Copilot"));

const empty = renderEmptyEditor("n");
assert.ok(empty.includes("Open File"));
assert.ok(empty.includes("Search Files"));
assert.ok(empty.includes("Open Terminal"));
assert.ok(empty.includes("Ask CodeMe"));
assert.ok(!empty.includes("GitHub Copilot"));

console.log("ok composer hub panel");
