const assert = require("assert");
const { DebugToolProvider } = require("../debug-tool-provider");

async function main() {
  let testsExitCode = 1;
  let patched = 0;
  const host = {
    async runTests() {
      return { exitCode: testsExitCode, stdout: testsExitCode ? "" : "pass", stderr: testsExitCode ? "FAIL" : "" };
    },
    async patchFile(path, oldText, newText) {
      patched += 1;
      return { path, before: oldText, after: newText, changed: true, noOp: false };
    },
    async gitDiff() {
      return { diff: "-old\n+new" };
    },
  };

  const provider = new DebugToolProvider(host);

  const premature = await provider.call("file.patch", {
    path: "src/app.js",
    oldText: "old",
    newText: "new",
  });
  assert.strictEqual(premature.ok, false);
  assert.strictEqual(premature.error.code, "debug_reproduce_first");
  assert.strictEqual(patched, 0);

  const reproduced = await provider.call("tests.run", { command: "npm test" });
  assert.strictEqual(reproduced.ok, false);
  assert.strictEqual(provider.debugState().failureObserved, true);
  assert.strictEqual(provider.debugState().failureCheck.name, "tests.run");

  const repair = await provider.call("file.patch", {
    path: "src/app.js",
    oldText: "old",
    newText: "new",
  });
  assert.strictEqual(repair.ok, true);
  assert.strictEqual(patched, 1);
  assert.strictEqual(provider.debugState().recheckRequired, true);

  const earlyDiff = await provider.call("git.diff", {});
  assert.strictEqual(earlyDiff.ok, false);
  assert.strictEqual(earlyDiff.error.code, "debug_recheck_required");

  testsExitCode = 0;
  const verified = await provider.call("tests.run", { command: "npm test" });
  assert.strictEqual(verified.ok, true);
  assert.strictEqual(provider.debugState().recheckRequired, false);

  const diff = await provider.call("git.diff", {});
  assert.strictEqual(diff.ok, true);

  console.log("ok Debug mode requires reproduction and exact recheck before final diff");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
