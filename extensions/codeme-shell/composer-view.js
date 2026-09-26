const fs = require("fs");
const path = require("path");

function renderComposer(nonce) {
  const client = fs.readFileSync(path.join(__dirname, "composer-client.js"), "utf8")
    .replace(/if \(typeof module[\s\S]*$/, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${escapeHtml(nonce)}';" />
  <style>
    html, body { height: 100%; }
    body { margin: 0; color: #dfe4ec; background: #1c2027; font-family: var(--vscode-font-family); font-size: 13px; }
    .shell { height: 100%; display: flex; flex-direction: column; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 36px; padding: 0 10px; border-bottom: 1px solid #2a3038; background: #171b23; }
    h1 { margin: 0; font-size: 12px; font-weight: 600; }
    select { max-width: 180px; background: #171b23; color: #dfe4ec; border: 1px solid #2a3038; border-radius: 6px; height: 24px; }
    .thread { flex: 1; overflow: auto; padding: 12px; }
    .stage { margin: 0 0 10px; color: #7fd3ea; font-size: 12px; font-weight: 600; }
    .steps { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 12px; padding: 0; list-style: none; }
    .steps li { color: #6b7689; font-size: 11px; }
    .steps li.now { color: #dfe4ec; }
    .bubble { margin: 0 0 8px; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; line-height: 1.45; }
    .bubble.user { background: #2b3a48; }
    .bubble.assistant { background: #171b23; border: 1px solid #2a3038; }
    .error { color: #ff918b; margin: 0 0 8px; }
    .card { border: 1px solid #2a3038; border-radius: 6px; padding: 8px 10px; margin: 0 0 8px; }
    .card h2 { margin: 0 0 4px; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: #97a3b6; }
    .card p, .card li { margin: 0; color: #dfe4ec; }
    details pre { white-space: pre-wrap; color: #97a3b6; font-size: 11px; }
    footer { border-top: 1px solid #2a3038; padding: 8px; background: #171b23; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
    .chip { display: flex; align-items: center; gap: 6px; border: 1px solid #2a3038; border-radius: 6px; padding: 4px 6px; background: #1c2027; }
    .chip button { border: 0; background: transparent; color: #97a3b6; cursor: pointer; }
    .drop { border: 1px solid #2a3038; border-radius: 6px; background: #1c2027; }
    .drop.over { border-color: #7fd3ea; }
    textarea { width: 100%; min-height: 64px; box-sizing: border-box; border: 0; resize: vertical; background: transparent; color: #dfe4ec; font: inherit; padding: 8px; outline: none; }
    .bar { display: flex; align-items: center; gap: 8px; padding: 0 8px 8px; }
    .bar button, .ghost { border: 1px solid #2a3038; background: #1c2027; color: #dfe4ec; border-radius: 6px; height: 24px; padding: 0 8px; cursor: pointer; }
    #send { margin-left: auto; background: #7fd3ea; color: #171b23; border: 0; font-weight: 700; }
    #send:disabled, #stop[hidden] { opacity: 0.45; }
    .notice { color: #eebb58; font-size: 11px; margin: 0 0 6px; }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <h1>CodeMe</h1>
      <select id="model" aria-label="Model"></select>
    </header>
    <div class="thread" id="thread">
      <p class="stage" id="stage">Waiting</p>
      <ol class="steps" id="steps"></ol>
      <div id="messages"></div>
      <div id="result"></div>
    </div>
    <footer>
      <p class="notice" id="notice"></p>
      <div class="chips" id="chips"></div>
      <div class="drop" id="drop">
        <textarea id="prompt" placeholder="Describe the change…"></textarea>
        <div class="bar">
          <button type="button" id="attach" class="ghost">Attach</button>
          <button type="button" id="stop" hidden>Stop</button>
          <button type="button" id="send">↑</button>
        </div>
      </div>
    </footer>
  </div>
  <script nonce="${escapeHtml(nonce)}">
    ${client}
    const vscode = acquireVsCodeApi();
    const prompt = document.getElementById("prompt");
    const send = document.getElementById("send");
    const stop = document.getElementById("stop");
    const model = document.getElementById("model");
    const steps = document.getElementById("steps");
    const stage = document.getElementById("stage");
    const messages = document.getElementById("messages");
    const result = document.getElementById("result");
    const chips = document.getElementById("chips");
    const notice = document.getElementById("notice");
    const drop = document.getElementById("drop");
    let running = false;
    let sending = false;
    let requestId = "";
    let epoch = 0;
    let shownRun = "";
    let draft = "";
    const trail = COMPOSER_STAGES.filter((name) => name !== "Waiting" && name !== "Failed" && name !== "Cancelled");
    steps.innerHTML = trail.map((name) => '<li data-stage="' + name + '">' + name + "</li>").join("");
    function sendPrompt() {
      if (sending || running) return;
      const text = prompt.value;
      if (!text.trim() && !chips.childElementCount) return;
      sending = true;
      draft = text;
      epoch += 1;
      send.disabled = true;
      vscode.postMessage({ type: "submit", text, epoch });
    }
    prompt.addEventListener("keydown", (event) => {
      const action = composerKeyAction({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: event.isComposing,
        keyCode: event.keyCode,
      });
      if (action === "newline") {
        event.preventDefault();
        const start = prompt.selectionStart;
        const end = prompt.selectionEnd;
        prompt.value = prompt.value.slice(0, start) + "\\n" + prompt.value.slice(end);
        prompt.selectionStart = prompt.selectionEnd = start + 1;
        return;
      }
      if (action === "send") {
        event.preventDefault();
        sendPrompt();
      }
    });
    send.addEventListener("click", sendPrompt);
    stop.addEventListener("click", () => vscode.postMessage({ type: "cancel", requestId }));
    document.getElementById("attach").addEventListener("click", () => vscode.postMessage({ type: "pick" }));
    model.addEventListener("change", () => {
      const option = model.selectedOptions[0];
      if (!option) return;
      vscode.postMessage({ type: "select-model", provider: option.dataset.provider, id: option.value });
    });
    drop.addEventListener("dragover", (event) => {
      event.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      drop.classList.remove("over");
      const paths = droppedPaths(event.dataTransfer);
      if (paths.length) vscode.postMessage({ type: "attach", files: paths });
    });
    function droppedPaths(transfer) {
      const found = [];
      const resource = transfer.getData("resourceurls");
      if (resource) {
        try {
          for (const item of JSON.parse(resource)) found.push({ path: String(item) });
        } catch {}
      }
      const list = transfer.getData("text/uri-list") || transfer.getData("text/plain");
      if (list) {
        for (const line of list.split(/\\r?\\n/)) {
          const value = line.trim();
          if (value && !value.startsWith("#")) found.push({ path: value });
        }
      }
      return found;
    }
    function current(message) {
      return !(typeof message.epoch === "number" && message.epoch !== epoch);
    }
    function applyState(state) {
      if (!current(state)) return;
      if (state.requestId && requestId && state.requestId !== requestId) return;
      running = Boolean(state.running);
      stage.textContent = state.stage || "Waiting";
      stage.dataset.stage = state.stage || "Waiting";
      stage.dataset.runId = state.runId || "";
      stage.dataset.running = running ? "true" : "false";
      stage.dataset.model = state.selected ? state.selected.id : "";
      stage.dataset.provider = state.selected ? state.selected.provider : "";
      for (const item of steps.querySelectorAll("li")) item.classList.toggle("now", item.dataset.stage === state.stage);
      stop.hidden = !running;
      send.disabled = running || sending;
      prompt.disabled = running;
      notice.textContent = state.notice || state.error || "";
      model.innerHTML = "";
      for (const item of state.models || []) {
        const option = document.createElement("option");
        option.value = item.id;
        option.dataset.provider = item.provider;
        option.textContent = item.label;
        option.selected = Boolean(state.selected && state.selected.id === item.id && state.selected.provider === item.provider);
        model.appendChild(option);
      }
      chips.innerHTML = "";
      for (const item of state.attachments || []) {
        const chip = document.createElement("span");
        chip.className = "chip";
        const label = document.createElement("span");
        label.textContent = item.name + " · " + item.type + " · " + item.size + " B";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.setAttribute("aria-label", "Remove " + item.name);
        remove.addEventListener("click", () => vscode.postMessage({ type: "detach", id: item.id }));
        chip.appendChild(label);
        chip.appendChild(remove);
        chips.appendChild(chip);
      }
      if (!running && state.outcome && state.runId && state.runId !== shownRun) {
        shownRun = state.runId;
        addMessage("assistant", outcomeText(state));
        renderResult(state);
      }
    }
    function outcomeText(state) {
      const outcome = state.outcome || {};
      return outcome.summary || outcome.reason || state.stage;
    }
    function renderResult(state) {
      const files = state.filesChanged || [];
      const verification = state.verification && state.verification.summary ? state.verification.summary : "";
      result.innerHTML = "";
      const card = document.createElement("div");
      card.className = "card";
      const title = document.createElement("h2");
      title.textContent = state.stage || "";
      const body = document.createElement("p");
      body.textContent = outcomeText(state);
      card.appendChild(title);
      card.appendChild(body);
      if (state.runId) {
        const id = document.createElement("p");
        id.textContent = state.runId;
        card.appendChild(id);
      }
      if (files.length) {
        const list = document.createElement("ul");
        for (const file of files) {
          const item = document.createElement("li");
          item.textContent = file;
          list.appendChild(item);
        }
        card.appendChild(list);
      }
      if (verification) {
        const check = document.createElement("p");
        check.textContent = verification;
        card.appendChild(check);
      }
      if (state.diff) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "Diff";
        const pre = document.createElement("pre");
        pre.textContent = state.diff;
        details.appendChild(summary);
        details.appendChild(pre);
        card.appendChild(details);
      }
      result.appendChild(card);
    }
    function addMessage(role, text) {
      const item = document.createElement("div");
      item.className = "bubble " + role;
      item.textContent = text;
      messages.appendChild(item);
    }
    let sawState = false;
    window.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.type === "state") {
        sawState = true;
        applyState(message);
      }
      if (message.type === "accepted" && current(message) && sameRequest(message.requestId, message.requestId)) {
        requestId = message.requestId;
        prompt.value = "";
        draft = "";
        sending = false;
        addMessage("user", message.text || "");
        send.disabled = running;
      }
      if (message.type === "rejected" && current(message)) {
        sending = false;
        send.disabled = running;
        notice.textContent = message.message || "Could not send.";
        if (!prompt.value && draft) prompt.value = draft;
      }
    });
    const readyTimer = setInterval(() => {
      if (sawState) {
        clearInterval(readyTimer);
        return;
      }
      vscode.postMessage({ type: "ready" });
    }, 300);
    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

module.exports = { renderComposer };
