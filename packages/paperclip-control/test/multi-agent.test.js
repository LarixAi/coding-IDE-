const assert = require("assert");
const {
  PaperclipAgentRegistry,
  PaperclipController,
  paperclipTaskPrompt,
} = require("../index");
const { deniedToolUse, rolePolicy } = require("../roles");

function fakeApi(label) {
  return {
    label,
    checkoutCalls: [],
    updateCalls: [],
    async getIssue(id) {
      return {
        id,
        identifier: "COD-MA",
        title: "Multi-agent test",
        description: "Perform only the assigned role.",
      };
    },
    async checkout(input) {
      this.checkoutCalls.push(input);
      return { ok: true };
    },
    async updateIssue(input) {
      this.updateCalls.push(input);
      return { ok: true };
    },
  };
}

function fakeSession(states) {
  const queue = Array.isArray(states) ? states.slice() : [];
  return {
    mode: "ask",
    submitCalls: [],
    cancelCalls: 0,
    state: {
      running: false,
      selected: { provider: "fixture", id: "selected-model", label: "Selected Model" },
      stage: "Waiting",
      runId: "",
      tools: [],
      filesChanged: [],
      verification: null,
    },
    snapshot() {
      if (queue.length) this.state = { ...this.state, ...queue.shift() };
      return {
        ...this.state,
        tools: (this.state.tools || []).map((tool) => ({ ...tool })),
      };
    },
    async refreshModels() {
      return this.state.selected;
    },
    selectMode(mode) {
      this.mode = mode;
      return { ok: true };
    },
    selectModel() {
      throw new Error("Paperclip agents must never select a model");
    },
    async submit(prompt) {
      this.submitCalls.push(prompt);
      this.state.running = true;
      this.state.runId = "run-multi-agent";
      this.state.stage = "Reading";
      return { ok: true, runId: "run-multi-agent" };
    },
    cancel() {
      this.cancelCalls += 1;
      this.state.running = false;
      this.state.stage = "Cancelled";
      return { ok: true };
    },
  };
}

async function main() {
  const registry = new PaperclipAgentRegistry({
    defaultApiKey: "controller-token",
    controllerAgentId: "controller-id",
    roles: {
      "controller-id": "controller",
      "dev-id": "developer",
      "review-id": "reviewer",
      "test-id": "test",
    },
    keys: {
      "dev-id": "developer-token",
      "review-id": "reviewer-token",
      "test-id": "test-token",
    },
  });

  assert.strictEqual(registry.resolve("controller-id").apiKey, "controller-token");
  assert.strictEqual(registry.resolve("dev-id").role.key, "developer");
  assert.strictEqual(registry.resolve("dev-id").apiKey, "developer-token");
  assert.throws(
    () => registry.resolve("unknown-agent"),
    (error) => error && error.code === "paperclip_agent_not_registered",
  );

  const summary = registry.summary();
  assert.strictEqual(summary.mode, "multi-agent");
  assert.strictEqual(summary.agents.length, 4);
  assert.ok(summary.agents.every((item) => !Object.prototype.hasOwnProperty.call(item, "apiKey")));

  const developerPrompt = paperclipTaskPrompt(
    { identifier: "COD-DEV", title: "Fix page" },
    rolePolicy("developer"),
  );
  assert.ok(developerPrompt.includes("Developer Agent"));
  assert.ok(developerPrompt.includes("revert any now-unnecessary edit"));

  const reviewerPrompt = paperclipTaskPrompt(
    { identifier: "COD-REV", title: "Review diff" },
    rolePolicy("reviewer"),
  );
  assert.ok(reviewerPrompt.includes("Reviewer Agent"));
  assert.ok(reviewerPrompt.includes("Do not edit source files"));

  assert.strictEqual(
    deniedToolUse(
      [{ name: "file.patch", status: "done", args: { path: "src/app.js" } }],
      rolePolicy("test"),
    ).name,
    "file.patch",
  );
  assert.strictEqual(
    deniedToolUse(
      [{ name: "browser.check", status: "done", args: {} }],
      rolePolicy("test"),
    ),
    null,
  );

  const developerSession = fakeSession([
    {
      running: false,
      selected: { provider: "fixture", id: "selected-model", label: "Selected Model" },
    },
    {
      running: true,
      runId: "run-multi-agent",
      stage: "Editing",
      tools: [{ name: "file.patch", status: "done", args: { path: "src/app.js" } }],
    },
    {
      running: false,
      runId: "run-multi-agent",
      stage: "Complete",
      tools: [{ name: "file.patch", status: "done", args: { path: "src/app.js" } }],
      filesChanged: ["src/app.js"],
      verification: { status: "passed" },
      outcome: { summary: "Implemented and verified." },
    },
  ]);
  const createdApis = [];
  const developerController = new PaperclipController({
    session: developerSession,
    api: fakeApi("default"),
    agentRegistry: registry,
    apiFactory(identity) {
      createdApis.push({ agentId: identity.agentId, role: identity.role.key, apiKey: identity.apiKey });
      return fakeApi(identity.role.key);
    },
    pollMs: 1,
    maxRunMs: 1000,
  });

  const accepted = await developerController.handleHeartbeat({
    runId: "pc-dev",
    agentId: "dev-id",
    context: { taskId: "issue-dev" },
  });
  assert.strictEqual(accepted.accepted, true);
  assert.strictEqual(developerSession.mode, "code");
  assert.strictEqual(developerSession.state.selected.id, "selected-model");
  assert.ok(developerSession.submitCalls[0].includes("Developer Agent"));
  assert.deepStrictEqual(createdApis[0], {
    agentId: "dev-id",
    role: "developer",
    apiKey: "developer-token",
  });
  const devDone = await developerController.waitForCompletion("pc-dev");
  assert.strictEqual(devDone.status, "done");

  const reviewSession = fakeSession([
    {
      running: false,
      selected: { provider: "fixture", id: "selected-model", label: "Selected Model" },
    },
    {
      running: false,
      runId: "run-multi-agent",
      stage: "Complete",
      tools: [{ name: "git.diff", status: "done", args: {} }],
      filesChanged: [],
      verification: { status: "passed" },
      outcome: { summary: "Diff reviewed." },
    },
  ]);
  const reviewController = new PaperclipController({
    session: reviewSession,
    api: fakeApi("default"),
    agentRegistry: registry,
    apiFactory(identity) {
      return fakeApi(identity.role.key);
    },
    pollMs: 1,
    maxRunMs: 1000,
  });
  await reviewController.handleHeartbeat({
    runId: "pc-review",
    agentId: "review-id",
    context: { taskId: "issue-review" },
  });
  assert.strictEqual(reviewSession.mode, "ask");
  assert.ok(reviewSession.submitCalls[0].includes("Reviewer Agent"));
  const reviewDone = await reviewController.waitForCompletion("pc-review");
  assert.strictEqual(reviewDone.status, "done");

  const testApi = fakeApi("test");
  const testSession = fakeSession([
    {
      running: false,
      selected: { provider: "fixture", id: "selected-model", label: "Selected Model" },
    },
    {
      running: true,
      runId: "run-multi-agent",
      stage: "Editing",
      tools: [{ name: "file.patch", status: "done", args: { path: "src/app.js" } }],
    },
  ]);
  const testController = new PaperclipController({
    session: testSession,
    api: fakeApi("default"),
    agentRegistry: registry,
    apiFactory() {
      return testApi;
    },
    pollMs: 1,
    maxRunMs: 1000,
  });
  await testController.handleHeartbeat({
    runId: "pc-test",
    agentId: "test-id",
    context: { taskId: "issue-test" },
  });
  const testDone = await testController.waitForCompletion("pc-test");
  assert.strictEqual(testDone.status, "blocked");
  assert.strictEqual(testSession.cancelCalls, 1);
  assert.ok(testApi.updateCalls.some((call) => (
    call.status === "blocked" && /outside its role boundary/.test(call.comment)
  )));

  developerController.dispose();
  reviewController.dispose();
  testController.dispose();

  console.log("ok Paperclip multi-agent roles preserve model choice, isolate identities, and enforce role boundaries");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
