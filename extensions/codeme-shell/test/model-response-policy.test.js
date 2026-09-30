const assert = require("assert");
const { RESPONSE_POLICY, ResponsePolicyProvider } = require("../model-response-policy");

(async () => {
  const seen = [];
  const base = {
    name: "fixture",
    async complete(input) {
      seen.push(input);
      return { text: "OK", toolCalls: [] };
    },
  };
  const provider = new ResponsePolicyProvider(base);
  const original = {
    model: "fixture",
    messages: [{ role: "user", content: "Does routing work?" }],
    tools: [],
  };
  const reply = await provider.complete(original);
  assert.strictEqual(reply.text, "OK");
  assert.strictEqual(original.messages.length, 1, "must not mutate pipeline messages");
  assert.strictEqual(seen[0].messages.length, 2);
  assert.strictEqual(seen[0].messages[1].role, "system");
  assert.ok(seen[0].messages[1].content.includes("not verified"));
  assert.ok(RESPONSE_POLICY.includes("plain English"));
  console.log("ok model response policy");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
