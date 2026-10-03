"use strict";

const crypto = require("crypto");
const { formatGoal } = require("./composer-client");
const {
  isWebsiteBuildGoal,
  websiteQualityContract,
} = require("../../packages/agent-runtime/website-quality");

function reject(code, message) {
  return { ok: false, code, message };
}

function shouldRouteToPaperclip(composerMode, originalGoal, decision) {
  if (String(composerMode || "").toLowerCase() !== "code") return false;
  if (!decision || String(decision.status || "").toUpperCase() !== "READY") return false;

  const agents = Array.isArray(decision.suggestedAgents) ? decision.suggestedAgents.filter(Boolean) : [];
  const requirements = Array.isArray(decision.requirements) ? decision.requirements.filter(Boolean) : [];
  const criteria = Array.isArray(decision.acceptanceCriteria) ? decision.acceptanceCriteria.filter(Boolean) : [];
  const goal = String(originalGoal || "");

  const broadBuild =
    /\b(build|create|develop|implement|scaffold)\b[\s\S]{0,120}\b(full[- ]?stack|website|web app|application|system|platform|portal|dashboard)\b/i.test(goal)
    || /\b(full|complete|end[- ]?to[- ]?end)\b[\s\S]{0,80}\b(website|web app|application|system|platform|stack)\b/i.test(goal);

  return broadBuild
    || agents.length >= 2
    || requirements.length >= 4
    || criteria.length >= 4;
}

function installPromptPaperclipHandoff(options = {}) {
  const composerModule = options.composerModule || require("./composer-session");
  const multitaskModule = options.multitaskModule || require("./multitask-controller");
  const paperclipModule = options.paperclipModule || require("../../packages/paperclip-control");
  const ComposerSession = composerModule.ComposerSession;
  const BaseMultitaskController = multitaskModule.MultitaskController;
  const PaperclipController = paperclipModule.PaperclipController;

  if (!ComposerSession || !BaseMultitaskController || !PaperclipController) {
    throw new Error("Prompt/Paperclip handoff dependencies are unavailable.");
  }

  if (!BaseMultitaskController.__codemeAutoHandoffWrapped) {
    class RegisteredMultitaskController extends BaseMultitaskController {
      constructor(controllerOptions = {}) {
        super(controllerOptions);
        if (controllerOptions.session) {
          controllerOptions.session.__codemeMultitaskController = this;
        }
      }
    }
    RegisteredMultitaskController.__codemeAutoHandoffWrapped = true;
    multitaskModule.MultitaskController = RegisteredMultitaskController;
  }

  if (!PaperclipController.prototype.__codemeAutoHandoffWrapped) {
    const originalHeartbeat = PaperclipController.prototype.handleHeartbeat;
    PaperclipController.prototype.handleHeartbeat = async function patchedHeartbeat(payload) {
      const session = this.session;
      if (session) {
        session.__codemePaperclipAssignedDepth = Number(session.__codemePaperclipAssignedDepth || 0) + 1;
      }
      try {
        return await originalHeartbeat.call(this, payload);
      } finally {
        if (session) {
          session.__codemePaperclipAssignedDepth = Math.max(
            0,
            Number(session.__codemePaperclipAssignedDepth || 1) - 1,
          );
        }
      }
    };
    PaperclipController.prototype.__codemeAutoHandoffWrapped = true;
  }

  if (ComposerSession.prototype.__codemeAutoHandoffWrapped) return;

  const originalSubmit = ComposerSession.prototype.submit;
  const originalSubmitClarification = ComposerSession.prototype.submitClarification;

  ComposerSession.prototype.submitClarification = async function patchedSubmitClarification(...args) {
    const pending = this.clarification;
    const traceId = String(pending && pending.traceId || this.requestId || "").trim();
    const originalPrompt = String(pending && pending.originalPrompt || "").trim();
    const n8n = this.n8n;

    if (!n8n || typeof n8n.enhanceForSubmit !== "function") {
      return originalSubmitClarification.apply(this, args);
    }

    const originalEnhance = n8n.enhanceForSubmit;
    this.__codemeEnhancementTraceId = traceId;
    this.__codemeOriginalPromptForHandoff = originalPrompt;

    n8n.enhanceForSubmit = async (...enhanceArgs) => {
      const decision = await originalEnhance.apply(n8n, enhanceArgs);
      this.__codemeCapturedEnhancementDecision = decision || null;
      return decision;
    };

    try {
      return await originalSubmitClarification.apply(this, args);
    } finally {
      n8n.enhanceForSubmit = originalEnhance;
      this.__codemeEnhancementTraceId = "";
      this.__codemeOriginalPromptForHandoff = "";
      this.__codemeCapturedEnhancementDecision = null;
    }
  };

  ComposerSession.prototype.submit = async function patchedSubmit(text, epoch, submitOptions = {}) {
    const optionsForRun = submitOptions && typeof submitOptions === "object" ? { ...submitOptions } : {};

    if (Number(this.__codemePaperclipAssignedDepth || 0) > 0) {
      return originalSubmit.call(this, text, epoch, {
        ...optionsForRun,
        skipEnhancement: true,
        skipPaperclip: true,
      });
    }

    const originalGoal = formatGoal(text, this.attachments);
    if (!originalGoal.trim()) return reject("empty", "Enter a message first.");

    const visibleText = String(text || "").trim() || originalGoal;

    // Preserve the existing follow-up and clarification behavior. The
    // clarification wrapper captures the READY decision before the original
    // method re-enters submit with skipEnhancement=true.
    if (this.running || (this.clarification && !optionsForRun.resumeFromClarification)) {
      return originalSubmit.call(this, text, epoch, optionsForRun);
    }

    if (optionsForRun.skipEnhancement) {
      const decision = optionsForRun.enhancementDecision || this.__codemeCapturedEnhancementDecision || null;
      const traceId = String(
        optionsForRun.enhancementTraceId
        || this.__codemeEnhancementTraceId
        || (decision && decision.requestId)
        || "",
      ).trim();
      const routeGoal = String(
        optionsForRun.originalGoal
        || this.__codemeOriginalPromptForHandoff
        || originalGoal,
      ).trim();

      const routeToPaperclip = !optionsForRun.skipPaperclip
        && shouldRouteToPaperclip(this.composerMode, routeGoal, decision);

      if (routeToPaperclip) {
        const controller = this.__codemeMultitaskController;
        if (!controller || typeof controller.start !== "function") {
          return reject(
            "paperclip_unavailable",
            "This task needs Paperclip orchestration, but the Paperclip controller is not ready.",
          );
        }

        const result = controller.start(
          String(optionsForRun.goalOverride || originalGoal).trim(),
          epoch,
          {
            visibleText,
            requestId: traceId || undefined,
            traceId: traceId || undefined,
            returnMode: this.composerMode,
            composerMode: this.composerMode,
            mode: this.mode,
            source: "prompt.enrich",
          },
        );

        return result;
      }

      return originalSubmit.call(this, text, epoch, optionsForRun);
    }

    if (!this.n8n || typeof this.n8n.enhanceForSubmit !== "function") {
      if (String(this.composerMode || "").toLowerCase() === "code" && isWebsiteBuildGoal(originalGoal)) {
        return originalSubmit.call(this, text, epoch, {
          ...optionsForRun,
          goalOverride: [originalGoal, websiteQualityContract()].join("\n\n"),
        });
      }
      return originalSubmit.call(this, text, epoch, optionsForRun);
    }

    const traceId = "trace_" + crypto.randomBytes(8).toString("hex");
    let decision;
    try {
      decision = await this.n8n.enhanceForSubmit(originalGoal, {
        conversation: this.thread,
        workspace: typeof this.n8n.workspaceContext === "function"
          ? this.n8n.workspaceContext(this.root)
          : {},
        mode: this.composerMode,
        projectId: this.root ? require("path").basename(this.root) : null,
        conversationId: this.conversationId || null,
        taskId: traceId,
        requestId: traceId,
        runId: traceId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notice = "Prompt enhancement failed: " + message;
      this.emit();
      return reject(
        error && error.code ? String(error.code) : "prompt_enhancement_failed",
        message,
      );
    }

    if (decision && decision.status === "NEEDS_CLARIFICATION") {
      const result = this.beginClarification(originalGoal, visibleText, decision, epoch);
      if (this.clarification) this.clarification.traceId = traceId;
      this.emit();
      return result;
    }

    if (decision && decision.status === "NEEDS_RESEARCH") {
      return this.beginResearchStop(originalGoal, visibleText, decision, epoch);
    }

    if (decision && decision.status === "READY") {
      const enhanced = String(decision.prompt || decision.enhancedPrompt || "").trim();
      if (!enhanced) {
        return reject(
          "prompt_enhancement_invalid",
          "Prompt enhancement marked the task READY without an enhanced prompt.",
        );
      }

      return this.submit(visibleText, epoch, {
        ...optionsForRun,
        skipEnhancement: true,
        goalOverride: enhanced,
        originalGoal,
        enhancementDecision: decision,
        enhancementTraceId: String(decision.requestId || traceId),
      });
    }

    if (decision && decision.status === "DISABLED") {
      return originalSubmit.call(this, text, epoch, {
        ...optionsForRun,
        skipEnhancement: true,
      });
    }

    return reject(
      "prompt_enhancement_invalid",
      "Prompt enhancement returned an unsupported state.",
    );
  };

  ComposerSession.prototype.__codemeAutoHandoffWrapped = true;
}

module.exports = {
  installPromptPaperclipHandoff,
  shouldRouteToPaperclip,
};
