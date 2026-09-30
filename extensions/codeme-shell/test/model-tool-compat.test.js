const assert = require("assert");
const {
  recoverLooseToolCalls,
  ToolCallCompatProvider,
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
  console.log("ok server-model loose tool-call compatibility");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
