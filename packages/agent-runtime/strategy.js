const STRATEGIES = {
  inspect: {
    id: "inspect",
    version: 1,
    taskClass: "inspect",
    guidance: "Inspect the repository with tools and record observations. Do not invent file contents or a successful command.",
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
};

function classifyTask(goal, options = {}) {
  if (options.taskClass && STRATEGIES[options.taskClass]) return options.taskClass;
  const text = String(goal || "").toLowerCase();
  if ((options.requirements || []).length >= 3) return "feature";
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
