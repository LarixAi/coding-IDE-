const { hasNoEditDirective, stripNegatedEditing, isResearchOnlyRequest } = require("./intent");

const STRATEGIES = {
  chat: {
    id: "chat",
    version: 1,
    taskClass: "chat",
    guidance: "Conversation only. Do not inspect the workspace, call tools, use external capabilities, run commands, browse the preview, or modify files. Answer from the conversation and the model's general knowledge only.",
  },
  research: {
    id: "research",
    version: 1,
    taskClass: "research",
    guidance: "This is a research and explanation request, not a repair job. Gather outside evidence with the research capability at most once, read the relevant workspace files, then answer with the researched approach and a project-specific analysis. Do not edit files.",
  },
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
    guidance: "Inspect first, implement incrementally against the tracked requirements, prefer file.patch for precise edits to existing files, and verify each requirement with tools.",
  },
  general: {
    id: "general",
    version: 1,
    taskClass: "general",
    guidance: "Inspect, plan, implement, diagnose, and verify. Prefer file.patch for precise existing-file edits and file.write for new files or full replacements. A claim of success is not evidence.",
  },
  layout: {
    id: "layout",
    version: 1,
    taskClass: "layout",
    guidance: "Inspect the current HTML and CSS once. Apply the layout with file.patch for precise edits or file.write for full replacements. Then call browser.check. Do not search the same query again.",
  },
  run: {
    id: "run",
    version: 1,
    taskClass: "run",
    guidance: "Run the existing project rather than creating or redesigning it. Inspect the current workspace and start configuration, check the owned process, start it only when needed, then verify the real preview. Do not edit files unless startup or verification produces concrete failure evidence that requires a repair.",
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
    guidance: "Inspect the workspace first. Create only the files the request actually needs. For a simple static site in an empty workspace, use file.write/dir.create only, do not add a package manager or server, and read every created file back before finishing. For existing files prefer file.patch. For framework or runtime projects, preserve the setup, use process.start only for a long-running npm preview process, and verify with browser.check. Never pass the literal string --port to server.listen(); the listen value must be numeric. Do not use terminal.run to list files, install packages, or run long-lived servers.",
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
  const noEdit = hasNoEditDirective(goal);
  if (noEdit) return isWorkspaceInventory(stripNegatedEditing(goal)) ? "inspect" : "research";
  const text = stripNegatedEditing(goal).toLowerCase();
  if (folderNameFromGoal(goal)) return options.mode === "read_only" ? "inspect" : "folder";
  if (isWorkspaceInventory(goal)) return "inspect";
  if ((options.requirements || []).length >= 3) return "feature";
  if (/\b(layout|restyle|redesign|better website|improve the (site|page|layout))\b/.test(text)
    || (/\b(edit|change|update|rewrite|improve)\b/.test(text) && /\b(html|css|page|site|website|layout)\b/.test(text))) {
    return options.mode === "read_only" ? "inspect" : "layout";
  }
  if (isRunGoal(goal)) return options.mode === "read_only" ? "inspect" : "run";
  if (isBuildGoal(goal)) return options.mode === "read_only" ? "inspect" : "build";
  if (/\b(fix|repair|bug|failing|broken|does not|regression)\b/.test(text)) return "bug-fix";
  if (options.mode === "read_only") return "inspect";
  if (isResearchOnlyRequest(goal)) return "research";
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

function isReadAllFilesGoal(goal) {
  const text = String(goal || "").toLowerCase();
  return /\b(read|review|inspect|look through|go through)\b/.test(text)
    && /\b(all|every)\b[\s\S]{0,40}\bfiles?\b/.test(text);
}

function isWorkspaceInventory(goal) {
  const text = String(goal || "").toLowerCase();
  if (/\b(create|make|build|add|write|implement|fix|repair|continue|working|run|start|serve)\b/.test(text)) return false;

  const explicitRead = /\b(read|review|inspect|look through|go through|open)\b/.test(text)
    && (
      /\b(files?|folders?|directory|workspace|repo|repository|codebase|project)\b/.test(text)
      || /(?:^|\s)[\w./-]+\.[a-z0-9]{1,10}\b/i.test(text)
    );
  if (explicitRead) return true;

  return /\b(what|which|list|missing|exist|inside)\b/.test(text)
    && /\b(files?|folders?|directory|workspace)\b/.test(text);
}

function isRunGoal(goal) {
  const text = stripNegatedEditing(goal).toLowerCase();
  if (/\b(create|make|build|scaffold|set up|setup|write|add)\b/.test(text)) return false;
  const action = /\b(run|start|launch|serve|open)\b/.test(text);
  const target = /\b(existing|current|website|site|web app|app|application|project|server|preview|it|this|that)\b/.test(text);
  return action && target;
}

function isBuildGoal(goal) {
  const text = String(goal || "").toLowerCase();
  if (folderNameFromGoal(goal)) return false;
  if (/\b(fix|repair|bug|failing|broken|regression)\b/.test(text)) return false;
  return /\b(create|make|build|scaffold|set up|setup|write|add)\b/.test(text)
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

module.exports = { STRATEGIES, classifyTask, selectStrategy, strategyGuidance, folderNameFromGoal, isWorkspaceInventory, isReadAllFilesGoal, isLocalFollowUp, isRunGoal, isBuildGoal, isWebsiteBuild, isNewWebsite };
