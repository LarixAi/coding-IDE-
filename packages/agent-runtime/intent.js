// Negation-aware intent helpers.
// Keep explicit "do not edit" language separate from real edit intent.

const EDIT_VERBS = "(?:edit|change|modify|update|patch|write|rewrite|implement|fix|repair|refactor|create|add|remove|delete|apply|touch)";
const NEGATION = "(?:do\\s+not|don[\'’]?t|dont|never|must\\s+not|should\\s+not|shouldn[\'’]?t|will\\s+not|won[\'’]?t)";

function normalize(goal) {
  return String(goal || "").replace(/\s+/g, " ").trim();
}

function negatedClauses(goal) {
  const text = normalize(goal);
  const clauses = [];
  const patterns = [
    new RegExp("\\b" + NEGATION + "\\s+(?:\\w+\\s+){0,2}?" + EDIT_VERBS + "\\b([^.!?;,\\n]*)", "gi"),
    new RegExp("\\bwithout\\s+(?:\\w+\\s+){0,2}?" + EDIT_VERBS + "\\b([^.!?;,\\n]*)", "gi"),
    /\bno\s+(?:file\s+|code\s+|workspace\s+)?(?:edits?|changes?|modifications?|writes?|patch(?:es)?)\b([^.!?;,\n]*)/gi,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      clauses.push({ full: match[0], tail: String(match[1] || "").trim() });
    }
  }
  return clauses;
}

function genericNoEditTail(tail) {
  const text = normalize(tail).toLowerCase();
  if (!text) return true;
  return /^(?:anything|anything\s+yet|anything\s+for\s+now|any\s+files?|all\s+files?|files?|code|the\s+code|this\s+code|project|the\s+project|this\s+project|workspace|the\s+workspace|this\s+workspace|repo(?:sitory)?|the\s+repo(?:sitory)?|this\s+repo(?:sitory)?|it|this|that|yet|now|for\s+now|right\s+now|at\s+all|just\s+yet|please)$/i.test(text);
}

function hasNoEditDirective(goal) {
  const text = normalize(goal);
  if (!text) return false;
  if (/\b(?:read|research|explain|analysis|analy[sz]e|inspect|discussion|planning)[\s-]+only\b|\b(?:just|only)\s+(?:research|explain|analy[sz]e|tell\s+me|describe|review)\b/i.test(text)) return true;
  return negatedClauses(text).some((item) => genericNoEditTail(item.tail));
}

function stripNegatedEditing(goal) {
  let text = normalize(goal);
  for (const item of negatedClauses(text)) {
    text = text.replace(item.full, " ");
  }
  text = text.replace(/\b(?:read|research|explain|analysis|analy[sz]e|inspect|discussion|planning)[\s-]+only\b/gi, " ");
  text = text.replace(/\b(?:just|only)\s+(?:research|explain|analy[sz]e|tell\s+me|describe|review)\b/gi, " ");
  return text.replace(/\s+/g, " ").trim();
}

const EDIT_INTENT = /\b(fix|repair|change|update|edit|make|add|remove|rewrite|implement|create|build|write|refactor|rename|delete|patch|replace|improve|restyle|redesign|scaffold|apply|button|click|broken|regression|failing|bug)\b|doesn[\'’]?t work|does not work/;
function hasEditIntent(goal) {
  return EDIT_INTENT.test(stripNegatedEditing(goal).toLowerCase());
}

const RESEARCH_INTENT = /\b(research|investigate|look up|look into|explain|analy[sz]e|analysis|compare|summari[sz]e|recommend(?:ed|ation)?|what should|how (?:does|do|should|would|can)|why (?:does|do|is|are|did)|what (?:is|are|does)|walk me through|tell me)\b/;
function hasResearchIntent(goal) {
  return RESEARCH_INTENT.test(normalize(goal).toLowerCase());
}

function isResearchOnlyRequest(goal) {
  if (hasNoEditDirective(goal)) return true;
  return hasResearchIntent(goal) && !hasEditIntent(goal);
}

module.exports = {
  hasNoEditDirective,
  stripNegatedEditing,
  hasEditIntent,
  hasResearchIntent,
  isResearchOnlyRequest,
};
