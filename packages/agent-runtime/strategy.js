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
    guidance: "Inspect the current HTML and CSS once. Apply a better layout with file.write on those workspace files. Then call browser.check. Do not search the same query again.",
  },
};

function classifyTask(goal, options = {}) {
  if (options.taskClass && STRATEGIES[options.taskClass]) return options.taskClass;
  const text = String(goal || "").toLowerCase();
  if ((options.requirements || []).length >= 3) return "feature";
  if (/\b(layout|restyle|redesign|better website|improve the (site|page|layout))\b/.test(text)
    || (/\b(edit|change|update|rewrite|improve)\b/.test(text) && /\b(html|css|page|site|website|layout)\b/.test(text))) {
    return options.mode === "read_only" ? "inspect" : "layout";
  }
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

function strategyGuidance(strategy) {
  return (strategy && strategy.guidance) || STRATEGIES.general.guidance;
}

module.exports = { STRATEGIES, classifyTask, selectStrategy, strategyGuidance };
