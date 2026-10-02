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
    const text = commentText(sorted[index]);
    if (text) return text;
  }
  return "";
}

function includesMarker(text, marker) {
  return String(text || "").toUpperCase().includes(String(marker || "").toUpperCase());
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

class PaperclipTeamOrchestrator {
  constructor(options = {}) {
    if (!options.api) throw new Error("PaperclipTeamOrchestrator requires PaperclipApi");
    if (!options.agentRegistry) throw new Error("PaperclipTeamOrchestrator requires PaperclipAgentRegistry");
    this.api = options.api;
    this.agentRegistry = options.agentRegistry;
    this.pollMs = Number(options.pollMs || 1000);
    this.maxChildMs = Number(options.maxChildMs || 30 * 60 * 1000);
    this.maxWorkflowMs = Number(options.maxWorkflowMs || 60 * 60 * 1000);
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
    return ["controller", "cto", "developer", "test", "reviewer"].every((role) => {
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
        ok: true,
        duplicate: true,
        accepted: true,
        status: existing.status,
        taskId: existing.taskId,
        phase: existing.phase,
      };
    }

    if (!this.configured()) {
      const error = new Error("Paperclip team orchestration requires controller, CTO, developer, test, and reviewer identities");
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
      phase: "cto",
      cycle: 0,
      childIssueId: "",
      startedAt: Date.now(),
      completion,
      resolveCompletion,
      completionResolved: false,
    };
    this.records.set(request.runId, record);

    await this.safeParentUpdate(
      record,
      "in_progress",
      "CodeMe team orchestration started. The Controller will coordinate CTO planning, Developer implementation, Test verification, and Reviewer approval before completing this parent task.",
    );

    this.run(record, parent).catch(async (error) => {
      if (record.status !== "running") return;
      const message = error instanceof Error ? error.message : String(error);
      await this.finishParent(
        record,
        "blocked",
        "CodeMe team orchestration stopped: " + message,
      );
      this.resolveRecord(record, {
        ok: false,
        accepted: true,
        completed: true,
        status: record.status,
        taskId: record.taskId,
        phase: record.phase,
        reason: message,
        syncError: record.syncError || null,
      });
    });

    return {
      ok: true,
      accepted: true,
      status: "running",
      taskId: request.taskId,
      phase: record.phase,
      teamOrchestration: true,
    };
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
        ok: record.status === "done",
        accepted: true,
        completed: true,
        status: record.status,
        taskId: record.taskId,
        phase: record.phase,
      };
    }
    return record.completion;
  }

  async run(record, parent) {
    const deadline = record.startedAt + this.maxWorkflowMs;

    record.phase = "cto";
    record.cycle = 0;
    const cto = await this.runPhase({
      record,
      parent,
      role: "cto",
      phase: "cto",
      cycle: 0,
      label: "CTO plan",
      description: [
        parentTaskText(parent),
        "",
        "You are the CTO planning this parent task.",
        "Inspect the current CodeMe workspace as needed, but do not edit source files.",
        "Produce a bounded technical plan: likely files/components, risks, acceptance criteria, and concrete implementation steps for the Developer.",
        "Do not implement the task.",
        "End the final response with exactly: PLAN: READY",
      ].join("\n"),
      deadline,
    });
    this.requireDone(cto, "CTO");

    const plan = cto.summary;
    let cycle = 0;
    let repairContext = "";

    while (cycle <= this.maxRepairCycles) {
      record.phase = cycle === 0 ? "developer" : "developer-repair";
      record.cycle = cycle;
      const developer = await this.runPhase({
        record,
        parent,
        role: "developer",
        phase: cycle === 0 ? "developer" : "developer-repair",
        cycle,
        label: cycle === 0 ? "Developer implementation" : "Developer repair",
        description: [
          parentTaskText(parent),
          "",
          "CTO plan/evidence:",
          plan || "(No CTO comment was available; re-inspect the workspace before editing.)",
          repairContext ? "\nRepair evidence from Test/Reviewer:\n" + repairContext : "",
          "",
          cycle === 0
            ? "Implement only the parent task."
            : "Repair only the failures identified above. Do not widen scope.",
          "Use the smallest sufficient change.",
          "If an earlier file edit was based on a disproved hypothesis and is no longer needed, revert that unnecessary edit before completion.",
          "Run relevant verification before finishing.",
          "End the final response with exactly: DEV: COMPLETE",
        ].filter(Boolean).join("\n"),
        deadline,
      });
      this.requireDone(developer, "Developer");

      record.phase = "test";
      const test = await this.runPhase({
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
          "Use diagnostics, tests, the CodeMe-owned preview process, and real browser verification where applicable.",
          "If the behaviour is proven correct, end the final response with exactly: TEST: PASS",
          "If verification fails, end the final response with: TEST: FAIL - <specific reason>",
        ].join("\n"),
        deadline,
      });
      this.requireDone(test, "Test");

      if (!includesMarker(test.summary, "TEST: PASS")) {
        if (cycle >= this.maxRepairCycles) {
          throw new Error("Test did not produce TEST: PASS after " + (cycle + 1) + " attempt(s). Last evidence: " + compact(test.summary));
        }
        repairContext = test.summary || "Test did not report a pass.";
        cycle += 1;
        continue;
      }

      record.phase = "reviewer";
      const reviewer = await this.runPhase({
        record,
        parent,
        role: "reviewer",
        phase: "reviewer",
        cycle,
        label: "Reviewer approval",
        description: [
          parentTaskText(parent),
          "",
          "CTO plan/evidence:",
          plan || "(No CTO comment was available.)",
          "",
          "Developer evidence:",
          developer.summary || "(No developer comment was available.)",
          "",
          "Test evidence:",
          test.summary || "(No test comment was available.)",
          "",
          "Review the working-tree diff, requested scope, diagnostics, and verification evidence.",
          "Do not edit or silently repair source files.",
          "Reject unrelated, duplicate, superseded, or unverified changes.",
          "If the change is clean and supported by evidence, end the final response with exactly: REVIEW: APPROVED",
          "Otherwise end with: REVIEW: CHANGES_REQUIRED - <specific reason>",
        ].join("\n"),
        deadline,
      });
      this.requireDone(reviewer, "Reviewer");

      if (includesMarker(reviewer.summary, "REVIEW: APPROVED")) {
        record.phase = "complete";
        await this.finishParent(
          record,
          "done",
          [
            "CodeMe team completed the parent task.",
            "",
            "CTO: plan completed.",
            "Developer: implementation completed.",
            "Test: TEST: PASS.",
            "Reviewer: REVIEW: APPROVED.",
            "Repair cycles: " + cycle + ".",
          ].join("\n"),
        );
        this.resolveRecord(record, {
          ok: record.status === "done",
          accepted: true,
          completed: true,
          status: record.status,
          taskId: record.taskId,
          phase: "complete",
          repairCycles: cycle,
          syncError: record.syncError || null,
        });
        return;
      }

      if (cycle >= this.maxRepairCycles) {
        throw new Error("Reviewer did not approve after " + (cycle + 1) + " review attempt(s). Last evidence: " + compact(reviewer.summary));
      }

      repairContext = reviewer.summary || "Reviewer requested changes.";
      cycle += 1;
    }

    throw new Error("Team workflow exceeded its repair-cycle limit");
  }

  async runPhase({ record, parent, role, phase, cycle, label, description, deadline }) {
    if (this.disposed) throw new Error("Paperclip team orchestrator was disposed");
    if (Date.now() > deadline) throw new Error("Paperclip team workflow exceeded its time limit");

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
    }

    record.childIssueId = String(child.id || "");
    await this.safeParentUpdate(
      record,
      "in_progress",
      "Team phase " + phase + " assigned to " + agent.role.label + ": " + String(child.identifier || child.id || title),
    );

    const terminal = await this.waitForIssue(child.id, deadline);
    const comments = await this.api.getIssueComments(child.id);
    const summary = latestCommentText(comments);

    return {
      issue: terminal,
      summary,
      status: String(terminal.status || ""),
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

  async waitForIssue(issueId, workflowDeadline) {
    const childDeadline = Math.min(workflowDeadline, Date.now() + this.maxChildMs);
    while (!this.disposed && Date.now() <= childDeadline) {
      const issue = await this.api.getIssue(issueId);
      const status = String(issue.status || "");
      if (["done", "blocked", "cancelled"].includes(status)) return issue;
      await delay(this.pollMs);
    }
    throw new Error("Timed out waiting for Paperclip child issue " + issueId);
  }

  requireDone(result, label) {
    if (result.status === "done") return;
    throw new Error(label + " phase ended with status " + result.status + ". Evidence: " + compact(result.summary));
  }

  async safeParentUpdate(record, status, comment) {
    try {
      return await this.api.updateIssue({
        issueId: record.taskId,
        runId: record.paperclipRunId,
        status,
        comment,
      });
    } catch (error) {
      record.lastSyncError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  async syncParentDisposition(record, status, comment) {
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

  async finishParent(record, status, comment) {
    try {
      await this.syncParentDisposition(record, status, comment);
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
