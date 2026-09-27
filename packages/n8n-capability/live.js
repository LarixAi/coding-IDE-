const fs = require("fs");
const path = require("path");
const { ModelProvider, OllamaModelProvider, RunStore, startAgentRun, ControlledToolProvider, ToolRegistry } = require("../agent-runtime");
const { buildRequest } = require("../agent-runtime/capability");
const { createWorkspaceHost } = require("../coding-qualify/host");
const { N8nCapabilityProvider } = require("./index.js");

const MARKER = "codeme-hub-ok";
const MODEL = process.env.CODEME_QWEN_MODEL || "qwen3.5:9b";
const ROOT = path.join(__dirname, "../..");

class HybridModelProvider extends ModelProvider {
  constructor(ollama) {
    super("hybrid");
    this.ollama = ollama;
    this.calls = [];
    this.turn = 0;
  }

  async complete(input) {
    this.calls.push({ messages: input.messages, tools: (input.tools || []).map((tool) => tool.name) });
    this.turn += 1;
    if (this.turn === 1) {
      return {
        text: "Checking the external hub.",
        toolCalls: [{ name: "capability.invoke", args: { capability: "hub.health", input: {} } }],
      };
    }
    return this.ollama.complete(input);
  }
}

async function main() {
  const hub = new N8nCapabilityProvider({ retries: 1, retryDelayMs: 50 });
  const status = await hub.connectionStatus();
  const listed = status.connected ? await hub.listCapabilities() : [];
  const evidence = {
    gate: 8,
    connection: { connected: status.connected, endpoint: status.endpoint },
    discovery: listed.map((item) => item.name),
    liveCall: null,
    observation: null,
    qwen: null,
  };

  if (!status.connected || !listed.some((item) => item.name === "hub.health")) {
    fs.mkdirSync(path.join(__dirname, "out"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "out/foundation.json"), JSON.stringify(evidence, null, 2));
    console.error("live n8n webhook is not available");
    process.exit(1);
  }

  const built = buildRequest({
    runId: "run_live_probe",
    capability: "hub.health",
    input: { echo: "gate8" },
    context: { purpose: "health" },
    timeout: 5000,
  });
  const response = await hub.invoke(built.request);
  if (!response || response.requestId !== built.request.requestId || !response.data || response.data.marker !== MARKER) {
    evidence.liveCall = { ok: false, status: response && response.status, code: response && response.error && response.error.code };
    fs.mkdirSync(path.join(__dirname, "out"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "out/foundation.json"), JSON.stringify(evidence, null, 2));
    console.error("live hub response did not match the protocol");
    process.exit(1);
  }
  evidence.liveCall = {
    ok: true,
    requestId: response.requestId,
    runId: built.request.runId,
    status: response.status,
    marker: response.data.marker,
  };
  const logs = JSON.stringify(hub.logs);
  if (process.env.CODEME_N8N_TOKEN && logs.includes(process.env.CODEME_N8N_TOKEN)) {
    console.error("logs contained the hub token");
    process.exit(1);
  }

  const directory = fs.mkdtempSync(path.join(require("os").tmpdir(), "codeme-gate8-qwen-"));
  const store = new RunStore(path.join(directory, "runs"));
  const model = new HybridModelProvider(new OllamaModelProvider());
  const run = await startAgentRun({
    goal: "Call hub.health with an empty input. After the tool result, reply with only the marker value from that untrusted observation. Do not call another tool.",
    model: MODEL,
    providerName: "ollama",
    provider: model,
    registry: new ToolRegistry(new ControlledToolProvider(createWorkspaceHost(directory))),
    store,
    capabilities: hub,
    mode: "read_only",
    maxIterations: 3,
    timeoutMs: 180000,
    verify(runState, text) {
      const saw = runState.observations.some((item) => item.type === "capability" && item.summary.includes(MARKER));
      if (saw && String(text).trim()) return { status: "passed", summary: "The following turn received the hub observation", evidence: ["capability.invoke"] };
      return { status: "failed", summary: "The hub observation was missing", evidence: [] };
    },
  }).done;

  const observation = run.observations.find((item) => item.type === "capability");
  const followUp = model.calls[1];
  const toolMessage = followUp && followUp.messages.find((message) => message.role === "tool" && message.name === "capability.invoke");
  const reply = run.outcome && run.outcome.summary ? run.outcome.summary : "";
  evidence.observation = observation ? {
    type: observation.type,
    trusted: observation.trusted,
    ok: observation.ok,
    requestId: observation.requestId,
    runId: observation.runId,
    correlated: observation.requestId === (run.toolCalls[0] && run.toolCalls[0].result && run.toolCalls[0].result.requestId) && observation.runId === run.id,
  } : null;
  evidence.qwen = {
    model: MODEL,
    receivedObservation: Boolean(toolMessage && toolMessage.content.includes(MARKER) && toolMessage.content.includes('"trusted":false')),
    replyIncludedMarker: reply.includes(MARKER),
    lifecycle: run.lifecycle,
    filesChanged: run.filesChanged,
  };
  evidence.runId = run.id;
  fs.mkdirSync(path.join(__dirname, "out"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "out/foundation.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
  if (!evidence.qwen.receivedObservation || run.lifecycle !== "completed" || run.filesChanged.length !== 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
