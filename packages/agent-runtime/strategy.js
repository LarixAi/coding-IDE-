const STRATEGIES = {
  inspect: {
    id: "inspect",
    version: 1,
    taskClass: "inspect",
    guidance: "Inspect the repository with tools and record observations. Do not invent file contents or a successful command.",
  },
  plan: {
    id: "plan",
    version: 1,
    taskClass: "plan",
    guidance: "Inspect the repository and produce a sequenced plan. Do not edit files. Finish with concrete steps, files, and risks.",
  },
  "bug-fix": {
    id: "bug-fix",
    version: 1,
    taskClass: "bug-fix",
    guidance: "Reproduce the failure, isolate the cause, patch the implementation, rerun the failing check, and finish only with evidence.",
  },
  feature: {
    id: "feature",
    version: 1,
    taskClass: "feature",
    guidance: "Inspect first, implement incrementally against the tracked requirements, and verify each requirement with tools.",
  },
  general: {
    id: "general",
    version: 1,
    taskClass: "general",
    guidance: "Inspect, plan, implement, diagnose, and verify. A claim of success is not evidence.",
  },
  layout: {
    id: "layout",
    version: 1,
    taskClass: "layout",
    guidance: "Inspect the current HTML and CSS once. Change the existing rule with file.patch. Call file.write only when the file is missing. Then call browser.check. Do not search the same query again.",
  },
  folder: {
    id: "folder",
    version: 1,
    taskClass: "folder",
    guidance: "Create the named folder with dir.create. Do not use the terminal. Finish when that folder exists.",
  },
  build: {
    id: "build",
    version: 1,
    taskClass: "build",
    guidance: "List the workspace with dir.list. When a file is missing, call file.write in that same turn. Describing the file does not create it. For a new website, write package.json, server.js, and index.html. The start script must be node server.js --port 4173, and server.js must serve this folder on 127.0.0.1:4173 using only Node, then call browser.check with http://127.0.0.1:4173/. If package.json already has a start script, keep it, write only the missing files, and call browser.check on that script's local URL. Do not use the terminal to list files, install packages, or create folders.",
  },
};

function folderNameFromGoal(goal) {
  const text = String(goal || "").replace(/\s+/g, " ").trim();
  const called = text.match(/^(.*)\b(?:called|named)\s+["']?(.+?)["']?$/i);
  if (!called) return "";
  const prefix = called[1];
  const name = called[2].replace(/[.?!]+$/, "").trim();
  if (!/\b(create|make|add)\b/i.test(prefix) || !/\b(folder|directory)\b/i.test(prefix)) return "";
  if (/\b(fix|repair|edit|layout|implement|research)\b/i.test(prefix)) return "";
  if (!name || name.length > 80 || /[\\/]/.test(name) || name.includes("..")) return "";
  return name;
}

function classifyTask(goal, options = {}) {
  if (options.taskClass && STRATEGIES[options.taskClass]) return options.taskClass;
  const text = String(goal || "").toLowerCase();
  if (folderNameFromGoal(goal)) return options.mode === "read_only" ? "inspect" : "folder";
  if (isWorkspaceInventory(goal)) return "inspect";
  if ((options.requirements || []).length >= 3) return "feature";
  if (/\b(layout|restyle|redesign|better website|improve the (site|page|layout))\b/.test(text)
    || (/\b(edit|change|update|rewrite|improve)\b/.test(text) && /\b(html|css|page|site|website|layout)\b/.test(text))) {
    return options.mode === "read_only" ? "inspect" : "layout";
  }
  if (isBuildGoal(goal)) return options.mode === "read_only" ? "inspect" : "build";
  if (/\b(fix|repair|bug|failing|broken|does not|regression)\b/.test(text)) return "bug-fix";
  if (options.mode === "read_only") return "inspect";
  if (options.mode === "controlled") return "bug-fix";
  return "general";
}

function selectStrategy(goal, options = {}) {
  const taskClass = classifyTask(goal, options);
  const selected = STRATEGIES[taskClass] || STRATEGIES.general;
  return {
    id: selected.id,
    version: selected.version,
    taskClass,
    guidance: selected.guidance,
  };
}

function isLocalFollowUp(goal) {
  const text = String(goal || "").toLowerCase();
  return /\b(go ahead|please proceed|fix the issue|fix this|fix it|run the|start the|continue working|missing files?)\b/.test(text);
}

function isWorkspaceInventory(goal) {
  const text = String(goal || "").toLowerCase();
  if (/\b(create|make|build|add|write|implement|fix|repair|continue|working|run|start|serve)\b/.test(text)) return false;
  return /\b(what|which|list|missing|exist|inside)\b/.test(text) && /\b(files?|folders?|directory|workspace)\b/.test(text);
}

function isBuildGoal(goal) {
  const text = String(goal || "").toLowerCase();
  if (folderNameFromGoal(goal)) return false;
  if (/\b(fix|repair|bug|failing|broken|regression)\b/.test(text)) return false;
  return /\b(create|make|build|scaffold|set up|setup|continue|run|start|write|add)\b/.test(text)
    && /\b(website|site|app|application|project|page|server|files?)\b/.test(text);
}

function isNewWebsite(goal) {
  const text = String(goal || "").toLowerCase();
  return /\b(create|make|build|scaffold|set up|setup)\b/.test(text)
    && /\b(website|site|page)\b/.test(text);
}

function isWebsiteBuild(goal) {
  return isBuildGoal(goal) && /\b(website|site|page)\b/i.test(String(goal || ""));
}

function strategyGuidance(strategy) {
  return (strategy && strategy.guidance) || STRATEGIES.general.guidance;
}

function isBugFixGoal(goal) {
  return /\b(fix|repair|bug|failing|broken|does not|regression)\b/i.test(String(goal || ""));
}

function isSimpleLocalWork(goal) {
  const text = String(goal || "").toLowerCase();
  if (/\b(change|update|edit|rename|restyle)\b/.test(text) && /\b(css|button|color|label|heading|text|class|style)\b/.test(text)) return true;
  if (/\b(read|open|show)\b/.test(text) && /\b(file|readme)\b/.test(text) && !/\b(research|docs|best)\b/.test(text)) return true;
  if (/\b(run|start|serve)\b/.test(text) && /\b(project|app|site|server|website|it)\b/.test(text) && !/\b(create|build|make|scaffold)\b/.test(text)) return true;
  if (/\b(create|add|write)\b/.test(text) && /\b(page|file)\b/.test(text) && /\b(already|existing|missing)\b/.test(text)) return true;
  if (/\b(fix|repair)\b/.test(text) && !/\b(not in the|algorithm|best practice|documentation|research|how does|why does|unfamiliar)\b/.test(text)) return true;
  return false;
}

function needsOutsideEvidence(goal, options = {}) {
  if (options.taskClass === "layout" || options.taskClass === "folder") return false;
  if (folderNameFromGoal(goal) || isWorkspaceInventory(goal) || isLocalFollowUp(goal) || isSimpleLocalWork(goal)) return false;
  const text = String(goal || "").toLowerCase();
  if (/\b(research|investigate|look up|look into)\b/.test(text)) return true;
  if (/\b(best practices?|current docs|documentation|docs for|up to date|latest version)\b/.test(text)) return true;
  if (/\b(how|why)\b/.test(text) && /\b(does|is|are|do|did|can|would|fail|error|work|happen)\b/.test(text)) return true;
  if (/\b(failing api|api error|unknown error|unknown technical|unfamiliar)\b/.test(text)) return true;
  if (/\bnot in the (repo|repository|codebase|workspace)\b/.test(text)) return true;
  if (/\balgorithm\b/.test(text) && !/\b(fix|repair|implement|verify|inspect)\b/.test(text)) return true;
  if (isNewWebsite(goal)) return true;
  if (!isBuildGoal(goal)) return false;
  const ands = (text.match(/\band\b/g) || []).length;
  return ands >= 2 || text.length > 180;
}

module.exports = { STRATEGIES, classifyTask, selectStrategy, strategyGuidance, folderNameFromGoal, isWorkspaceInventory, isLocalFollowUp, isBuildGoal, isWebsiteBuild, isNewWebsite, isBugFixGoal, isSimpleLocalWork, needsOutsideEvidence };
