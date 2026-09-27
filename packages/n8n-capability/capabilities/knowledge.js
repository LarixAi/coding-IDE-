const SEED = [
  {
    title: "CodeMe owns local files",
    text: "The hub must not read or edit the workspace. File, git, terminal, and test tools stay in CodeMe.",
    tags: ["architecture", "security"],
  },
  {
    title: "Qwen is the coding model",
    text: "Qwen 3.5 9B reasons through CodeMe. The hub returns evidence, prior notes, and task graphs.",
    tags: ["architecture", "qwen"],
  },
  {
    title: "Completion needs evidence",
    text: "A model claim of success is not completion. Tests, diagnostics, and the diff decide.",
    tags: ["verification"],
  },
];

function lookupKnowledge(body, store) {
  const started = Date.now();
  if (body.capability && body.capability !== "knowledge.lookup") {
    return knowledgeEnvelope(body, "error", null, { code: "capability_unavailable", message: "This workflow only serves knowledge.lookup" }, started);
  }
  if (!store || typeof store !== "object") {
    return knowledgeEnvelope(body, "error", null, { code: "invalid_input", message: "knowledge store is missing" }, started);
  }
  if (!Array.isArray(store.entries) || store.entries.length === 0) store.entries = SEED.map((entry) => ({ ...entry }));

  const action = body.input && body.input.action === "remember" ? "remember" : "lookup";
  if (action === "remember") {
    const saved = remember(store, body.input && body.input.entry);
    if (saved.error) return knowledgeEnvelope(body, "error", null, { code: "invalid_input", message: saved.error }, started);
    return knowledgeEnvelope(body, "ok", { action: "remember", entry: saved.entry }, null, started);
  }

  const query = clip(body.input && (body.input.query || body.input.problem), 500);
  if (!query) return knowledgeEnvelope(body, "error", null, { code: "invalid_input", message: "input.query is required" }, started);
  const queryTokens = tokens(query);
  const matches = store.entries
    .map((entry) => ({
      title: clip(entry.title, 160),
      text: clip(entry.text, 1000),
      tags: Array.isArray(entry.tags) ? entry.tags.map((tag) => clip(tag, 40)).filter(Boolean).slice(0, 8) : [],
      score: score(entry, queryTokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
  const warnings = matches.length ? [] : ["No stored note matched this query"];
  return knowledgeEnvelope(body, "ok", { action: "lookup", query, matches }, null, started, warnings);
}

function remember(store, entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { error: "entry must be an object" };
  const title = clip(entry.title, 160);
  const text = clip(entry.text, 1000);
  if (!title || !text) return { error: "entry title and text are required" };
  const tags = Array.isArray(entry.tags) ? entry.tags.map((tag) => clip(tag, 40)).filter(Boolean).slice(0, 8) : [];
  const kept = store.entries.filter((item) => clip(item.title, 160) !== title);
  const seeds = kept.filter((item) => !item.remembered);
  const remembered = kept.filter((item) => item.remembered).concat([{ title, text, tags, remembered: true }]).slice(-30);
  store.entries = seeds.concat(remembered);
  return { entry: { title, text, tags } };
}

function score(entry, queryTokens) {
  const hay = new Set(tokens(`${entry.title || ""} ${entry.text || ""} ${(entry.tags || []).join(" ")}`));
  let count = 0;
  for (const token of queryTokens) if (hay.has(token)) count += 1;
  return count;
}

function tokens(value) {
  return String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
}

function knowledgeEnvelope(body, status, data, error, started, warnings) {
  return {
    protocolVersion: 1,
    requestId: body.requestId,
    status,
    data,
    sources: [],
    warnings: warnings || [],
    error,
    duration: Date.now() - started,
  };
}

function clip(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

module.exports = { lookupKnowledge, SEED };
