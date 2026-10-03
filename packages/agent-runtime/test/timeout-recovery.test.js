const assert = require("assert");
const {
  runPipeline,
  CODE_TURN_DEADLINE_MS,
  NORMAL_TURN_DEADLINE_MS,
} = require("../pipeline-loop");
const { compactMessages } = require("../pipeline-recovery");

function timeoutReply(input) {
  return new Promise((resolve, reject) => {
    if (input.signal.aborted) {
      reject(Object.assign(new Error("aborted"), { code: "cancelled" }));
      return;
    }
    input.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { code: "cancelled" })), { once: true });
  });
}

async function main() {
  assert.strictEqual(CODE_TURN_DEADLINE_MS, 300000);
  assert.strictEqual(NORMAL_TURN_DEADLINE_MS, 180000);

  const big = "x".repeat(18000);
  const compacted = compactMessages([
    { role: "system", content: "SYSTEM" },
    { role: "user", content: "Fix login" },
    { role: "assistant", content: "", toolCalls: [{ name: "file.read", args: { path: "src/auth.js" } }] },
    { role: "tool", name: "file.read", content: "OK: " + big },
    { role: "assistant", content: "", toolCalls: [{ name: "file.write", args: { path: "src/auth.js", contents: big } }] },
    { role: "tool", name: "file.write", content: "OK: wrote src/auth.js" },
    { role: "user", content: "VERIFICATION FAILED: tests" },
    ...Array.from({ length: 10 }, (_, index) => ({ role: "assistant", content: "step " + index })),
  ], { keepRecent: 4 });

  assert.ok(compacted.afterChars < compacted.beforeChars);
  assert.deepStrictEqual(compacted.filesChanged, ["src/auth.js"]);
  assert.ok(compacted.messages.some((message) => /VERIFICATION FAILED/.test(String(message.content || ""))));
  assert.match(compacted.messages[compacted.messages.length - 1].content, /MODEL TIMEOUT RECOVERY TURN/);

  {
    let calls = 0;
    const deadlines = [];
    const events = [];
    const checkpoints = [];
    const result = await runPipeline({
      goal: "Fix login",
      model: "fixture",
      mode: "controlled",
      messages: [{ role: "system", content: "SYSTEM" }, { role: "user", content: "Fix login" }],
      tools: [],
      provider: {
        async complete(input) {
          calls += 1;
          deadlines.push(input.timeoutMs);
          if (calls === 1) return timeoutReply(input);
          assert.ok(input.messages.some((message) => /MODEL TIMEOUT RECOVERY TURN/.test(String(message.content || ""))));
          return { text: "Recovered.", toolCalls: [] };
        },
      },
      executeTool: async () => ({ ok: true }),
      turnDeadlineMs: 25,
      retryDeadlineMs: 25,
      onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
      onEvent: (event) => events.push(event),
    });
    assert.strictEqual(result.reason, "answered");
    assert.strictEqual(result.finalText, "Recovered.");
    assert.strictEqual(calls, 2);
    assert.deepStrictEqual(deadlines, [25, 25], "recovery retry must keep the full deadline");
    assert.ok(checkpoints.length >= 1);
    const timeout = events.find((event) => event.type === "model_timeout");
    assert.ok(timeout);
    assert.strictEqual(timeout.diagnostics.retryDeadlineMs, timeout.diagnostics.deadlineMs);
    assert.ok(events.some((event) => event.type === "model_timeout_recovered"));
  }

  {
    let calls = 0;
    const events = [];
    const result = await runPipeline({
      goal: "x",
      model: "fixture",
      mode: "controlled",
      messages: [{ role: "user", content: "x" }],
      tools: [],
      provider: {
        complete(input) {
          calls += 1;
          return timeoutReply(input);
        },
      },
      executeTool: async () => ({ ok: true }),
      turnDeadlineMs: 20,
      retryDeadlineMs: 20,
      onEvent: (event) => events.push(event),
    });
    assert.strictEqual(calls, 2);
    assert.strictEqual(result.reason, "timeout");
    assert.ok(result.checkpoint);
    assert.ok(events.some((event) => event.type === "model_timeout_failed"));
  }

  {
    let calls = 0;
    const events = [];
    const result = await runPipeline({
      goal: "x",
      model: "fixture",
      mode: "controlled",
      messages: [{ role: "user", content: "x" }],
      tools: [],
      provider: {
        async complete() {
          calls += 1;
          if (calls < 3) throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), { code: "ECONNREFUSED" });
          return { text: "Reconnected.", toolCalls: [] };
        },
      },
      executeTool: async () => ({ ok: true }),
      turnDeadlineMs: 100,
      reconnectDelaysMs: [0, 0],
      onEvent: (event) => events.push(event),
    });
    assert.strictEqual(result.reason, "answered");
    assert.strictEqual(result.finalText, "Reconnected.");
    assert.strictEqual(calls, 3);
    assert.ok(events.some((event) => event.type === "model_reconnect"));
    assert.ok(events.some((event) => event.type === "model_reconnected"));
  }

  {
    let calls = 0;
    const result = await runPipeline({
      goal: "x",
      model: "fixture",
      mode: "controlled",
      messages: [{ role: "user", content: "x" }],
      tools: [],
      provider: {
        async complete() {
          calls += 1;
          throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), { code: "ECONNREFUSED" });
        },
      },
      executeTool: async () => ({ ok: true }),
      turnDeadlineMs: 100,
      reconnectDelaysMs: [0, 0],
    });
    assert.strictEqual(result.reason, "model_offline");
    assert.ok(result.checkpoint);
    assert.strictEqual(calls, 3);
  }

  console.log("ok Pipeline v2 timeout recovery and reconnect checkpoints");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
