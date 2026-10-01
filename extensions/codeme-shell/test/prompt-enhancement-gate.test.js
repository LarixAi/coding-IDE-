const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ModelProvider,
  RunStore,
  ToolRegistry,
  ReadOnlyToolProvider,
} = require("../../../packages/agent-runtime");
const { ComposerSession } = require("../composer-session");
const { renderComposer } = require("../composer-view");
const { parseEnhancementResponse } = require("../n8n-integration");

class QuietModel extends ModelProvider {
  constructor() {
    super("fixture");
    this.calls = [];
  }

  async complete(input) {
    this.calls.push(input);
    return { text: "The clarified task is ready.", toolCalls: [] };
  }
}

function host(root) {
  return {
    async inspectWorkspace() {
      return {
        state: "project",
        root,
        projectMarkers: [],
        languages: [],
        frameworks: [],
        scripts: {},
        git: false,
      };
    },
    async listDir() { return { entries: [] }; },
    async readFile(file) { return { path: file, contents: "" }; },
    async search() { return { query: "", matches: [] }; },
    async gitStatus() { return { branch: "main", changes: [] }; },
    async gitDiff() { return { diff: "" }; },
    async diagnostics() { return { items: [] }; },
    async browserCheck(url) {
      return { available: false, code: "browser_unavailable", message: "none", url };
    },
  };
}

function createSession(root, n8n, provider) {
  const selected = { provider: "fixture", id: "fixture-model", label: "Fixture Model" };
  return new ComposerSession({
    store: new RunStore(path.join(root, "runs")),
    selectionStore: {
      get: () => selected,
      set() {},
      getMode: () => "ask",
      setMode() {},
    },
    listModels: async () => [selected],
    createProvider: () => provider,
    createRegistry: () => new ToolRegistry(new ReadOnlyToolProvider(host(root))),
    capabilities: null,
    n8n,
    root,
  });
}

async function waitFor(session, predicate) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (predicate(session)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for ComposerSession: " + session.stage + " " + session.error);
}

async function main() {
  const parsed = parseEnhancementResponse(JSON.stringify({
    ok: true,
    status: "NEEDS_CLARIFICATION",
    summary: "More detail is needed.",
    intent: { goal: "build a booking system", taskType: "code" },
    requirements: [],
    constraints: [],
    knownContext: [],
    assumptions: [],
    missingInformation: ["What is being booked"],
    clarifyingQuestions: [{
      id: "q1",
      question: "What is being booked?",
      reason: "This changes the data model.",
      required: true,
    }],
    researchQueries: [],
    suggestedCapabilities: [],
    suggestedAgents: [],
    acceptanceCriteria: [],
    enhancedPrompt: "",
    confidence: 0.9,
  }));
  assert.strictEqual(parsed.status, "NEEDS_CLARIFICATION");
  assert.strictEqual(parsed.clarifyingQuestions.length, 1);
  assert.throws(
    () => parseEnhancementResponse(JSON.stringify({ status: "READY", enhancedPrompt: "" })),
    /READY without an enhanced prompt/i,
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-prompt-gate-"));
  fs.mkdirSync(path.join(root, "runs"));
  const provider = new QuietModel();
  const calls = [];
  const n8n = {
    workspaceContext() { return { rootName: "fixture", files: [] }; },
    async enhanceForSubmit(prompt, context, options = {}) {
      calls.push({ prompt, context, options });
      if (calls.length === 1) {
        return {
          status: "NEEDS_CLARIFICATION",
          prompt: "",
          source: "n8n",
          summary: "I need one detail before I start.",
          intent: { goal: "build a booking system", taskType: "code" },
          requirements: [],
          constraints: [],
          knownContext: [],
          assumptions: [],
          missingInformation: ["What is being booked"],
          clarifyingQuestions: [{
            id: "q1",
            question: "What is being booked?",
            reason: "This changes the implementation.",
            required: true,
          }],
          researchQueries: [],
          suggestedCapabilities: [],
          suggestedAgents: [],
          acceptanceCriteria: [],
          confidence: 0.9,
        };
      }
      return {
        status: "READY",
        prompt: "Build a community transport booking system. Keep the implementation minimal and verify the result.",
        enhancedPrompt: "Build a community transport booking system. Keep the implementation minimal and verify the result.",
        source: "n8n",
        summary: "Enough information is available.",
        clarifyingQuestions: [],
        researchQueries: [],
      };
    },
  };

  const session = createSession(root, n8n, provider);
  await session.refreshModels();

  const first = await session.submit("build me a booking system", 1);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.status, "NEEDS_CLARIFICATION");
  assert.strictEqual(first.clarification, true);
  assert.strictEqual(session.running, false);
  assert.strictEqual(session.runId, "");
  assert.strictEqual(provider.calls.length, 0, "clarification must stop before the model/agent starts");
  assert.strictEqual(session.tools.length, 0, "clarification must not run tools");
  assert.ok(session.clarification);
  assert.strictEqual(session.clarification.questions[0].id, "q1");

  const second = await session.submitClarification(
    [{ id: "q1", answer: "Community transport journeys" }],
    "Community transport journeys",
    2,
  );
  assert.strictEqual(second.ok, true);
  assert.ok(second.runId, "READY clarification should start the normal pipeline");
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[1].options.clarificationAnswers, [
    { id: "q1", answer: "Community transport journeys" },
  ]);
  await waitFor(session, (item) => !item.running);
  assert.ok(provider.calls.length > 0, "READY is the only path that should reach the agent");

  const researchProvider = new QuietModel();
  const researchSession = createSession(root, {
    workspaceContext() { return { rootName: "fixture", files: [] }; },
    async enhanceForSubmit() {
      return {
        status: "NEEDS_RESEARCH",
        prompt: "",
        summary: "Current documentation is required.",
        researchQueries: ["current React error boundary guidance"],
        clarifyingQuestions: [],
      };
    },
  }, researchProvider);
  await researchSession.refreshModels();
  const research = await researchSession.submit("Use the current recommended React error boundary approach", 3);
  assert.strictEqual(research.ok, true);
  assert.strictEqual(research.status, "NEEDS_RESEARCH");
  assert.strictEqual(researchSession.running, false);
  assert.strictEqual(researchProvider.calls.length, 0, "research gate must stop before the coding agent");
  assert.ok(researchSession.researchRequest);

  const failedProvider = new QuietModel();
  const failedSession = createSession(root, {
    workspaceContext() { return { rootName: "fixture", files: [] }; },
    async enhanceForSubmit() {
      const error = new Error("n8n offline");
      error.code = "prompt_enhancement_unavailable";
      throw error;
    },
  }, failedProvider);
  await failedSession.refreshModels();
  const failed = await failedSession.submit("Change the heading", 4);
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.code, "prompt_enhancement_unavailable");
  assert.strictEqual(failedProvider.calls.length, 0, "enhancement failure must not silently bypass the gate");

  const html = renderComposer("prompt-gate-nonce");
  assert.ok(html.includes('id="clarification"'));
  assert.ok(html.includes("clarification-submit"));
  assert.ok(html.includes('id="work-panel"'));
  assert.ok(html.includes("Work details"));
  assert.ok(html.includes('activity.classList.toggle("on", running && Boolean(line))'));

  console.log("ok prompt enhancement hard gate, clarification UI, and collapsible work panel");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
