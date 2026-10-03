"use strict";

const crypto = require("crypto");

function messageForResult(result) {
  if (result && result.ok && result.status === "done") {
    return [
      "Multitask complete.",
      "",
      "Product requirements, architecture, implementation, independent test and final review all completed through the Paperclip team.",
      result.repairCycles ? "Repair cycles: " + String(result.repairCycles) + "." : "",
    ].filter(Boolean).join("\n");
  }
  const phase = String(result && result.phase || "team");
  const reason = String(result && (result.reason || result.syncError) || "The team did not reach verified completion.");
  return "Multitask stopped during " + phase + ": " + reason;
}

class MultitaskController {
  constructor(options = {}) {
    if (!options.session) throw new Error("MultitaskController requires a ComposerSession");
    if (!options.paperclip) throw new Error("MultitaskController requires a PaperclipBridge");
    this.session = options.session;
    this.paperclip = options.paperclip;
    this.onChange = options.onChange || (() => {});
    this.current = null;
  }

  snapshot() {
    if (!this.current) return { active: false, phase: "", status: "", requestId: "", runId: "", taskId: "" };
    return {
      active: Boolean(this.current.active),
      phase: this.current.phase || "",
      status: this.current.status || "",
      requestId: this.current.requestId || "",
      runId: this.current.runId || "",
      taskId: this.current.taskId || "",
      childIssueId: this.current.childIssueId || "",
      error: this.current.error || "",
    };
  }

  emit() {
    this.onChange(this.snapshot());
  }

  start(text, epoch, options = {}) {
    const goal = String(text || "").trim();
    if (!goal) return { ok: false, code: "empty", message: "Enter a message first." };
    if (this.current && this.current.active) {
      return { ok: false, code: "multitask_busy", message: "A Multitask team run is already active." };
    }
    if (this.session.running) {
      return { ok: false, code: "busy", message: "Stop the current CodeMe run before starting Multitask." };
    }

    const paperclipState = this.paperclip && typeof this.paperclip.status === "function"
      ? this.paperclip.status()
      : null;
    const orchestrationReady = Boolean(
      paperclipState
      && paperclipState.enabled
      && paperclipState.configured
      && paperclipState.started
      && paperclipState.companyIdConfigured
      && paperclipState.orchestration
      && paperclipState.orchestration.enabled
    );
    if (!orchestrationReady) {
      return {
        ok: false,
        code: "multitask_unavailable",
        message: "Multitask requires Paperclip online, PAPERCLIP_COMPANY_ID configured, and the complete seven-role team ready.",
      };
    }

    const requestId = String(options.requestId || "").trim() || ("multitask_" + crypto.randomBytes(8).toString("hex"));
    const visibleText = String(options.visibleText || goal).trim() || goal;
    const returnMode = String(options.returnMode || "").trim();
    this.session.recordUserMessage(visibleText);
    this.current = {
      active: true,
      cancelled: false,
      requestId,
      runId: requestId,
      taskId: "",
      childIssueId: "",
      phase: "product",
      status: "starting",
      error: "",
      epoch: Number.isFinite(Number(epoch)) ? Number(epoch) : 0,
    };
    this.emit();

    Promise.resolve().then(async () => {
      try {
        const result = await this.paperclip.submitUserTask(goal, {
          traceId: String(options.traceId || requestId).trim() || requestId,
          source: String(options.source || "").trim(),
          isCancelled: () => Boolean(this.current && this.current.cancelled),
          onProgress: (progress) => {
            if (!this.current || this.current.requestId !== requestId) return;
            this.current.phase = String(progress && progress.phase || this.current.phase || "team");
            this.current.status = String(progress && progress.status || "running");
            this.current.runId = String(progress && progress.runId || this.current.runId || requestId);
            this.current.taskId = String(progress && progress.taskId || this.current.taskId || "");
            this.current.childIssueId = String(progress && progress.childIssueId || "");
            this.emit();
          },
        });

        if (!this.current || this.current.requestId !== requestId) return;
        this.current.active = false;
        this.current.phase = String(result && result.phase || this.current.phase || "complete");
        this.current.status = String(result && result.status || (result && result.ok ? "done" : "blocked"));
        this.current.runId = String(result && result.runId || this.current.runId || requestId);
        this.current.taskId = String(result && result.taskId || this.current.taskId || "");
        this.session.selectMode(returnMode || "multitask");
        this.session.recordAssistantMessage(messageForResult(result), this.current.runId);
        this.emit();
      } catch (error) {
        if (!this.current || this.current.requestId !== requestId) return;
        const message = error instanceof Error ? error.message : String(error);
        this.current.active = false;
        this.current.status = this.current.cancelled ? "cancelled" : "failed";
        this.current.error = message;
        this.session.selectMode(returnMode || "multitask");
        this.session.recordAssistantMessage(
          this.current.cancelled ? "Multitask stopped." : "Multitask failed: " + message,
          this.current.runId,
        );
        this.emit();
      }
    });

    return {
      ok: true,
      requestId,
      runId: requestId,
      conversationId: this.session.conversationId || "",
      multitask: true,
      orchestrated: Boolean(options.source),
      source: String(options.source || ""),
      mode: options.mode || "read_only",
      composerMode: options.composerMode || "multitask",
    };
  }

  cancel() {
    if (!this.current || !this.current.active) return { ok: false, code: "not_running" };
    this.current.cancelled = true;
    this.current.status = "cancelling";
    this.emit();
    return { ok: true };
  }
}

module.exports = { MultitaskController, messageForResult };
