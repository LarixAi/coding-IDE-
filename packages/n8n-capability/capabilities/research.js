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
  for (const item of [...web, ...issues.filter((item) => relevant(item, problem)), ...answers.filter((item) => relevant(item, problem))]) {
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
  let payload = null;
  for (const query of candidateQueries(problem)) {
    payload = await httpRequest({
      url: `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
    });
    const page = payload && payload.AbstractURL;
    if (payload && (payload.AbstractText || (typeof page === "string" && /wikipedia\.org\/wiki\//i.test(page)))) break;
  }
  const found = [];
  const page = payload && payload.AbstractURL;
  if (typeof page === "string" && /wikipedia\.org\/wiki\//i.test(page)) {
    try {
      const procedure = await wikipediaProcedure(page, httpRequest);
      if (procedure) found.push(procedure);
    } catch (_error) {
      // The abstract remains available when the page extract cannot be fetched.
    }
  }
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
  if (found.length) return found.slice(0, 3);
  const query = webQuery(problem);
  const pageHtml = await httpRequest({
    url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    json: false,
    timeout: 12000,
    headers: { "User-Agent": "CodeMe" },
  });
  const text = asText(pageHtml);
  const parsed = parseSearchResults(text);
  if (parsed.length) return parsed.slice(0, 4);
  if (!text) {
    const kind = pageHtml == null ? "empty" : typeof pageHtml;
    const keys = pageHtml && typeof pageHtml === "object" ? Object.keys(pageHtml).slice(0, 6).join(",") : "";
    throw new Error(`web page was empty (${kind}${keys ? ` ${keys}` : ""})`);
  }
  return [];
}

async function wikipediaProcedure(pageUrl, httpRequest) {
  const title = decodeURIComponent(String(pageUrl).split("/wiki/")[1] || "").split(/[?#]/)[0];
  if (!title) return null;
  const payload = await httpRequest({
    url: `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`,
    headers: { "User-Agent": "CodeMe" },
  });
  const pages = payload && payload.query && payload.query.pages;
  const page = pages && Object.values(pages)[0];
  const excerpt = procedureExcerpt(page && page.extract);
  if (!excerpt) return null;
  return evidenceItem((page && page.title) || title.replace(/_/g, " "), pageUrl, excerpt, "wikipedia");
}

function procedureExcerpt(extract) {
  let text = String(extract || "");
  text = text.replace(/\{\\displaystyle[\s\S]*?\}/g, " ");
  text = text.replace(/==+[^=]+==+/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  let at = -1;
  for (const marker of ["the check digit is computed", "computed as follows", "as follows:"]) {
    const found = lower.indexOf(marker);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  const slice = (at >= 0 ? text.slice(at) : text).slice(0, 500);
  return slice.length >= 80 ? slice : "";
}

async function collectIssues(problem, httpRequest) {
  const query = searchQuery(problem);
  if (!query) return [];
  const payload = await httpRequest({
    url: `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=3`,
    headers: { "User-Agent": "CodeMe", Accept: "application/vnd.github+json" },
  });
  return (payload && payload.items || []).slice(0, 3).map((item) => evidenceItem(item.title, item.html_url, item.body, "github.issues")).filter(Boolean);
}

async function collectAnswers(problem, httpRequest) {
  const query = searchQuery(problem);
  if (!query) return [];
  const payload = await httpRequest({
    url: `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow&pagesize=3&q=${encodeURIComponent(query)}`,
    headers: { "User-Agent": "CodeMe" },
  });
  return (payload && payload.items || []).slice(0, 3).map((item) => evidenceItem(item.title, item.link, item.title, "stackoverflow")).filter(Boolean);
}

const SEARCH_STOP = new Set("what does file files need needs first new the and for with your into from that this will have website project workspace create creating want page pages how why when where which can you are not use using about".split(" "));

function webQuery(problem) {
  const text = String(problem || "").toLowerCase();
  if (/\b(website|webpage|web page)\b/.test(text) && /\b(file|files|folder|workspace)\b/.test(text)) {
    return "new website project files index.html css javascript";
  }
  return candidateQueries(problem)[0] || problem;
}

function searchQuery(problem) {
  return tokens(problem).slice(0, 8).join(" ");
}

function tokens(value) {
  return String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3 && !SEARCH_STOP.has(token));
}

function relevant(item, problem) {
  const wanted = new Set(tokens(problem));
  if (!wanted.size) return false;
  return tokens(`${item.title} ${item.excerpt}`).some((token) => wanted.has(token));
}

function asText(payload) {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload.body === "string") return payload.body;
  if (payload && typeof payload.data === "string") return payload.data;
  return "";
}

function parseSearchResults(html) {
  const text = String(html || "");
  const found = [];
  const linkRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const links = [];
  const snippets = [];
  let link = linkRe.exec(text);
  while (link) {
    links.push(link);
    link = linkRe.exec(text);
  }
  let snippet = snippetRe.exec(text);
  while (snippet) {
    snippets.push(snippet);
    snippet = snippetRe.exec(text);
  }
  for (let index = 0; index < links.length && found.length < 4; index += 1) {
    const title = clip(decodeHtml(links[index][2].replace(/<[^>]+>/g, " ")), 180);
    const excerpt = clip(decodeHtml((snippets[index] ? snippets[index][1] : links[index][2]).replace(/<[^>]+>/g, " ")), 500);
    const item = evidenceItem(title, resultUrl(links[index][1]), excerpt, "web");
    if (item) found.push(item);
  }
  return found;
}

function resultUrl(href) {
  let raw = decodeHtml(href).trim();
  if (raw.startsWith("//")) raw = `https:${raw}`;
  const match = /[?&]uddg=([^&]+)/.exec(raw);
  let target = match ? safeDecode(match[1]) : raw;
  if (target.startsWith("//")) target = `https:${target}`;
  if (!/^https?:\/\//i.test(target)) return "";
  if (/duckduckgo\.com|ad_domain=|bing\.com\/aclick/i.test(target)) return "";
  return target;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function candidateQueries(problem) {
  const queries = [];
  const add = (value) => {
    const query = clip(value, 120);
    if (query.length >= 4 && !queries.some((item) => item.toLowerCase() === query.toLowerCase())) queries.push(query);
  };
  add(problem);
  const named = String(problem).match(/\b[A-Z][A-Za-z0-9.+#-]{2,}(?:\s+[A-Za-z][A-Za-z0-9.+#-]*)?/g) || [];
  for (const phrase of named) add(phrase);
  add(String(problem).split(/\b(?:which|how|what|when|where|why)\b/i)[0]);
  return queries.slice(0, 3);
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
    excerpt: clip(excerpt, 500),
    source,
    provenance: { provider: source, url: cleanUrl, title: cleanTitle },
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
