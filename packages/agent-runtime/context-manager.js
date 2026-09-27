// Each model turn is assembled from the run state. The stored transcript can keep
// growing; this view is what the model actually sees.
function buildModelContext(run) {
  const messages = [];
  const system = (run.messages || []).find((message) => message.role === "system");
  if (system && system.content) messages.push({ role: "system", content: system.content });

  const sections = [
    `Goal: ${String(run.goal || "").trim()}`,
    planSection(run),
    requirementsSection(run),
    failuresSection(run),
    rangesSection(run),
  ].filter(Boolean);
  messages.push({ role: "user", content: sections.join("\n\n") });

  for (const notice of noticeMessages(run)) {
    messages.push({ role: "user", content: notice });
  }

  const recent = recentCalls(run);
  if (recent.length) {
    messages.push({
      role: "assistant",
      content: "",
      toolCalls: recent.map((call) => ({ name: call.name, args: call.args || {} })),
    });
    for (const call of recent) {
      messages.push({ role: "tool", name: call.name, content: renderObservation(call) });
    }
  }
  return messages;
}

function planSection(run) {
  const steps = (run.plan || []).map((step) => `- ${step.id}: ${step.title} (${step.status})`);
  return steps.length ? `Plan:\n${steps.join("\n")}` : "";
}

function requirementsSection(run) {
  const items = run.requirements || [];
  if (!items.length) return "";
  const lines = items.map((item) => `- ${item.id}: ${item.text} (${item.status})`);
  return `Requirements:\n${lines.join("\n")}`;
}

function failuresSection(run) {
  const lines = [];
  for (const item of (run.verificationHistory || []).filter((entry) => entry.status === "failed").slice(-3)) {
    lines.push(`Verification: ${clip(item.summary, 400)}`);
  }
  for (const call of (run.toolCalls || []).filter((call) => call.result && call.result.ok === false).slice(-4)) {
    const error = call.result.error || {};
    const target = targetOf(call.args);
    lines.push(`Tool ${call.name}${target ? ` ${target}` : ""} failed: ${error.code || "tool_failed"} ${clip(error.message, 300)}`.trim());
  }
  for (const item of (run.diagnoses || []).slice(-3)) {
    lines.push(`Diagnosis: ${item.tool || "tool"} ${item.class || ""} next ${item.next || "inspect"}`.trim());
  }
  return lines.length ? `Failures:\n${lines.join("\n")}` : "";
}

function rangesSection(run) {
  const reads = (run.toolCalls || []).filter((call) => (
    (call.name === "file.read" || call.name === "file.readRange") && call.result && call.result.ok
  ));
  const changed = new Set(run.filesChanged || []);
  const relevant = reads.filter((call) => changed.has(call.args && call.args.path));
  const picked = (relevant.length ? relevant : reads).slice(-3);
  if (!picked.length) return "";
  const blocks = picked.map((call) => {
    const data = call.result.data || {};
    const path = (call.args && call.args.path) || data.path || "file";
    const span = call.name === "file.readRange" && data.startLine
      ? `${path} lines ${data.startLine}-${data.endLine}`
      : path;
    const contents = clip(data.contents, call.name === "file.readRange" ? 4000 : 2500);
    const more = typeof data.contents === "string" && data.contents.length > contents.length
      ? "\n… file continues. Use file.readRange for another span."
      : "";
    return `${span}:\n${contents}${more}`;
  });
  return `Relevant ranges:\n${blocks.join("\n\n")}`;
}

function noticeMessages(run) {
  const users = (run.messages || []).filter((message) => (
    message.role === "user" && String(message.content || "") !== String(run.goal || "")
  ));
  const pinned = users.filter((message) => /Workspace files:|hub read this prompt|untrusted|Follow-up\./i.test(message.content));
  const recent = users.slice(-6);
  const seen = new Set();
  const kept = [];
  for (const message of pinned.concat(recent)) {
    const text = String(message.content || "");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    kept.push(text);
  }
  return kept;
}

function recentCalls(run) {
  return (run.toolCalls || []).filter((call) => call && call.result).slice(-4);
}

function renderObservation(call) {
  const result = call.result || {};
  const data = result.data && typeof result.data === "object" ? result.data : {};
  const error = result.error || {};
  const body = { ok: Boolean(result.ok), tool: call.name };
  const target = targetOf(call.args);
  if (call.args && call.args.path) body.path = call.args.path;
  else if (target) body.target = target;
  if (data.startLine) {
    body.startLine = data.startLine;
    body.endLine = data.endLine;
  }
  if (typeof data.contents === "string") {
    const limit = call.name === "file.readRange" ? 4000 : 2500;
    body.contents = clip(data.contents, limit);
    if (data.contents.length > body.contents.length) body.truncated = true;
  }
  if (Array.isArray(data.matches)) {
    body.matches = data.matches.slice(0, 8).map((match) => ({
      path: match.path,
      line: match.line,
      text: clip(match.text, 160),
    }));
  }
  if (Array.isArray(data.entries)) {
    body.entries = data.entries.slice(0, 40).map((entry) => entry.path || entry);
  }
  if (typeof data.diff === "string") body.diff = clip(data.diff, 2000);
  if (typeof data.stdout === "string") body.stdout = clip(data.stdout, 1500);
  if (typeof data.stderr === "string") body.stderr = clip(data.stderr, 800);
  if (typeof data.exitCode === "number") body.exitCode = data.exitCode;
  if (typeof data.text === "string" && data.text) body.text = clip(data.text, 1500);
  if (Array.isArray(data.consoleErrors) && data.consoleErrors.length) body.consoleErrors = data.consoleErrors.slice(0, 8);
  if (Array.isArray(data.failedRequests) && data.failedRequests.length) body.failedRequests = data.failedRequests.slice(0, 8);
  if (data.screenshot && data.screenshot.path) body.screenshot = data.screenshot.path;
  if (result.kind === "capability" || result.trusted === false) body.trusted = false;
  if (!result.ok) body.error = { code: error.code || "tool_failed", message: clip(error.message, 300) };
  return JSON.stringify(body);
}

function targetOf(args) {
  if (!args || typeof args !== "object") return "";
  return String(args.path || args.query || args.command || args.url || args.executable || "");
}

function clip(value, limit) {
  const text = String(value || "");
  return text.length > limit ? text.slice(0, limit) : text;
}

module.exports = { buildModelContext };
