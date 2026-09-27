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

function normalizeComposerMode(value) {
  if (value === "code" || value === "controlled") return "code";
  if (value === "plan") return "plan";
  return "ask";
}

function agentModeFor(composerMode) {
  return normalizeComposerMode(composerMode) === "code" ? "controlled" : "read_only";
}

function taskClassFor(composerMode) {
  return normalizeComposerMode(composerMode) === "plan" ? "plan" : "";
}

function looksLikeWorkspaceEdit(goal) {
  const text = String(goal || "").toLowerCase();
  return /\b(edit|change|update|rewrite|restyle|redesign|layout|better website|improve the (site|page|layout)|apply (the )?(change|edit|fix))\b/.test(text);
}

function composerModeLabel(composerMode) {
  const mode = normalizeComposerMode(composerMode);
  if (mode === "code") return "Code";
  if (mode === "plan") return "Plan";
  return "Ask";
}

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
  if (name === "file.read" || name === "file.readRange" || name === "dir.list") return "Reading";
  if (name === "file.write" || name === "file.patch" || name === "dir.create") return "Editing";
  if (name === "tests.run" || name === "terminal.run" || name === "process.run" || name === "process.start" || name === "process.stop") return "Testing";
  if (name === "capability.invoke" || name === "capability.list") return "Researching";
  if (name === "browser.check") return "Testing";
  if (name === "diagnostics.run" || name === "git.diff" || name === "git.status" || name === "process.status") return "Verifying";
  return "Reading";
}

function activityTarget(args) {
  if (!args || typeof args !== "object") return "";
  if (args.path) return String(args.path);
  if (args.query) return String(args.query);
  if (args.url) return String(args.url);
  if (args.command) return String(args.command);
  if (args.executable) return [args.executable].concat(args.args || []).join(" ");
  return "";
}

function activityLabel(name, args) {
  const target = activityTarget(args);
  const verbs = {
    "file.read": "Reading",
    "file.readRange": "Reading",
    "file.write": "Editing",
    "file.patch": "Editing",
    "dir.list": "Listing",
    "dir.create": "Creating",
    "repo.search": "Searching",
    "terminal.run": "Running",
    "tests.run": "Running tests",
    "process.run": "Running",
    "process.start": "Starting",
    "process.stop": "Stopping",
    "process.status": "Checking",
    "browser.check": "Checking",
    "git.diff": "Reviewing diff",
    "git.status": "Checking git",
    "diagnostics.run": "Checking diagnostics",
    "capability.invoke": "Researching",
    "capability.list": "Listing capabilities",
  };
  const verb = verbs[name] || name || "Working";
  return target ? `${verb} ${target}` : verb;
}

function threadFrom(run) {
  const items = [];
  if (run && run.goal) items.push({ role: "user", text: String(run.goal) });
  const seen = new Set();
  for (const call of (run && run.toolCalls) || []) {
    const text = activityLabel(call.name, call.args);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    items.push({ role: "activity", text });
  }
  const finalText = finalAnswer(run);
  if (finalText) items.push({ role: "assistant", text: finalText });
  return items;
}

function finalAnswer(run) {
  if (!run) return "";
  const terminal = run.lifecycle === "completed" || run.lifecycle === "failed" || run.lifecycle === "cancelled";
  if (!terminal && !run.finalResponse) return "";
  const text = run.finalResponse || (run.outcome && run.outcome.summary) || "";
  return String(text).trim();
}

function isProgressTalk(text) {
  const body = String(text || "").replace(/\s+/g, " ").trim();
  if (!body) return false;
  return /^(let me |i'll |i will |great[,!]? |i found |i need to |first,? let me |i'm going to |now (i'll|let me) )/i.test(body.slice(0, 280));
}

function lastProgressTalk(run) {
  const decisions = (run && run.decisions) || [];
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const text = decisions[index] && decisions[index].text;
    if (isProgressTalk(text)) return String(text).replace(/\s+/g, " ").trim();
  }
  return "";
}

function composerActivity(run) {
  const stage = composerStage(run);
  if (run && run.inFlight && run.inFlight.name && stage !== "Complete" && stage !== "Failed" && stage !== "Cancelled") {
    return activityLabel(run.inFlight.name, run.inFlight.args);
  }
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

function composerVoiceAction(listening, available) {
  if (!available) return "unavailable";
  return listening ? "stop" : "start";
}

function droppedPaths(transfer) {
  const found = [];
  const seen = new Set();
  function add(value) {
    const next = String(value || "").trim();
    if (!next || next.startsWith("#") || seen.has(next)) return;
    seen.add(next);
    found.push({ path: next });
  }
  if (!transfer) return found;
  const names = [
    "ResourceURLs",
    "resourceurls",
    "CodeFiles",
    "application/vnd.code.uri-list",
    "text/uri-list",
    "text/plain",
  ];
  for (const name of names) {
    if (typeof transfer.getData !== "function") continue;
    const raw = transfer.getData(name);
    if (!raw) continue;
    if (name === "ResourceURLs" || name === "resourceurls" || name === "CodeFiles") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) add(item);
          continue;
        }
      } catch {
        // Fall through to line splitting for a plain path.
      }
    }
    for (const line of String(raw).split(/\r?\n/)) add(line);
  }
  if (transfer.files && transfer.files.length) {
    for (const file of transfer.files) {
      if (file && file.path) add(file.path);
    }
  }
  return found;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    COMPOSER_STAGES,
    normalizeComposerMode,
    agentModeFor,
    taskClassFor,
    composerModeLabel,
    composerKeyAction,
    composerStage,
    composerActivity,
    compactTools,
    diffsByFile,
    formatGoal,
    sameRequest,
    activityLabel,
    threadFrom,
    finalAnswer,
    droppedPaths,
    composerVoiceAction,
    looksLikeWorkspaceEdit,
    isProgressTalk,
    lastProgressTalk,
  };
}
