const assert = require("assert");
const { PaperclipBridge } = require("../paperclip-bridge");

async function main() {
  const phases = [];
  let steps = 0;
  const api = {
    apiKey: "controller-key",
    async createIssue({ companyId, issue }) {
      assert.strictEqual(companyId, "company-1");
      assert.strictEqual(issue.assigneeAgentId, undefined);
      return { id: "parent-1", companyId, ...issue };
    },
    async getIssue(id) {
      assert.strictEqual(id, "child-1");
      return { id, status: "done" };
    },
  };
  const registry = {
    hasCredential() { return true; },
    summary() { return { mode: "multi-agent", agents: [] }; },
    agentForRole(role) {
      if (role === "controller") return { agentId: "controller-id", configured: true };
      return { agentId: role + "-id", configured: true };
    },
  };
  const controller = {
    snapshot() { return { active: [] }; },
    dispose() {},
  };
  const teamOrchestrator = {
    configured() { return true; },
    snapshot() { return { enabled: true, active: [] }; },
    async handleHeartbeat() {
      steps += 1;
      if (steps === 1) {
        return {
          ok: true,
          accepted: true,
          completed: true,
          status: "blocked",
          phase: "product",
          childIssueId: "child-1",
        };
      }
      return {
        ok: true,
        accepted: true,
        completed: true,
        status: "done",
        phase: "complete",
        repairCycles: 0,
      };
    },
    dispose() {},
  };

  const bridge = new PaperclipBridge({
    session: {},
    enabled: true,
    bridgeToken: "bridge-secret",
    companyId: "company-1",
    api,
    agentRegistry: registry,
    controller,
    teamOrchestrator,
    teamOrchestrationEnabled: true,
  });
  bridge.started = true;

  const result = await bridge.submitUserTask("Build the booking flow", {
    pollMs: 1,
    childTimeoutMs: 100,
    onProgress(item) { phases.push(item.phase); },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, "done");
  assert.strictEqual(steps, 2);
  assert.ok(phases.includes("product"));
  assert.ok(phases.includes("complete"));

  bridge.dispose();
  console.log("ok Composer can drive a direct Paperclip Multitask parent through team phases");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
