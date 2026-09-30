const assert = require("assert");
const { renderComposer } = require("../composer-view");
const { renderWelcome, formatRelativeTime } = require("../welcome");
const { renderEmptyEditor } = require("../empty-editor");

const html = renderComposer("nonce-value");
assert.ok(html.includes("nonce-nonce-value"));
assert.ok(html.includes("composerKeyAction"));
assert.ok(html.includes("Ask CodeMe anything, @ files or type /"));
assert.ok(html.includes(">CodeMe<"));
assert.ok(html.includes('aria-label="Send">↑</button>'));
assert.ok(html.includes("clearSendPending"));
assert.ok(html.includes('message.type === "submitting"'));
assert.ok(!html.includes("sameRequest("));
const composerScript = html.match(/<script nonce="nonce-value">([\s\S]*?)<\/script>/);
assert.ok(composerScript, "composer script");
new Function(composerScript[1]);
assert.ok(composerScript[1].includes("function renderMarkdownText"));
assert.ok(composerScript[1].includes('replace(/\\r\\n/g, "\\n").split("\\n")'));
assert.ok(composerScript[1].includes('prompt.addEventListener'));
assert.ok(composerScript[1].includes('send.addEventListener'));
assert.ok(composerScript[1].includes('vscode.postMessage({ type: "submit"'));
assert.ok(html.includes("＋ Context"));
assert.ok(html.includes(">Mic<"));
assert.ok(html.includes("select-mode"));
assert.ok(html.includes(">Ask<"));
assert.ok(html.includes(">Plan<"));
assert.ok(html.includes(">Code<"));
assert.ok(html.includes('id="changed-files"'));
assert.ok(html.includes("work-note"));
assert.ok(html.includes('send.title = running ? "Add follow-up" : "Send"'));
assert.ok(!html.includes("if (sending || running) return;"));
assert.ok(html.includes("ResourceURLs"));
assert.ok(!html.includes("qwen3.5:9b"));
assert.ok(!html.includes("File edits stay off"));
assert.ok(!html.includes("workbench.action.chat.open"));

const welcome = renderWelcome({
  detail: "A local model is selected.",
  ready: true,
  modelLabel: "Qwen 3.5 8B",
  recent: [{ name: "docs-site", path: "~/Projects/docs-site", when: "2 days ago", uri: "file:///tmp/docs-site" }],
}, "n");
assert.ok(welcome.includes("Welcome to CodeMe"));
assert.ok(welcome.includes("Open Folder"));
assert.ok(welcome.includes("Create Project"));
assert.ok(welcome.includes("Clone Repository"));
assert.ok(welcome.includes("Connect AI Provider"));
assert.ok(welcome.includes("Recent Projects"));
assert.ok(welcome.includes("Quick Start"));
assert.ok(welcome.includes("docs-site"));
assert.ok(welcome.includes("Local model ready"));
assert.ok(welcome.includes("Qwen 3.5 8B"));
assert.ok(!welcome.includes("GitHub Copilot"));

const offline = renderWelcome({ detail: "A local model is selected." }, "n");
assert.ok(offline.includes("A local model is selected."));
assert.ok(!offline.includes("Local model ready"));

assert.strictEqual(formatRelativeTime(Date.now() - 2 * 24 * 60 * 60 * 1000, Date.now()), "2 days ago");

const empty = renderEmptyEditor("n");
assert.ok(empty.includes("Open File"));
assert.ok(empty.includes("Search Files"));
assert.ok(empty.includes("Open Terminal"));
assert.ok(empty.includes("Ask CodeMe"));
assert.ok(!empty.includes("GitHub Copilot"));

console.log("ok composer hub panel");
