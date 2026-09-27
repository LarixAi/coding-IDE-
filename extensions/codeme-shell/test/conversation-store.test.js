const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ConversationStore, cleanTitle } = require("../conversation-store");

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-conversations-"));
  const store = new ConversationStore(directory);
  const workspaceA = path.join(directory, "project-a");
  const workspaceB = path.join(directory, "project-b");

  const first = store.create(workspaceA, "Build a professional dealership website with a very long title that should be shortened neatly");
  assert.ok(/^chat_/.test(first.id));
  assert.ok(first.title.length <= 54);
  store.append(first.id, workspaceA, { role: "user", text: "First question" });
  store.append(first.id, workspaceA, { role: "assistant", text: "First answer", runId: "run_1" });

  const second = store.create(workspaceA, "Second chat");
  store.append(second.id, workspaceA, { role: "user", text: "Second question" });
  assert.strictEqual(store.active(workspaceA).id, second.id);
  assert.strictEqual(store.list(workspaceA).length, 2);

  assert.strictEqual(store.setActive(workspaceA, first.id), true);
  const restored = new ConversationStore(directory);
  assert.strictEqual(restored.active(workspaceA).id, first.id);
  assert.deepStrictEqual(restored.get(first.id, workspaceA).messages.map((item) => item.text), [
    "First question",
    "First answer",
  ]);

  const other = restored.create(workspaceB, "Other project chat");
  restored.append(other.id, workspaceB, { role: "user", text: "Project B" });
  assert.strictEqual(restored.list(workspaceB).length, 1);
  assert.strictEqual(restored.list(workspaceA).length, 2);
  assert.strictEqual(restored.get(first.id, workspaceB), null);

  restored.clearActive(workspaceA);
  assert.strictEqual(restored.active(workspaceA), null);
  assert.strictEqual(restored.list(workspaceA).length, 2);

  assert.strictEqual(cleanTitle("  A title with\nmore detail  "), "A title with");

  console.log("ok conversation store");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
