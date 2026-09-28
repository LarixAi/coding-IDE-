const assert = require("assert");
const { RULE_PRIORITY, resolveRuleDecision } = require("../rule-decision");

function resolve(call, facts = {}) {
  return resolveRuleDecision({ call, facts });
}

async function main() {
  {
    const decision = resolve(
      { name: "file.write", args: { path: "package.json", contents: "{}" } },
      {
        mode: "read_only",
        requireFailureBeforeEdit: true,
        browserFailureObserved: false,
        dependencyFreeStatic: true,
      },
    );
    assert.strictEqual(decision.rule, "safety.read_only");
    assert.strictEqual(decision.priority, RULE_PRIORITY.safety);
    assert.strictEqual(decision.action, "deny");
  }

  {
    const decision = resolve(
      { name: "file.patch", args: { path: "test/booking.test.js", oldText: "false", newText: "true" } },
      {
        mode: "controlled",
        taskClass: "inspect",
        registeredToolNames: ["file.patch", "file.read", "dir.list"],
      },
    );
    assert.strictEqual(decision.rule, "safety.inspect_only");
    assert.strictEqual(decision.priority, RULE_PRIORITY.safety);
    assert.strictEqual(decision.action, "deny");
    assert.strictEqual(decision.code, "inspect_only_tool_denied");
  }

  {
    const decision = resolve(
      { name: "capability.invoke", args: { capability: "research.problem" } },
      {
        mode: "controlled",
        taskClass: "inspect",
        registeredToolNames: ["capability.invoke", "file.read", "dir.list"],
      },
    );
    assert.strictEqual(decision.rule, "safety.inspect_only");
    assert.strictEqual(decision.action, "deny");
  }

  {
    const decision = resolve(
      { name: "file.read", args: { path: "server.js" } },
      {
        mode: "controlled",
        taskClass: "inspect",
        registeredToolNames: ["file.read", "dir.list"],
      },
    );
    assert.strictEqual(decision.rule, "allow.default");
    assert.strictEqual(decision.action, "allow");
  }

  {
    const decision = resolve(
      { name: "file.patch", args: { path: "script.js", oldText: "broken", newText: "fixed" } },
      {
        mode: "controlled",
        requireFailureBeforeEdit: true,
        browserFailureObserved: false,
      },
    );
    assert.strictEqual(decision.rule, "user.require_failure_before_edit");
    assert.strictEqual(decision.priority, RULE_PRIORITY.user);
    assert.strictEqual(decision.action, "deny");
  }

  {
    const decision = resolve(
      { name: "process.start", args: { command: "npm start" } },
      {
        mode: "controlled",
        dependencyFreeStatic: true,
        browserEditTask: true,
      },
    );
    assert.strictEqual(decision.rule, "strategy.static_site");
    assert.strictEqual(decision.priority, RULE_PRIORITY.strategy);
    assert.strictEqual(decision.action, "deny");
  }

  {
    const decision = resolve(
      { name: "terminal.run", args: { command: "npm start" } },
      {
        mode: "controlled",
        browserEditTask: true,
        browserCheckAvailable: true,
        previewTarget: "index.html",
      },
    );
    assert.strictEqual(decision.rule, "phase.browser_preview_owner");
    assert.strictEqual(decision.priority, RULE_PRIORITY.phase);
    assert.strictEqual(decision.action, "rewrite");
    assert.strictEqual(decision.call.name, "browser.check");
    assert.strictEqual(decision.call.args.url, "index.html");
    assert.strictEqual(decision.call.routedFrom.name, "terminal.run");
  }

  {
    const decision = resolve(
      { name: "process.start", args: { command: "npm start" } },
      {
        mode: "controlled",
        browserEditTask: true,
      },
    );
    assert.strictEqual(decision.rule, "phase.browser_preview_owner");
    assert.strictEqual(decision.priority, RULE_PRIORITY.phase);
    assert.strictEqual(decision.action, "guard");
  }

  {
    const decision = resolve(
      { name: "file.patch", args: { path: "server.js", oldText: "broken", newText: "fixed" } },
      {
        mode: "controlled",
        failedProcessNeedsLogs: true,
        registeredToolNames: ["file.patch", "process.logs"],
      },
    );
    assert.strictEqual(decision.rule, "recovery.process_logs_required");
    assert.strictEqual(decision.priority, RULE_PRIORITY.recovery);
    assert.strictEqual(decision.action, "deny");
  }

  {
    const decision = resolve(
      { name: "file.patch", args: { path: "src/check.js", oldText: "broken", newText: "fixed" } },
      {
        mode: "controlled",
        requireExternalEvidenceBeforeEdit: true,
        workspaceHasTests: true,
        testFailureObserved: true,
        externalEvidenceObserved: false,
        registeredToolNames: ["file.patch", "tests.run", "capability.invoke"],
      },
    );
    assert.strictEqual(decision.rule, "recovery.external_evidence_required");
    assert.strictEqual(decision.priority, RULE_PRIORITY.recovery);
    assert.strictEqual(decision.action, "deny");
  }

  {
    const decision = resolve(
      { name: "process.start", args: { command: "npm start" } },
      {
        mode: "controlled",
        requireExternalEvidenceBeforeEdit: true,
        registeredToolNames: ["process.start", "tests.run"],
      },
    );
    assert.strictEqual(decision.rule, "recovery.native_verification_required");
    assert.strictEqual(decision.action, "deny");
  }

  {
    const decision = resolve(
      { name: "capability.invoke", args: { capability: "research" } },
      {
        mode: "controlled",
        simpleLocalWorkspaceTask: true,
        registeredToolNames: ["capability.invoke"],
      },
    );
    assert.strictEqual(decision.rule, "strategy.local_workspace");
    assert.strictEqual(decision.priority, RULE_PRIORITY.strategy);
    assert.strictEqual(decision.action, "deny");
  }

  {
    const decision = resolve(
      { name: "tests.run", args: { command: "npm test" } },
      {
        mode: "controlled",
        workspaceHasTests: false,
        registeredToolNames: ["tests.run"],
      },
    );
    assert.strictEqual(decision.rule, "eligibility.no_tests");
    assert.strictEqual(decision.priority, RULE_PRIORITY.eligibility);
    assert.strictEqual(decision.action, "deny");
  }

  {
    const decision = resolve(
      { name: "file.read", args: { path: "index.html" } },
      {
        mode: "controlled",
        registeredToolNames: ["browser.check"],
      },
    );
    assert.strictEqual(decision.rule, "eligibility.tool_unavailable");
    assert.strictEqual(decision.action, "deny");
    assert.strictEqual(decision.code, "tool_unavailable");
  }

  {
    const decision = resolve(
      { name: "file.read", args: { path: "index.html" } },
      {
        mode: "controlled",
        registeredToolNames: ["file.read"],
      },
    );
    assert.strictEqual(decision.rule, "allow.default");
    assert.strictEqual(decision.action, "allow");
  }

  console.log("ok hard rules v2 resolver");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
