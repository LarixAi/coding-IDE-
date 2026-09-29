const assert = require("assert");
const { GATES, RUNTIME_INVARIANTS, gateContractPrompt } = require("../gate-contract");

assert.strictEqual(GATES.length, 11);
assert.deepStrictEqual(GATES.map((item) => item.gate), [1,2,3,4,5,6,7,8,9,10,11]);
assert.ok(GATES.find((item) => item.gate === 8).name.includes("n8n"));
assert.ok(GATES.find((item) => item.gate === 10).name.includes("Research"));
assert.ok(GATES.find((item) => item.gate === 11).name.includes("Autonomous"));
assert.ok(RUNTIME_INVARIANTS.some((item) => item.includes("CodeMe runtime owns")));
const prompt = gateContractPrompt();
assert.ok(prompt.includes("current implementation through Gate 11"));
assert.ok(prompt.includes("G1 Code - OSS baseline"));
assert.ok(prompt.includes("G11 Autonomous agent hardening"));
assert.ok(prompt.includes("historical blueprint numbering conflict"));
assert.ok(prompt.includes("Never print a tool call as prose/JSON"));
console.log("gate contract passed");
