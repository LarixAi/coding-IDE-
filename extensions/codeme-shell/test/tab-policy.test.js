const assert = require("assert");
const { isCodeMeSurface, hasWorkspaceEditorInGroups } = require("../tab-policy");

assert.strictEqual(isCodeMeSurface({ label: "Start", input: undefined }), true);
assert.strictEqual(isCodeMeSurface({ label: "Welcome", input: { viewType: "codeme.welcome" } }), true);
assert.strictEqual(isCodeMeSurface({ label: "127.0.0.1:3000", input: undefined }), false);

assert.strictEqual(hasWorkspaceEditorInGroups([
  { tabs: [{ label: "Start", input: { viewType: "codeme.start" } }] },
]), false);

assert.strictEqual(hasWorkspaceEditorInGroups([
  {
    tabs: [
      { label: "Start", input: { viewType: "codeme.start" } },
      // Simple Browser can briefly expose no tab.input while opening. It must
      // still count as a real editor so Start cannot steal focus back.
      { label: "127.0.0.1:3000", input: undefined },
    ],
  },
]), true);

assert.strictEqual(hasWorkspaceEditorInGroups([
  {
    tabs: [
      { label: "Start", input: { viewType: "codeme.start" } },
      { label: "server.js", input: { uri: "file:///tmp/server.js" } },
    ],
  },
]), true);

console.log("ok browser tab suppresses CodeMe Start");
