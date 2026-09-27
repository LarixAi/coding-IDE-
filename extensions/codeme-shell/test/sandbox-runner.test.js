const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parseSandboxCommand,
  isolationBackend,
  createSandboxRunner,
} = require("../sandbox-runner");

async function main() {
  assert.deepStrictEqual(parseSandboxCommand("node script.js"), {
    program: "node",
    args: ["script.js"],
  });
  assert.deepStrictEqual(parseSandboxCommand("node --check script.js"), {
    program: "node",
    args: ["--check", "script.js"],
  });
  assert.deepStrictEqual(parseSandboxCommand("npm test"), {
    program: "npm",
    args: ["test"],
  });
  assert.throws(
    () => parseSandboxCommand("node script.js &"),
    (error) => error && error.code === "command_rejected",
  );
  assert.throws(
    () => parseSandboxCommand("node ../outside.js"),
    (error) => error && error.code === "command_rejected",
  );

  const backend = isolationBackend();
  assert.ok(["macos-sandbox-exec", "bubblewrap", "workspace-copy"].includes(backend.kind));
  assert.strictEqual(typeof backend.securityBoundary, "boolean");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-sandbox-test-"));
  fs.writeFileSync(
    path.join(root, "script.js"),
    [
      'const fs = require("fs");',
      'fs.writeFileSync("generated.txt", "sandbox only");',
      'process.stdout.write("sandbox-ok");',
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(root, "live.txt"), "unchanged", "utf8");

  try {
    const result = await createSandboxRunner().run(root, {
      command: "node script.js",
      timeoutMs: 10000,
    });

    assert.strictEqual(result.exitCode, 0, JSON.stringify(result));
    assert.ok(result.stdout.includes("sandbox-ok"), JSON.stringify(result));
    assert.strictEqual(result.workspace, "ephemeral_copy");
    assert.strictEqual(result.discarded, true);
    assert.ok(result.changedPaths.includes("generated.txt"), JSON.stringify(result.changedPaths));
    assert.strictEqual(fs.existsSync(path.join(root, "generated.txt")), false);
    assert.strictEqual(fs.readFileSync(path.join(root, "live.txt"), "utf8"), "unchanged");

    fs.writeFileSync(path.join(root, "broken.js"), "const = ;\n", "utf8");
    const broken = await createSandboxRunner().run(root, {
      command: "node --check broken.js",
      timeoutMs: 10000,
    });
    assert.notStrictEqual(broken.exitCode, 0);
    assert.ok(/syntax/i.test(broken.stderr || broken.output), JSON.stringify(broken));
    assert.strictEqual(fs.readFileSync(path.join(root, "broken.js"), "utf8"), "const = ;\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log("ok sandbox runner");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
