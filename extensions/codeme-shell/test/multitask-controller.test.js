const assert = require("assert");
const { MultitaskController } = require("../multitask-controller");

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for Multitask state");
}

async function main() {
  const messages = [];
  const selectedModes = [];
  const session = {
    running: false,
    conversationId: "chat-1",
    recordUserMessage(text) { messages.push({ role: "user", text }); },
    recordAssistantMessage(text) { messages.push({ role: "assistant", text }); },
    selectMode(mode) { selectedModes.push(mode); return { ok: true }; },
  };

  const paperclip = {
    status() {
      return {
        enabled: true,
        configured: true,
        started: true,
        companyIdConfigured: true,
        orchestration: { enabled: true },
      };
    },
    async submitUserTask(goal, options) {
      assert.strictEqual(goal, "Build the booking flow");
      options.onProgress({ phase: "product", status: "done", taskId: "parent-1", runId: "team-1" });
      options.onProgress({ phase: "cto", status: "done", taskId: "parent-1", runId: "team-1" });
      options.onProgress({ phase: "developer", status: "running", taskId: "parent-1", runId: "team-1" });
      return { ok: true, status: "done", phase: "complete", taskId: "parent-1", runId: "team-1", repairCycles: 0 };
    },
  };

  const snapshots = [];
  const controller = new MultitaskController({
    session,
    paperclip,
    onChange: (state) => snapshots.push(state),
  });

  const started = controller.start("Build the booking flow", 4);
  assert.strictEqual(started.ok, true);
  assert.strictEqual(started.multitask, true);
  assert.strictEqual(controller.snapshot().active, true);

  await waitFor(() => controller.snapshot().active === false);
  assert.strictEqual(controller.snapshot().status, "done");
  assert.ok(snapshots.some((item) => item.phase === "product"));
  assert.ok(snapshots.some((item) => item.phase === "developer"));
  assert.ok(messages.some((item) => item.role === "user" && item.text === "Build the booking flow"));
  assert.ok(messages.some((item) => item.role === "assistant" && /Multitask complete/.test(item.text)));
  assert.ok(selectedModes.includes("multitask"));

  console.log("ok Composer Multitask controller lifecycle");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
