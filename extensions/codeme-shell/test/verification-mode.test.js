const assert = require("assert");
const { VerificationToolProvider } = require("../verification-tool-provider");

async function main() {
  let patched = 0;
  const host = {
    async patchFile() { patched += 1; return { changed: true }; },
    async runTests() { return { exitCode: 0, stdout: "pass", stderr: "" }; },
    async gitDiff() { return { diff: "" }; },
  };
  const provider = new VerificationToolProvider(host);
  assert.ok(!provider.definitions().some((tool) => tool.name === "file.patch"));
  assert.ok(provider.definitions().some((tool) => tool.name === "tests.run"));

  const blocked = await provider.call("file.patch", {
    path: "src/app.js",
    oldText: "a",
    newText: "b",
  });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.error.code, "verification_role_mutation_blocked");
  assert.strictEqual(patched, 0);

  const test = await provider.call("tests.run", { command: "npm test" });
  assert.strictEqual(test.ok, true);

  console.log("ok verification role can test but cannot mutate source");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
