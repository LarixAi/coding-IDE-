const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, ToolRegistry, ReadOnlyToolProvider } = require("../agent-runtime");
const { N8nCapabilityProvider } = require("../n8n-capability");
const { ComposerSession } = require("../../extensions/codeme-shell/composer-session");

const RUNS = path.join(__dirname, "../../.tools/codeme-user-data/User/globalStorage/codeme.codeme-shell/composer-runs");

class ScriptedModel extends ModelProvider {
  constructor(steps) {
    super("scripted");
    this.steps = [...steps];
  }

  async complete() {
    const step = this.steps.shift();
    if (!step) throw Object.assign(new Error("no decision"), { code: "model_disconnected" });
    return { text: step.text || "", toolCalls: step.toolCalls || [] };
  }
}

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-research-run-"));
  fs.writeFileSync(path.join(workspace, "README.md"), "Car Bid Dealership preview on localhost:4173\n");
  fs.mkdirSync(RUNS, { recursive: true });
  const provider = new ScriptedModel([
    { text: "Reading the site.", toolCalls: [{ name: "file.read", args: { path: "README.md" } }] },
    { text: "The workspace site is a dealership preview." },
  ]);
  const host = {
    async readFile(file) {
      return { path: file, contents: fs.readFileSync(path.join(workspace, file), "utf8") };
    },
    async search() { return { query: "", matches: [] }; },
    async gitStatus() { return { branch: "main", changes: [] }; },
    async gitDiff() { return { diff: "" }; },
    async diagnostics() { return { items: [] }; },
    async browserCheck(url) { return { available: false, code: "browser_unavailable", message: "none", url }; },
  };
  const session = new ComposerSession({
    store: new RunStore(RUNS),
    selectionStore: { get() { return { provider: "scripted", id: "scripted" }; }, set() {} },
    listModels: async () => [{ provider: "scripted", id: "scripted", label: "Scripted" }],
    createProvider: () => provider,
    createRegistry: () => new ToolRegistry(new ReadOnlyToolProvider(host)),
    capabilities: new N8nCapabilityProvider({ retries: 0, retryDelayMs: 1 }),
    root: workspace,
  });
  await session.refreshModels();
  const started = await session.submit("research the website");
  if (!started.ok) {
    console.error(started);
    process.exit(1);
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20000) {
    if (!session.running) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const run = JSON.parse(fs.readFileSync(path.join(RUNS, `${started.runId}.json`), "utf8"));
  const invoked = (run.toolCalls || []).some((call) => call.name === "capability.invoke");
  console.log(JSON.stringify({
    runId: run.id,
    lifecycle: run.lifecycle,
    invokedN8n: invoked,
    recommended: run.progress && run.progress.recommendedName,
    selected: run.progress && run.progress.selectedName,
  }));
  if (!invoked) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
