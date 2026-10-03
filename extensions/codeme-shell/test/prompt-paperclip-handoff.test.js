"use strict";

const assert = require("assert");
const {
  installPromptPaperclipHandoff,
  shouldRouteToPaperclip,
} = require("../prompt-paperclip-handoff");

class FakeComposerSession {
  constructor(n8n) {
    this.n8n = n8n;
    this.thread = [];
    this.attachments = [];
    this.root = "/tmp/dealership";
    this.composerMode = "code";
    this.mode = "controlled";
    this.conversationId = "chat-1";
    this.running = false;
    this.clarification = null;
    this.requestId = "";
    this.originalCalls = [];
    this.notices = [];
  }

  async submit(text, epoch, options = {}) {
    this.originalCalls.push({ text, epoch, options });
    return { ok: true, direct: true, options };
  }

  async submitClarification() {
    return { ok: true };
  }

  emit() {
    this.notices.push(this.notice || "");
  }

  beginClarification() {
    return { ok: true, status: "NEEDS_CLARIFICATION" };
  }

  beginResearchStop() {
    return { ok: true, status: "NEEDS_RESEARCH" };
  }
}

class FakeMultitaskController {
  constructor(options = {}) {
    this.session = options.session;
    this.started = null;
  }

  start(goal, epoch, options = {}) {
    this.started = { goal, epoch, options };
    return {
      ok: true,
      multitask: true,
      orchestrated: true,
      requestId: options.requestId || "",
      runId: options.traceId || "",
    };
  }
}

class FakePaperclipController {
  constructor(session) {
    this.session = session;
  }

  async handleHeartbeat() {
    return this.session.submit("Paperclip assigned developer task", 9);
  }
}

async function main() {
  assert.strictEqual(
    shouldRouteToPaperclip("code", "Build a full dealership website with booking", {
      status: "READY",
      suggestedAgents: ["product", "developer"],
    }),
    true,
  );
  assert.strictEqual(
    shouldRouteToPaperclip("code", "Change the heading to Hello", {
      status: "READY",
      suggestedAgents: ["developer"],
      requirements: ["Change one heading"],
      acceptanceCriteria: ["Heading reads Hello"],
    }),
    false,
  );
  assert.strictEqual(
    shouldRouteToPaperclip("ask", "Build a full dealership website", {
      status: "READY",
      suggestedAgents: ["product", "developer"],
    }),
    false,
  );

  const composerModule = { ComposerSession: FakeComposerSession };
  const multitaskModule = { MultitaskController: FakeMultitaskController };
  const paperclipModule = { PaperclipController: FakePaperclipController };
  installPromptPaperclipHandoff({ composerModule, multitaskModule, paperclipModule });

  const enhancementCalls = [];
  const n8n = {
    workspaceContext() {
      return { rootName: "dealership", files: [] };
    },
    async enhanceForSubmit(prompt, context) {
      enhancementCalls.push({ prompt, context });
      return {
        status: "READY",
        prompt: "ENHANCED DEALERSHIP BRIEF",
        enhancedPrompt: "ENHANCED DEALERSHIP BRIEF",
        requestId: context.requestId,
        suggestedAgents: ["product", "cto", "developer", "test", "reviewer"],
        requirements: ["inventory", "posting", "booking", "admin"],
        acceptanceCriteria: ["inventory works", "posting works", "booking works", "tests pass"],
      };
    },
  };

  const session = new composerModule.ComposerSession(n8n);
  const controller = new multitaskModule.MultitaskController({ session });

  const routed = await session.submit(
    "Build a full dealership website where I can post vehicles and customers can book a viewing.",
    1,
  );

  assert.strictEqual(routed.ok, true);
  assert.strictEqual(routed.multitask, true);
  assert.strictEqual(routed.orchestrated, true);
  assert.strictEqual(enhancementCalls.length, 1);
  assert.ok(enhancementCalls[0].context.requestId.startsWith("trace_"));
  assert.strictEqual(enhancementCalls[0].context.requestId, enhancementCalls[0].context.runId);
  assert.strictEqual(controller.started.goal, "ENHANCED DEALERSHIP BRIEF");
  assert.match(controller.started.options.visibleText, /full dealership website/i);
  assert.strictEqual(controller.started.options.traceId, enhancementCalls[0].context.requestId);
  assert.strictEqual(session.originalCalls.length, 0, "large READY task must not start the direct CodeMe model loop");

  const simpleN8n = {
    workspaceContext() {
      return { rootName: "fixture", files: [] };
    },
    async enhanceForSubmit(prompt, context) {
      return {
        status: "READY",
        prompt: "Change only the heading to Hello and verify it.",
        enhancedPrompt: "Change only the heading to Hello and verify it.",
        requestId: context.requestId,
        suggestedAgents: ["developer"],
        requirements: ["Change one heading"],
        acceptanceCriteria: ["Heading reads Hello"],
      };
    },
  };

  const simpleSession = new composerModule.ComposerSession(simpleN8n);
  new multitaskModule.MultitaskController({ session: simpleSession });
  const simple = await simpleSession.submit("Change the heading to Hello", 2);
  assert.strictEqual(simple.direct, true);
  assert.strictEqual(simpleSession.originalCalls.length, 1);
  assert.strictEqual(simpleSession.originalCalls[0].options.skipEnhancement, true);
  assert.strictEqual(
    simpleSession.originalCalls[0].options.goalOverride,
    "Change only the heading to Hello and verify it.",
  );

  const directWebsiteSession = new composerModule.ComposerSession(null);
  const directWebsite = await directWebsiteSession.submit(
    "Create a responsive website for a local dealership with a strong book-a-viewing CTA.",
    3,
  );
  assert.strictEqual(directWebsite.direct, true);
  assert.strictEqual(directWebsiteSession.originalCalls.length, 1);
  assert.match(directWebsiteSession.originalCalls[0].options.goalOverride, /WEBSITE QUALITY CONTRACT/);
  assert.match(directWebsiteSession.originalCalls[0].options.goalOverride, /CSS strategy/i);
  assert.match(directWebsiteSession.originalCalls[0].options.goalOverride, /primary CTA/i);
  assert.match(directWebsiteSession.originalCalls[0].options.goalOverride, /Product Manager angle/i);
  assert.match(directWebsiteSession.originalCalls[0].options.goalOverride, /Software Architect angle/i);
  assert.match(directWebsiteSession.originalCalls[0].options.goalOverride, /Developer angle/i);

  let recursiveEnhanceCalls = 0;
  const assignedSession = new composerModule.ComposerSession({
    async enhanceForSubmit() {
      recursiveEnhanceCalls += 1;
      throw new Error("Paperclip-assigned tasks must not re-enter prompt.enrich");
    },
  });
  const paperclipController = new paperclipModule.PaperclipController(assignedSession);
  const assigned = await paperclipController.handleHeartbeat({});
  assert.strictEqual(assigned.direct, true);
  assert.strictEqual(recursiveEnhanceCalls, 0);
  assert.strictEqual(assignedSession.originalCalls[0].options.skipEnhancement, true);
  assert.strictEqual(assignedSession.originalCalls[0].options.skipPaperclip, true);

  console.log("ok prompt.enrich -> Paperclip handoff, website quality injection, simple-task bypass, trace propagation, and recursion guard");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
