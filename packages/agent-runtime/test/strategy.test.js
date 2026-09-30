const assert = require("assert");
const { classifyTask, isRunGoal, isBuildGoal } = require("../strategy");

assert.strictEqual(isRunGoal("run the website"), true);
assert.strictEqual(isRunGoal("start the existing project"), true);
assert.strictEqual(isRunGoal("open the current preview"), true);
assert.strictEqual(isRunGoal("can you run it"), true);

assert.strictEqual(isBuildGoal("run the website"), false);
assert.strictEqual(isBuildGoal("start the existing project"), false);
assert.strictEqual(isBuildGoal("build a website"), true);
assert.strictEqual(isBuildGoal("create a new app"), true);

assert.strictEqual(classifyTask("run the website", { mode: "controlled" }), "run");
assert.strictEqual(classifyTask("start the existing project", { mode: "controlled" }), "run");
assert.strictEqual(classifyTask(
  "Run the existing website in the current workspace and open/verify the existing preview. Do not recreate or redesign the website unless startup or verification proves a repair is required.",
  { mode: "controlled" },
), "run");
assert.strictEqual(classifyTask("build a website", { mode: "controlled" }), "build");
assert.strictEqual(classifyTask("run the website", { mode: "read_only" }), "inspect");

console.log("run intent routing passed");
