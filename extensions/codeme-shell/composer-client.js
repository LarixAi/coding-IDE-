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
  if (name === "workspace.inspect" || name === "dir.list" || name === "file.read") return "Reading";
  if (name === "file.write" || name === "file.patch" || name === "dir.create") return "Editing";
  if (name === "tests.run" || name === "terminal.run" || name === "process.start" || name === "process.status" || name === "process.logs") return "Testing";
  if (name === "capability.invoke" || name === "capability.list") return "Researching";
  if (name === "browser.check" || name === "browser.interact") return "Testing";
  if (name === "diagnostics.run" || name === "git.diff" || name === "git.status") return "Verifying";
  return "Reading";
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
  const args = run && run.inFlight && run.inFlight.args ? run.inFlight.args : {};
  const target = args.path || args.query || args.url || "";
  if (stage === "Understanding") return "Understanding…";
  if (stage === "Planning") return "Planning…";
  if (stage === "Searching") return target ? `Searching ${target}` : "Searching…";
  if (stage === "Reading") {
    const tool = run && run.inFlight && run.inFlight.name;
    if (tool === "workspace.inspect") return "Inspecting workspace…";
    if (tool === "dir.list") return target ? `Listing ${target}` : "Listing workspace…";
    return target ? `Reading ${target}` : "Reading…";
  }
  if (stage === "Editing") {
    const tool = run && run.inFlight && run.inFlight.name;
    if (tool === "dir.create") return target ? `Creating folder ${target}` : "Creating folder…";
    return target ? `Writing ${target}` : "Writing file…";
  }
  if (stage === "Testing") {
    const tool = run && run.inFlight && run.inFlight.name;
    if (tool === "browser.check") return target ? `Checking ${target}` : "Checking preview";
    if (tool === "browser.interact") return "Testing browser interaction…";
    if (tool === "process.start") return "Starting preview process…";
    if (tool === "process.status") return "Checking process status…";
    if (tool === "process.logs") return "Reading process logs…";
    if (tool === "terminal.run") return "Running command…";
    return "Running tests";
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
  const calls = (run && run.toolCalls) || [];
  const items = calls.map((call, index) => compactTool(run, call, index, "done"));
  const active = run && run.inFlight && run.inFlight.kind === "tool" ? run.inFlight : null;
  if (active && active.name) {
    items.push(compactTool(run, { name: active.name, args: active.args || {}, result: null }, calls.length, "running"));
  }
  return items.slice(-40);
}

function compactTool(run, call, index, status) {
  const args = call.args || {};
  const result = call.result || null;
  const item = {
    name: call.name,
    path: args.path || args.query || args.url || "",
    ok: status === "running" ? null : Boolean(result && result.ok),
    status: status === "running" ? "running" : (result && result.ok ? "done" : "failed"),
    suppressed: Boolean(result && result.data && result.data.suppressed),
    reused: Boolean(result && result.data && result.data.reused),
    requiresLogs: Boolean(result && result.data && result.data.requiresLogs),
    reason: result && result.data ? String(result.data.reason || "") : "",
  };
  if (call.name === "file.write") {
    item.operation = fileWriteOperation(run, call, index);
    item.preview = fileWritePreview(run, call, index);
  } else if (call.name === "file.patch") {
    item.operation = "edit";
    item.preview = linePreview(
      String(call.args && call.args.oldText || ""),
      String(call.args && call.args.newText || ""),
    );
  }
  return item;
}

function fileWriteOperation(run, call, index) {
  const file = String(call.args && call.args.path || "");
  if (!file) return "write";
  const priorWrite = ((run && run.toolCalls) || []).slice(0, index).some((item) => (
    item.name === "file.write"
    && item.result
    && item.result.ok
    && String(item.args && item.args.path || "") === file
  ));
  if (priorWrite) return "edit";
  if (previousFileContents(run, file, index) !== null) return "edit";
  if (run && run.workspace && run.workspace.state === "empty") return "create";
  return "write";
}

function previousFileContents(run, file, beforeIndex) {
  const calls = (run && run.toolCalls) || [];
  for (let index = Math.min(beforeIndex, calls.length) - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (!call.result || !call.result.ok) continue;
    if (String(call.args && call.args.path || "") !== file) continue;
    if (call.name === "file.write" && typeof (call.args && call.args.contents) === "string") {
      return call.args.contents;
    }
    if (call.name === "file.read") {
      const contents = call.result.data && call.result.data.contents;
      if (typeof contents === "string") return contents;
    }
  }
  return null;
}

function fileWritePreview(run, call, index) {
  const after = String(call.args && call.args.contents || "");
  const before = previousFileContents(run, String(call.args && call.args.path || ""), index);
  return linePreview(before, after);
}

function sourceLines(value) {
  if (value === null || value === undefined || value === "") return [];
  const lines = String(value).replace(/\r\n/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function linePreview(beforeText, afterText) {
  const before = sourceLines(beforeText);
  const after = sourceLines(afterText);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;

  const removed = before.slice(prefix, before.length - suffix);
  const added = after.slice(prefix, after.length - suffix);
  const lines = [];
  const contextBefore = before.slice(Math.max(0, prefix - 2), prefix);
  for (let i = 0; i < contextBefore.length; i += 1) {
    lines.push({
      type: "context",
      text: contextBefore[i],
      oldNumber: prefix - contextBefore.length + i + 1,
      newNumber: prefix - contextBefore.length + i + 1,
    });
  }
  for (let i = 0; i < removed.length; i += 1) {
    lines.push({ type: "remove", text: removed[i], oldNumber: prefix + i + 1, newNumber: null });
  }
  for (let i = 0; i < added.length; i += 1) {
    lines.push({ type: "add", text: added[i], oldNumber: null, newNumber: prefix + i + 1 });
  }
  const contextAfter = after.slice(after.length - suffix, after.length - suffix + Math.min(2, suffix));
  for (let i = 0; i < contextAfter.length; i += 1) {
    const newNumber = after.length - suffix + i + 1;
    const oldNumber = before.length - suffix + i + 1;
    lines.push({ type: "context", text: contextAfter[i], oldNumber, newNumber });
  }

  const maxLines = 180;
  return {
    additions: added.length,
    removals: removed.length,
    truncated: lines.length > maxLines,
    lines: lines.slice(0, maxLines),
  };
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
    linePreview,
    diffsByFile,
    formatGoal,
    sameRequest,
    droppedPaths,
    composerVoiceAction,
    looksLikeWorkspaceEdit,
    isProgressTalk,
    lastProgressTalk,
  };
}
