const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore } = require("../../../packages/agent-runtime");
const { ComposerSession } = require("../composer-session");

class FollowUpProvider extends ModelProvider {
  constructor() {
    super("fixture");
    this.calls = [];
  }

  async complete(input) {
    this.calls.push(input);
    if (this.calls.length === 1) {
      return { text: "", toolCalls: [{ name: "file.read", args: { path: "README.md" } }] };
    }
    const text = input.messages.map((message) => String(message.content || "")).join("\n");
    assert.match(text, /also mention the active project/i);
    return { text: "The active project is Demo.", toolCalls: [] };
  }
}

class ReadOnlyRegistry {
  definitions() {
    return [
      { name: "workspace.inspect", description: "Inspect workspace", parameters: { type: "object", properties: {}, required: [] } },
      { name: "dir.list", description: "List directory", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "file.read", description: "Read file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    ];
  }

  async call(name) {
    if (name === "workspace.inspect") {
      return {
        ok: true,
        tool: name,
        data: {
          state: "project",
          root: "fixture",
          projectMarkers: ["README.md"],
          languages: ["Markdown"],
          frameworks: [],
          scripts: {},
          git: false,
        },
      };
    }
    if (name === "dir.list") {
      return { ok: true, tool: name, data: { entries: [{ path: "README.md", type: "file" }] } };
    }
    if (name === "file.read") {
      return { ok: true, tool: name, data: { path: "README.md", contents: "# Demo\n" } };
    }
    return { ok: false, tool: name, error: { code: "unknown_tool", message: name } };
  }
}

async function waitFor(session, predicate) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (predicate(session)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for ComposerSession");
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-composer-pipeline-"));
  fs.writeFileSync(path.join(root, "README.md"), "# Demo\n");
  const provider = new FollowUpProvider();
  const selected = { provider: "fixture", id: "fixture-model", label: "Fixture Model" };
  const session = new ComposerSession({
    store: new RunStore(path.join(root, "runs")),
    selectionStore: {
      get: () => selected,
      set() {},
      getMode: () => "ask",
      setMode() {},
    },
    listModels: async () => [selected],
    createProvider: () => provider,
    createRegistry: () => new ReadOnlyRegistry(),
    capabilities: null,
    root,
  });

  await session.refreshModels();
  const first = await session.submit("Read the README and answer briefly.", 1);
  assert.strictEqual(first.ok, true);
  assert.ok(first.runId);

  const followUp = await session.submit("Also mention the active project.", 2);
  assert.strictEqual(followUp.ok, true);
  assert.strictEqual(followUp.followUp, true);
  assert.strictEqual(followUp.runId, first.runId, "follow-up must remain in the same active run");

  await waitFor(session, (item) => !item.running && item.stage === "Complete");
  assert.strictEqual(session.runId, first.runId);
  assert.ok(session.thread.some((item) => /active project is Demo/i.test(item.text)));
  assert.ok(provider.calls.length >= 2);

  console.log("ok composer live follow-up stays in active pipeline run");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
