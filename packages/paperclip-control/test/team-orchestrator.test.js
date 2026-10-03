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
    ...(options.parent || {}),
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
  assert.strictEqual(includesMarker("TEST:PASS", "TEST: PASS"), true);
  assert.strictEqual(includesMarker("REVIEW:APPROVED", "REVIEW: APPROVED"), true);
  assert.strictEqual(includesMarker("REVIEW :   APPROVED", "REVIEW: APPROVED"), true);
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
      "product-id": "product",
      "cto-id": "cto",
      "developer-id": "developer",
      "test-id": "test",
      "reviewer-id": "reviewer",
      "research-id": "research",
    },
    keys: {
      "product-id": "product-key",
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

  const productWait = await heartbeat("pc-parent-1");
  assert.strictEqual(productWait.status, "blocked");
  assert.strictEqual(productWait.completed, true);
  assert.strictEqual(productWait.phase, "product");
  assert.ok(productWait.waitingFor);
  assert.deepStrictEqual(api.state.parent.blockedByIssueIds, ["child-1"]);
  assert.strictEqual((await orchestrator.waitForCompletion("pc-parent-1")).status, "blocked");
  const duplicate = await heartbeat("pc-parent-1");
  assert.strictEqual(duplicate.duplicate, true);
  assert.strictEqual(api.state.creates.length, 1);

  api.complete(":product:0]", "PRODUCT: READY");

  const ctoWait = await heartbeat("pc-parent-2");
  assert.strictEqual(ctoWait.status, "blocked");
  assert.strictEqual(ctoWait.phase, "cto");
  assert.deepStrictEqual(api.state.parent.blockedByIssueIds, ["child-2"]);
  const architect = api.state.creates.find((item) => item.issue.title.includes(":cto:0]"));
  assert.strictEqual(architect.issue.assigneeAgentId, "cto-id");
  assert.match(architect.issue.description, /Product requirements/i);
  api.complete(":cto:0]", "PLAN: READY");

  const developerWait = await heartbeat("pc-parent-3");
  assert.strictEqual(developerWait.status, "blocked");
  assert.strictEqual(developerWait.phase, "developer");
  assert.deepStrictEqual(api.state.parent.blockedByIssueIds, ["child-3"]);
  const firstDev = api.state.creates.find((item) => item.issue.title.includes(":developer:0]"));
  assert.strictEqual(firstDev.issue.assigneeAgentId, "developer-id");
  assert.match(firstDev.issue.description, /final working-tree diff/i);
  assert.match(firstDev.issue.description, /actual runtime path/i);
  assert.match(firstDev.issue.description, /revert the unnecessary file/i);

  api.complete(":developer:0]", "DEV: COMPLETE");

  const testWait = await heartbeat("pc-parent-4");
  assert.strictEqual(testWait.status, "blocked");
  assert.strictEqual(testWait.phase, "test");
  const firstTest = api.state.creates.find((item) => item.issue.title.includes(":test:0]"));
  assert.strictEqual(firstTest.issue.assigneeAgentId, "test-id");
  assert.match(firstTest.issue.description, /actual runtime\/served path/i);
  assert.match(firstTest.issue.description, /every modified file/i);
  assert.match(firstTest.issue.description, /merely containing the expected text is not proof/i);
  assert.match(firstTest.issue.description, /RUNTIME PATH/i);
  assert.match(firstTest.issue.description, /FILE NECESSITY/i);

  api.complete(":test:0]", [
    "RUNTIME PATH: public/index.html is the served static page.",
    "FILE NECESSITY: public/index.html REQUIRED; pages/Home.js UNPROVEN/REDUNDANT.",
    "TEST: PASS",
  ].join("\n"));

  const reviewerWait0 = await heartbeat("pc-parent-5");
  assert.strictEqual(reviewerWait0.status, "blocked");
  assert.strictEqual(reviewerWait0.phase, "reviewer");
  const reviewer0 = api.state.creates.find((item) => item.issue.title.includes(":reviewer:0]"));
  assert.strictEqual(reviewer0.issue.assigneeAgentId, "reviewer-id");
  assert.match(reviewer0.issue.description, /actual runtime\/served path/i);
  assert.match(reviewer0.issue.description, /causal justification/i);
  assert.match(reviewer0.issue.description, /matching text/i);
  assert.match(reviewer0.issue.description, /require the redundant change to be reverted/i);
  assert.match(reviewer0.issue.description, /FILE JUSTIFICATION/i);

  api.complete(
    ":reviewer:0]",
    "FILE JUSTIFICATION: public/index.html required; pages/Home.js is not executed by the served path.\nREVIEW: CHANGES_REQUIRED - revert redundant pages/Home.js edit",
  );

  const repairWait = await heartbeat("pc-parent-6");
  assert.strictEqual(repairWait.status, "blocked");
  assert.strictEqual(repairWait.phase, "developer-repair");
  const repair = api.state.creates.find((item) => item.issue.title.includes(":developer-repair:1]"));
  assert.ok(repair);
  assert.match(repair.issue.description, /pages\/Home\.js/i);
  assert.match(repair.issue.description, /remove that unnecessary change/i);

  api.complete(":developer-repair:1]", "DEV: COMPLETE");

  const retestWait = await heartbeat("pc-parent-7");
  assert.strictEqual(retestWait.status, "blocked");
  assert.strictEqual(retestWait.phase, "test");
  assert.ok(api.state.creates.some((item) => item.issue.title.includes(":test:1]")));

  api.complete(
    ":test:1]",
    "RUNTIME PATH: public/index.html is served.\nFILE NECESSITY: public/index.html REQUIRED.\nTEST: PASS",
  );

  const reviewerWait = await heartbeat("pc-parent-8");
  assert.strictEqual(reviewerWait.status, "blocked");
  assert.strictEqual(reviewerWait.phase, "reviewer");
  const reviewer = api.state.creates.find((item) => item.issue.title.includes(":reviewer:1]"));
  assert.strictEqual(reviewer.issue.assigneeAgentId, "reviewer-id");

  api.complete(":reviewer:1]", "FILE JUSTIFICATION: public/index.html required.\nREVIEW: APPROVED");

  const done = await heartbeat("pc-parent-9");
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
  assert.ok(phases.some((title) => title.includes(":product:0]")));
  assert.ok(phases.some((title) => title.includes(":cto:0]")));
  assert.ok(phases.some((title) => title.includes(":developer:0]")));
  assert.ok(phases.some((title) => title.includes(":test:0]")));
  assert.ok(phases.some((title) => title.includes(":developer-repair:1]")));
  assert.ok(phases.some((title) => title.includes(":test:1]")));
  assert.ok(phases.some((title) => title.includes(":reviewer:1]")));

  const websiteApi = fakeTeamApi({
    parent: {
      identifier: "WEB-1",
      title: "Build a professional dealership website",
      description: "Create a responsive dealership website with inventory, strong book-a-viewing CTA, trust content, and polished CSS.",
    },
  });
  const websiteOrchestrator = new PaperclipTeamOrchestrator({
    api: websiteApi,
    agentRegistry: registry,
    maxRepairCycles: 1,
    dispositionRetryDelays: [0, 0, 0],
  });
  const websiteHeartbeat = (runId) => websiteOrchestrator.handleHeartbeat({
    runId,
    agentId: "controller-id",
    companyId: "company-1",
    context: { taskId: "parent-1" },
  });

  await websiteHeartbeat("website-1");
  const webProduct = websiteApi.state.creates.find((item) => item.issue.title.includes(":product:0]"));
  assert.match(webProduct.issue.description, /WEBSITE QUALITY CONTRACT/);
  assert.match(webProduct.issue.description, /CTA \/ CONVERSION/);
  assert.match(webProduct.issue.description, /CONTENT & TRUST/);
  websiteApi.complete(":product:0]", "AUDIENCE: buyers\nCTA / CONVERSION: book viewing\nPRODUCT: READY");

  await websiteHeartbeat("website-2");
  const webArchitect = websiteApi.state.creates.find((item) => item.issue.title.includes(":cto:0]"));
  assert.match(webArchitect.issue.description, /CSS ARCHITECTURE/);
  assert.match(webArchitect.issue.description, /RESPONSIVE STRATEGY/);
  assert.match(webArchitect.issue.description, /SEO \/ PERFORMANCE/);
  websiteApi.complete(":cto:0]", "CSS ARCHITECTURE: design tokens and component styles\nPLAN: READY");

  await websiteHeartbeat("website-3");
  const webDeveloper = websiteApi.state.creates.find((item) => item.issue.title.includes(":developer:0]"));
  assert.match(webDeveloper.issue.description, /Inspect the existing CSS/i);
  assert.match(webDeveloper.issue.description, /primary CTA/i);
  assert.match(webDeveloper.issue.description, /visual hierarchy/i);
  websiteApi.complete(":developer:0]", "DEV: COMPLETE");

  await websiteHeartbeat("website-4");
  const webTest = websiteApi.state.creates.find((item) => item.issue.title.includes(":test:0]"));
  assert.match(webTest.issue.description, /WEB QUALITY MATRIX/);
  assert.match(webTest.issue.description, /CSS path/i);
  assert.match(webTest.issue.description, /WEB QUALITY: PASS/);
  websiteApi.complete(":test:0]", [
    "WEB QUALITY MATRIX",
    "product PASS",
    "architecture PASS",
    "visual PASS",
    "responsive PASS",
    "interaction PASS",
    "accessibility PASS",
    "content PASS",
    "seo PASS",
    "performance PASS",
    "verification PASS",
    "WEB QUALITY: PASS",
    "TEST: PASS",
  ].join("\n"));

  await websiteHeartbeat("website-5");
  const webReviewer = websiteApi.state.creates.find((item) => item.issue.title.includes(":reviewer:0]"));
  assert.match(webReviewer.issue.description, /CSS quality/i);
  assert.match(webReviewer.issue.description, /CTA prominence/i);
  assert.match(webReviewer.issue.description, /WEB REVIEW: APPROVED/);
  websiteApi.complete(":reviewer:0]", "WEB REVIEW: APPROVED\nREVIEW: APPROVED");

  const websiteDone = await websiteHeartbeat("website-6");
  assert.strictEqual(websiteDone.status, "done");
  assert.ok(websiteApi.state.updates.some((item) => (
    item.issueId === "parent-1"
    && item.status === "done"
    && /WEB QUALITY: PASS/.test(item.comment)
    && /WEB REVIEW: APPROVED/.test(item.comment)
  )));
  websiteOrchestrator.dispose();

  const testFailureApi = fakeTeamApi();
  const testFailureOrchestrator = new PaperclipTeamOrchestrator({
    api: testFailureApi,
    agentRegistry: registry,
    maxRepairCycles: 1,
    dispositionRetryDelays: [0, 0, 0],
  });
  const testFailureHeartbeat = (runId) => testFailureOrchestrator.handleHeartbeat({
    runId,
    agentId: "controller-id",
    companyId: "company-1",
    context: { taskId: "parent-1" },
  });
  await testFailureHeartbeat("test-failure-1");
  testFailureApi.complete(":product:0]", "PRODUCT: READY");
  await testFailureHeartbeat("test-failure-2");
  testFailureApi.complete(":cto:0]", "PLAN: READY");
  await testFailureHeartbeat("test-failure-3");
  testFailureApi.complete(":developer:0]", "DEV: COMPLETE");
  await testFailureHeartbeat("test-failure-4");
  testFailureApi.complete(":test:0]", "TEST: FAIL - public/index.html is correct but pages/Home.js is redundant");
  const testFailureRepair = await testFailureHeartbeat("test-failure-5");
  assert.strictEqual(testFailureRepair.phase, "developer-repair");
  assert.ok(testFailureApi.state.creates.some((item) => item.issue.title.includes(":developer-repair:1]")));

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
  testFailureOrchestrator.dispose();
  failingOrchestrator.dispose();
  console.log("ok Paperclip team enforces runtime-aware diffs plus multi-angle website product, architecture, CSS, CTA, QA, and review");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
