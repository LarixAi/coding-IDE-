const assert = require("assert");
const { renderComposer } = require("../hub-panel");
const { renderWelcome } = require("../welcome");

const html = renderComposer({
  connected: true,
  capabilities: ["hub.health", "research.problem", "knowledge.lookup", "task.decompose"],
  detail: "Intelligence hub connected.",
}, "nonce-value");

assert.ok(html.includes("data-action=\"research.problem\""));
assert.ok(html.includes("data-action=\"knowledge.lookup\""));
assert.ok(html.includes("data-action=\"task.decompose\""));
assert.ok(html.includes("File edits stay off."));
assert.ok(html.includes("nonce-nonce-value"));
assert.ok(!html.includes("file.write"));
assert.ok(!html.includes("terminal.run"));

const offline = renderComposer({ connected: false, capabilities: [], detail: "Intelligence hub is not reachable." }, "n");
assert.ok(offline.includes("Intelligence hub is not reachable."));
assert.ok(offline.includes("Describe the change"));
assert.ok(offline.includes("Delegate work to CodeMe"));
const withModel = renderComposer({
  connected: false,
  capabilities: [],
  detail: "Intelligence hub is not reachable.",
  model: { detail: "qwen3.5:9b is installed." },
}, "n");
assert.ok(withModel.includes("Local model"));
assert.ok(withModel.includes("qwen3.5:9b is installed."));
assert.ok(!offline.includes("data-action"));
assert.ok(offline.includes("nonce-n"));

const welcome = renderWelcome({ detail: "qwen3.5:9b is installed." }, "n");
assert.ok(welcome.includes(">CodeMe<"));
assert.ok(welcome.includes("Open Folder"));
assert.ok(welcome.includes("qwen3.5:9b is installed."));
assert.ok(!welcome.includes("GitHub Copilot"));
assert.ok(!welcome.includes("Get started with VS Code"));

console.log("ok composer hub panel");
