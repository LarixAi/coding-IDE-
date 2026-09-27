const fs = require("fs");
const path = require("path");
const { buildRequest, acceptResponse } = require("../agent-runtime/capability");
const { N8nCapabilityProvider } = require("./index.js");

async function call(hub, capability, input, timeout) {
  const built = buildRequest({
    runId: "run_live_capabilities",
    capability,
    input,
    context: { purpose: "live" },
    timeout,
  });
  if (!built.ok) return { ok: false, error: built.error };
  const response = await hub.invoke(built.request);
  const accepted = acceptResponse(response, built.request);
  return accepted;
}

async function main() {
  const hub = new N8nCapabilityProvider({ retries: 0, retryDelayMs: 1 });
  const status = await hub.connectionStatus();
  const listed = status.connected ? await hub.listCapabilities() : [];
  const names = listed.map((item) => item.name);
  const evidence = { connection: status.connected, discovery: names, calls: {} };
  const required = ["hub.health", "research.problem", "knowledge.lookup", "task.decompose"];
  if (!status.connected || required.some((name) => !names.includes(name))) {
    evidence.error = "The live hub is missing a routed capability";
    write(evidence);
    console.error(JSON.stringify(evidence));
    process.exit(1);
  }

  const research = await call(hub, "research.problem", { problem: "Stripe webhook signature verification failing" }, 15000);
  evidence.calls.research = summary(research);
  const remembered = await call(hub, "knowledge.lookup", {
    action: "remember",
    entry: { title: "Live hub note", text: "A remembered note stays in the hub, not in the workspace.", tags: ["live"] },
  }, 10000);
  const lookup = await call(hub, "knowledge.lookup", { query: "remembered note workspace" }, 10000);
  evidence.calls.knowledge = { remember: summary(remembered), lookup: summary(lookup) };
  const plan = await call(hub, "task.decompose", {
    goal: "Build a small page that lists cars, accepts a bid, and lets an admin remove a listing.",
  }, 80000);
  evidence.calls.decompose = summary(plan);
  write(evidence);
  console.log(JSON.stringify(evidence));

  const researchOk = research.ok && research.data && research.data.likely_cause === null && Array.isArray(research.data.evidence);
  const rememberOk = remembered.ok && remembered.data && remembered.data.action === "remember";
  const lookupOk = lookup.ok && lookup.data && lookup.data.matches.some((entry) => entry.title === "Live hub note");
  const planOk = plan.ok && plan.data && Array.isArray(plan.data.tasks) && plan.data.tasks.length >= 2 && plan.data.tasks.every((task) => task.id && task.objective);
  if (!researchOk || !rememberOk || !lookupOk || !planOk) process.exit(1);
}

function summary(result) {
  return {
    ok: Boolean(result.ok),
    status: result.status,
    code: result.error && result.error.code,
    confidence: result.data && result.data.confidence,
    evidence: result.data && result.data.evidence ? result.data.evidence.length : undefined,
    matches: result.data && result.data.matches ? result.data.matches.map((entry) => entry.title) : undefined,
    tasks: result.data && result.data.tasks ? result.data.tasks.map((task) => task.id) : undefined,
  };
}

function write(evidence) {
  const dir = path.join(__dirname, "out");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "capabilities.json"), JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
