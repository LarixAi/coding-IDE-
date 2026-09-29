const assert = require("assert");
const { finalAssistantText } = require("../composer-session");

const failed = finalAssistantText({
  lifecycle: "failed",
  taskClass: "bug-fix",
  filesChanged: ["public/script.js"],
  outcome: {
    summary: [
      "Verification is still failing.",
      "",
      "```json",
      '{"name":"file_write","arguments":{"path":"public/script.js","content":"ignored"}}',
      "```",
    ].join("\n"),
  },
});

assert.ok(failed.includes("Verification is still failing."));
assert.ok(!failed.includes("file_write"));
assert.ok(!failed.includes('"arguments"'));

console.log("ok final chat hides tool protocol noise");
