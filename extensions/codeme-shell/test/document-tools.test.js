const assert = require("assert");
const {
  ReadOnlyToolProvider,
  ControlledToolProvider,
  ToolRegistry,
} = require("../../../packages/agent-runtime/tool-registry");

async function main() {
  const host = {
    async readDocument(filePath) {
      return { path: filePath, format: "docx", contents: "Hello" };
    },
    async createDocument(filePath, contents) {
      return { path: filePath, bytes: contents.length, changed: true };
    },
    async editDocument(filePath) {
      return { path: filePath, replacements: 1, changed: true };
    },
  };

  const readOnly = new ToolRegistry(new ReadOnlyToolProvider(host));
  const readOnlyNames = readOnly.definitions().map((tool) => tool.name);
  assert.ok(readOnlyNames.includes("document.read"));
  assert.ok(!readOnlyNames.includes("document.create"));
  assert.ok(!readOnlyNames.includes("document.edit"));

  const read = await readOnly.call("document.read", { path: "report.docx" });
  assert.strictEqual(read.ok, true);
  const blocked = await readOnly.call("document.create", { path: "report.docx", contents: "Hello" });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.error.code, "mutation_blocked");

  const controlled = new ToolRegistry(new ControlledToolProvider(host));
  const controlledNames = controlled.definitions().map((tool) => tool.name);
  assert.ok(controlledNames.includes("document.read"));
  assert.ok(controlledNames.includes("document.create"));
  assert.ok(controlledNames.includes("document.edit"));

  assert.strictEqual((await controlled.call("document.create", { path: "report.docx", contents: "Hello" })).ok, true);
  assert.strictEqual((await controlled.call("document.edit", { path: "report.docx", oldText: "Hello", newText: "Hi" })).ok, true);

  console.log("ok document tool policy");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
