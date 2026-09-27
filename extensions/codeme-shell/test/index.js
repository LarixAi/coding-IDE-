const assert = require("assert");
const vscode = require("vscode");
const { runTool } = require("../code-oss-host");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`not ok ${name}`);
    console.error(error);
    throw error;
  }
}

async function waitFor(label, predicate) {
  const started = Date.now();
  let last;
  while (Date.now() - started < 20000) {
    last = await predicate();
    if (last) return last;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  assert.ok(folder, "a workspace folder must be open");

  await test("workspace.inspect reports the active workspace without changing it", async () => {
    const result = await runTool("workspace.inspect", {});
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.ok(["empty", "project", "folder"].includes(result.data.state), result.data.state);
    assert.strictEqual(result.data.root, folder.name);
    assert.ok(Array.isArray(result.data.projectMarkers));
    assert.ok(Array.isArray(result.data.languages));
    assert.ok(Array.isArray(result.data.frameworks));
  });

  await test("file.write and file.read round-trip", async () => {
    const written = await runTool("file.write", { path: "README.md", contents: "base\ncodeme-needle\n" });
    assert.strictEqual(written.ok, true);
    const read = await runTool("file.read", { path: "README.md" });
    assert.strictEqual(read.ok, true);
    assert.strictEqual(read.data.contents, "base\ncodeme-needle\n");
  });

  await test("file.read rejects a path outside the workspace", async () => {
    const result = await runTool("file.read", { path: "../outside.txt" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, "path_escape");
  });

  await test("repo.search finds the written text", async () => {
    const result = await runTool("repo.search", { query: "codeme-needle" });
    assert.strictEqual(result.ok, true);
    assert.ok(result.data.matches.some((match) => match.path === "README.md" && match.line === 2));
  });

  await test("git.diff and git.status see the edit", async () => {
    const diff = await waitFor("git diff", async () => {
      const result = await runTool("git.diff", {});
      return result.ok && result.data.diff.includes("codeme-needle") ? result : null;
    });
    assert.ok(diff.data.diff.includes("codeme-needle"));
    const status = await runTool("git.status", {});
    assert.strictEqual(status.ok, true);
    assert.ok(status.data.changes.some((change) => change.path === "README.md"));
  });

  await test("terminal.run reports stdout and a non-zero exit", async () => {
    const ok = await runTool("terminal.run", { command: "printf codeme-out" });
    assert.strictEqual(ok.ok, true, JSON.stringify(ok));
    assert.ok(ok.data.output.includes("codeme-out"), ok.data.output);
    const failed = await runTool("terminal.run", { command: "false" });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.error.code, "exit_status");
    assert.notStrictEqual(failed.data.exitCode, 0);
  });

  await test("tests.run captures stdout, stderr, and exit status", async () => {
    const ok = await runTool("tests.run", { command: "node -e \"process.stdout.write('pass')\"" });
    assert.strictEqual(ok.ok, true, JSON.stringify(ok));
    assert.ok(ok.data.stdout.includes("pass"));
    const failed = await runTool("tests.run", { command: "node -e \"process.stderr.write('fail'); process.exit(3)\"" });
    assert.strictEqual(failed.ok, false);
    assert.strictEqual(failed.error.code, "exit_status");
    assert.strictEqual(failed.data.exitCode, 3);
    assert.ok(failed.data.stderr.includes("fail"));
  });

  await test("diagnostics.run reports a real syntax error", async () => {
    const written = await runTool("file.write", { path: "broken.js", contents: "const = ;\n" });
    assert.strictEqual(written.ok, true);
    const uri = vscode.Uri.joinPath(folder.uri, "broken.js");
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const found = await waitFor("diagnostics", async () => {
      const result = await runTool("diagnostics.run", {});
      if (!result.ok) return null;
      return result.data.items.some((item) => item.path === "broken.js" && item.severity === 0) ? result : null;
    });
    assert.ok(found.data.items.some((item) => item.path === "broken.js"));
  });

  await test("browser.check reports a down local page without starting a different server", async () => {
    const result = await runTool("browser.check", { url: "http://127.0.0.1:9" });
    assert.strictEqual(result.ok, false);
    assert.ok(["connection_refused", "ECONNREFUSED", "timeout"].includes(result.error.code), result.error.code);
    assert.ok(String(result.data.url).includes("127.0.0.1:9"));
  });
}

module.exports = { run };
