// Negation-aware intent helpers.
//
// Keyword regexes over the raw goal cannot tell "edit the file" from
// "do not edit anything yet". Every decision that reads the goal for edit
// intent goes through this module so negated edit words never count.
//
// Blanket bans make the whole run read-only. Scoped bans such as
// "fix the page but do not touch package.json" do not cancel the edit request.

const EDIT_WORDS = "edit|edits|editing|change|changes|changing|modify|modifying|update|updating|patch|patching|write|writing|rewrite|implement|implementing|fix|fixing|repair|repairing|refactor|refactoring|create|creating|add|adding|remove|removing|delete|deleting|apply|applying|touch|touching";
const TAIL = "(?:[^.!?;,\\n]|\\.(?=\\w))*";
const VERB_NEGATION = "(?:do\\s+not|don['’]?t|dont|never|must\\s+not|should\\s+not|shouldn['’]?t|will\\s+not|won['’]?t)";
const NEGATED_VERB = new RegExp(`\\b${VERB_NEGATION}\\s+(?:\\w+\\s+){0,2}?(${EDIT_WORDS})\\b(${TAIL})`, "gi");
const NEGATED_WITHOUT = new RegExp(`\\bwithout\\s+(?:\\w+\\s+){0,2}?(${EDIT_WORDS})\\b(${TAIL})`, "gi");
const NEGATED_NOUN = new RegExp(`\\bno\\s+(?:file\\s+|code\\s+|workspace\\s+)?(?:edits?|changes?|modifications?|writes?|patch(?:es)?)\\b(${TAIL})`, "gi");
const HOLD_OFF = new RegExp(`\\b(?:not\\s+yet|hold\\s+off)\\b${TAIL}?\\b(?:edit|edits|editing|chang\\w*|implement\\w*|writ\\w*)\\b(${TAIL})`, "gi");
const ONLY_MODE = /\\b(?:read|research|explain|analysis|analy[sz]e|inspect|discussion|planning)[\\s-]+only\\b|\\b(?:just|only)\\s+(?:research|explain|analy[sz]e|tell\\s+me|describe|review)\\b/gi;
const GENERIC_OBJECT = /^(?:(?:to|in|on|any\\s+of)\\s+)?(?:(?:anything|any|all|the|my|this|our|those|these)\\s+)*(?:anything|things?|files?|code|project|workspace|repo(?:sitory)?|codebase|source(?:\\s+code)?|it|this|that|yet|now)?\\s*(?:else|yet|now|for\\s+now|at\\s+all|just\\s+yet|right\\s+now|please|in\\s+(?:the|this)\\s+(?:project|workspace|repo(?:sitory)?|codebase))?\\s*$/i;

function normalize(goal) {
  return String(goal || "").replace(/\\s+/g, " ").trim();
}
function isGenericObject(tail) {
  return GENERIC_OBJECT.test(String(tail || "").trim());
}
function hasNoEditDirective(goal) {
  const text = normalize(goal);
  if (!text) return false;
  ONLY_MODE.lastIndex = 0;
  if (ONLY_MODE.test(text)) return true;
  for (const pattern of [NEGATED_VERB, NEGATED_WITHOUT, NEGATED_NOUN, HOLD_OFF]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const tail = match[match.length - 1];
      if (isGenericObject(tail)) return true;
    }
  }
  return false;
}
function stripNegatedEditing(goal) {
  let text = normalize(goal);
  for (const pattern of [NEGATED_VERB, NEGATED_WITHOUT, NEGATED_NOUN, HOLD_OFF, ONLY_MODE]) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, " ");
  }
  return text.replace(/\\s+/g, " ").trim();
}
const EDIT_INTENT = /\\b(fix|repair|change|update|edit|make|add|remove|rewrite|implement|create|build|write|refactor|rename|delete|patch|replace|improve|restyle|redesign|scaffold|apply|button|click|broken|regression|failing|bug)\\b|doesn['’]t work|does not work/;
function hasEditIntent(goal) {
  return EDIT_INTENT.test(stripNegatedEditing(goal).toLowerCase());
}
const RESEARCH_INTENT = /\\b(research|investigate|look up|look into|explain|analy[sz]e|analysis|compare|summari[sz]e|recommend(?:ed|ation)?|what should|how (?:does|do|should|would|can)|why (?:does|do|is|are|did)|what (?:is|are|does)|walk me through|tell me)\\b/;
function hasResearchIntent(goal) {
  return RESEARCH_INTENT.test(normalize(goal).toLowerCase());
}
function isResearchOnlyRequest(goal) {
  if (hasNoEditDirective(goal)) return true;
  return hasResearchIntent(goal) && !hasEditIntent(goal);
}
module.exports = { hasNoEditDirective, stripNegatedEditing, hasEditIntent, hasResearchIntent, isResearchOnlyRequest };
