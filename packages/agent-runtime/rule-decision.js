const RULE_PRIORITY = Object.freeze({
  safety: 700,
  user: 600,
  strategy: 500,
  phase: 400,
  eligibility: 300,
  recovery: 200,
  budget: 100,
  allow: 0,
});

const STATIC_SCAFFOLD_TOOLS = new Set([
  "workspace.inspect",
  "dir.list",
  "dir.create",
  "file.write",
  "file.read",
  "browser.check",
  "browser.interact",
]);

const READ_ONLY_BLOCKED_TOOLS = new Set([
  "file.write",
  "file.patch",
  "dir.create",
  "terminal.run",
  "sandbox.run",
  "process.start",
  "tests.run",
  "browser.interact",
]);

const WORKSPACE_MUTATION_TOOLS = new Set([
  "file.write",
  "file.patch",
  "dir.create",
]);

function cloneCall(rawCall) {
  if (!rawCall || typeof rawCall !== "object") return rawCall;
  return {
    ...rawCall,
    args: { ...((rawCall && rawCall.args) || {}) },
  };
}

function isStaticScaffoldTool(name) {
  return STATIC_SCAFFOLD_TOOLS.has(String(name || ""));
}

function isPreviewStartCommand(command) {
  const text = String(command || "").trim();
  if (!text) return false;
  const withoutBackground = text.replace(/\s*&\s*$/, "").trim();
  if (/^npm\s+(?:start|run\s+(?:dev|preview))$/i.test(withoutBackground)) return true;
  if (/^node\s+(?:--[\w-]+\s+)*[^\s]+\.m?js$/i.test(withoutBackground)) {
    return /(?:^|\/)(?:server|app|index|main)(?:\.[^.]+)?\.m?js$/i.test(
      withoutBackground.replace(/^node\s+(?:--[\w-]+\s+)*/, ""),
    );
  }
  return false;
}

function forbiddenStaticPath(value) {
  const file = String(value || "").replace(/\\/g, "/").toLowerCase();
  if (!file) return false;
  if (file === "package.json" || file === "package-lock.json" || file === "yarn.lock" || file === "pnpm-lock.yaml") return true;
  if (/(^|\/)server\.(js|mjs|cjs|ts)$/.test(file)) return true;
  if (file === "vite.config.js" || file === "vite.config.ts" || file === "next.config.js" || file === "next.config.mjs") return true;
  return file === "node_modules" || file.startsWith("node_modules/");
}

function candidate(tier, rule, action, reason, call, extra = {}) {
  return {
    tier,
    priority: RULE_PRIORITY[tier],
    rule,
    action,
    reason,
    call,
    code: extra.code || (action === "deny" ? "policy_denied" : ""),
    ...extra,
  };
}

function pick(candidates, fallback) {
  if (!candidates.length) return fallback;
  return candidates
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (
      b.item.priority - a.item.priority
      || a.index - b.index
    ))[0].item;
}

function resolveRuleDecision(input = {}) {
  const originalCall = cloneCall(input.call);
  if (!originalCall || !originalCall.name) {
    return candidate(
      "eligibility",
      "eligibility.invalid_call",
      "deny",
      "The requested tool call is missing a tool name.",
      originalCall,
      { code: "invalid_args" },
    );
  }

  const facts = input.facts || {};
  const candidates = [];
  const name = String(originalCall.name);
  const registered = Array.isArray(facts.registeredToolNames)
    ? new Set(facts.registeredToolNames)
    : null;

  if (facts.mode === "read_only" && READ_ONLY_BLOCKED_TOOLS.has(name)) {
    candidates.push(candidate(
      "safety",
      "safety.read_only",
      "deny",
      `The run is read-only, so ${name} is not permitted.`,
      originalCall,
    ));
  }

  if (
    facts.requireFailureBeforeEdit
    && WORKSPACE_MUTATION_TOOLS.has(name)
    && !facts.browserFailureObserved
  ) {
    candidates.push(candidate(
      "user",
      "user.require_failure_before_edit",
      "deny",
      "The user required CodeMe to verify the current behaviour before changing workspace files. Run the requested browser verification first; only edit after that verification fails.",
      originalCall,
    ));
  }

  if (facts.dependencyFreeStatic) {
    if (!isStaticScaffoldTool(name)) {
      candidates.push(candidate(
        "strategy",
        "strategy.static_site",
        "deny",
        "This project was classified as a dependency-free static website. Use only workspace file/folder tools and browser verification; do not use terminal, process, tests, npm, frameworks, or external capabilities.",
        originalCall,
      ));
    } else if (
      (name === "file.write" || name === "dir.create")
      && forbiddenStaticPath(originalCall.args && originalCall.args.path)
    ) {
      candidates.push(candidate(
        "strategy",
        "strategy.static_site_path",
        "deny",
        `This project was classified as a dependency-free static website, so ${originalCall.args.path} is not allowed. Create only browser-native HTML, CSS, assets, and optional JavaScript.`,
        originalCall,
      ));
    }
  }

  if (
    (name === "capability.invoke" || name === "capability.list")
    && facts.simpleLocalWorkspaceTask
  ) {
    candidates.push(candidate(
      "strategy",
      "strategy.local_workspace",
      "deny",
      "This is a local workspace edit and does not need external research. Inspect and verify the local files instead.",
      originalCall,
    ));
  }

  if (
    name === "capability.invoke"
    && facts.localLayoutPhase
  ) {
    candidates.push(candidate(
      "strategy",
      "strategy.local_layout",
      "deny",
      "This layout job uses local HTML and CSS. External research is withheld.",
      originalCall,
    ));
  }

  if (
    name === "terminal.run"
    && facts.browserEditTask
    && isPreviewStartCommand(originalCall.args && originalCall.args.command)
  ) {
    if (facts.browserCheckAvailable !== false) {
      const rewritten = {
        name: "browser.check",
        args: { url: facts.previewTarget || "index.html" },
        routedFrom: {
          name: "terminal.run",
          command: String((originalCall.args && originalCall.args.command) || ""),
        },
      };
      candidates.push(candidate(
        "phase",
        "phase.browser_preview_owner",
        "rewrite",
        "Browser-visible edits use browser.check for preview startup and verification instead of a terminal server command.",
        rewritten,
        { originalTool: "terminal.run" },
      ));
    } else {
      candidates.push(candidate(
        "phase",
        "phase.browser_preview_unavailable",
        "deny",
        "This browser-visible edit requires browser.check, but that tool is unavailable.",
        originalCall,
        { code: "tool_unavailable" },
      ));
    }
  }

  if (name === "process.start" && facts.browserEditTask) {
    candidates.push(candidate(
      "phase",
      "phase.browser_preview_owner",
      "guard",
      "Browser-visible edits delegate process reuse/start decisions to the process guard; browser.check owns preview verification.",
      originalCall,
    ));
  }

  if (name === "tests.run" && facts.workspaceHasTests === false) {
    candidates.push(candidate(
      "eligibility",
      "eligibility.no_tests",
      "deny",
      "This workspace has no test script. Do not run tests.run; verify the changed file directly or use browser.check for a web change.",
      originalCall,
    ));
  }

  if (
    (name === "git.diff" || name === "git.status")
    && facts.workspaceHasGit === false
  ) {
    candidates.push(candidate(
      "eligibility",
      "eligibility.no_git",
      "deny",
      "This workspace is not a Git repository. Do not call Git tools; use the available verification for this project.",
      originalCall,
    ));
  }

  if (registered && !registered.has(name)) {
    candidates.push(candidate(
      "eligibility",
      "eligibility.tool_unavailable",
      "deny",
      `The tool ${name} is not available in this run.`,
      originalCall,
      { code: "tool_unavailable" },
    ));
  }

  if (name === "process.start") {
    candidates.push(candidate(
      "recovery",
      "recovery.process_start_guard",
      "guard",
      "Process starts must check existing process state and failed-process logs before starting or restarting.",
      originalCall,
    ));
  }

  return pick(candidates, candidate(
    "allow",
    "allow.default",
    "allow",
    "No higher-priority hard rule blocks or rewrites this tool call.",
    originalCall,
  ));
}

module.exports = {
  RULE_PRIORITY,
  resolveRuleDecision,
  isStaticScaffoldTool,
  isPreviewStartCommand,
  forbiddenStaticPath,
};
