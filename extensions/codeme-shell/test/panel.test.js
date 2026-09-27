const assert = require("assert");
const { renderComposer } = require("../composer-view");
const { renderWelcome } = require("../welcome");
const { renderEmptyEditor } = require("../empty-editor");

const html = renderComposer("nonce-value");
assert.ok(html.includes("nonce-nonce-value"));
assert.ok(html.includes("composerKeyAction"));
assert.ok(html.includes("Ask, drop a file, or use Voice"));
assert.ok(html.includes(">CodeMe<"));
assert.ok(html.includes(">Send<"));
assert.ok(html.includes(">Attach<"));
assert.ok(html.includes(">Voice<"));
assert.ok(html.includes("select-mode"));
assert.ok(html.includes(">Ask<"));
assert.ok(html.includes(">Plan<"));
assert.ok(html.includes(">Code<"));
assert.ok(html.includes("ResourceURLs"));
assert.ok(!html.includes("qwen3.5:9b"));
assert.ok(!html.includes("File edits stay off"));
assert.ok(!html.includes("workbench.action.chat.open"));

const welcome = renderWelcome({ detail: "A local model is selected." }, "n");
assert.ok(welcome.includes(">Code Me<"));
assert.ok(welcome.includes("Open Folder"));
assert.ok(welcome.includes("Create Project"));
assert.ok(welcome.includes("README.md and .gitignore"));
assert.ok(welcome.includes("data-action=\"open\""));
assert.ok(welcome.includes("data-action=\"create\""));
assert.ok(welcome.includes("A local model is selected."));
assert.ok(!welcome.includes("GitHub Copilot"));

const empty = renderEmptyEditor("n");
assert.ok(empty.includes(">Code Me<"));
assert.ok(empty.includes("Open File"));
assert.ok(empty.includes("Search Files"));
assert.ok(empty.includes("Open Folder"));
assert.ok(empty.includes("Create Project"));
assert.ok(!empty.includes("GitHub Copilot"));

console.log("ok composer hub panel");
