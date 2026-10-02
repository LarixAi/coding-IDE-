const crypto = require("crypto");

const SCHEMA_VERSION = 1;
const REQUIREMENT_STATES = new Set(["proposed","confirmed","implemented","verified","changed","removed"]);

function nowIso(now) { return (now instanceof Date ? now : new Date(now || Date.now())).toISOString(); }
function idFor(prefix, value) { return prefix + "_" + crypto.createHash("sha256").update(String(value)).digest("hex").slice(0,12); }
function words(value) { return new Set(String(value || "").toLowerCase().match(/[a-z0-9_./-]{3,}/g) || []); }
function score(goal, item) {
  const wanted = words(goal);
  const hay = words([item.title,item.text,item.summary,item.path,(item.tags || []).join(" ")].filter(Boolean).join(" "));
  let n = 0; for (const word of wanted) if (hay.has(word)) n += 1;
  return n;
}
function createProjectBrain(input = {}, now) {
  const originalPrompt = String(input.originalPrompt || input.goal || "").trim();
  const identity = input.identity ? {
    kind: String(input.identity.kind || "project"),
    domain: String(input.identity.domain || ""),
    purpose: String(input.identity.purpose || originalPrompt),
    originalPrompt, source: "user", status: "confirmed",
  } : originalPrompt ? { kind:"project", domain:"", purpose:originalPrompt, originalPrompt, source:"user", status:"confirmed" } : null;
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: String(input.projectId || idFor("project", input.root || originalPrompt || "workspace")),
    root: String(input.root || ""), identity, requirements: [], decisions: [], lessons: [],
    files: {}, relationships: [], workState: null, createdAt: nowIso(now), updatedAt: nowIso(now),
  };
}
function upsert(list, record) {
  const i = list.findIndex(x => x.id === record.id);
  if (i >= 0) list[i] = { ...list[i], ...record }; else list.push(record);
}
function addRequirement(brain, requirement, now) {
  const text = String(requirement.text || requirement.title || "").trim(); if (!text) return brain;
  const status = REQUIREMENT_STATES.has(requirement.status) ? requirement.status : "confirmed";
  upsert(brain.requirements, { id:String(requirement.id || idFor("req", text)), text, status, source:requirement.source || "user", tags:requirement.tags || [], updatedAt:nowIso(now) });
  brain.updatedAt = nowIso(now); return brain;
}
function addDecision(brain, decision, now) {
  const title = String(decision.title || decision.text || "").trim(); if (!title) return brain;
  upsert(brain.decisions, { id:String(decision.id || idFor("decision", title)), title, rationale:String(decision.rationale || ""), status:decision.status || "active", source:decision.source || "user", tags:decision.tags || [], updatedAt:nowIso(now) });
  brain.updatedAt = nowIso(now); return brain;
}
function addVerifiedLesson(brain, lesson, now) {
  if (!lesson || lesson.verified !== true) return brain;
  const text = String(lesson.text || lesson.summary || "").trim(); if (!text) return brain;
  upsert(brain.lessons, { id:String(lesson.id || idFor("lesson", text)), text, verified:true, evidence:lesson.evidence || [], tags:lesson.tags || [], updatedAt:nowIso(now) });
  brain.updatedAt = nowIso(now); return brain;
}
function rememberFile(brain, file, now) {
  const path = String(file.path || "").trim(); if (!path) return brain;
  brain.files[path] = { path, summary:String(file.summary || ""), hash:String(file.hash || ""), status:file.status || "current", tags:file.tags || [], relationships:file.relationships || [], updatedAt:nowIso(now) };
  brain.updatedAt = nowIso(now); return brain;
}
function invalidateChangedFiles(brain, currentHashes = {}, now) {
  for (const [path, record] of Object.entries(brain.files || {})) {
    if (Object.prototype.hasOwnProperty.call(currentHashes, path) && record.hash && currentHashes[path] !== record.hash) {
      record.status = "stale"; record.staleAt = nowIso(now);
    }
  }
  brain.updatedAt = nowIso(now); return brain;
}
function retrieveProjectContext(brain, goal, options = {}) {
  if (!brain) return { identity:null, requirements:[], decisions:[], lessons:[], files:[], workState:null };
  const limit = Number.isFinite(options.limitPerType) ? options.limitPerType : 8;
  const rank = list => list.filter(x => x.status !== "removed" && x.status !== "superseded")
    .map(item => ({item, n:score(goal,item)}))
    .sort((a,b) => b.n-a.n || String(b.item.updatedAt || "").localeCompare(String(a.item.updatedAt || "")))
    .slice(0,limit).map(x => x.item);
  return {
    identity: brain.identity || null,
    requirements: rank(brain.requirements || []),
    decisions: rank(brain.decisions || []),
    lessons: rank(brain.lessons || []),
    files: rank(Object.values(brain.files || {}).filter(x => x.status !== "stale")),
    workState: brain.workState || null,
  };
}
function projectBrainText(context) {
  if (!context) return "";
  const lines = [];
  if (context.identity) lines.push("Project identity: " + context.identity.purpose + (context.identity.domain ? " (" + context.identity.domain + ")" : ""));
  if (context.requirements?.length) lines.push("Relevant requirements:\n" + context.requirements.map(x => "- [" + x.status + "] " + x.text).join("\n"));
  if (context.decisions?.length) lines.push("Relevant decisions:\n" + context.decisions.map(x => "- " + x.title + (x.rationale ? " — " + x.rationale : "")).join("\n"));
  if (context.lessons?.length) lines.push("Verified lessons:\n" + context.lessons.map(x => "- " + x.text).join("\n"));
  if (context.files?.length) lines.push("Relevant file knowledge (read current source before editing):\n" + context.files.map(x => "- " + x.path + ": " + x.summary).join("\n"));
  if (context.workState) lines.push("Current work state: " + String(context.workState.summary || context.workState));
  return lines.join("\n\n");
}
module.exports = { SCHEMA_VERSION, createProjectBrain, addRequirement, addDecision, addVerifiedLesson, rememberFile, invalidateChangedFiles, retrieveProjectContext, projectBrainText };
