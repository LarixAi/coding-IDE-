const assert = require("assert");
const { renderComposer } = require("../composer-view");
const { renderWelcome } = require("../welcome");

const html = renderComposer("nonce-value");
assert.ok(html.includes("nonce-nonce-value"));
assert.ok(html.includes("composerKeyAction"));
assert.ok(html.includes("Describe the change"));
assert.ok(html.includes("Understanding"));
assert.ok(html.includes("Complete"));
assert.ok(!html.includes("qwen3.5:9b"));

const welcome = renderWelcome({ detail: "A local model is selected." }, "n");
assert.ok(welcome.includes(">CodeMe<"));
assert.ok(welcome.includes("Open Folder"));
assert.ok(welcome.includes("A local model is selected."));
assert.ok(!welcome.includes("GitHub Copilot"));

console.log("ok composer hub panel");
