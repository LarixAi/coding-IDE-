"use strict";

function listItems(body, keys = []) {
  if (Array.isArray(body)) return body;
  for (const key of keys) {
    if (body && Array.isArray(body[key])) return body[key];
  }
  return [];
}

function commentText(comment) {
  if (!comment || typeof comment !== "object") return "";
  return String(comment.body || comment.comment || comment.content || comment.text || "").trim();
}

function latestCommentText(body) {
  const comments = listItems(body, ["comments", "items", "data"]);
  if (!comments.length) return "";
  const sorted = comments.slice().sort((a, b) => {
    const left = Date.parse(a.createdAt || a.created_at || 0) || 0;
    const right = Date.parse(b.createdAt || b.created_at || 0) || 0;
    return left - right;
  });
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const value = commentText(sorted[index]);
    if (value) return value;
  }
  return "";
}

function normalizeMarkerText(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*/g, ":")
    .trim();
}

function includesMarker(text, marker) {
  return normalizeMarkerText(text).includes(normalizeMarkerText(marker));
}

function phaseTitle(parent, phase, cycle, label) {
  const identifier = String(parent.identifier || parent.id || "TASK");
  return "[team:" + identifier + ":" + phase + ":" + cycle + "] " + label;
}

function parentTaskText(parent) {
  return [
    "Parent task: " + String(parent.identifier || parent.id || ""),
    "Title: " + String(parent.title || ""),
    "",
    String(parent.description || "").trim(),
  ].join("\n").trim();
}

function needsResearch(parent, productSummary, architectureSummary) {
  const text = [
    parentTaskText(parent),
    String(productSummary || ""),
    String(architectureSummary || ""),
  ].join("\n").toLowerCase();
  return /\b(research|current|latest|up[- ]to[- ]date|documentation|docs|api version|browser compatibility|migration|published rule|github issue|npm|mdn)\b/.test(text);
}

class PaperclipTeamOrchestrator {
  constructor(options = {}) {
    if (!options.api) throw new Error("PaperclipTeamOrchestrator requires PaperclipApi");
    if (!options.agentRegistry) throw new Error("PaperclipTeamOrchestrator requires PaperclipAgentRegistry");
    this.api = options.api;
    this.agentRegistry = options.agentRegistry;
    this.dispositionRetryDelays = Array.isArray(options.dispositionRetryDelays)
      ? options.dispositionRetryDelays
      : [0, 250, 750];
    this.maxRepairCycles = Number.isInteger(options.maxRepairCycles)
      ? options.maxRepairCycles
      : 2;
    this.records = new Map();
    this.disposed = false;
  }

  configured() {
    return ["controller", "product", "cto", "research", "developer", "test", "reviewer"].every((role) => {
      const agent = this.agentRegistry.agentForRole(role);
      return Boolean(agent && agent.configured);
    });
  }

  snapshot() {
    return {
      enabled: this.configured(),
      active: [...this.records.values()]
        .filter((record) => record.status === "running")
        .map((record) => ({
          paperclipRunId: record.paperclipRunId,
          taskId: record.taskId,
          status: record.status,
          phase: record.phase,
          cycle: record.cycle,
          childIssueId: record.childIssueId || "",
        })),
    };
  }

  async handleHeartbeat(payload) {
    const request = normalizeRequest(payload);
    const existing = this.records.get(request.runId);
    if (existing) {
      return {
        ok: existing.status === "done" || existing.status === "blocked",
        duplicate: true,
        accepted: true,
        completed: existing.status !== "running",
        status: existing.status,
        taskId: existing.taskId,
        phase: existing.phase,
        childIssueId: existing.childIssueId || "",
        syncError: existing.syncError || null,
      };
    }

    if (!this.configured()) {
      const error = new Error("Paperclip team orchestration requires controller, product, architect, research, developer, test, and reviewer identities");
      error.code = "paperclip_team_incomplete";
      error.statusCode = 503;
      throw error;
    }

    const identity = this.agentRegistry.resolve(request.agentId);
    if (identity.role.key !== "controller") {
      const error = new Error("Only the CodeMe Controller may start a team orchestration run");
      error.code = "paperclip_orchestrator_wrong_role";
      error.statusCode = 403;
      throw error;
    }

    const parent = await this.api.getIssue(request.taskId);
    const companyId = String(parent.companyId || request.companyId || "").trim();
    if (!companyId) {
      const error = new Error("Paperclip parent issue is missing companyId");
      error.code = "paperclip_company_missing";
      error.statusCode = 400;
      throw error;
    }

    await this.api.checkout({
      issueId: request.taskId,
      agentId: request.agentId,
      runId: request.runId,
    });

    let resolveCompletion;
    const completion = new Promise((resolve) => { resolveCompletion = resolve; });
    const record = {
      paperclipRunId: request.runId,
      agentId: request.agentId,
      companyId,
      taskId: request.taskId,
      status: "running",
      phase: "product",
      cycle: 0,
      childIssueId: "",
      startedAt: Date.now(),
      completion,
      resolveCompletion,
      completionResolved: false,
      syncError: null,
    };
    this.records.set(request.runId, record);

    let result;
    try {
      result = await this.advance(record, parent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const blockerIds = record.childIssueId ? [record.childIssueId] : undefined;
      if (blockerIds && blockerIds.length) {
        await this.finishParent(
          record,
          "blocked",
          "CodeMe team orchestration stopped while waiting on " + record.phase + ": " + message,
          blockerIds,
        );
        result = {
          ok: false,
          accepted: true,
          completed: true,
          status: record.status,
          taskId: record.taskId,
          phase: record.phase,
          reason: message,
          childIssueId: record.childIssueId || "",
          syncError: record.syncError || null,
        };
      } else {
        record.status = "sync_failed";
        record.syncError = message;
        result = {
          ok: false,
          accepted: true,
          completed: true,
          status: "sync_failed",
          taskId: record.taskId,
          phase: record.phase,
          reason: message,
          childIssueId: "",
          syncError: message,
        };
      }
    }

    this.resolveRecord(record, result);
    return result;
  }

  async waitForCompletion(runId) {
    const record = this.records.get(String(runId || ""));
    if (!record) {
      const error = new Error("Unknown Paperclip team run");
      error.code = "paperclip_team_run_not_found";
      error.statusCode = 404;
      throw error;
    }
    if (record.status !== "running") {
      return {
        ok: record.status === "done" || record.status === "blocked",
        accepted: true,
        completed: true,
        status: record.status,
        taskId: record.taskId,
        phase: record.phase,
        childIssueId: record.childIssueId || "",
        syncError: record.syncError || null,
      };
    }
    return record.completion;
  }

  async advance(record, parent) {
    if (this.disposed) throw new Error("Paperclip team orchestrator was disposed");

    const product = await this.ensurePhase({
      record,
      parent,
      role: "product",
      phase: "product",
      cycle: 0,
      label: "Product definition",
      description: [
        parentTaskText(parent),
        "",
        "You are the Product Manager for this parent task.",
        "Define the user outcome, bounded requirements, acceptance criteria, non-goals, ambiguities, and priority.",
        "Do not choose implementation files, frameworks, libraries, or architecture unless the parent task explicitly constrains them.",
        "Do not edit source files.",
        "End the final response with exactly: PRODUCT: READY",
      ].join("\n"),
    });
    if (product.waiting) return product.result;
    this.requireDone(product, "Product Manager");
    if (!includesMarker(product.summary, "PRODUCT: READY")) {
      throw new Error("Product Manager did not produce PRODUCT: READY");
    }

    const productBrief = product.summary;

    const cto = await this.ensurePhase({
      record,
      parent,
      role: "cto",
      phase: "cto",
      cycle: 0,
      label: "CTO plan",
      description: [
        parentTaskText(parent),
        "",
        "Product requirements:",
        productBrief || "(No product brief was available.)",
        "",
        "You are the Software Architect planning this parent task.",
        "Inspect the current CodeMe workspace as needed, but do not edit source files.",
        "Produce a bounded technical plan: runtime path, likely files/components, dependencies, risks, implementation steps, and verification strategy for the Developer.",
        "Treat actual runtime evidence as stronger than a file-name or framework assumption.",
        "Do not implement the task.",
        "End the final response with exactly: PLAN: READY",
      ].join("\n"),
    });
    if (cto.waiting) return cto.result;
    this.requireDone(cto, "CTO");

    const plan = cto.summary;

    let researchSummary = "";
    if (needsResearch(parent, productBrief, plan)) {
      const research = await this.ensurePhase({
        record,
        parent,
        role: "research",
        phase: "research",
        cycle: 0,
        label: "Research evidence",
        description: [
          parentTaskText(parent),
          "",
          "Product requirements:",
          productBrief || "(No product brief was available.)",
          "",
          "Architecture plan:",
          plan || "(No architecture plan was available.)",
          "",
          "Research only the current or external facts needed by this task.",
          "Use CodeMe/n8n research capabilities when available. Do not edit source files.",
          "Return concise evidence and implementation implications.",
          "End the final response with exactly: RESEARCH: READY",
        ].join("\n"),
      });
      if (research.waiting) return research.result;
      this.requireDone(research, "Research");
      if (!includesMarker(research.summary, "RESEARCH: READY")) {
        throw new Error("Research did not produce RESEARCH: READY");
      }
      researchSummary = research.summary;
    }

    let repairContext = "";

    for (let cycle = 0; cycle <= this.maxRepairCycles; cycle += 1) {
      record.cycle = cycle;
      const developerPhase = cycle === 0 ? "developer" : "developer-repair";
      const developer = await this.ensurePhase({
        record,
        parent,
        role: "developer",
        phase: developerPhase,
        cycle,
        label: cycle === 0 ? "Developer implementation" : "Developer repair",
        description: [
          parentTaskText(parent),
          "",
          "Product requirements:",
          productBrief || "(No Product Manager comment was available.)",
          "",
          "Architecture plan/evidence:",
          plan || "(No Software Architect comment was available; re-inspect the workspace before editing.)",
          researchSummary ? "\nResearch evidence:\n" + researchSummary : "",
          repairContext ? "\nRepair evidence from Test/Reviewer:\n" + repairContext : "",
          "",
          cycle === 0
            ? "Implement only the parent task."
            : "Repair only the failures identified above. Do not widen scope.",
          "Use the smallest sufficient change.",
          "Before completion, inspect the final working-tree diff and justify why every modified file is required by the actual runtime path for this task.",
          "If the same visible result is implemented in both an active runtime file and an unused, duplicate, superseded, or parallel file, revert the unnecessary file instead of keeping both for consistency.",
          "If Test or Reviewer names a redundant or unproven file during a repair cycle, remove that unnecessary change rather than widening the implementation.",
          "If an earlier file edit was based on a disproved hypothesis and is no longer needed, revert that unnecessary edit before completion.",
          "Run relevant verification before finishing.",
          "End the final response with exactly: DEV: COMPLETE",
        ].filter(Boolean).join("\n"),
      });
      if (developer.waiting) return developer.result;
      this.requireDone(developer, "Developer");

      const test = await this.ensurePhase({
        record,
        parent,
        role: "test",
        phase: "test",
        cycle,
        label: "Test verification",
        description: [
          parentTaskText(parent),
          "",
          "Developer completion evidence:",
          developer.summary || "(No developer comment was available.)",
          "",
          "Verify the requested behaviour independently.",
          "Do not edit, patch, create, or delete source files.",
          "Use diagnostics, tests, source/config reads, the CodeMe-owned preview process, and real browser verification where applicable.",
          "Identify the actual runtime/served path that produces the verified behaviour. Trace the entrypoint, server/static configuration, imports, or equivalent evidence rather than assuming every similarly named file is active.",
          "Enumerate every modified file in the working tree and classify each one as REQUIRED or UNPROVEN/REDUNDANT for the requested runtime behaviour.",
          "A file merely containing the expected text is not proof that the file is required. Browser success proves the outcome, but does not by itself prove that every modified file is necessary.",
          "If any modified file cannot be causally tied to the actual runtime path or requested scope, verification fails. Name the exact file and why it is unnecessary or unproven.",
          "In the final response include a concise RUNTIME PATH section and FILE NECESSITY section.",
          "Only if the requested behaviour is proven and every modified file is necessary may you end with exactly: TEST: PASS",
          "Otherwise end the final response with: TEST: FAIL - <specific reason>",
        ].join("\n"),
      });
      if (test.waiting) return test.result;
      this.requireDone(test, "Test");

      if (!includesMarker(test.summary, "TEST: PASS")) {
        if (cycle >= this.maxRepairCycles) {
          throw new Error(
            "Test did not produce TEST: PASS after "
            + (cycle + 1)
            + " attempt(s). Last evidence: "
            + compact(test.summary),
          );
        }
        repairContext = test.summary || "Test did not report a pass.";
        continue;
      }

      const reviewer = await this.ensurePhase({
        record,
        parent,
        role: "reviewer",
        phase: "reviewer",
        cycle,
        label: "Reviewer approval",
        description: [
          parentTaskText(parent),
          "",
          "Product requirements:",
          productBrief || "(No Product Manager comment was available.)",
          "",
          "Architecture plan/evidence:",
          plan || "(No Software Architect comment was available.)",
          researchSummary ? "\nResearch evidence:\n" + researchSummary : "",
          "",
          "Developer evidence:",
          developer.summary || "(No developer comment was available.)",
          "",
          "Test evidence:",
          test.summary || "(No test comment was available.)",
          "",
          "Review the working-tree diff, requested scope, diagnostics, and verification evidence independently. Do not accept the Test Agent's conclusion without checking its evidence.",
          "Do not edit or silently repair source files.",
          "Identify the actual runtime/served path for the requested behaviour and inspect every modified file.",
          "For every modified file, require a causal justification showing why that file is necessary for the requested runtime result. Matching text, duplicated content, or a broad claim that a file is related to the feature is not sufficient.",
          "Reject unrelated, duplicate, superseded, non-executed, parallel-copy, or otherwise unverified changes even when the browser result is correct.",
          "If one active runtime file is sufficient and another modified file is not loaded or executed for this task, require the redundant change to be reverted.",
          "In the final response include a concise FILE JUSTIFICATION section covering every modified file.",
          "Approve only when every modified file is necessary, the requested behaviour is verified, and no unrelated or redundant edits remain.",
          "If those conditions are satisfied, end the final response with exactly: REVIEW: APPROVED",
          "Otherwise end with: REVIEW: CHANGES_REQUIRED - <specific reason>",
        ].join("\n"),
      });
      if (reviewer.waiting) return reviewer.result;
      this.requireDone(reviewer, "Reviewer");

      if (includesMarker(reviewer.summary, "REVIEW: APPROVED")) {
        record.phase = "complete";
        await this.finishParent(
          record,
          "done",
          [
            "CodeMe team completed the parent task.",
            "",
            "Product Manager: requirements completed.",
            "Software Architect: plan completed.",
            researchSummary ? "Research: evidence completed." : "Research: not required.",
            "Developer: implementation completed.",
            "Test: TEST: PASS.",
            "Reviewer: REVIEW: APPROVED.",
            "Repair cycles: " + cycle + ".",
          ].join("\n"),
          [],
        );
        return {
          ok: record.status === "done",
          accepted: true,
          completed: true,
          status: record.status,
          taskId: record.taskId,
          phase: "complete",
          repairCycles: cycle,
          childIssueId: "",
          syncError: record.syncError || null,
        };
      }

      if (cycle >= this.maxRepairCycles) {
        throw new Error(
          "Reviewer did not approve after "
          + (cycle + 1)
          + " review attempt(s). Last evidence: "
          + compact(reviewer.summary),
        );
      }

      repairContext = reviewer.summary || "Reviewer requested changes.";
    }

    throw new Error("Team workflow exceeded its repair-cycle limit");
  }

  async ensurePhase({ record, parent, role, phase, cycle, label, description }) {
    const agent = this.agentRegistry.agentForRole(role);
    if (!agent || !agent.agentId) throw new Error("No Paperclip agent is registered for role " + role);

    const title = phaseTitle(parent, phase, cycle, label);
    record.phase = phase;
    record.cycle = cycle;

    let child = await this.findChild(record.companyId, parent.id, title);
    if (!child) {
      child = await this.api.createIssue({
        companyId: record.companyId,
        runId: record.paperclipRunId,
        issue: {
          title,
          description,
          status: "todo",
          priority: parent.priority || "medium",
          assigneeAgentId: agent.agentId,
          parentId: parent.id,
          projectId: parent.projectId || undefined,
          goalId: parent.goalId || undefined,
        },
      });
    } else {
      child = await this.api.getIssue(child.id);
    }

    record.childIssueId = String(child.id || "");
    const status = String(child.status || "");

    if (status !== "done") {
      const childLabel = String(child.identifier || child.id || title);
      await this.finishParent(
        record,
        "blocked",
        [
          "CodeMe team phase " + phase + " is delegated to " + agent.role.label + ": " + childLabel + ".",
          "The parent is intentionally parked behind this child so the HTTP heartbeat can finish safely.",
          "Paperclip should wake the Controller again when this blocker reaches done.",
        ].join("\n"),
        [child.id],
      );
      return {
        waiting: true,
        issue: child,
        summary: "",
        status,
        result: {
          ok: record.status === "blocked",
          accepted: true,
          completed: true,
          status: record.status,
          taskId: record.taskId,
          phase,
          cycle,
          waitingFor: childLabel,
          childIssueId: child.id,
          syncError: record.syncError || null,
        },
      };
    }

    const comments = await this.api.getIssueComments(child.id);
    return {
      waiting: false,
      issue: child,
      summary: latestCommentText(comments),
      status,
    };
  }

  async findChild(companyId, parentId, title) {
    const query = title.replace(/^\[|\].*$/g, "").trim() || title;
    const body = await this.api.listIssues({ companyId, query });
    const issues = listItems(body, ["issues", "items", "data"]);
    return issues.find((issue) => (
      String(issue.parentId || "") === String(parentId || "")
      && String(issue.title || "") === String(title || "")
    )) || null;
  }

  requireDone(result, label) {
    if (result.status === "done") return;
    throw new Error(label + " phase ended with status " + result.status + ". Evidence: " + compact(result.summary));
  }

  async syncParentDisposition(record, status, comment, blockedByIssueIds) {
    let lastError = null;
    for (let index = 0; index < this.dispositionRetryDelays.length; index += 1) {
      const delayMs = Number(this.dispositionRetryDelays[index] || 0);
      if (delayMs > 0) await delay(delayMs);
      try {
        const receipt = await this.api.updateIssue({
          issueId: record.taskId,
          runId: record.paperclipRunId,
          status,
          comment,
          ...(blockedByIssueIds !== undefined ? { blockedByIssueIds } : {}),
        });
        if (
          receipt
          && typeof receipt === "object"
          && receipt.status
          && String(receipt.status) !== String(status)
        ) {
          const error = new Error(
            "Paperclip parent disposition write returned status "
            + receipt.status
            + " instead of "
            + status,
          );
          error.code = "paperclip_parent_disposition_not_committed";
          throw error;
        }
        if (
          blockedByIssueIds !== undefined
          && receipt
          && typeof receipt === "object"
          && Array.isArray(receipt.blockedByIssueIds)
        ) {
          const expected = blockedByIssueIds.map(String).sort();
          const actual = receipt.blockedByIssueIds.map(String).sort();
          if (JSON.stringify(expected) !== JSON.stringify(actual)) {
            const error = new Error("Paperclip parent blocker relation did not commit as requested");
            error.code = "paperclip_parent_blocker_relation_not_committed";
            throw error;
          }
        }
        record.lastSyncError = "";
        return receipt;
      } catch (error) {
        lastError = error;
        record.lastSyncError = error instanceof Error ? error.message : String(error);
      }
    }

    const wrapped = new Error(
      "Paperclip could not persist the parent issue disposition after "
      + this.dispositionRetryDelays.length
      + " attempt(s): "
      + (lastError instanceof Error ? lastError.message : String(lastError || "unknown error")),
    );
    wrapped.code = "paperclip_parent_disposition_sync_failed";
    wrapped.statusCode = 502;
    throw wrapped;
  }

  async finishParent(record, status, comment, blockedByIssueIds) {
    try {
      await this.syncParentDisposition(record, status, comment, blockedByIssueIds);
      record.status = status;
      record.syncError = null;
    } catch (error) {
      record.status = "sync_failed";
      record.syncError = error instanceof Error ? error.message : String(error);
    }
  }

  resolveRecord(record, value) {
    if (!record || record.completionResolved) return;
    record.completionResolved = true;
    try { record.resolveCompletion(value); } catch {}
  }

  dispose() {
    this.disposed = true;
  }
}

function normalizeRequest(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const context = body.context && typeof body.context === "object" ? body.context : {};
  const runId = String(body.runId || "").trim();
  const agentId = String(body.agentId || "").trim();
  const companyId = String(body.companyId || context.companyId || "").trim();
  const taskId = String(context.taskId || body.taskId || "").trim();
  if (!runId || !agentId || !taskId) {
    const error = new Error("Paperclip team heartbeat requires runId, agentId, and context.taskId");
    error.code = "invalid_heartbeat";
    error.statusCode = 400;
    throw error;
  }
  return { runId, agentId, companyId, taskId, context };
}

function compact(value, limit = 600) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "(no summary)";
  return text.length > limit ? text.slice(0, limit) + "…" : text;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  PaperclipTeamOrchestrator,
  compact,
  includesMarker,
  latestCommentText,
  listItems,
  phaseTitle,
};
