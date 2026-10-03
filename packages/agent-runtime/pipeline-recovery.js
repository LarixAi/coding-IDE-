const DEFAULT_RECONNECT_DELAYS_MS = Object.freeze([2000, 4000, 8000, 16000, 30000]);

function messageChars(messages) {
  return (messages || []).reduce((total, message) => total + String(message && message.content || "").length, 0);
}

function collectFiles(messages) {
  const read = new Set();
  const changed = new Set();
  for (const message of messages || []) {
    const calls = Array.isArray(message && message.toolCalls) ? message.toolCalls : [];
    for (const call of calls) {
      const name = String(call && call.name || "");
      const args = call && (call.args || call.arguments) || {};
      const paths = [];
      if (typeof args.path === "string" && args.path.trim()) paths.push(args.path.trim());
      if (Array.isArray(args.files)) {
        for (const item of args.files) {
          if (item && typeof item.path === "string" && item.path.trim()) paths.push(item.path.trim());
        }
      }
      const writes = new Set(["file.write", "file.patch", "file.delete", "file.move", "dir.create"]);
      for (const path of paths) {
        if (writes.has(name)) changed.add(path);
        else read.add(path);
      }
    }
  }
  for (const path of changed) read.delete(path);
  return { filesRead: [...read], filesChanged: [...changed] };
}

function summarizeToolMessage(message) {
  const content = String(message && message.content || "");
  const head = content.split(/\r?\n/).find((line) => line.trim()) || "";
  const state = /"ok"\s*:\s*false|\bERROR\b/i.test(content) ? "ERROR" : "OK";
  return state + " [compacted " + content.length + " chars from " + String(message && message.name || "tool") + "]: "
    + head.replace(/^(OK|ERROR)\s*:?\s*/i, "").slice(0, 180);
}

function compactMessages(messages, options = {}) {
  const source = (messages || []).map((message) => ({ ...message }));
  const keepRecent = Math.max(4, Number(options.keepRecent || 8));
  const maxToolChars = Math.max(600, Number(options.maxToolChars || 1400));
  const beforeChars = messageChars(source);
  const touched = collectFiles(source);
  const originalGoalIndex = source.findIndex((message) => message && message.role === "user");
  const recentFrom = Math.max(originalGoalIndex + 1, source.length - keepRecent);
  let lastVerificationIndex = -1;
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (/VERIFICATION FAILED/i.test(String(source[index] && source[index].content || ""))) {
      lastVerificationIndex = index;
      break;
    }
  }

  let summarized = 0;
  const compacted = source.map((message, index) => {
    if (index <= originalGoalIndex || index >= recentFrom || index === lastVerificationIndex) return message;
    const content = String(message && message.content || "");

    if (message && message.role === "tool" && content.length > maxToolChars) {
      summarized += 1;
      return { ...message, content: summarizeToolMessage(message) };
    }

    if (message && message.role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      const toolCalls = message.toolCalls.map((call) => {
        const raw = call && (call.args || call.arguments) || {};
        const args = {};
        for (const [key, value] of Object.entries(raw)) {
          if (typeof value === "string" && value.length > maxToolChars) {
            args[key] = "[" + value.length + " chars omitted]";
            summarized += 1;
          } else {
            args[key] = value;
          }
        }
        return { ...call, args };
      });
      return {
        ...message,
        content: content.slice(0, maxToolChars),
        toolCalls,
      };
    }

    if (content.length > maxToolChars * 3) {
      summarized += 1;
      return { ...message, content: content.slice(0, maxToolChars) + "\n…[compacted after timeout]" };
    }
    return message;
  });

  compacted.push({
    role: "user",
    content: [
      "MODEL TIMEOUT RECOVERY TURN.",
      "The previous model request timed out. Continue the same task from confirmed state; do not restart from scratch.",
      touched.filesRead.length ? "Files already read: " + touched.filesRead.slice(0, 30).join(", ") : "",
      touched.filesChanged.length ? "Files already changed: " + touched.filesChanged.slice(0, 30).join(", ") : "",
      "Use the latest verification evidence above. Make one concrete tool call next, or give the final answer if the task is already complete.",
    ].filter(Boolean).join("\n"),
  });

  return {
    messages: compacted,
    beforeChars,
    afterChars: messageChars(compacted),
    summarized,
    ...touched,
  };
}

function isTimeoutError(error) {
  return Boolean(error && (error.code === "timeout" || /timed out|timeout/i.test(String(error.message || error))));
}

function isConnectionLoss(error) {
  if (!error) return false;
  if (error.code === "model_disconnected" || error.code === "ECONNRESET" || error.code === "ECONNREFUSED") return true;
  const message = String(error.message || error);
  return /ECONNREFUSED|ECONNRESET|socket hang up|failed to fetch|network error|service unavailable|HTTP 50[234]|connection.*(?:lost|closed|refused|reset)/i.test(message);
}

function checkpointState(input = {}) {
  return {
    turn: Number(input.turn || 0),
    messages: (input.messages || []).map((message) => ({ ...message })),
    toolCallCount: Number(input.toolCallCount || 0),
    repairs: Number(input.repairs || 0),
    finalText: String(input.finalText || ""),
    savedAt: Date.now(),
  };
}

module.exports = {
  DEFAULT_RECONNECT_DELAYS_MS,
  compactMessages,
  collectFiles,
  isTimeoutError,
  isConnectionLoss,
  checkpointState,
};
