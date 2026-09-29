const assert = require("assert");
const { compactRunStream } = require("../composer-client");

const stream = compactRunStream({
  decisions: [{
    iteration: 1,
    text: "I found the button handler. I’ll update the page and verify it.",
    toolCalls: [{ name: "file.patch" }],
  }],
  toolCalls: [{
    iteration: 1,
    directedBy: "model",
    name: "file.patch",
    args: {
      path: "src/app.js",
      oldText: "button.textContent = 'Click Me';",
      newText: "button.textContent = 'It works!';",
    },
    result: { ok: true, data: { path: "src/app.js" } },
  }],
});

assert.strictEqual(stream.length, 2);
assert.strictEqual(stream[0].type, "narration");
assert.ok(stream[0].text.includes("update the page"));
assert.strictEqual(stream[1].type, "tool");
assert.strictEqual(stream[1].name, "file.patch");
assert.strictEqual(stream[1].path, "src/app.js");
assert.strictEqual(stream[1].preview.additions, 1);
assert.strictEqual(stream[1].preview.removals, 1);

const quietContext = compactRunStream({
  decisions: [],
  toolCalls: [{
    iteration: 0,
    directedBy: "context",
    name: "workspace.inspect",
    args: {},
    result: { ok: true, data: { state: "project" } },
  }],
});
assert.deepStrictEqual(quietContext, []);

const failedContext = compactRunStream({
  decisions: [],
  toolCalls: [{
    iteration: 0,
    directedBy: "context",
    name: "file.read",
    args: { path: "AGENTS.md" },
    result: { ok: false, error: { code: "not_found", message: "AGENTS.md not found" } },
  }],
});
assert.strictEqual(failedContext.length, 1);
assert.strictEqual(failedContext[0].status, "failed");

const qwenFallbackNoise = compactRunStream({
  decisions: [{
    iteration: 1,
    text: '<tool_call>{"name":"file_read","arguments":{"path":"index.html"}}</tool_call>',
    toolCalls: [{ name: "file.read" }],
  }],
  toolCalls: [{
    iteration: 1,
    directedBy: "model",
    name: "file.read",
    args: { path: "index.html" },
    result: { ok: true, data: { contents: "<h1>CodeMe</h1>" } },
  }],
});
assert.strictEqual(qwenFallbackNoise.filter((item) => item.type === "narration").length, 0);
assert.strictEqual(qwenFallbackNoise.filter((item) => item.type === "tool").length, 1);

console.log("ok compact conversational composer stream");
