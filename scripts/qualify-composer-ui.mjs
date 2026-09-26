// Drive the running CodeMe Composer webview through Chrome DevTools.
// Start CodeMe with --remote-debugging-port=9223 before running this.
import fs from "fs";
import os from "os";
import path from "path";

const CDP = process.env.CODEME_CDP || "http://127.0.0.1:9223";
const WORKSPACE = process.env.CODEME_UI_WORKSPACE;
const RUNS = process.env.CODEME_UI_RUNS;
const INSIDE = process.env.CODEME_UI_INSIDE || "README.md";
const OUTSIDE = process.env.CODEME_UI_OUTSIDE;
const ANCHOR = process.env.CODEME_UI_ANCHOR || "codeme-ui-anchor-not-inlined";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.next = 1;
    this.pending = new Map();
    this.contextId = undefined;
  }

  async open() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", () => reject(new Error(`CDP failed: ${this.url}`)), { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      contextId: this.contextId,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "evaluation failed");
    }
    return result.result && result.result.value;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function findComposer() {
  const started = Date.now();
  while (Date.now() - started < 45000) {
    const version = await (await fetch(`${CDP}/json/version`)).json();
    const browser = new Cdp(version.webSocketDebuggerUrl);
    await browser.open();
    const listed = await browser.send("Target.getTargets");
    const workbench = (listed.targetInfos || []).find((target) => target.type === "page");
    if (workbench) {
      const shell = new Cdp(`ws://127.0.0.1:9223/devtools/page/${workbench.targetId}`);
      try {
        await shell.open();
        await shell.eval("const el = Array.from(document.querySelectorAll('a.action-label')).find((node) => node.getAttribute('aria-label') === 'CodeMe Agent' && node.offsetParent); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));");
      } catch {
        // The workbench can still be starting.
      }
      shell.close();
    }
    browser.close();
    const host = (listed.targetInfos || []).find((target) => target.type === "iframe" && String(target.url).includes("extensionId=codeme.codeme-shell"));
    if (host) {
      const page = new Cdp(`ws://127.0.0.1:9223/devtools/page/${host.targetId}`);
      try {
        await page.open();
        await page.send("Page.enable");
        await page.send("Runtime.enable");
        const tree = await page.send("Page.getFrameTree");
        const child = tree.frameTree && tree.frameTree.childFrames && tree.frameTree.childFrames[0];
        if (child) {
          const world = await page.send("Page.createIsolatedWorld", { frameId: child.frame.id, worldName: "codeme-qualify" });
          page.contextId = world.executionContextId;
          const found = await page.eval("Boolean(document.querySelector('#prompt') && document.querySelector('#model'))");
          if (found) return page;
        }
      } catch {
        // The webview target can disappear while the window is opening.
      }
      page.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Composer webview was not found");
}

function runFiles() {
  if (!RUNS || !fs.existsSync(RUNS)) return [];
  return fs.readdirSync(RUNS).filter((name) => name.endsWith(".json") && !name.includes(".prev"));
}

function readRun(id) {
  return JSON.parse(fs.readFileSync(path.join(RUNS, `${id}.json`), "utf8"));
}

async function main() {
  assert(WORKSPACE && OUTSIDE && RUNS, "workspace, outside file, and runs directory are required");
  const evidence = [];
  const note = (name, detail) => {
    evidence.push({ name, detail });
    console.log(`ok ${name}: ${detail}`);
  };

  const page = await findComposer();
  const busy = await page.eval("document.querySelector('#stage').dataset.running === 'true'");
  if (busy) {
    const active = await page.eval("document.querySelector('#stage').dataset.runId");
    await page.eval("document.querySelector('#stop').click()");
    await waitFor(page, "existing run to stop", "document.querySelector('#stage').dataset.running", (value) => value === "false");
    note("Stop", `${active} cancelled from the Composer`);
  }
  await waitFor(page, "model option", "document.querySelectorAll('#model option').length", (count) => Number(count) > 0);
  const models = await page.eval("Array.from(document.querySelectorAll('#model option')).map((option) => ({ id: option.value, label: option.textContent, provider: option.dataset.provider }))");
  assert(models.length > 0, "model dropdown is empty");
  assert(models.some((model) => model.label === "Qwen 3.5 9B" && model.id === "qwen3.5:9b" && model.provider === "ollama"), JSON.stringify(models));
  note("model dropdown", models.map((model) => model.label).join(", "));

  await page.eval("const prompt = document.querySelector('#prompt'); prompt.focus(); prompt.value = ''; prompt.setSelectionRange(0, 0);");
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", text: "a", windowsVirtualKeyCode: 65 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", modifiers: 8, windowsVirtualKeyCode: 13 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", modifiers: 8, windowsVirtualKeyCode: 13 });
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "b", code: "KeyB", text: "b", windowsVirtualKeyCode: 66 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "b", code: "KeyB", windowsVirtualKeyCode: 66 });
  const shifted = await page.eval("document.querySelector('#prompt').value");
  assert(shifted === "a\nb", `Shift+Enter produced ${JSON.stringify(shifted)}`);
  note("Shift+Enter", JSON.stringify(shifted));

  const before = new Set(runFiles());
  const insideUri = `file://${path.join(WORKSPACE, INSIDE)}`;
  const dropped = await page.eval(`(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/uri-list", ${JSON.stringify(insideUri)});
    document.querySelector("#drop").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return true;
  })()`);
  assert(dropped === true, "drop did not dispatch");
  const chip = await waitFor(page, "chip", "document.querySelector('#chips') ? document.querySelector('#chips').textContent : ''", (text) => text.includes(INSIDE));
  assert(chip.includes("text/markdown"), chip);
  assert(chip.includes("B"), chip);
  note("drag attachment", chip.trim());

  await page.eval("document.querySelector('#chips button').click()");
  const cleared = await waitFor(page, "chip removed", "document.querySelector('#chips') ? document.querySelector('#chips').textContent : ''", (text) => !text.includes(INSIDE));
  assert(!cleared.includes(INSIDE), cleared);
  note("remove attachment", "chip removed");

  const outsideUri = `file://${OUTSIDE}`;
  await page.eval(`(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/uri-list", ${JSON.stringify(outsideUri)});
    document.querySelector("#drop").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  })()`);
  const notice = await waitFor(page, "boundary notice", "document.querySelector('#notice').textContent", (text) => text.includes("outside"));
  const outsideChip = await page.eval("document.querySelector('#chips').textContent");
  assert(!outsideChip.includes(path.basename(OUTSIDE)), outsideChip);
  note("workspace boundary", notice.trim());

  await page.eval(`(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/uri-list", ${JSON.stringify(insideUri)});
    document.querySelector("#drop").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  })()`);
  await waitFor(page, "attachment restored", "document.querySelector('#chips').textContent", (text) => text.includes(INSIDE));

  const prompt = "Read README.md and reply with the word ready.";
  await page.eval(`(() => {
    const prompt = document.querySelector("#prompt");
    prompt.focus();
    prompt.value = ${JSON.stringify(prompt)};
    prompt.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
  })()`);
  const running = await waitFor(page, "run id", "document.querySelector('#stage').dataset.runId", (id) => /^run_/.test(id));
  note("Enter send", running);
  const stages = new Set();
  const started = Date.now();
  let finalStage = "";
  while (Date.now() - started < 150000) {
    const state = await page.eval("({ stage: document.querySelector('#stage').dataset.stage, running: document.querySelector('#stage').dataset.running, enabled: !document.querySelector('#prompt').disabled })");
    stages.add(state.stage);
    finalStage = state.stage;
    if (state.running === "false" && state.stage !== "Waiting" && state.stage !== "Understanding") break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  note("live progress", [...stages].join(" → ") || finalStage);

  const created = runFiles().filter((name) => !before.has(name));
  assert(created.includes(`${running}.json`), `run file missing: ${created.join(", ")}`);
  const run = readRun(running);
  assert(run.id === running, `${run.id} !== ${running}`);
  assert(run.requestedModel === "qwen3.5:9b", run.requestedModel);
  assert(run.provider === "ollama", run.provider);
  assert(run.goal.includes(INSIDE), "attachment reference missing from the run");
  assert(!run.goal.includes(ANCHOR), "file contents were inlined into the goal");
  note("AgentRun record", `${run.id} ${run.provider}/${run.requestedModel} ${run.lifecycle}`);

  const usable = await page.eval("!document.querySelector('#prompt').disabled && !document.querySelector('#send').disabled");
  if (finalStage === "Failed" || finalStage === "Cancelled" || finalStage === "Complete") {
    assert(usable, "composer stayed disabled after the run finished");
    note("composer recovered", finalStage);
  }

  if (finalStage !== "Cancelled") {
    const previous = running;
    await page.eval(`(() => {
      const prompt = document.querySelector("#prompt");
      prompt.value = "Reply with the single word ready.";
      prompt.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
    })()`);
    const next = await waitFor(page, "second run", "document.querySelector('#stage').dataset.runId", (id) => /^run_/.test(id) && id !== previous);
    const stop = await page.eval("document.querySelector('#stop').click(); document.querySelector('#stage').dataset.running");
    note("second prompt", next);
    const cancelStarted = Date.now();
    let cancelled = stop;
    while (Date.now() - cancelStarted < 20000) {
      cancelled = await page.eval("document.querySelector('#stage').dataset.stage");
      const enabled = await page.eval("!document.querySelector('#prompt').disabled");
      if (cancelled === "Cancelled" && enabled) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const saved = readRun(next);
    assert(saved.lifecycle === "cancelled", saved.lifecycle);
    const afterCancel = await page.eval("!document.querySelector('#prompt').disabled && !document.querySelector('#send').disabled");
    assert(afterCancel, "composer stayed disabled after cancel");
    note("Stop", `${saved.id} ${saved.lifecycle}`);
  }

  page.close();
  const evidencePath = process.env.CODEME_UI_EVIDENCE || path.join(os.tmpdir(), "codeme-composer-ui-evidence.json");
  fs.writeFileSync(evidencePath, JSON.stringify({ evidence, finalStage }, null, 2));
}

async function waitFor(page, label, expression, predicate) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < 20000) {
    last = await page.eval(expression);
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
