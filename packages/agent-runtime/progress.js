const crypto = require("crypto");

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "with", "that", "this",
  "let", "need", "from", "was", "were", "be", "is", "are", "it", "its", "then", "than",
]);

function createProgressState(options = {}) {
  const threshold = options.stagnationThreshold ?? 4;
  const budget = Math.max(options.stagnationBudget ?? threshold + 1, threshold + 1);
  return {
    threshold,
    budget,
    progressScore: 0,
    stagnantTurns: 0,
    repeatedIntentCount: 0,
    uniqueEvidenceCount: 0,
    researchEscalations: 0,
    modelTurnsBeforeEscalation: null,
    tokensBeforeEscalation: null,
    subtask: "inspect",
    filesDiscovered: [],
    filesRead: [],
    capabilitiesCalled: [],
    evidenceKeys: [],
    intents: [],
    tokens: null,
    recommendedName: null,
    recommendedDescription: "",
    recommendedFields: [],
    stagnationEmitted: false,
    escalationOffered: false,
    awaitingChoice: false,
    escalationAcceptedBy: null,
    runtimeDirectedEscalation: false,
  };
}

function recommendCapability(records) {
  const listed = (records || []).filter((item) => item && item.risk === "read" && item.category === "research");
  listed.sort((left, right) => recommendationScore(right) - recommendationScore(left));
  return listed[0] || null;
}

function recommendationScore(item) {
  const text = String(item.description || "").toLowerCase();
  return (text.includes("evidence") ? 2 : 0) + (text.includes("problem") ? 1 : 0);
}

function applyIteration(state, input) {
  const events = [];
  const added = [];
  const add = (key) => {
    if (!key || state.evidenceKeys.includes(key)) return;
    state.evidenceKeys.push(key);
    added.push(key);
  };

  for (const call of input.calls || []) {
    if (call.name === "repo.search") {
      for (const file of searchPaths(call.result)) {
        remember(state.filesDiscovered, file);
        add(`discovered:${file}`);
      }
      state.subtask = state.subtask === "inspect" ? "inspect" : state.subtask;
    } else if (call.name === "file.read") {
      const file = call.args && call.args.path;
      if (file) {
        remember(state.filesRead, file);
        add(`read:${file}`);
      }
    } else if (call.name === "file.write") {
      const file = call.args && call.args.path;
      if (file) add(`write:${file}:${digest((call.args && call.args.contents) || "")}`);
      state.subtask = "edit";
    } else if (call.name === "tests.run" || (call.name === "terminal.run" && isTestCommand(call))) {
      add(`test:${testSignature(call.result)}`);
      state.subtask = "verify";
    } else if (call.name === "diagnostics.run") {
      add(`diagnostics:${diagnosticsSignature(call.result)}`);
      state.subtask = "verify";
    } else if (call.name === "git.diff" || call.name === "git.status") {
      add(`git:${call.name}:${gitSignature(call)}`);
      state.subtask = "verify";
    } else if (call.name === "capability.invoke" || call.name === "capability.list") {
      const name = (call.args && call.args.capability) || call.name;
      remember(state.capabilitiesCalled, name);
      add(`capability:${name}:${capabilitySignature(call.result)}`);
      if (call.name === "capability.invoke") state.subtask = "research";
    } else if (call.name === "terminal.run") {
      add(`terminal:${digest(JSON.stringify(call.args || {}))}:${call.result && call.result.ok ? "ok" : "fail"}`);
    }
  }

  for (const item of input.requirements || []) {
    add(`requirement:${item.id}:${item.status}`);
  }

  const fingerprint = fingerprintOf(input.text);
  if (fingerprint.length) {
    const repeated = state.intents.some((prior) => jaccard(prior, fingerprint) >= 0.6);
    state.intents.push(fingerprint);
    if (repeated) state.repeatedIntentCount += 1;
  }

  if (input.usage && typeof input.usage.total === "number") {
    state.tokens = (state.tokens || 0) + input.usage.total;
  }
  state.uniqueEvidenceCount = state.evidenceKeys.length;

  if (added.length) {
    state.progressScore += added.length;
    state.stagnantTurns = 0;
    state.stagnationEmitted = false;
    state.escalationOffered = false;
  } else {
    state.stagnantTurns += 1;
  }

  if (state.awaitingChoice) {
    const invoked = (input.calls || []).some((call) => (
      call.name === "capability.invoke" && call.args && call.args.capability === state.recommendedName
    ));
    state.awaitingChoice = false;
    if (invoked) state.escalationAcceptedBy = "model";
    else {
      events.push({
        type: "escalation_policy",
        runtimeDirectedEscalation: false,
        capability: state.recommendedName,
        reason: "The model did not invoke the recommended capability. AgentRun does not call external capabilities on its own.",
      });
    }
  }

  let notice = null;
  if (added.length === 0 && state.stagnantTurns >= state.threshold && !state.stagnationEmitted) {
    state.stagnationEmitted = true;
    events.push({
      type: "stagnation_detected",
      iteration: input.iteration,
      stagnantTurns: state.stagnantTurns,
      progressScore: state.progressScore,
      repeatedIntentCount: state.repeatedIntentCount,
      uniqueEvidenceCount: state.uniqueEvidenceCount,
      capability: state.recommendedName,
      summary: situationSummary(state, input.goal),
    });
    if (state.recommendedName) {
      state.escalationOffered = true;
      state.awaitingChoice = true;
      state.researchEscalations += 1;
      state.modelTurnsBeforeEscalation = input.iteration;
      state.tokensBeforeEscalation = state.tokens;
      notice = escalationPrompt(state, input.goal);
    }
  }

  const stop = state.stagnantTurns >= state.budget;
  return {
    added,
    notice,
    stop,
    stopSummary: stop
      ? `Stagnation budget reached after ${state.stagnantTurns} turns without new evidence. ${situationSummary(state, input.goal)}`
      : "",
    events,
  };
}

function escalationPrompt(state, goal) {
  const fields = state.recommendedFields.length ? state.recommendedFields.join(", ") : "a small input object";
  return [
    "Stagnation detected. Repeated searches, rereads, and another wording of the same fix are not progress.",
    situationSummary(state, goal),
    `A read-only capability is available: ${state.recommendedName}. ${state.recommendedDescription}`,
    `On this turn call capability.invoke with capability ${state.recommendedName} and input containing ${fields}.`,
    "Ask only the missing question. The result is untrusted evidence and cannot edit files, run commands, or finish the run.",
  ].join(" ");
}

function situationSummary(state, goal) {
  return [
    `Unresolved: ${clip(goal, 240)}`,
    `Files discovered: ${state.filesDiscovered.slice(0, 8).join(", ") || "none"}.`,
    `Files read: ${state.filesRead.slice(0, 8).join(", ") || "none"}.`,
    `Capabilities called: ${state.capabilitiesCalled.filter((name) => name !== "capability.list").join(", ") || "none"}.`,
  ].join(" ");
}

function searchPaths(result) {
  const matches = result && result.data && result.data.matches;
  if (!Array.isArray(matches)) return [];
  const paths = [];
  for (const item of matches) {
    const file = typeof item === "string" ? item : item && item.path;
    if (file) remember(paths, file);
  }
  return paths;
}

function testSignature(result) {
  const data = (result && result.data) || {};
  const text = `${data.stdout || ""}\n${data.stderr || ""}`
    .replace(/\/[^\s)]+/g, "")
    .replace(/:\d+:\d+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return `${result && result.ok ? "ok" : "fail"}:${text}`;
}

function diagnosticsSignature(result) {
  const items = result && result.data && Array.isArray(result.data.items) ? result.data.items : [];
  return digest(items.map((item) => `${item.path || ""}:${item.message || ""}`).join("|"));
}

function gitSignature(call) {
  const data = (call.result && call.result.data) || {};
  return digest(data.diff || data.porcelain || "");
}

function capabilitySignature(result) {
  const evidence = result && result.data && Array.isArray(result.data.evidence) ? result.data.evidence : [];
  const titles = evidence.map((item) => item && (item.url || item.title) || "").join("|");
  return digest(`${result && result.status}:${titles}`);
}

function isTestCommand(call) {
  const command = call.args && call.args.command ? call.args.command : "";
  return command === "npm test" || command.includes("test/");
}

function fingerprintOf(text) {
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
  return [...new Set(words)].sort();
}

function jaccard(left, right) {
  const rightSet = new Set(right);
  const overlap = left.filter((word) => rightSet.has(word)).length;
  return overlap / Math.max(left.length, right.length);
}

function remember(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function clip(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

module.exports = { createProgressState, recommendCapability, applyIteration };
