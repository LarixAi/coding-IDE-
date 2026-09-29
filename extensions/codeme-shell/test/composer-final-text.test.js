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

const mixed = finalAssistantText({
  lifecycle: "failed",
  taskClass: "bug-fix",
  filesChanged: ["public/index.html"],
  outcome: {
    summary: [
      "First, let's check the HTML content.",
      '{"name":"file_read","arguments":{"path":"public/index.html"}}',
      "Verification is still failing.",
    ].join("\n"),
  },
});

assert.ok(mixed.includes("First, let's check the HTML content."));
assert.ok(mixed.includes("Verification is still failing."));
assert.ok(!mixed.includes("file_read"));
assert.ok(!mixed.includes('"arguments"'));

console.log("ok final chat hides tool protocol noise");
