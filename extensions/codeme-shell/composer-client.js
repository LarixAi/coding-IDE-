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
  if (name === "diagnostics.run" || name === "git.diff" || name === "git.status") return "Verifying";
  return "Reading";
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
    formatGoal,
    sameRequest,
  };
}
