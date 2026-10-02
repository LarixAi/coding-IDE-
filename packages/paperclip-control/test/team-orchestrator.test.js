const assert = require("assert");
const { PaperclipAgentRegistry } = require("../index");
const {
  PaperclipTeamOrchestrator,
  includesMarker,
  latestCommentText,
  phaseTitle,
} = require("../team-orchestrator");

function fakeTeamApi(options = {}) {
  const parent = {
    id: "parent-1",
    identifier: "COD-TEAM",
    companyId: "company-1",
    title: "Change heading and verify",
    description: "Change the main heading and prove it in the browser.",
    priority: "medium",
    status: "todo",
    blockedByIssueIds: [],
  };

  const state = {
    parent: { ...parent },
    issues: new Map(),
    comments: new Map(),
    creates: [],
    updates: [],
    checkouts: [],
  };

  function findCreated(fragment) {
    const created = state.creates.find((item) => item.issue.title.includes(fragment));
    if (!created) throw new Error("missing child matching " + fragment);
    return state.issues.get(created.id);
  }

  return {
    state,
    complete(fragment, outcome) {
      const issue = findCreated(fragment);
      issue.status = "done";
      state.comments.set(issue.id, [{
        createdAt: new Date().toISOString(),
        body: "CodeMe completed the task.\n\n" + outcome,
      }]);
      return { ...issue };
    },
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
      state.updates.push({ ...input });
      if (
        options.failParentTerminal
        && input.issueId === parent.id
        && ["done", "blocked"].includes(input.status)
      ) {
        throw new Error("simulated parent disposition failure");
      }
      if (input.issueId === parent.id) {
        if (input.status) state.parent.status = input.status;
        if (input.blockedByIssueIds !== undefined) {
          state.parent.blockedByIssueIds = input.blockedByIssueIds.slice();
        }
        return {
          ...state.parent,
          blockedByIssueIds: state.parent.blockedByIssueIds.slice(),
        };
      }
      return { ok: true };
    },
    async createIssue({ companyId, runId, issue }) {
      const id = "child-" + (state.creates.length + 1);
      const created = {
        ...issue,
        id,
        identifier: "COD-TEAM-" + (state.creates.length + 1),
        companyId,
        status: "todo",
      };
      state.creates.push({ companyId, runId, issue: { ...issue }, id });
      state.issues.set(id, created);
      state.comments.set(id, []);
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

  const api = fakeTeamApi();
  const orchestrator = new PaperclipTeamOrchestrator({
    api,
    agentRegistry: registry,
    maxRepairCycles: 2,
    dispositionRetryDelays: [0, 0, 0],
  });

  async function heartbeat(runId) {
    return orchestrator.handleHeartbeat({
      runId,
      agentId: "controller-id",
      companyId: "company-1",
      context: { taskId: "parent-1" },
    });
  }

  const ctoWait = await heartbeat("pc-parent-1");
  assert.strictEqual(ctoWait.status, "blocked");
  assert.strictEqual(ctoWait.completed, true);
  assert.strictEqual(ctoWait.phase, "cto");
  assert.ok(ctoWait.waitingFor);
  assert.deepStrictEqual(api.state.parent.blockedByIssueIds, ["child-1"]);
  assert.strictEqual((await orchestrator.waitForCompletion("pc-parent-1")).status, "blocked");
  const duplicate = await heartbeat("pc-parent-1");
  assert.strictEqual(duplicate.duplicate, true);
  assert.strictEqual(api.state.creates.length, 1);

  api.complete(":cto:0]", "PLAN: READY");

  const developerWait = await heartbeat("pc-parent-2");
  assert.strictEqual(developerWait.status, "blocked");
  assert.strictEqual(developerWait.phase, "developer");
  assert.deepStrictEqual(api.state.parent.blockedByIssueIds, ["child-2"]);
  const firstDev = api.state.creates.find((item) => item.issue.title.includes(":developer:0]"));
  assert.strictEqual(firstDev.issue.assigneeAgentId, "developer-id");

  api.complete(":developer:0]", "DEV: COMPLETE");

  const testWait = await heartbeat("pc-parent-3");
  assert.strictEqual(testWait.status, "blocked");
  assert.strictEqual(testWait.phase, "test");
  const firstTest = api.state.creates.find((item) => item.issue.title.includes(":test:0]"));
  assert.strictEqual(firstTest.issue.assigneeAgentId, "test-id");

  api.complete(":test:0]", "TEST: FAIL - heading was not visible");

  const repairWait = await heartbeat("pc-parent-4");
  assert.strictEqual(repairWait.status, "blocked");
  assert.strictEqual(repairWait.phase, "developer-repair");
  assert.ok(api.state.creates.some((item) => item.issue.title.includes(":developer-repair:1]")));

  api.complete(":developer-repair:1]", "DEV: COMPLETE");

  const retestWait = await heartbeat("pc-parent-5");
  assert.strictEqual(retestWait.status, "blocked");
  assert.strictEqual(retestWait.phase, "test");
  assert.ok(api.state.creates.some((item) => item.issue.title.includes(":test:1]")));

  api.complete(":test:1]", "TEST: PASS");

  const reviewerWait = await heartbeat("pc-parent-6");
  assert.strictEqual(reviewerWait.status, "blocked");
  assert.strictEqual(reviewerWait.phase, "reviewer");
  const reviewer = api.state.creates.find((item) => item.issue.title.includes(":reviewer:1]"));
  assert.strictEqual(reviewer.issue.assigneeAgentId, "reviewer-id");

  api.complete(":reviewer:1]", "REVIEW: APPROVED");

  const done = await heartbeat("pc-parent-7");
  assert.strictEqual(done.status, "done");
  assert.strictEqual(done.repairCycles, 1);
  assert.deepStrictEqual(api.state.parent.blockedByIssueIds, []);
  assert.ok(
    api.state.updates.some((item) => (
      item.issueId === "parent-1"
      && item.status === "done"
      && /Reviewer: REVIEW: APPROVED/.test(item.comment)
    )),
  );

  const phases = api.state.creates.map((item) => item.issue.title);
  assert.ok(phases.some((title) => title.includes(":cto:0]")));
  assert.ok(phases.some((title) => title.includes(":developer:0]")));
  assert.ok(phases.some((title) => title.includes(":test:0]")));
  assert.ok(phases.some((title) => title.includes(":developer-repair:1]")));
  assert.ok(phases.some((title) => title.includes(":test:1]")));
  assert.ok(phases.some((title) => title.includes(":reviewer:1]")));

  const failingApi = fakeTeamApi({ failParentTerminal: true });
  const failingOrchestrator = new PaperclipTeamOrchestrator({
    api: failingApi,
    agentRegistry: registry,
    maxRepairCycles: 2,
    dispositionRetryDelays: [0, 0, 0],
  });
  const syncFailure = await failingOrchestrator.handleHeartbeat({
    runId: "pc-parent-sync-failure",
    agentId: "controller-id",
    companyId: "company-1",
    context: { taskId: "parent-1" },
  });
  assert.strictEqual(syncFailure.status, "sync_failed");
  assert.strictEqual(syncFailure.ok, false);
  assert.match(syncFailure.syncError, /could not persist the parent issue disposition/i);
  assert.strictEqual(
    failingApi.state.updates.filter((item) => (
      item.issueId === "parent-1" && item.status === "blocked"
    )).length,
    3,
    "parent parked disposition must be retried before failing closed",
  );

  orchestrator.dispose();
  failingOrchestrator.dispose();
  console.log("ok Paperclip team yields between phases, resumes durably, repairs, reviews, and fails closed on disposition sync");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
