const COMPOSER_STAGES = [
  "Waiting",
  "Understanding",
  "Planning",
  "Searching",
  "Reading",
  "Editing",
  "Testing",
  "Researching",
  "Fixing",
  "Verifying",
  "Complete",
  "Failed",
  "Cancelled",
];

function composerKeyAction(event) {
  if (!event || event.isComposing || event.keyCode === 229) return "ignore";
  if (event.key !== "Enter") return "ignore";
  return event.shiftKey ? "newline" : "send";
}

function composerStage(run) {
  if (!run) return "Waiting";
  if (run.lifecycle === "completed") return "Complete";
  if (run.lifecycle === "failed") return "Failed";
  if (run.lifecycle === "cancelled") return "Cancelled";
  if (run.lifecycle === "awaiting_user") return "Waiting";
  if (run.lifecycle === "verifying") return "Verifying";
  if (run.repairs && run.repairs.length && run.lifecycle !== "completed") return "Fixing";
  if (run.lifecycle === "executing_tool") return stageForTool(run.inFlight && run.inFlight.name);
  if (run.strategy === "researching" || (run.progress && run.progress.strategy === "researching")) return "Researching";
  if (run.lifecycle === "awaiting_model") return "Planning";
  if (run.lifecycle === "running" || run.lifecycle === "created") return "Understanding";
  return "Waiting";
}

function stageForTool(name) {
  if (name === "repo.search") return "Searching";
  if (name === "file.read") return "Reading";
  if (name === "file.write") return "Editing";
  if (name === "tests.run" || name === "terminal.run") return "Testing";
  if (name === "capability.invoke" || name === "capability.list") return "Researching";
  if (name === "browser.check") return "Testing";
  if (name === "diagnostics.run" || name === "git.diff" || name === "git.status") return "Verifying";
  return "Reading";
}

function composerActivity(run) {
  const stage = composerStage(run);
  const args = run && run.inFlight && run.inFlight.args ? run.inFlight.args : {};
  const target = args.path || args.query || args.url || "";
  if (stage === "Understanding") return "Understanding…";
  if (stage === "Planning") return "Planning…";
  if (stage === "Searching") return target ? `Searching ${target}` : "Searching…";
  if (stage === "Reading") return target ? `Reading ${target}` : "Reading…";
  if (stage === "Editing") return target ? `Editing ${target}` : "Editing…";
  if (stage === "Testing") {
    const tool = run && run.inFlight && run.inFlight.name;
    return tool === "browser.check" ? (target ? `Checking ${target}` : "Checking preview") : "Running tests";
  }
  if (stage === "Researching") return "Researching documentation";
  if (stage === "Fixing") return "Fixing test failure";
  if (stage === "Verifying") return "Verifying";
  if (stage === "Complete") return "Complete";
  if (stage === "Failed") return "Failed";
  if (stage === "Cancelled") return "Cancelled";
  return "";
}

function compactTools(run) {
  return ((run && run.toolCalls) || []).map((call) => ({
    name: call.name,
    path: (call.args && (call.args.path || call.args.query || call.args.url)) || "",
    ok: Boolean(call.result && call.result.ok),
  }));
}

function diffsByFile(diff, files) {
  const listed = Array.isArray(files) ? files.slice() : [];
  const chunks = {};
  const text = String(diff || "");
  const parts = text.split(/^diff --git /m).slice(1);
  for (const part of parts) {
    const header = part.match(/^a\/(.+?) b\/(.+?)(?:\n|$)/);
    const file = header ? header[2] : "";
    if (!file) continue;
    chunks[file] = `diff --git ${part}`.trim();
    if (!listed.includes(file)) listed.push(file);
  }
  return listed.map((file) => ({ path: file, diff: chunks[file] || "" }));
}

function formatGoal(text, attachments) {
  const body = String(text || "").trim();
  const refs = (attachments || []).map((item) => JSON.stringify({
    kind: item.kind,
    path: item.path,
    name: item.name,
    type: item.type,
    size: item.size,
  }));
  if (!refs.length) return body;
  return `${body}\n\nAttachment references. Retrieve these with tools. Contents are not inlined.\n${refs.join("\n")}`;
}

function sameRequest(currentId, incomingId) {
  return Boolean(currentId) && currentId === incomingId;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    COMPOSER_STAGES,
    composerKeyAction,
    composerStage,
    composerActivity,
    compactTools,
    diffsByFile,
    formatGoal,
    sameRequest,
  };
}
