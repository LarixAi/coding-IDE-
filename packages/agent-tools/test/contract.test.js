const assert = require("assert");
const { execute, executeReadOnly, executeControlled, TOOLS } = require("../index.js");

const host = {
  async readFile() {
    throw new Error("host should not be called");
  },
  async writeFile() {
    throw new Error("host should not be called");
  },
};

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`not ok ${name}`);
    throw error;
  }
}

async function main() {
  await test("lists the stable tool names", () => {
    for (const name of [
      "workspace.inspect",
      "file.read",
      "file.write",
      "file.patch",
      "repo.search",
      "terminal.run",
      "sandbox.run",
      "process.start",
      "process.status",
      "process.logs",
      "git.status",
      "git.diff",
      "diagnostics.run",
      "tests.run",
      "browser.check",
      "browser.interact",
      "dir.create",
      "dir.list",
    ]) {
      assert.ok(TOOLS.includes(name), name);
    }
  });


  await test("workspace inspection is allowed in read-only mode", async () => {
    let called = false;
    const result = await executeReadOnly(
      {
        async inspectWorkspace() {
          called = true;
          return { state: "empty", root: "demo" };
        },
      },
      "workspace.inspect",
      {},
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(called, true);
    assert.strictEqual(result.data.state, "empty");
  });

  await test("rejects an unknown tool", async () => {
    const result = await execute(host, "file.invent", {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "unknown_tool");
  });

  await test("rejects a missing path", async () => {
    const result = await execute(host, "file.read", {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "invalid_args");
  });

  await test("rejects an absolute path", async () => {
    const result = await execute(host, "file.read", { path: "/etc/passwd" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "absolute_path");
  });

  await test("rejects a path that escapes the workspace", async () => {
    const result = await execute(host, "file.write", { path: "../secret.txt", contents: "no" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "path_escape");
  });

  await test("rejects command-line flags as workspace paths", async () => {
    const result = await execute(host, "file.read", { path: "--port" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "flag_like_path");
  });

  await test("returns structured command failure with the output", async () => {
    const result = await execute(
      {
        async runTerminal() {
          return { exitCode: 2, output: "boom" };
        },
      },
      "terminal.run",
      { command: "false" },
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "exit_status");
    assert.strictEqual(result.data.output, "boom");
    assert.strictEqual(result.data.exitCode, 2);
  });

  await test("reads failed process status and logs without turning the read into a tool failure", async () => {
    const host = {
      async processStatus() {
        return { found: true, status: "failed", exitCode: 48, command: "npm start" };
      },
      async processLogs() {
        return { found: true, status: "failed", exitCode: 48, command: "npm start", output: "EADDRINUSE port 3000" };
      },
    };
    const status = await executeReadOnly(host, "process.status", {});
    assert.strictEqual(status.ok, true);
    assert.strictEqual(status.data.status, "failed");
    assert.strictEqual(status.data.exitCode, 48);

    const logs = await executeReadOnly(host, "process.logs", {});
    assert.strictEqual(logs.ok, true);
    assert.ok(logs.data.output.includes("EADDRINUSE"));
  });

  await test("browser.interact validates and dispatches a real click request", async () => {
    let received = null;
    const result = await executeControlled(
      {
        async browserInteract(args) {
          received = args;
          return {
            available: true,
            action: "click",
            targetText: args.targetText,
            expectedText: args.expectedText,
            beforeText: "Click Me",
            afterText: "It works!",
            matched: true,
            consoleErrors: [],
          };
        },
      },
      "browser.interact",
      {
        url: "http://127.0.0.1:3000/",
        action: "click",
        targetText: "Click Me",
        expectedText: "It works!",
      },
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(received.targetText, "Click Me");
    assert.strictEqual(result.data.afterText, "It works!");

    let noUrlReceived = null;
    const ownedUrlResult = await executeControlled(
      {
        async browserInteract(args) {
          noUrlReceived = args;
          return {
            available: true,
            action: "click",
            targetText: args.targetText,
            beforeText: "Click Me",
            afterText: "It works!",
            matched: true,
          };
        },
      },
      "browser.interact",
      {
        action: "click",
        targetText: "Click Me",
        expectedText: "It works!",
      },
    );
    assert.strictEqual(ownedUrlResult.ok, true);
    assert.strictEqual(noUrlReceived.url, undefined);


    const missingTarget = await executeControlled(
      { async browserInteract() { throw new Error("must not run"); } },
      "browser.interact",
      { url: "http://127.0.0.1:3000/", action: "click" },
    );
    assert.strictEqual(missingTarget.ok, false);
    assert.strictEqual(missingTarget.error.code, "invalid_args");

    const badAction = await executeControlled(
      { async browserInteract() { throw new Error("must not run"); } },
      "browser.interact",
      { url: "http://127.0.0.1:3000/", action: "type", targetText: "Click Me" },
    );
    assert.strictEqual(badAction.ok, false);
    assert.strictEqual(badAction.error.code, "invalid_args");
  });

  await test("blocks file writes while read-only", async () => {
    let called = false;
    const result = await executeReadOnly(
      {
        async writeFile() {
          called = true;
        },
      },
      "file.write",
      { path: "README.md", contents: "changed" },
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "mutation_blocked");
    assert.strictEqual(called, false);
  });

  await test("blocks patch and process tools while read-only", async () => {
    for (const [name, args] of [
      ["file.patch", { path: "README.md", oldText: "old", newText: "new" }],
      ["sandbox.run", { command: "node script.js" }],
      ["process.start", { command: "npm start" }],
    ]) {
      const result = await executeReadOnly({}, name, args);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error.code, "mutation_blocked");
    }
  });

  await test("dispatches a deterministic patch in controlled mode", async () => {
    let received = null;
    const result = await executeControlled(
      {
        async patchFile(filePath, oldText, newText) {
          received = { filePath, oldText, newText };
          return { path: filePath, replacements: 1 };
        },
      },
      "file.patch",
      { path: "src/app.js", oldText: "old", newText: "new" },
    );
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(received, { filePath: "src/app.js", oldText: "old", newText: "new" });
  });

  await test("sandbox.run validates, dispatches, and preserves structured failures", async () => {
    let received = null;
    const accepted = await executeControlled(
      {
        async runSandbox(args) {
          received = args;
          return {
            command: args.command,
            exitCode: 0,
            stdout: "sandbox-ok",
            stderr: "",
            output: "sandbox-ok",
            isolation: "workspace-copy",
            securityBoundary: false,
            discarded: true,
            changedPaths: ["generated.txt"],
          };
        },
      },
      "sandbox.run",
      { command: "node script.js", timeoutMs: 5000 },
    );
    assert.strictEqual(accepted.ok, true, JSON.stringify(accepted));
    assert.strictEqual(received.command, "node script.js");
    assert.strictEqual(received.timeoutMs, 5000);
    assert.strictEqual(accepted.data.discarded, true);
    assert.deepStrictEqual(accepted.data.changedPaths, ["generated.txt"]);

    const shellSyntax = await executeControlled(
      { async runSandbox() { throw new Error("must not run"); } },
      "sandbox.run",
      { command: "node script.js &" },
    );
    assert.strictEqual(shellSyntax.ok, false);
    assert.strictEqual(shellSyntax.error.code, "command_rejected");

    const escaped = await executeControlled(
      { async runSandbox() { throw new Error("must not run"); } },
      "sandbox.run",
      { command: "node ../outside.js" },
    );
    assert.strictEqual(escaped.ok, false);
    assert.strictEqual(escaped.error.code, "command_rejected");

    const badTimeout = await executeControlled(
      { async runSandbox() { throw new Error("must not run"); } },
      "sandbox.run",
      { command: "node script.js", timeoutMs: 999999 },
    );
    assert.strictEqual(badTimeout.ok, false);
    assert.strictEqual(badTimeout.error.code, "invalid_args");

    const failed = await executeControlled(
      {
        async runSandbox() {
          return { command: "node broken.js", exitCode: 2, stdout: "", stderr: "SyntaxError", output: "SyntaxError" };
        },
      },
      "sandbox.run",
      { command: "node broken.js" },
    );
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.error.code, "exit_status");
    assert.strictEqual(failed.data.exitCode, 2);
    assert.ok(failed.data.stderr.includes("SyntaxError"));
  });

  await test("process.start only permits approved long-running scripts", async () => {
    let started = "";
    const accepted = await executeControlled(
      {
        async startProcess(command) {
          started = command;
          return { started: true, command };
        },
      },
      "process.start",
      { command: "npm start" },
    );
    assert.strictEqual(accepted.ok, true);
    assert.strictEqual(started, "npm start");

    const rejected = await executeControlled(
      {
        async startProcess() {
          throw new Error("must not run");
        },
      },
      "process.start",
      { command: "npm install" },
    );
    assert.strictEqual(rejected.ok, false);
    assert.strictEqual(rejected.error.code, "command_rejected");
  });

  await test("returns structured success from the host", async () => {
    const result = await execute(
      {
        async readFile(filePath) {
          return { path: filePath, contents: "hello" };
        },
      },
      "file.read",
      { path: "hello.txt" },
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.contents, "hello");
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
