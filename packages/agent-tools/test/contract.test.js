const assert = require("assert");
const { execute, executeReadOnly, TOOLS } = require("../index.js");

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
      "file.read",
      "file.write",
      "repo.search",
      "terminal.run",
      "git.status",
      "git.diff",
      "diagnostics.run",
      "tests.run",
      "browser.check",
    ]) {
      assert.ok(TOOLS.includes(name), name);
    }
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
