const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { RunStore, buildRunLedger, redact } = require("../run-store");

function test(name, fn) {
  try {
    fn();
    console.log("ok", name);
  } catch (error) {
    console.error("fail", name);
    throw error;
  }
}

test("run ledger records tool lifecycle, errors and context telemetry", () => {
  const run = {
    id: "run_ledger_test",
    goal: "Fix the test",
    model: "qwen2.5-coder:14b",
    providerName: "ollama-server",
    composerMode: "code",
    lifecycle: "failed",
    startedAt: "2026-10-03T17:00:00.000Z",
    finishedAt: "2026-10-03T17:00:05.000Z",
    conversationHistory: [{ role: "user", text: "hello" }],
    decisions: [{ text: "read the file" }],
    filesChanged: ["src/app.js"],
    toolCalls: [
      {
        name: "file.read",
        args: { path: "src/app.js" },
        durationMs: 12,
        result: { ok: true, data: { path: "src/app.js" } },
      },
      {
        name: "process.start",
        args: { command: "npm test", authorization: "Bearer top-secret-token" },
        durationMs: 1300,
        result: { ok: false, error: { code: "exit_1", message: "tests failed" } },
      },
    ],
  };
  const ledger = buildRunLedger(run, Date.parse(run.finishedAt));
  assert.strictEqual(ledger.schemaVersion, 1);
  assert.strictEqual(ledger.durationMs, 5000);
  assert.strictEqual(ledger.summary.toolCalls, 2);
  assert.strictEqual(ledger.summary.failedToolCalls, 1);
  assert.strictEqual(ledger.events[1].status, "failed");
  assert.strictEqual(ledger.events[1].input.authorization, "[REDACTED]");
  assert.ok(ledger.context.approximateTokens > 0);
});

test("RunStore keeps canonical run and additive ledger side by side", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-ledger-"));
  try {
    const store = new RunStore(directory);
    store.save({
      id: "run_saved",
      goal: "Inspect",
      lifecycle: "completed",
      startedAt: "2026-10-03T17:00:00.000Z",
      finishedAt: "2026-10-03T17:00:01.000Z",
      toolCalls: [],
    });
    assert.ok(fs.existsSync(path.join(directory, "run_saved.json")));
    assert.ok(fs.existsSync(path.join(directory, "ledger", "run_saved.json")));
    assert.strictEqual(store.loadLedger("run_saved").runId, "run_saved");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("redaction hides secret-looking fields and bearer values", () => {
  const clean = redact({
    password: "secret",
    nested: { apiKey: "abc", note: "Bearer abcdefghijklmnopqrstuvwxyz" },
  });
  assert.strictEqual(clean.password, "[REDACTED]");
  assert.strictEqual(clean.nested.apiKey, "[REDACTED]");
  assert.ok(!clean.nested.note.includes("abcdefghijklmnopqrstuvwxyz"));
});

console.log("run ledger tests passed");
