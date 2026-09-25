const assert = require("assert");
const { validNumber } = require("../src/check.js");

assert.strictEqual(validNumber("79927398713"), true);
assert.strictEqual(validNumber("79927398710"), false);
assert.strictEqual(validNumber("378282246310005"), true);
assert.strictEqual(validNumber("378282246310006"), false);
assert.strictEqual(validNumber(""), false);
assert.strictEqual(validNumber("0"), false);
assert.strictEqual(validNumber("12a"), false);

console.log("ok");
