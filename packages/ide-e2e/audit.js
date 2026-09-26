const fs = require("fs");
const path = require("path");
const { N8nCapabilityProvider } = require("../n8n-capability");
const { buildRequest, acceptResponse } = require("../agent-runtime/capability");

const RUNS = path.join(__dirname, "../../.tools/codeme-user-data/User/globalStorage/codeme.codeme-shell/composer-runs");

async function call(hub, capability, input, timeout) {
  const built = buildRequest({
    runId: "run_ide_e2e",
    capability,
    input,
    context: { purpose: "ide-e2e" },
    timeout,
  });
  if (!built.ok) return { ok: false, error: built.error };
  return acceptResponse(await hub.invoke(built.request), built.request);
}

function auditRuns() {
  if (!fs.existsSync(RUNS)) return [];
  return fs.readdirSync(RUNS)
    .filter((file) => file.endsWith(".json") && !file.endsWith(".prev"))
    .map((file) => {
      const run = JSON.parse(fs.readFileSync(path.join(RUNS, file), "utf8"));
      const tools = (run.toolCalls || []).map((call) => call.name);
      return {
        id: run.id,
        goal: String(run.goal || "").replace(/\s+/g, " ").slice(0, 90),
        mode: run.mode,
        lifecycle: run.lifecycle,
        tools: [...new Set(tools)],
        invokedN8n: tools.includes("capability.invoke") || tools.includes("capability.list"),
        recommended: run.progress && run.progress.recommendedName,
        writes: tools.filter((name) => name === "file.write").length,
        tests: tools.filter((name) => name === "tests.run").length,
      };
    });
}

async function main() {
  const hub = new N8nCapabilityProvider({ retries: 0, retryDelayMs: 1 });
  const status = await hub.connectionStatus();
  const listed = status.connected ? await hub.listCapabilities() : [];
  const names = listed.map((item) => item.name);
  const research = names.includes("research.problem")
    ? await call(hub, "research.problem", { problem: "Luhn algorithm doubling rule" }, 15000)
    : { ok: false, error: { code: "not_listed" } };
  const evidence = {
    hub: { connected: status.connected, endpoint: status.endpoint, capabilities: names },
    research: {
      ok: Boolean(research.ok),
      status: research.status,
      evidence: research.data && Array.isArray(research.data.evidence) ? research.data.evidence.length : 0,
      code: research.error && research.error.code,
    },
    composerRuns: auditRuns(),
  };
  const out = path.join(__dirname, "out");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "audit.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  if (!status.connected) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
