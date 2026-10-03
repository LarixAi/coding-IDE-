const crypto = require("crypto");
const { createRun } = require("./agent-run");
const { applyFollowUp } = require("./requirements");
const {
  capabilityToolDefinitions,
  loadCapabilityRegistry,
  dispatchCapability,
} = require("./capability");
const { buildModelContext } = require("./pipeline-context");
const { instructionsForMode } = require("./pipeline-instructions");
const { runPipeline } = require("./pipeline-loop");

const MUTATION_TOOLS = new Set(["file.write", "file.patch", "dir.create"]);
const READ_ONLY_BLOCKED = new Set([
  "file.write",
  "file.patch",
  "dir.create",
  "terminal.run",
  "sandbox.run",
  "process.start",
  "tests.run",
  "browser.interact",
]);
const CODE_FILE = /\.(?:js|mjs|cjs|jsx|ts|tsx|py|go|rs|java|cs|rb|php|swift|dart|c|cc|cpp|h|hpp)$/i;
const WEB_FILE = /\.(?:html?|css|js|jsx|ts|tsx)$/i;

function touch(run, lifecycle, inFlight) {
  run.lifecycle = lifecycle;
  run.inFlight = inFlight || null;
  run.updatedAt = new Date().toISOString();
}

function summarize(result) {
  if (!result) return "No result";
  if (result.ok) {
    const data = result.data;
    if (data && typeof data === "object") {
      if (typeof data.path === "string") return data.path;
      if (typeof data.diff === "string") return data.diff.slice(0, 600);
      if (typeof data.output === "string") return data.output.slice(0, 600);
      if (typeof data.stdout === "string") return data.stdout.slice(0, 600);
      if (typeof data.contents === "string") return data.contents.slice(0, 600);
      if (typeof data.status === "string") return data.status;
    }
    return "Tool completed successfully";
  }
  return String(
    result.error && (result.error.message || result.error.code)
      || "Tool failed",
  ).slice(0, 800);
}

function appliedMutation(call) {
  if (!call || !MUTATION_TOOLS.has(call.name) || !call.result || !call.result.ok) return false;
  if (call.name === "file.write" || call.name === "file.patch") {
    const data = call.result.data;
    if (data && typeof data === "object" && data.changed === false) return false;
  }
  return true;
}

function recordTool(run, call, result, directedBy) {
  const external = String(call && call.name || "").startsWith("capability.")
    || Boolean(result && result.trusted === false);
  const record = {
    id: call.id || "call_" + crypto.randomBytes(4).toString("hex"),
    iteration: run.iteration,
    name: call.name,
    args: call.args || {},
    result,
    ...(directedBy ? { directedBy } : {}),
  };
  run.toolCalls.push(record);
  run.observations.push({
    type: external ? "capability" : "tool",
    tool: call.name,
    ok: Boolean(result && result.ok),
    trusted: !external,
    summary: summarize(result),
    ...(directedBy ? { directedBy } : {}),
  });

  if (appliedMutation(record) && (call.name === "file.write" || call.name === "file.patch")) {
    const path = String(call.args && call.args.path || "");
    if (path && !run.filesChanged.includes(path)) run.filesChanged.push(path);
  }
  if (result && result.ok && call.name === "file.read") {
    const path = String(call.args && call.args.path || "");
    if (path && run.progress && !run.progress.filesRead.includes(path)) run.progress.filesRead.push(path);
  }
  return record;
}

function toolNames(registry) {
  return new Set((registry && registry.definitions ? registry.definitions() : []).map((tool) => tool.name));
}

async function safeContextCall(registry, name, args) {
  try {
    if (!toolNames(registry).has(name)) return null;
    return await registry.call(name, args || {});
  } catch {
    return null;
  }
}

async function loadProjectRules(registry) {
  const candidates = ["AGENTS.md", "CODEME.md", ".codeme/rules.md"];
  const parts = [];
  for (const path of candidates) {
    const result = await safeContextCall(registry, "file.read", { path });
    const contents = result && result.ok && result.data && result.data.contents;
    if (typeof contents === "string" && contents.trim()) {
      parts.push("--- " + path + " ---\n" + contents.trim().slice(0, 5000));
    }
  }
  return parts.join("\n\n");
}

async function loadAttachmentContext(registry, attachments) {
  const list = [];
  for (const item of (attachments || []).slice(0, 6)) {
    if (item.kind === "image" || item.kind === "pdf") continue;
    const result = await safeContextCall(registry, "file.read", { path: item.path });
    const contents = result && result.ok && result.data && result.data.contents;
    if (typeof contents === "string" && contents) {
      list.push({ path: item.path, contents: contents.slice(0, 8000) });
    }
  }
  return list;
}

function listingText(result) {
  const entries = result && result.ok && result.data && Array.isArray(result.data.entries)
    ? result.data.entries
    : [];
  return entries
    .slice(0, 250)
    .map((item) => String(item.type || item.kind || "file") + " " + String(item.path || item.name || ""))
    .filter(Boolean)
    .join("\n");
}

function hasEditIntent(goal) {
  return /\b(edit|change|update|write|create|add|remove|delete|fix|repair|implement|build|make|rename|refactor|restyle|redesign)\b/i.test(String(goal || ""));
}

function readOnlyNeedsExternalEvidence(goal) {
  const text = String(goal || "");
  return /\b(?:research|external|online|internet|web\s+search|search\s+(?:the\s+)?(?:web|internet)|look\s*up|latest|up[- ]to[- ]date|github|npm|mdn)\b/i.test(text)
    || /\bcurrent\s+(?:recommended|recommendation|docs?|documentation|version|release)\b/i.test(text);
}

function wantsExhaustiveRead(goal) {
  return /\b(?:read|review|inspect|check)\s+(?:all|every)\s+(?:the\s+)?(?:files?|project files?|workspace files?)\b/i.test(String(goal || ""));
}

function isWebGoal(goal) {
  return /\b(website|web site|webpage|page|layout|css|html|browser|preview|button|form|click|frontend|front-end|ui|ux)\b/i.test(String(goal || ""));
}

function isInteractiveGoal(goal) {
  return /\b(click|button|form|submit|interaction|interact|dropdown|input|working|works)\b/i.test(String(goal || ""));
}

function isRunGoal(run) {
  if (run && run.taskClass === "run") return true;
  const goal = String(run && run.goal || "");
  if (hasEditIntent(goal)) return false;
  return /\b(run|start|launch|serve|open)\b/i.test(goal)
    && /\b(existing|current|website|site|web app|app|application|project|server|preview|it|this|that)\b/i.test(goal);
}

function successfulCallAfter(run, startIndex, names) {
  for (let index = startIndex + 1; index < run.toolCalls.length; index += 1) {
    const call = run.toolCalls[index];
    if (names.has(call.name) && call.result && call.result.ok) return call;
  }
  return null;
}

function latestSuccessfulCallBefore(run, endIndex, name) {
  const calls = Array.isArray(run && run.toolCalls) ? run.toolCalls : [];
  const last = Math.min(Number(endIndex), calls.length - 1);
  for (let index = last; index >= 0; index -= 1) {
    const call = calls[index];
    if (call && call.name === name && call.result && call.result.ok) return call;
  }
  return null;
}

function latestOwnedPreviewUrl(run) {
  const calls = Array.isArray(run && run.toolCalls) ? run.toolCalls : [];
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (!call || !call.result || !call.result.ok) continue;
    if (!["process.start", "process.status", "process.logs"].includes(call.name)) continue;
    const data = call.result.data;
    if (!data || typeof data !== "object") continue;
    const url = data.url || (data.session && data.session.url) || data.origin || "";
    if (typeof url === "string" && url.trim()) return url.trim();
  }
  return "";
}

function diagnosticsErrors(result) {
  const items = result && result.data && Array.isArray(result.data.items) ? result.data.items : [];
  return items.filter((item) => {
    const severity = item && item.severity;
    return severity === "error" || severity === 0 || severity === "Error";
  });
}

async function createVerifier(run, context) {
  const { registry, workspace, callTool } = context;
  const definitions = toolNames(registry);

  return async ({ text }) => {
    const items = [];
    const evidence = [];
    const answer = String(text || "").trim();
    items.push({
      id: "answer",
      label: "Final answer",
      ok: Boolean(answer),
      detail: answer ? "Model returned a final answer" : "The final answer was empty",
    });

    if (run.mode === "chat_only") {
      const ok = items.every((item) => item.ok);
      return { ok, items, evidence, summary: ok ? "Chat answer complete" : "Chat answer is empty" };
    }

    if (run.mode === "read_only") {
      if (run.composerMode === "plan") {
        const sequenced = /(^|\n)\s*(?:\d+[.)]|[-*]\s+)/m.test(answer);
        items.push({
          id: "plan",
          label: "Sequenced plan",
          ok: sequenced,
          detail: sequenced ? "Plan contains concrete steps" : "Plan mode requires a sequenced implementation plan",
        });
      }
      if (run.workspaceInspected) evidence.push("workspace.inspect");
      const ok = items.every((item) => item.ok);
      if (ok) {
        for (const requirement of run.requirements || []) requirement.status = "verified";
      }
      return { ok, items, evidence, summary: ok ? "Read-only answer grounded in workspace context" : "Read-only verification failed" };
    }

    const mutationIndexes = [];
    for (let index = 0; index < run.toolCalls.length; index += 1) {
      const call = run.toolCalls[index];
      if (appliedMutation(call)) mutationIndexes.push(index);
    }
    const latestMutation = mutationIndexes.length ? mutationIndexes[mutationIndexes.length - 1] : -1;

    if (hasEditIntent(run.goal)) {
      items.push({
        id: "mutation",
        label: "Requested workspace change",
        ok: latestMutation >= 0,
        detail: latestMutation >= 0 ? "A workspace mutation was applied" : "No file or directory change was applied",
      });
    }

    for (const path of run.filesChanged.slice(0, 8)) {
      if (!definitions.has("file.read")) break;
      const read = await callTool("file.read", { path }, "verification");
      const ok = Boolean(read && read.ok);
      items.push({
        id: "readback:" + path,
        label: "Saved file " + path,
        ok,
        detail: ok ? "Saved contents can be read back" : summarize(read),
      });
      if (ok) evidence.push("file.read");
    }

    const codeChanged = run.filesChanged.some((path) => CODE_FILE.test(path));
    if (codeChanged && definitions.has("diagnostics.run")) {
      const diagnostics = await callTool("diagnostics.run", {}, "verification");
      const errors = diagnosticsErrors(diagnostics);
      const ok = Boolean(diagnostics && diagnostics.ok) && errors.length === 0;
      items.push({
        id: "diagnostics",
        label: "Diagnostics",
        ok,
        detail: !diagnostics || !diagnostics.ok
          ? summarize(diagnostics)
          : errors.length
            ? errors.slice(0, 5).map((item) => String(item.path || "") + ": " + String(item.message || "")).join("\n")
            : "No blocking diagnostics",
      });
      if (ok) evidence.push("diagnostics.run");
    }

    const scripts = workspace && workspace.scripts && typeof workspace.scripts === "object" ? workspace.scripts : {};
    if (codeChanged && scripts.test && definitions.has("tests.run")) {
      const tests = await callTool("tests.run", { command: "npm test" }, "verification");
      const ok = Boolean(tests && tests.ok);
      items.push({
        id: "tests",
        label: "Project tests",
        ok,
        detail: ok ? "npm test passed" : summarize(tests),
      });
      if (ok) evidence.push("tests.run");
    }

    if (isRunGoal(run)) {
      const browserRequired = isWebGoal(run.goal);
      const browserName = isInteractiveGoal(run.goal) ? "browser.interact" : "browser.check";
      const browserCall = browserRequired
        ? latestSuccessfulCallBefore(run, run.toolCalls.length, browserName)
        : null;
      const processCall = latestSuccessfulCallBefore(run, run.toolCalls.length, "process.start")
        || latestSuccessfulCallBefore(run, run.toolCalls.length, "process.status");

      if (browserRequired) {
        items.push({
          id: "run-browser",
          label: browserName === "browser.interact" ? "Running website interaction" : "Running website preview",
          ok: Boolean(browserCall),
          detail: browserCall
            ? "The existing website was verified in the CodeMe-owned browser preview"
            : "Start or reuse the existing application process, then run " + browserName + " against the CodeMe-owned preview before finishing.",
        });
        if (browserCall) evidence.push(browserName);
      } else {
        items.push({
          id: "run-process",
          label: "Running application process",
          ok: Boolean(processCall),
          detail: processCall
            ? "The existing application process is running"
            : "Start or confirm the existing application process with process.start or process.status before finishing.",
        });
        if (processCall) evidence.push(processCall.name);
      }
    }

    const webChanged = run.filesChanged.some((path) => WEB_FILE.test(path));
    if (webChanged && isWebGoal(run.goal) && latestMutation >= 0) {
      const required = isInteractiveGoal(run.goal) ? "browser.interact" : "browser.check";
      let observed = successfulCallAfter(run, latestMutation, new Set([required]));
      let replayed = null;
      if (!observed && definitions.has(required)) {
        const prior = latestSuccessfulCallBefore(run, latestMutation - 1, required);
        if (prior) {
          replayed = await callTool(required, { ...(prior.args || {}) }, "verification");
          if (replayed && replayed.ok) {
            observed = { name: required, args: prior.args || {}, result: replayed, directedBy: "verification" };
          }
        }
      }
      const ownedPreviewUrl = latestOwnedPreviewUrl(run);
      items.push({
        id: "browser",
        label: required === "browser.interact" ? "Real browser interaction" : "Browser verification",
        ok: Boolean(observed),
        detail: observed
          ? replayed
            ? "CodeMe replayed the last successful " + required + " after the latest edit"
            : "A successful " + required + " ran after the latest edit"
          : replayed
            ? summarize(replayed)
            : ownedPreviewUrl
              ? "Run " + required + " after the latest edit using the CodeMe-owned preview at " + ownedPreviewUrl + ". Do not invent another port."
              : "Run process.start first, then run " + required + ". The browser tool will automatically use the CodeMe-owned preview URL.",
      });
      if (observed) evidence.push(required);
    }

    if (workspace && workspace.git && definitions.has("git.diff")) {
      const diff = await callTool("git.diff", {}, "verification");
      if (diff && diff.ok) evidence.push("git.diff");
      items.push({
        id: "diff",
        label: "Git diff",
        ok: Boolean(diff && diff.ok),
        detail: diff && diff.ok ? "Working-tree diff inspected" : summarize(diff),
      });
    }

    const ok = items.every((item) => item.ok);
    if (ok) {
      for (const requirement of run.requirements || []) requirement.status = "verified";
    }
    return {
      ok,
      items,
      evidence: [...new Set(evidence)],
      summary: ok ? "Verification passed" : "Verification found work still to do",
    };
  };
}

async function executePipelineRun(run, options, followUpQueue) {
  const { provider, registry, store, signal } = options;
  touch(run, "running");
  run.pipelineVersion = 2;
  run.pipeline = {
    name: "cursor-style",
    context: "fixed-bounded",
    toolPolicy: "all-legal-tools",
    verification: "answer-then-verify-repair",
  };
  store.save(run);

  let workspace = null;
  let projectRules = "";
  let attachmentContext = [];
  if (run.mode !== "chat_only") {
    const inspected = await safeContextCall(registry, "workspace.inspect", {});
    if (inspected && inspected.ok) {
      workspace = inspected.data || {};
      run.workspace = workspace;
      run.workspaceInspected = true;
      recordTool(run, { name: "workspace.inspect", args: {} }, inspected, "context");
    }
    const listed = await safeContextCall(registry, "dir.list", { path: "." });
    if (listed && listed.ok) {
      workspace = { ...(workspace || {}), listing: listingText(listed) };
    }
    projectRules = await loadProjectRules(registry);
    attachmentContext = await loadAttachmentContext(registry, run.attachments);
  }

  const allowExternalEvidence = run.mode !== "read_only" || readOnlyNeedsExternalEvidence(run.goal);

  let capabilityRegistry = null;
  let capabilityDefinitions = [];
  if (run.mode !== "chat_only" && allowExternalEvidence && options.capabilities) {
    capabilityRegistry = await loadCapabilityRegistry(options.capabilities);
    const listed = capabilityRegistry.list();
    if (listed.length) capabilityDefinitions = capabilityToolDefinitions(listed);
  }

  let externalDefinitions = [];
  if (
    run.mode !== "chat_only"
    && allowExternalEvidence
    && options.externalTools
    && typeof options.externalTools.listTools === "function"
  ) {
    try {
      const listed = await options.externalTools.listTools(signal);
      if (Array.isArray(listed)) externalDefinitions = listed;
    } catch {
      externalDefinitions = [];
    }
  }
  const externalToolNames = new Set(externalDefinitions.map((tool) => tool && tool.name).filter(Boolean));

  const baseDefinitions = run.mode === "chat_only"
    ? []
    : registry.definitions().filter((tool) => run.mode !== "read_only" || !READ_ONLY_BLOCKED.has(tool.name));
  const definitions = [...baseDefinitions, ...capabilityDefinitions, ...externalDefinitions];
  run.pipeline.toolPolicy = allowExternalEvidence ? "all-legal-tools" : "local-read-only-tools";
  const context = buildModelContext({
    goal: run.goal,
    system: instructionsForMode(run.mode, run.composerMode),
    projectRules,
    requirements: run.requirements,
    conversationHistory: run.conversationHistory,
    attachments: attachmentContext,
    workspace,
    tools: definitions,
    budgetChars: options.contextBudgetChars || 48000,
  });
  run.contextBlocks = context.blocks.map((block) => ({
    id: block.id,
    label: block.label,
    chars: block.chars,
    truncated: block.truncated,
  }));
  run.messages = context.messages.map((message) => ({ ...message }));
  store.save(run);

  const callTool = async (name, args, directedBy) => {
    const call = {
      id: "call_" + crypto.randomBytes(4).toString("hex"),
      name,
      args: args || {},
    };
    const previousLifecycle = run.lifecycle;
    touch(
      run,
      directedBy === "verification" ? "verifying" : "executing_tool",
      { kind: "tool", name, args: call.args, directedBy: directedBy || "model" },
    );
    store.save(run);

    let result;
    try {
      if (run.mode === "read_only" && READ_ONLY_BLOCKED.has(name)) {
        result = {
          ok: false,
          tool: name,
          error: { code: "mutation_blocked", message: name + " is not available in read-only mode." },
        };
      } else if (name === "capability.list" || name === "capability.invoke") {
        result = await dispatchCapability(options.capabilities, run, call, signal, capabilityRegistry);
      } else if (externalToolNames.has(name) && options.externalTools && typeof options.externalTools.call === "function") {
        result = await options.externalTools.call(name, call.args, signal);
      } else if (name === "process.start") {
        const status = await safeContextCall(registry, "process.status", {});
        const data = status && status.ok && status.data;
        if (data && data.status === "running" && !call.args.restart) {
          result = {
            ok: true,
            tool: name,
            data: { ...data, reused: true, suppressed: true, reason: "The CodeMe-owned process is already running." },
          };
        } else if (data && data.status === "failed" && !call.args.restart) {
          result = {
            ok: false,
            tool: name,
            error: {
              code: "process_logs_required",
              message: "The previous CodeMe-owned process failed. Read process.logs, repair the cause, then retry process.start with restart=true.",
            },
            data: { requiresLogs: true },
          };
        } else {
          result = await registry.call(name, call.args);
        }
      } else {
        result = await registry.call(name, call.args);
      }
    } catch (error) {
      result = {
        ok: false,
        tool: name,
        error: {
          code: error && error.code ? String(error.code) : "tool_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    recordTool(run, call, result, directedBy || "model");
    run.inFlight = null;
    run.lifecycle = directedBy === "verification" ? "verifying" : (previousLifecycle === "awaiting_model" ? "running" : "running");
    run.updatedAt = new Date().toISOString();
    store.save(run);
    return result;
  };

  const verify = await createVerifier(run, { registry, workspace, callTool });
  let currentModelTurn = 0;

  const result = await runPipeline({
    provider,
    model: run.effectiveModel,
    messages: context.messages,
    tools: definitions,
    executeTool: (call) => callTool(call.name, call.args, "model"),
    verify,
    maxTurns: options.maxIterations || 20,
    maxRepairRounds: options.maxRepairRounds ?? 2,
    maxToolCallsPerTurn: options.maxToolCallsPerTurn ?? 8,
    turnDeadlineMs: options.timeoutMs || 180000,
    retryDeadlineMs: options.retryTimeoutMs || options.timeoutMs || 180000,
    reconnectDelaysMs: options.reconnectDelaysMs,
    resumeFrom: options.resumeFrom || run.pipelineCheckpoint || null,
    onCheckpoint(checkpoint) {
      run.pipelineCheckpoint = checkpoint;
      store.save(run);
    },
    wallClockMs: options.wallClockMs || 45 * 60 * 1000,
    mode: run.mode,
    composerMode: run.composerMode,
    goal: run.goal,
    forceReadOnlyAnswerOnRepeat: true,
    readOnlyEvidenceLimit: run.mode === "read_only" && !wantsExhaustiveRead(run.goal)
      ? (options.readOnlyEvidenceLimit ?? 6)
      : 0,
    signal,
    takeFollowUps: () => followUpQueue.splice(0, followUpQueue.length),
    onEvent(event) {
      run.events.push({ ...event, at: new Date().toISOString() });
      if (event.type === "model_start") {
        currentModelTurn = event.turn;
        run.iteration = event.turn;
        touch(run, "awaiting_model", { kind: "model", turn: event.turn });
      } else if (event.type === "model_retry") {
        run.repairs.push({
          iteration: event.turn,
          reason: "model_retry",
          summary: event.reason,
          at: new Date().toISOString(),
        });
      } else if (event.type === "model_timeout") {
        run.timeoutDiagnostics = { ...event.diagnostics };
        run.modelTimeoutRetriesUsed = Number(run.modelTimeoutRetriesUsed || 0) + 1;
        run.timeoutRetryPending = true;
      } else if (event.type === "model_timeout_recovered") {
        if (run.timeoutDiagnostics) run.timeoutDiagnostics = { ...run.timeoutDiagnostics, outcome: "recovered" };
        run.timeoutRetryPending = false;
      } else if (event.type === "model_timeout_failed") {
        if (run.timeoutDiagnostics) run.timeoutDiagnostics = { ...run.timeoutDiagnostics, outcome: "failed" };
        run.timeoutRetryPending = false;
      } else if (event.type === "model_reconnect") {
        run.reconnect = {
          status: "retrying",
          turn: event.turn,
          attempt: event.attempt,
          max: event.max,
          delayMs: event.delayMs,
          reason: event.reason,
        };
      } else if (event.type === "model_reconnected") {
        run.reconnect = { status: "recovered", turn: event.turn, attempt: event.attempt };
      } else if (event.type === "model_offline") {
        run.reconnect = { status: "offline", turn: event.turn, reason: event.reason };
      } else if (event.type === "model_end") {
        run.decisions.push({
          iteration: event.turn,
          text: event.text || "",
          toolCalls: event.toolCalls || [],
          at: new Date().toISOString(),
        });
        run.inFlight = null;
        run.lifecycle = "running";
      } else if (event.type === "verify_start") {
        touch(run, "verifying", { kind: "verification", round: event.round });
      } else if (event.type === "verify_end") {
        run.verification = {
          status: event.result && event.result.ok ? "passed" : "failed",
          summary: event.result && event.result.summary || "",
          evidence: event.result && event.result.evidence || [],
        };
        run.verificationHistory.push({
          ...run.verification,
          at: new Date().toISOString(),
        });
        if (!event.result || !event.result.ok) {
          run.repairs.push({
            iteration: currentModelTurn,
            reason: "verification_failed",
            summary: event.result && event.result.summary || "Verification failed",
            at: new Date().toISOString(),
          });
        }
        run.inFlight = null;
        run.lifecycle = "running";
      }
      store.save(run);
    },
  });

  run.messages = result.messages;
  run.inFlight = null;
  if (result.checkpoint) run.pipelineCheckpoint = result.checkpoint;
  run.outcome = {
    status: result.reason,
    summary: result.finalText,
  };
  const success = result.reason === "verified" || result.reason === "answered";
  const resumable = result.reason === "model_offline" || result.reason === "timeout";
  run.lifecycle = result.reason === "cancelled"
    ? "cancelled"
    : success
      ? "completed"
      : resumable
        ? "awaiting_user"
        : "failed";
  if (!success && result.reason !== "cancelled" && !resumable) {
    run.error = {
      code: result.reason,
      message: result.finalText,
    };
  }
  run.updatedAt = new Date().toISOString();
  store.save(run);
  return run;
}

function startPipelineRun(options) {
  const controller = new AbortController();
  const run = createRun({
    ...options,
    inferRequirements: options.inferRequirements !== false,
    maxIterations: options.maxIterations || 20,
  });
  const followUpQueue = [];
  options.store.save(run);

  if (!run.modelLock || run.modelLock.ok === false) {
    run.lifecycle = "failed";
    run.error = {
      code: run.modelLock && run.modelLock.code || "model_not_capable",
      message: run.modelLock && run.modelLock.message || "The selected model cannot run this agent.",
    };
    options.store.save(run);
    return {
      id: run.id,
      run,
      cancel() {},
      followUp() {},
      done: Promise.resolve(run),
    };
  }

  const done = executePipelineRun(run, { ...options, signal: controller.signal }, followUpQueue)
    .catch((error) => {
      run.lifecycle = controller.signal.aborted ? "cancelled" : "failed";
      run.inFlight = null;
      run.error = controller.signal.aborted ? null : {
        code: error && error.code ? String(error.code) : "pipeline_failed",
        message: error instanceof Error ? error.message : String(error),
      };
      run.outcome = {
        status: run.lifecycle,
        summary: controller.signal.aborted ? "Stopped." : run.error.message,
      };
      run.updatedAt = new Date().toISOString();
      options.store.save(run);
      return run;
    });

  return {
    id: run.id,
    run,
    cancel() {
      run.cancelRequested = true;
      controller.abort();
    },
    followUp(text) {
      const value = String(text || "").trim();
      if (!value) return;
      followUpQueue.push(value);
      applyFollowUp(run, value);
      options.store.save(run);
    },
    done,
  };
}

module.exports = {
  startPipelineRun,
  executePipelineRun,
  createVerifier,
};
