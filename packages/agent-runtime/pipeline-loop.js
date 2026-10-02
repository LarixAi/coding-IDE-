let fallbackCallCounter = 0;

function nextCallId(name) {
  fallbackCallCounter += 1;
  return "call_" + fallbackCallCounter + "_" + String(name || "tool").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function embeddedJsonObjects(text) {
  const source = String(text || "");
  const values = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        quoted = false;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        values.push(source.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return values;
}

function recoverTextToolCalls(content, knownNames) {
  const text = String(content || "").trim();
  if (!text) return [];
  const candidates = [];

  for (const match of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi)) {
    if (match[1]) candidates.push(String(match[1]).trim());
  }
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
    const value = String(match[1] || "").trim();
    if (value.startsWith("{") && value.endsWith("}")) candidates.push(value);
  }
  if (!candidates.length && text.startsWith("{") && text.endsWith("}")) candidates.push(text);
  for (const value of embeddedJsonObjects(text)) candidates.push(value);

  const calls = [];
  const seen = new Set();
  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      let name = String(parsed.name || parsed.tool || "").trim();
      if (!knownNames.has(name)) {
        const canonical = [...knownNames].find((candidate) => candidate.replace(/\./g, "_") === name);
        if (!canonical) continue;
        name = canonical;
      }
      let args = parsed.arguments !== undefined ? parsed.arguments : parsed.args;
      if (typeof args === "string") args = JSON.parse(args);
      if (!args || typeof args !== "object" || Array.isArray(args)) args = {};
      const key = name + ":" + JSON.stringify(args);
      if (seen.has(key)) continue;
      seen.add(key);
      calls.push({ id: nextCallId(name), name, args });
    } catch {
      // Ordinary assistant text is not a tool call.
    }
  }
  return calls;
}

function normalizeArgs(name, rawArgs) {
  const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
    ? { ...rawArgs }
    : {};
  const alias = (canonical, alternatives) => {
    if (args[canonical] !== undefined && args[canonical] !== null && args[canonical] !== "") return;
    for (const key of alternatives) {
      if (args[key] !== undefined && args[key] !== null) {
        args[canonical] = args[key];
        return;
      }
    }
  };

  alias("path", ["file", "filepath", "file_path", "filePath", "filename", "target"]);
  alias("contents", ["content", "body", "text", "code", "data", "source"]);
  alias("oldText", ["old_text", "old", "from", "search", "find", "oldString"]);
  alias("newText", ["new_text", "new", "to", "replace", "replacement", "newString"]);
  alias("query", ["q", "search"]);
  alias("command", ["cmd", "shell"]);
  alias("url", ["href", "uri", "link", "address"]);

  if (name === "file.write" && args.contents !== undefined && typeof args.contents !== "string") {
    args.contents = String(args.contents);
  }
  return args;
}

function missingRequired(tool, args) {
  const required = tool && tool.parameters && Array.isArray(tool.parameters.required)
    ? tool.parameters.required
    : [];
  return required.filter((key) => args[key] === undefined || args[key] === null || args[key] === "");
}

function formatVerifyFailure(result) {
  const items = result && Array.isArray(result.items) ? result.items : [];
  const failed = items
    .filter((item) => !item.ok)
    .map((item) => "- " + item.label + ": " + item.detail);
  return failed.join("\n") || String(result && result.summary || "Verification failed");
}

const READ_ONLY_EVIDENCE_TOOLS = new Set([
  "workspace.inspect",
  "dir.list",
  "file.read",
  "repo.search",
  "git.status",
  "git.diff",
  "diagnostics.run",
  "capability.invoke",
]);

function actionKey(call) {
  return String(call && call.name || "") + ":" + JSON.stringify(call && call.args || {});
}

function compactReadOnlyAnswerMessages(messages, goal, reason) {
  const system = (messages || []).find((message) => message && message.role === "system");
  const systemText = String(system && system.content || "")
    .replace(/\n\n## Available tools\n[\s\S]*$/, "")
    .trim();
  const evidence = [];
  for (let index = (messages || []).length - 1; index >= 0 && evidence.length < 5; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "tool") continue;
    const name = String(message.name || "tool");
    const content = String(message.content || "").slice(0, 5000);
    if (!content) continue;
    evidence.push("Evidence from " + name + ":\n" + content);
  }
  evidence.reverse();

  return [
    ...(systemText ? [{ role: "system", content: systemText }] : []),
    {
      role: "user",
      content: [
        "ASK MODE FINAL ANSWER.",
        "Original request: " + String(goal || "").slice(0, 4000),
        reason ? "Why tool use stopped: " + String(reason).slice(0, 800) : "",
        evidence.length ? evidence.join("\n\n") : "Use the trusted workspace context already provided.",
        "Answer the user now from the evidence above.",
        "Do not call another tool, do not repeat file inspection, and do not claim that files were edited.",
        "If implementation is required, explain that Code mode is required to apply changes.",
      ].filter(Boolean).join("\n\n"),
    },
  ];
}

function withDeadline(parentSignal, timeoutMs, run) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (parentSignal && parentSignal.aborted) controller.abort();
  if (parentSignal) parentSignal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return Promise.resolve()
    .then(() => run(controller.signal))
    .catch((error) => {
      if (timedOut) {
        throw Object.assign(new Error("model request timed out"), { code: "timeout" });
      }
      throw error;
    })
    .finally(() => {
      clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener("abort", onAbort);
    });
}

async function runPipeline(options) {
  const maxTurns = options.maxTurns ?? 20;
  const maxRepairRounds = options.maxRepairRounds ?? 2;
  const maxToolCallsPerTurn = options.maxToolCallsPerTurn ?? 8;
  const turnDeadlineMs = options.turnDeadlineMs ?? 240000;
  const wallClockMs = options.wallClockMs ?? 45 * 60 * 1000;
  const onEvent = options.onEvent || (() => {});
  const started = Date.now();
  const messages = (options.messages || []).map((message) => ({ ...message }));
  const tools = Array.isArray(options.tools) ? options.tools : [];
  const knownNames = new Set(tools.map((tool) => tool.name));
  const readOnlyMode = options.mode === "read_only";
  const forceReadOnlyAnswerOnRepeat = readOnlyMode && options.forceReadOnlyAnswerOnRepeat !== false;
  const readOnlyEvidenceLimit = Math.max(0, Number(options.readOnlyEvidenceLimit || 0));
  const actionCounts = new Map();
  let answerOnlyPending = false;
  let answerOnlyReason = "";
  let readOnlyEvidenceCount = 0;
  let turn = 0;
  let idleTurns = 0;
  let repairs = 0;
  let toolCallCount = 0;
  let finalText = "";
  let lastVerify = null;

  const finish = (reason, text) => {
    const answer = String(text || finalText || "Done.").trim() || "Done.";
    onEvent({ type: "final", reason, text: answer, turn });
    return {
      finalText: answer,
      reason,
      turns: turn,
      messages,
      verify: lastVerify,
      toolCallCount,
    };
  };

  while (turn < maxTurns) {
    if (options.signal && options.signal.aborted) return finish("cancelled", finalText);
    if (Date.now() - started > wallClockMs) {
      return finish("wall_clock", (finalText ? finalText + "\n\n" : "") + "Stopped after reaching the run time limit.");
    }

    const followUps = options.takeFollowUps ? options.takeFollowUps() : [];
    for (const followUp of followUps || []) {
      const text = String(followUp || "").trim();
      if (text) messages.push({ role: "user", content: "Follow-up from the user. Keep the same run and update the active work:\n" + text });
    }

    turn += 1;
    onEvent({ type: "model_start", turn });
    const modelStarted = Date.now();

    const answerOnlyTurn = readOnlyMode && answerOnlyPending;
    let turnTools = answerOnlyTurn ? [] : tools;
    let turnKnownNames = answerOnlyTurn ? new Set() : knownNames;
    let turnMessages = answerOnlyTurn
      ? compactReadOnlyAnswerMessages(messages, options.goal, answerOnlyReason)
      : messages;

    const requestModel = (signal) => options.provider.complete({
      model: options.model,
      messages: turnMessages,
      tools: turnTools,
      signal,
      timeoutMs: turnDeadlineMs,
    });

    let reply;
    try {
      reply = await withDeadline(options.signal, turnDeadlineMs, requestModel);
    } catch (error) {
      if (options.signal && options.signal.aborted) return finish("cancelled", finalText);
      const retryAsAnswerOnly = readOnlyMode && (answerOnlyPending || readOnlyEvidenceCount > 0);
      onEvent({
        type: "model_retry",
        turn,
        reason: error instanceof Error ? error.message : String(error),
        ...(retryAsAnswerOnly ? { mode: "answer_only" } : {}),
      });
      if (retryAsAnswerOnly) {
        answerOnlyPending = true;
        answerOnlyReason = "The previous model request timed out after workspace evidence had already been collected.";
        turnTools = [];
        turnKnownNames = new Set();
        turnMessages = compactReadOnlyAnswerMessages(messages, options.goal, answerOnlyReason);
      }
      const retryDeadlineMs = Math.max(60000, Math.floor(turnDeadlineMs / 2));
      reply = await withDeadline(
        options.signal,
        retryDeadlineMs,
        (signal) => options.provider.complete({
          model: options.model,
          messages: turnMessages,
          tools: turnTools,
          signal,
          timeoutMs: retryDeadlineMs,
        }),
      );
    }

    let toolCalls = Array.isArray(reply && reply.toolCalls) ? reply.toolCalls : [];
    if (!toolCalls.length && reply && reply.text) {
      toolCalls = recoverTextToolCalls(reply.text, turnKnownNames);
    }
    toolCalls = toolCalls
      .slice(0, maxToolCallsPerTurn)
      .map((call) => ({
        id: call.id || nextCallId(call.name),
        name: String(call.name || ""),
        args: normalizeArgs(String(call.name || ""), call.args || call.arguments || {}),
      }));

    const text = String(reply && reply.text || "");
    onEvent({
      type: "model_end",
      turn,
      durationMs: Date.now() - modelStarted,
      text,
      toolCalls,
      usage: reply && reply.usage || null,
    });
    messages.push({
      role: "assistant",
      content: text,
      ...(toolCalls.length ? { toolCalls } : {}),
    });

    if (!toolCalls.length) {
      if (!text.trim()) {
        idleTurns += 1;
        if (idleTurns >= 2) return finish("idle", "Stopped because the model returned two empty replies.");
        messages.push({
          role: "user",
          content: "Your reply was empty. Call a tool to make progress or give a final answer.",
        });
        continue;
      }

      finalText = text;
      if (!options.verify) return finish("answered", text);

      onEvent({ type: "verify_start", round: repairs + 1, turn });
      lastVerify = await options.verify({ text, messages, turn });
      onEvent({ type: "verify_end", round: repairs + 1, turn, result: lastVerify });
      if (lastVerify && lastVerify.ok) return finish("verified", text);
      if (repairs >= maxRepairRounds) {
        return finish(
          "verify_failed",
          text + "\n\nVerification is still failing:\n" + formatVerifyFailure(lastVerify),
        );
      }

      repairs += 1;
      messages.push({
        role: "user",
        content:
          "VERIFICATION FAILED (repair round " + repairs + "/" + maxRepairRounds + "). " +
          "Use the available tools to fix every failed item, then answer again. " +
          "Do not describe a future tool call in prose: if a file change, command, browser action, or external lookup is required, your next turn must issue the native tool call now.\n" +
          formatVerifyFailure(lastVerify),
      });
      continue;
    }

    idleTurns = 0;
    for (const call of toolCalls) {
      if (options.signal && options.signal.aborted) return finish("cancelled", finalText);
      const tool = tools.find((item) => item.name === call.name);
      let result;
      const startedTool = Date.now();
      const key = actionKey(call);
      const priorCount = actionCounts.get(key) || 0;
      onEvent({ type: "tool_start", turn, call });

      if (
        forceReadOnlyAnswerOnRepeat
        && READ_ONLY_EVIDENCE_TOOLS.has(call.name)
        && priorCount > 0
      ) {
        result = {
          ok: true,
          tool: call.name,
          data: {
            suppressed: true,
            repeated: true,
            reason: "This read-only tool call already succeeded or was already attempted with the same arguments.",
          },
        };
        answerOnlyPending = true;
        answerOnlyReason = "A repeated " + call.name + " call was suppressed because the same evidence was already requested.";
        onEvent({
          type: "tool_repeat_suppressed",
          turn,
          call,
          reason: answerOnlyReason,
        });
      } else if (!tool) {
        result = {
          ok: false,
          error: { code: "unknown_tool", message: "Unknown tool " + call.name },
        };
      } else {
        const missing = missingRequired(tool, call.args);
        if (missing.length) {
          result = {
            ok: false,
            tool: call.name,
            error: {
              code: "invalid_args",
              message: "Missing required argument(s): " + missing.join(", "),
            },
          };
        } else {
          try {
            result = await options.executeTool(call, { turn });
          } catch (error) {
            result = {
              ok: false,
              tool: call.name,
              error: {
                code: "tool_failed",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }
        }
      }

      actionCounts.set(key, priorCount + 1);
      toolCallCount += 1;
      if (
        readOnlyMode
        && result
        && result.ok
        && READ_ONLY_EVIDENCE_TOOLS.has(call.name)
        && !(result.data && result.data.suppressed)
      ) {
        readOnlyEvidenceCount += 1;
        if (readOnlyEvidenceLimit > 0 && readOnlyEvidenceCount >= readOnlyEvidenceLimit) {
          answerOnlyPending = true;
          answerOnlyReason = "The read-only evidence budget was reached. Use the collected evidence instead of continuing to inspect.";
          onEvent({
            type: "read_only_evidence_limit",
            turn,
            count: readOnlyEvidenceCount,
            limit: readOnlyEvidenceLimit,
          });
        }
      }
      onEvent({
        type: "tool_end",
        turn,
        call,
        result,
        durationMs: Date.now() - startedTool,
      });
      messages.push({
        role: "tool",
        name: call.name,
        content: JSON.stringify(result).slice(0, 12000),
      });
      if (
        call.name === "browser.interact"
        && result
        && result.ok
        && result.data
        && result.data.matched !== false
      ) {
        messages.push({
          role: "user",
          content:
            "The requested real-browser interaction has succeeded. If the user's requested behavior is now satisfied, give the final answer without making further edits. " +
            "Do not make cosmetic, cleanup, or speculative changes after successful verification. If a real edit is still necessary, you must verify the browser again after that edit.",
        });
      }
    }
  }

  return finish(
    "max_turns",
    (finalText ? finalText + "\n\n" : "") + "Stopped after reaching the maximum model turns (" + maxTurns + ").",
  );
}

module.exports = {
  runPipeline,
  recoverTextToolCalls,
  embeddedJsonObjects,
  normalizeArgs,
};
