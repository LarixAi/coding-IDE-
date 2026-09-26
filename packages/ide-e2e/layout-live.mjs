// Drive the live CodeMe composer: Code mode + the website layout prompt.
import fs from "fs";
import path from "path";

const CDP = process.env.CODEME_CDP || "http://127.0.0.1:9223";
const RUNS = process.env.CODEME_UI_RUNS
  || path.join(path.dirname(new URL(import.meta.url).pathname), "../../.tools/codeme-user-data/User/globalStorage/codeme.codeme-shell/composer-runs");
const PROMPT = "can you find me a better layout for my website";

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
        // workbench still opening
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
          const world = await page.send("Page.createIsolatedWorld", { frameId: child.frame.id, worldName: "codeme-layout-live" });
          page.contextId = world.executionContextId;
          const found = await page.eval("Boolean(document.querySelector('#prompt') && document.querySelector('#mode'))");
          if (found) return page;
        }
      } catch {
        // webview still opening
      }
      page.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Composer webview was not found");
}

function readRun(id) {
  const file = path.join(RUNS, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function summarize(run) {
  if (!run) return null;
  const tools = (run.toolCalls || []).map((call) => ({
    i: call.iteration,
    name: call.name,
    path: call.args && (call.args.path || call.args.query || call.args.capability || call.args.url),
    ok: Boolean(call.result && call.result.ok),
    withheld: Boolean(call.result && call.result.data && call.result.data.withheld),
  }));
  return {
    id: run.id,
    lifecycle: run.lifecycle,
    taskClass: run.taskClass,
    mode: run.mode,
    composerMode: run.composerMode,
    iteration: run.iteration,
    error: run.error,
    inspectSatisfied: run.progress && run.progress.inspectSatisfied,
    writeNow: run.progress && run.progress.writeNow,
    recommendedName: run.progress && run.progress.recommendedName,
    filesRead: run.progress && run.progress.filesRead,
    filesChanged: run.filesChanged,
    verification: run.verification,
    outcome: run.outcome,
    tools,
    writes: tools.filter((item) => item.name === "file.write"),
    hub: tools.filter((item) => item.name === "capability.invoke" || item.name === "capability.list"),
  };
}

async function main() {
  const page = await findComposer();
  const busy = await page.eval("document.querySelector('#stage').dataset.running === 'true'");
  if (busy) {
    await page.eval("document.querySelector('#stop').click()");
    const started = Date.now();
    while (Date.now() - started < 20000) {
      const running = await page.eval("document.querySelector('#stage').dataset.running");
      if (running === "false") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  await page.eval(`(() => {
    const mode = document.querySelector("#mode");
    mode.value = "code";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  const perm = await page.eval("document.querySelector('#perm').textContent");
  console.log(`mode ${JSON.stringify(perm)}`);

  await page.eval(`(() => {
    const prompt = document.querySelector("#prompt");
    prompt.focus();
    prompt.value = ${JSON.stringify(PROMPT)};
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#send").click();
  })()`);

  const started = Date.now();
  let runId = "";
  while (Date.now() - started < 20000) {
    runId = await page.eval("document.querySelector('#stage').dataset.runId || ''");
    if (/^run_/.test(runId)) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!/^run_/.test(runId)) throw new Error("run did not start");
  console.log(`started ${runId}`);

  let lastLine = "";
  let final = null;
  while (Date.now() - started < 360000) {
    const ui = await page.eval(`({
      stage: document.querySelector("#stage").dataset.stage,
      running: document.querySelector("#stage").dataset.running,
      activity: document.querySelector("#activity").textContent,
      notice: document.querySelector("#notice").textContent,
      tools: document.querySelector("#tools").innerText,
      thread: Array.from(document.querySelectorAll("#messages .bubble")).map((node) => node.className + ":" + node.textContent.slice(0, 120)),
      result: document.querySelector("#result").innerText,
    })`);
    const run = readRun(runId);
    const snap = summarize(run);
    const line = [
      ui.stage,
      ui.running === "true" ? "running" : "idle",
      ui.activity.replace(/\s+/g, " ").slice(0, 80),
      snap ? `${snap.iteration}/${run.maxIterations} ${snap.tools.map((item) => item.name).join(",")}` : "no-run",
    ].join(" | ");
    if (line !== lastLine) {
      console.log(line);
      lastLine = line;
    }
    if (ui.running === "false" && ui.stage !== "Waiting" && ui.stage !== "Understanding") {
      final = { ui, snap };
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  if (!final) throw new Error("timed out waiting for the live run");

  const { ui, snap } = final;
  console.log(JSON.stringify({ ui, snap }, null, 2));
  page.close();

  if (!snap) throw new Error("run file missing");
  if (snap.hub.length) throw new Error("hub was invoked on a layout job");
  if (!snap.writes.length) throw new Error(`no file.write: ${snap.lifecycle} ${(snap.error && snap.error.code) || ""}`);
  if (snap.lifecycle !== "completed") throw new Error(`expected completed, got ${snap.lifecycle} ${(snap.error && snap.error.message) || ""}`);
  const talk = (ui.thread || []).filter((item) => /^bubble assistant:(Let me |I need to |I'll )/i.test(item));
  if (talk.length) throw new Error(`progress talk leaked into the thread: ${talk.join(" | ")}`);
  console.log(`ok live layout ${snap.id} ${snap.lifecycle} writes=${snap.writes.map((item) => item.path).join(",")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
