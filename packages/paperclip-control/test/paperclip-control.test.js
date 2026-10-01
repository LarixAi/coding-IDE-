const assert = require("assert");
const {
  PaperclipController,
  normalizeHeartbeat,
  paperclipTaskPrompt,
  repeatedTool,
} = require("../index");

function fakeSession(options = {}) {
  const states = Array.isArray(options.states) ? options.states.slice() : [];
  const session = {
    mode: "ask",
    refreshCalls: 0,
    submitCalls: [],
    cancelCalls: 0,
    state: options.initial || {
      running: false,
      selected: { provider: "fixture-provider", id: "fixture-model", label: "Fixture Model" },
      stage: "Waiting",
      runId: "",
      tools: [],
      filesChanged: [],
      verification: null,
      outcome: null,
      error: "",
    },
    snapshot() {
      if (states.length) this.state = { ...this.state, ...states.shift() };
      return { ...this.state, tools: (this.state.tools || []).map((item) => ({ ...item })) };
    },
    async refreshModels() {
      this.refreshCalls += 1;
      if (!this.state.selected && options.modelAfterRefresh) {
        this.state.selected = options.modelAfterRefresh;
      }
      return this.state.selected;
    },
    selectMode(mode) {
      this.mode = mode;
      return { ok: true };
    },
    selectModel() {
      throw new Error("Paperclip must never select or pin a model");
    },
    async submit(goal) {
      this.submitCalls.push(goal);
      const result = options.submitResult || { ok: true, runId: "run_codeme_1" };
      if (result.runId) {
        this.state.running = true;
        this.state.runId = result.runId;
        this.state.stage = "Reading";
      }
      if (result.status === "NEEDS_CLARIFICATION") {
        this.state.clarification = {
          questions: [{ id: "q1", question: "Which booking type?" }],
        };
      }
      return result;
    },
    cancel() {
      this.cancelCalls += 1;
      this.state.running = false;
      this.state.stage = "Cancelled";
      return { ok: true };
    },
  };
  return session;
}

function fakeApi(issue = {}) {
  return {
    getCalls: [],
    checkoutCalls: [],
    updateCalls: [],
    async getIssue(id) {
      this.getCalls.push(id);
      return {
        id,
        identifier: "PAP-12",
        title: "Build booking flow",
        description: "Create the booking form and availability flow.",
        ...issue,
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

async function main() {
  assert.deepStrictEqual(
    normalizeHeartbeat({
      runId: "pc-run-1",
      agentId: "agent-1",
      companyId: "company-1",
      context: { taskId: "issue-1" },
    }),
    {
      runId: "pc-run-1",
      agentId: "agent-1",
      companyId: "company-1",
      taskId: "issue-1",
      context: { taskId: "issue-1" },
    },
  );
  assert.deepStrictEqual(
    normalizeHeartbeat({
      runId: "pc-run-standard",
      agentId: "agent-standard",
      context: { taskId: "issue-standard", wakeReason: "assignment" },
    }),
    {
      runId: "pc-run-standard",
      agentId: "agent-standard",
      companyId: "",
      taskId: "issue-standard",
      context: { taskId: "issue-standard", wakeReason: "assignment" },
    },
    "standard Paperclip HTTP adapter payload must not require companyId",
  );
  assert.throws(() => normalizeHeartbeat({}), /runId is required/);

  const prompt = paperclipTaskPrompt({
    id: "issue-1",
    identifier: "PAP-12",
    title: "Build booking flow",
    description: "Create the form.",
  });
  assert.ok(prompt.includes("PAP-12"));
  assert.ok(prompt.includes("Work only on this assigned task"));
  assert.ok(prompt.includes("Do not repeat an identical tool action"));

  const repeated = repeatedTool([
    { name: "file.read", status: "done", args: { path: "public/index.html" } },
    { name: "file.read", status: "done", args: { path: "public/index.html" } },
    { name: "file.read", status: "done", args: { path: "public/index.html" } },
  ], 3);
  assert.ok(repeated);
  assert.strictEqual(repeated.signature, "file.read:public/index.html");
  assert.strictEqual(
    repeatedTool([
      { name: "file.read", status: "done", args: { path: "public/index.html" } },
      { name: "file.read", status: "done", args: { path: "public/app.js" } },
      { name: "file.read", status: "done", args: { path: "public/index.html" } },
    ], 3),
    null,
  );

  const completeSession = fakeSession({
    states: [
      {
        running: false,
        selected: { provider: "fixture-provider", id: "fixture-model", label: "Fixture Model" },
      },
      {
        running: true,
        runId: "run_codeme_1",
        stage: "Editing",
        tools: [{ name: "file.write", status: "done", args: { path: "public/index.html" } }],
      },
      {
        running: false,
        runId: "run_codeme_1",
        stage: "Complete",
        filesChanged: ["public/index.html"],
        verification: { status: "passed" },
        outcome: { summary: "Booking flow implemented." },
      },
    ],
  });
  const completeApi = fakeApi();
  const complete = new PaperclipController({
    session: completeSession,
    api: completeApi,
    pollMs: 1,
    maxRunMs: 1000,
  });
  const accepted = await complete.handleHeartbeat({
    runId: "pc-run-1",
    agentId: "agent-1",
    companyId: "company-1",
    context: { taskId: "issue-1" },
  });
  assert.strictEqual(accepted.accepted, true);
  assert.strictEqual(completeSession.mode, "code");
  assert.strictEqual(
    completeSession.state.selected.id,
    "fixture-model",
    "Paperclip must preserve whatever model CodeMe already selected",
  );
  assert.strictEqual(completeSession.submitCalls.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(completeApi.checkoutCalls.length === 1);
  assert.ok(completeApi.updateCalls.some((call) => call.status === "done"));
  const duplicate = await complete.handleHeartbeat({
    runId: "pc-run-1",
    agentId: "agent-1",
    companyId: "company-1",
    context: { taskId: "issue-1" },
  });
  assert.strictEqual(duplicate.duplicate, true);
  assert.strictEqual(completeSession.submitCalls.length, 1, "duplicate Paperclip run must not start CodeMe twice");

  const clarificationSession = fakeSession({
    submitResult: { ok: true, status: "NEEDS_CLARIFICATION" },
  });
  const clarificationApi = fakeApi();
  const clarification = new PaperclipController({
    session: clarificationSession,
    api: clarificationApi,
    pollMs: 1,
  });
  const blocked = await clarification.handleHeartbeat({
    runId: "pc-run-2",
    agentId: "agent-1",
    companyId: "company-1",
    context: { taskId: "issue-2" },
  });
  assert.strictEqual(blocked.needsClarification, true);
  assert.ok(clarificationApi.updateCalls.some((call) => (
    call.status === "blocked" && /Which booking type/.test(call.comment)
  )));

  const loopSession = fakeSession({
    states: [
      {
        running: false,
        selected: { provider: "fixture", id: "model", label: "Fixture" },
      },
      {
        running: true,
        runId: "run_codeme_1",
        stage: "Reading",
        tools: [
          { name: "file.read", status: "done", args: { path: "public/index.html" } },
          { name: "file.read", status: "done", args: { path: "public/index.html" } },
          { name: "file.read", status: "done", args: { path: "public/index.html" } },
        ],
      },
    ],
  });
  const loopApi = fakeApi();
  const loopController = new PaperclipController({
    session: loopSession,
    api: loopApi,
    pollMs: 1,
    repeatThreshold: 3,
    maxRunMs: 1000,
  });
  await loopController.handleHeartbeat({
    runId: "pc-run-3",
    agentId: "agent-1",
    companyId: "company-1",
    context: { taskId: "issue-3" },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(loopSession.cancelCalls, 1, "Paperclip watchdog must cancel a repeated-action loop");
  assert.ok(loopApi.updateCalls.some((call) => (
    call.status === "blocked" && /repeated-action loop/.test(call.comment)
  )));

  complete.dispose();
  clarification.dispose();
  loopController.dispose();

  console.log("ok Paperclip controls one CodeMe task, prevents duplicate dispatch, and stops repeated tool loops");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
