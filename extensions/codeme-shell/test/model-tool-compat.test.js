const assert = require("assert");
const {
  recoverLooseToolCalls,
  ToolCallCompatProvider,
  isRetryableToolProtocolError,
} = require("../model-tool-compat");

const tools = [
  { name: "file.read", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "dir.list", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
];

const calls = recoverLooseToolCalls(
  'name: file_read, arguments: {path: "pages/Home.js"}\n' +
  'name: file_read, arguments: {path: "pages/About.js"}\n' +
  'Tool: dir_list, arguments: {path: "pages"}',
  tools,
);
assert.deepStrictEqual(calls, [
  { name: "file.read", args: { path: "pages/Home.js" } },
  { name: "file.read", args: { path: "pages/About.js" } },
  { name: "dir.list", args: { path: "pages" } },
]);

const variants = recoverLooseToolCalls(
  "Action: file_read, args: {'path': 'pages/Contact.js'}",
  tools,
);
assert.deepStrictEqual(variants, [
  { name: "file.read", args: { path: "pages/Contact.js" } },
]);

assert.strictEqual(
  isRetryableToolProtocolError(
    new Error('model request returned 500: {"error":"expected element type \\u003cfunction\\u003e but have \\u003cparameter\\u003e"}'),
  ),
  true,
);
assert.strictEqual(
  isRetryableToolProtocolError(new Error("model request returned 500: unrelated server failure")),
  false,
);

(async () => {
  const base = {
    name: "fixture",
    async complete() {
      return { text: 'name: dir_list, arguments: {path: "pages"}', toolCalls: [] };
    },
  };
  const provider = new ToolCallCompatProvider(base);
  const reply = await provider.complete({ tools });
  assert.deepStrictEqual(reply.toolCalls, [{ name: "dir.list", args: { path: "pages" } }]);
  assert.strictEqual(reply.text, "");

  let attempts = 0;
  let recoveryMessages = [];
  const parserDriftBase = {
    name: "fixture",
    async complete(input) {
      attempts += 1;
      recoveryMessages = input.messages || [];
      if (attempts === 1) {
        throw new Error('model request returned 500: {"error":"expected element type \\u003cfunction\\u003e but have \\u003cparameter\\u003e"}');
      }
      return {
        text: "",
        toolCalls: [{ name: "file.read", args: { path: "pages/Home.js" } }],
      };
    },
  };
  const parserDriftProvider = new ToolCallCompatProvider(parserDriftBase);
  const recoveredReply = await parserDriftProvider.complete({
    tools,
    messages: [{ role: "user", content: "Read the page" }],
  });
  assert.strictEqual(attempts, 2, "known Qwen/Ollama tool parser drift should retry exactly once");
  assert.deepStrictEqual(
    recoveredReply.toolCalls,
    [{ name: "file.read", args: { path: "pages/Home.js" } }],
  );
  assert.ok(
    recoveryMessages.some((message) => (
      message.role === "system"
      && /function wrapper before any parameter/i.test(message.content || "")
    )),
    "retry must include a narrow tool-protocol recovery reminder",
  );

  let unrelatedAttempts = 0;
  const unrelatedBase = {
    name: "fixture",
    async complete() {
      unrelatedAttempts += 1;
      throw new Error("model request returned 500: unrelated server failure");
    },
  };
  const unrelatedProvider = new ToolCallCompatProvider(unrelatedBase);
  await assert.rejects(
    () => unrelatedProvider.complete({ tools, messages: [] }),
    /unrelated server failure/,
  );
  assert.strictEqual(unrelatedAttempts, 1, "unrelated model failures must not be retried");

  console.log("ok server-model loose tool-call compatibility and Qwen parser recovery");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
