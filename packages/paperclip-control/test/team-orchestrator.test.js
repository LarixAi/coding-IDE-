const assert = require("assert");
const { PaperclipAgentRegistry } = require("../index");
const {
  PaperclipTeamOrchestrator,
  includesMarker,
  latestCommentText,
  phaseTitle,
} = require("../team-orchestrator");

function fakeTeamApi() {
  const parent = {
    id: "parent-1",
    identifier: "COD-TEAM",
    companyId: "company-1",
    title: "Change heading and verify",
    description: "Change the main heading and prove it in the browser.",
    priority: "medium",
    status: "todo",
  };

  const state = {
    parent: { ...parent },
    issues: new Map(),
    comments: new Map(),
    creates: [],
    updates: [],
    checkouts: [],
  };

  function outcomeFor(title) {
    if (title.includes(":cto:")) return "PLAN: READY";
    if (title.includes(":developer:") || title.includes(":developer-repair:")) return "DEV: COMPLETE";
    if (title.includes(":test:0]")) return "TEST: FAIL - heading was not visible";
    if (title.includes(":test:1]")) return "TEST: PASS";
    if (title.includes(":reviewer:1]")) return "REVIEW: APPROVED";
    if (title.includes(":reviewer:0]")) return "REVIEW: CHANGES_REQUIRED - stale extra edit";
    return "DONE";
  }

  return {
    state,
    async getIssue(id) {
      if (id === parent.id) return { ...state.parent };
      const issue = state.issues.get(id);
      if (!issue) throw new Error("unknown issue " + id);
      return { ...issue };
    },
    async checkout(input) {
      state.checkouts.push(input);
      state.parent.status = "in_progress";
      return { ok: true };
    },
    async updateIssue(input) {
      state.updates.push(input);
      if (input.issueId === parent.id && input.status) state.parent.status = input.status;
      return { ok: true };
    },
    async createIssue({ companyId, runId, issue }) {
      const id = "child-" + (state.creates.length + 1);
      const created = {
        ...issue,
        id,
        identifier: "COD-TEAM-" + (state.creates.length + 1),
        companyId,
        status: "done",
      };
      state.creates.push({ companyId, runId, issue: { ...issue }, id });
      state.issues.set(id, created);
      state.comments.set(id, [
        {
          createdAt: new Date(Date.now() + state.creates.length).toISOString(),
          body: "CodeMe completed the task.\n\n" + outcomeFor(issue.title),
        },
      ]);
      return { ...created };
    },
    async listIssues({ query }) {
      return [...state.issues.values()].filter((issue) => (
        !query || String(issue.title || "").includes(query)
      ));
    },
    async getIssueComments(id) {
      return (state.comments.get(id) || []).map((item) => ({ ...item }));
    },
  };
}

async function main() {
  assert.strictEqual(includesMarker("result: TEST: PASS", "test: pass"), true);
  assert.strictEqual(includesMarker("TEST: FAIL", "TEST: PASS"), false);
  assert.strictEqual(
    latestCommentText({
      comments: [
        { createdAt: "2026-01-01T00:00:00Z", body: "old" },
        { createdAt: "2026-01-01T00:00:01Z", body: "new" },
      ],
    }),
    "new",
  );
  assert.strictEqual(
    phaseTitle({ identifier: "COD-5" }, "test", 1, "Test verification"),
    "[team:COD-5:test:1] Test verification",
  );

  const registry = new PaperclipAgentRegistry({
    defaultApiKey: "controller-key",
    controllerAgentId: "controller-id",
    roles: {
      "controller-id": "controller",
      "cto-id": "cto",
      "developer-id": "developer",
      "test-id": "test",
      "reviewer-id": "reviewer",
      "research-id": "research",
    },
    keys: {
      "cto-id": "cto-key",
      "developer-id": "developer-key",
      "test-id": "test-key",
      "reviewer-id": "reviewer-key",
      "research-id": "research-key",
    },
  });

  assert.strictEqual(registry.agentForRole("developer").agentId, "developer-id");
  assert.strictEqual(registry.agentForRole("test").configured, true);
  assert.strictEqual(registry.agentForRole("missing"), null);

  const api = fakeTeamApi();
  const orchestrator = new PaperclipTeamOrchestrator({
    api,
    agentRegistry: registry,
    pollMs: 1,
    maxChildMs: 1000,
    maxWorkflowMs: 3000,
    maxRepairCycles: 2,
  });

  const accepted = await orchestrator.handleHeartbeat({
    runId: "pc-parent-run",
    agentId: "controller-id",
    companyId: "company-1",
    context: { taskId: "parent-1" },
  });

  assert.strictEqual(accepted.accepted, true);
  assert.strictEqual(accepted.teamOrchestration, true);
  assert.strictEqual(accepted.status, "running");

  const done = await orchestrator.waitForCompletion("pc-parent-run");
  assert.strictEqual(done.status, "done");
  assert.strictEqual(done.repairCycles, 1);

  const phases = api.state.creates.map((item) => item.issue.title);
  assert.ok(phases.some((title) => title.includes(":cto:0]")));
  assert.ok(phases.some((title) => title.includes(":developer:0]")));
  assert.ok(phases.some((title) => title.includes(":test:0]")));
  assert.ok(phases.some((title) => title.includes(":developer-repair:1]")));
  assert.ok(phases.some((title) => title.includes(":test:1]")));
  assert.ok(phases.some((title) => title.includes(":reviewer:1]")));

  const firstDev = api.state.creates.find((item) => item.issue.title.includes(":developer:0]"));
  const firstTest = api.state.creates.find((item) => item.issue.title.includes(":test:0]"));
  const reviewer = api.state.creates.find((item) => item.issue.title.includes(":reviewer:1]"));
  assert.strictEqual(firstDev.issue.assigneeAgentId, "developer-id");
  assert.strictEqual(firstTest.issue.assigneeAgentId, "test-id");
  assert.strictEqual(reviewer.issue.assigneeAgentId, "reviewer-id");

  assert.ok(
    api.state.updates.some((item) => (
      item.issueId === "parent-1"
      && item.status === "done"
      && /Reviewer: REVIEW: APPROVED/.test(item.comment)
    )),
  );

  orchestrator.dispose();
  console.log("ok Paperclip team orchestrates CTO -> Developer -> Test -> repair -> Test -> Reviewer");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
