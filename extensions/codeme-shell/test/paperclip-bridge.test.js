const assert = require("assert");
const { PaperclipBridge } = require("../paperclip-bridge");

async function main() {
  let waitedForCompletion = false;
  const controller = {
    snapshot() {
      return { active: [] };
    },
    async handleHeartbeat(body) {
      assert.strictEqual(body.runId, "pc-http-run");
      assert.strictEqual(body.context.taskId, "issue-http");
      return {
        ok: true,
        accepted: true,
        status: "running",
        taskId: "issue-http",
        codemeRunId: "run_codeme_http",
      };
    },
    async waitForCompletion(runId) {
      assert.strictEqual(runId, "pc-http-run");
      await new Promise((resolve) => setTimeout(resolve, 30));
      waitedForCompletion = true;
      return {
        ok: true,
        accepted: true,
        completed: true,
        status: "done",
        taskId: "issue-http",
        codemeRunId: "run_codeme_http",
      };
    },
    dispose() {},
  };

  const bridge = new PaperclipBridge({
    session: {},
    enabled: true,
    host: "127.0.0.1",
    port: 17788,
    bridgeToken: "bridge-secret",
    api: { apiKey: "paperclip-agent-key" },
    controller,
  });

  await bridge.start();
  const startedAt = Date.now();
  try {
    const response = await fetch("http://127.0.0.1:17788/paperclip/heartbeat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CodeMe-Paperclip-Token": "bridge-secret",
      },
      body: JSON.stringify({
        runId: "pc-http-run",
        agentId: "agent-http",
        context: { taskId: "issue-http" },
      }),
    });
    const payload = await response.json();
    const elapsedMs = Date.now() - startedAt;

    assert.strictEqual(response.status, 200);
    assert.strictEqual(waitedForCompletion, true);
    assert.ok(elapsedMs >= 25, "HTTP response must wait for CodeMe completion");
    assert.strictEqual(payload.status, "done");
    assert.strictEqual(payload.completed, true);
    assert.strictEqual(payload.codemeRunId, "run_codeme_http");
  } finally {
    bridge.dispose();
  }

  console.log("ok Paperclip HTTP bridge waits for terminal CodeMe result");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
