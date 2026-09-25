async function researchProblem(body, httpRequest) {
  const started = Date.now();
  if (body.capability && body.capability !== "research.problem") {
    return researchEnvelope(body, "error", null, { code: "capability_unavailable", message: "This workflow only serves research.problem" }, [], [], started);
  }
  const problem = clip(body.input && body.input.problem, 1500);
  if (!problem) {
    return researchEnvelope(body, "error", null, { code: "invalid_input", message: "input.problem is required" }, [], [], started);
  }

  const warnings = [];
  const [web, issues, answers] = await Promise.all([
    collectWeb(problem, httpRequest).catch((error) => failedSource(warnings, "web", error)),
    collectIssues(problem, httpRequest).catch((error) => failedSource(warnings, "github", error)),
    collectAnswers(problem, httpRequest).catch((error) => failedSource(warnings, "stackoverflow", error)),
  ]);
  const evidence = [];
  for (const item of [...web, ...issues, ...answers]) {
    if (evidence.length >= 6) break;
    evidence.push(item);
  }
  if (!evidence.length) warnings.push("No external evidence was returned");
  warnings.push("This pass returns evidence only. The coding model decides the fix.");
  return researchEnvelope(body, "ok", {
    problem,
    likely_cause: null,
    recommended_fix: null,
    evidence,
    examples: [],
    confidence: evidence.length >= 3 ? "medium" : "low",
    conflicts: [],
  }, null, evidence.map((item) => ({ title: item.title, url: item.url })), warnings, started);
}

async function collectWeb(problem, httpRequest) {
  const payload = await httpRequest({
    url: `https://api.duckduckgo.com/?q=${encodeURIComponent(problem)}&format=json&no_html=1&skip_disambig=1`,
  });
  const found = [];
  if (payload && payload.AbstractText) {
    const item = evidenceItem(payload.Heading || "Web result", payload.AbstractURL, payload.AbstractText, "web");
    if (item) found.push(item);
  }
  const topics = [];
  flattenTopics(payload && payload.RelatedTopics, topics);
  for (const topic of topics) {
    const item = evidenceItem(topic.Text, topic.FirstURL, topic.Text, "web");
    if (item) found.push(item);
  }
  return found.slice(0, 3);
}

async function collectIssues(problem, httpRequest) {
  const payload = await httpRequest({
    url: `https://api.github.com/search/issues?q=${encodeURIComponent(problem.slice(0, 200))}&per_page=3`,
    headers: { "User-Agent": "CodeMe", Accept: "application/vnd.github+json" },
  });
  return (payload && payload.items || []).slice(0, 3).map((item) => evidenceItem(item.title, item.html_url, item.body, "github.issues")).filter(Boolean);
}

async function collectAnswers(problem, httpRequest) {
  const payload = await httpRequest({
    url: `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow&pagesize=3&q=${encodeURIComponent(problem.slice(0, 160))}`,
    headers: { "User-Agent": "CodeMe" },
  });
  return (payload && payload.items || []).slice(0, 3).map((item) => evidenceItem(item.title, item.link, item.title, "stackoverflow")).filter(Boolean);
}

function flattenTopics(topics, out) {
  for (const topic of topics || []) {
    if (out.length >= 3) return;
    if (topic && topic.Topics) flattenTopics(topic.Topics, out);
    else if (topic) out.push(topic);
  }
}

function evidenceItem(title, url, excerpt, source) {
  const cleanUrl = clip(url, 500);
  if (!/^https?:\/\//i.test(cleanUrl)) return null;
  const cleanTitle = clip(title, 180);
  if (!cleanTitle) return null;
  return {
    title: cleanTitle,
    url: cleanUrl,
    excerpt: clip(excerpt, 400),
    source,
  };
}

function failedSource(warnings, source, error) {
  warnings.push(`${source} lookup failed: ${clip(error && error.message, 160) || "request failed"}`);
  return [];
}

function researchEnvelope(body, status, data, error, sources, warnings, started) {
  return {
    protocolVersion: 1,
    requestId: body.requestId,
    status,
    data,
    sources,
    warnings,
    error,
    duration: Date.now() - started,
  };
}

function clip(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

module.exports = { researchProblem };
