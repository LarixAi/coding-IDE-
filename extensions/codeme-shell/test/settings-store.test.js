const assert = require("assert");
const {
  CodeMeSettingsStore,
  DEFAULTS,
  getPath,
  hasDefaultPath,
  mergeDeep,
} = require("../settings-store");

function memoryState() {
  const values = new Map();
  return {
    get(key) { return values.get(key); },
    async update(key, value) { values.set(key, value); },
  };
}

async function main() {
  const context = {
    globalState: memoryState(),
    workspaceState: memoryState(),
  };
  const store = new CodeMeSettingsStore(context);

  const initial = store.snapshot("global");
  assert.strictEqual(initial.effective.chatActivity.showN8nOnlyWhenUsed, true);
  assert.strictEqual(initial.effective.appearance.showServiceStatus, true);
  assert.strictEqual(initial.effective.skills.enabled, true);

  await store.update("global", "general.defaultMode", "team");
  assert.strictEqual(store.snapshot("global").effective.general.defaultMode, "team");

  await store.update("workspace", "general.defaultMode", "code");
  const workspace = store.snapshot("workspace");
  assert.strictEqual(workspace.global.general.defaultMode, "team");
  assert.strictEqual(workspace.workspace.general.defaultMode, "code");
  assert.strictEqual(workspace.effective.general.defaultMode, "code");

  await store.resetWorkspace("general.defaultMode");
  assert.strictEqual(store.snapshot("workspace").effective.general.defaultMode, "team");

  assert.strictEqual(hasDefaultPath("chatActivity.showPaperclipOnlyWhenUsed"), true);
  assert.strictEqual(hasDefaultPath("paperclip.apiKey"), false);
  assert.strictEqual(getPath(DEFAULTS, "general.autoSave"), true);

  const merged = mergeDeep(DEFAULTS, { chatActivity: { collapseCompleted: false } });
  assert.strictEqual(merged.chatActivity.collapseCompleted, false);
  assert.strictEqual(merged.chatActivity.showN8nOnlyWhenUsed, true);

  await assert.rejects(
    () => store.update("global", "secrets.paperclipToken", "secret"),
    /Unknown CodeMe setting/,
  );

  console.log("ok scoped CodeMe settings store");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
