const fs = require("fs");
const os = require("os");
const path = require("path");
const { ModelProvider, RunStore, startAgentRun, ReadOnlyToolProvider, ToolRegistry } = require("../agent-runtime");
const { createWorkspaceHost } = require("../coding-qualify/host");
const { N8nCapabilityProvider } = require("./index.js");

class ScriptedModelProvider extends ModelProvider {
  constructor() {
    super("scripted");
    this.calls = [];
    this.turn = 0;
  }

  async complete(input) {
    this.calls.push(input);
    this.turn += 1;
    if (this.turn === 1) {
      return {
        text: "Checking the discovered hub.",
        toolCalls: [{ name: "capability.invoke", args: { capability: "hub.health", input: {} } }],
      };
    }
    return { text: "The hub observation is recorded.", toolCalls: [] };
  }
}

async function main() {
  const hub = new N8nCapabilityProvider({ retries: 1, retryDelayMs: 50 });
  const status = await hub.connectionStatus();
  const listed = status.connected ? await hub.listCapabilities() : [];
  const record = listed.find((item) => item.name === "hub.health");
  const evidence = {
    gate: 9,
    connection: { connected: status.connected, endpoint: status.endpoint },
    discovery: listed.map((item) => item.name),
    contract: record ? {
      category: record.category,
      risk: record.risk,
      provider: record.provider,
      version: record.version,
      availability: record.availability,
      health: record.health,
      timeout: record.timeout,
      hasInputSchema: Boolean(record.inputSchema),
      hasOutputSchema: Boolean(record.outputSchema),
      exposesRoute: JSON.stringify(record).includes("webhook") || Object.prototype.hasOwnProperty.call(record, "route"),
    } : null,
    observation: null,
  };
  if (!record || evidence.contract.exposesRoute || record.risk !== "read") {
    write(evidence);
    console.error("live discovery did not return a safe hub.health contract");
    process.exit(1);
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-gate9-live-"));
  const model = new ScriptedModelProvider();
  const run = await startAgentRun({
    goal: "Call the discovered hub.health capability and stop.",
    model: "scripted",
    providerName: "scripted",
    provider: model,
    registry: new ToolRegistry(new ReadOnlyToolProvider(createWorkspaceHost(directory))),
    store: new RunStore(path.join(directory, "runs")),
    capabilities: hub,
    mode: "read_only",
    maxIterations: 3,
    timeoutMs: 20000,
    verify(runState, text) {
      const observation = runState.observations.find((item) => item.type === "capability" && item.trusted === false && item.ok);
      if (observation && observation.summary.includes("codeme-hub-ok") && text.includes("recorded")) {
        return { status: "passed", summary: "The hub observation stayed untrusted", evidence: ["capability.invoke"] };
      }
      return { status: "failed", summary: "The hub observation was missing", evidence: [] };
    },
  }).done;
  const observation = run.observations.find((item) => item.type === "capability");
  evidence.runId = run.id;
  evidence.observation = observation ? {
    type: observation.type,
    trusted: observation.trusted,
    ok: observation.ok,
    requestId: observation.requestId,
    runId: observation.runId,
    correlated: observation.runId === run.id && observation.requestId === run.toolCalls[0].result.requestId,
  } : null;
  evidence.lifecycle = run.lifecycle;
  evidence.filesChanged = run.filesChanged;
  write(evidence);
  console.log(JSON.stringify(evidence));
  if (!evidence.observation || !evidence.observation.correlated || run.lifecycle !== "completed" || run.filesChanged.length !== 0) {
    process.exit(1);
  }
}

function write(evidence) {
  fs.mkdirSync(path.join(__dirname, "out"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "out/registry.json"), JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
