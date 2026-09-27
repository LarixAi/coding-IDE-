const fs = require("fs");
const path = require("path");

function renderComposer(nonce) {
  const client = fs.readFileSync(path.join(__dirname, "composer-client.js"), "utf8")
    .replace(/if \(typeof module[\s\S]*$/, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${escapeHtml(nonce)}'; connect-src https: http: ws: wss:; media-src mediastream: blob:;" />
  <style>
    html, body { height: 100%; }
    body { margin: 0; color: #dfe4ec; background: #1c2027; font-family: var(--vscode-font-family); font-size: 13px; overflow: hidden; }
    .shell { height: 100%; min-width: 0; display: flex; flex-direction: column; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 32px; padding: 0 10px; flex-shrink: 0; }
    h1 { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.01em; }
    header .pickers { display: flex; align-items: center; gap: 6px; min-width: 0; }
    #model, #mode { max-width: min(140px, 46%); min-width: 0; background: transparent; color: #dfe4ec; border: 0; height: 22px; font: inherit; font-size: 12px; text-align: right; }
    .thread { flex: 1; min-height: 0; overflow: auto; padding: 8px 12px 16px; }
    .empty { margin: 28px 4px 0; color: #6b7689; font-size: 12px; line-height: 1.5; }
    .bubble { margin: 0 0 10px; max-width: 100%; min-width: 0; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
    .bubble.user { margin-left: 18%; color: #dfe4ec; font-size: 13px; }
    .bubble.assistant { color: #c7ced8; }
    .project-decision { display: none; margin: 0 0 10px; padding: 9px 10px; border: 1px solid #303640; border-radius: 9px; background: #181c22; }
    .project-decision.on { display: block; }
    .project-decision-title { margin: 0 0 3px; color: #dfe4ec; font-size: 12px; font-weight: 650; }
    .project-decision-meta { margin: 0 0 4px; color: #7fd3ea; font-size: 11px; }
    .project-decision-reason { margin: 0; color: #8e99aa; font-size: 11px; line-height: 1.4; }
    .activity { display: none; margin: 0 0 10px; color: #97a3b6; font-size: 12px; }
    .activity.on { display: block; }
    .tools { display: flex; flex-direction: column; gap: 8px; margin: 0 0 12px; }
    .tool-card { overflow: hidden; border: 1px solid #303640; border-radius: 9px; background: #181c22; color: #c7ced8; }
    .tool-card[open] { background: #171b21; }
    .tool-card.failed { border-color: #733b43; }
    .tool-card.running { border-color: #3d5964; }
    .tool-card summary { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 10px; cursor: pointer; list-style: none; user-select: none; }
    .tool-card summary::-webkit-details-marker { display: none; }
    .tool-kind { flex: 0 0 auto; min-width: 22px; color: #e8b66b; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 10px; font-weight: 700; }
    .tool-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #c7ced8; font-size: 12px; font-weight: 600; }
    .tool-stats { display: inline-flex; gap: 5px; flex: 0 0 auto; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 11px; }
    .tool-add { color: #63c58c; }
    .tool-remove { color: #e16e79; }
    .tool-state { flex: 0 0 auto; color: #6b7689; font-size: 11px; }
    .tool-card.running .tool-state { color: #7fd3ea; animation: codeme-pulse 1.1s ease-in-out infinite; }
    .tool-card.failed .tool-state { color: #ff918b; }
    @keyframes codeme-pulse { 50% { opacity: 0.35; } }
    .code-preview { max-height: 310px; overflow: auto; border-top: 1px solid #2a3038; background: #14181d; font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11px; line-height: 1.55; }
    .code-line { display: grid; grid-template-columns: 38px 18px minmax(0, 1fr); min-height: 18px; }
    .code-line.add { background: #173325; }
    .code-line.remove { background: #3a1f25; }
    .code-no { padding: 0 7px 0 4px; color: #667080; text-align: right; border-right: 1px solid #252b33; user-select: none; }
    .code-sign { text-align: center; color: #667080; user-select: none; }
    .code-line.add .code-sign { color: #63c58c; }
    .code-line.remove .code-sign { color: #e16e79; }
    .code-text { min-width: 0; padding: 0 8px 0 2px; white-space: pre; overflow-x: visible; color: #c7ced8; }
    .code-truncated { padding: 6px 10px; border-top: 1px solid #252b33; color: #6b7689; font-size: 10px; }
    .result { margin: 8px 0 0; }
    .result-title { margin: 0 0 4px; font-size: 12px; font-weight: 600; color: #dfe4ec; }
    .result-summary { margin: 0 0 8px; color: #c7ced8; }
    .result-count { margin: 0 0 6px; color: #97a3b6; font-size: 12px; }
    .file { margin: 0; }
    .file summary { cursor: pointer; color: #dfe4ec; font-size: 12px; list-style: none; }
    .file summary::-webkit-details-marker { display: none; }
    .file summary::before { content: "› "; color: #6b7689; }
    .file[open] summary::before { content: "⌄ "; }
    .file pre { margin: 6px 0 10px; white-space: pre-wrap; overflow-wrap: anywhere; color: #97a3b6; font-size: 11px; }
    .error { margin: 0 0 8px; color: #ff918b; font-size: 12px; }
    footer { flex-shrink: 0; padding: 0 8px 8px; }
    .notice { min-height: 0; margin: 0 2px 4px; color: #eebb58; font-size: 11px; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 2px 6px; }
    .chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-width: 0; color: #97a3b6; font-size: 11px; }
    .chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip button { border: 0; background: transparent; color: #6b7689; cursor: pointer; padding: 0; }
    .composer { display: flex; flex-direction: column; min-width: 0; border-radius: 8px; padding: 2px 4px 4px; }
    .shell.over .composer { outline: 1px solid #7fd3ea88; outline-offset: 2px; background: #7fd3ea10; }
    textarea { width: 100%; min-height: 56px; max-height: 180px; box-sizing: border-box; border: 0; resize: none; background: transparent; color: #dfe4ec; font: inherit; padding: 6px 4px 2px; outline: none; }
    .bar { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .bar button { border: 0; background: transparent; color: #97a3b6; height: 24px; padding: 0 6px; cursor: pointer; font: inherit; font-size: 12px; }
    #send, #stop { margin-left: auto; color: #7fd3ea; font-weight: 650; }
    #send[hidden], #stop[hidden] { display: none; }
    #send:disabled { opacity: 0.35; }
    #mic.on { color: #ff918b; }
    .perm { margin-left: 2px; color: #6b7689; font-size: 10px; }
    @media (max-width: 220px) {
      h1, .perm { display: none; }
      #model { max-width: 100%; text-align: left; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <h1>CodeMe</h1>
      <div class="pickers">
        <select id="mode" aria-label="Mode">
          <option value="ask">Ask</option>
          <option value="plan">Plan</option>
          <option value="code">Code</option>
        </select>
        <select id="model" aria-label="Model"></select>
      </div>
    </header>
    <div class="thread" id="thread">
      <p class="empty" id="empty">Ask about this workspace.</p>
      <div id="messages"></div>
      <div class="project-decision" id="project-decision"></div>
      <p class="activity" id="activity"></p>
      <div class="tools" id="tools"></div>
      <div class="result" id="result"></div>
    </div>
    <footer>
      <p class="notice" id="notice"></p>
      <div class="chips" id="chips"></div>
      <div class="composer" id="drop">
        <textarea id="prompt" placeholder="Ask, drop a file, or use Voice…" rows="3"></textarea>
        <div class="bar">
          <button type="button" id="attach" title="Attach files">Attach</button>
          <button type="button" id="mic" title="Voice to text" aria-pressed="false">Voice</button>
          <span class="perm" id="perm"></span>
          <button type="button" id="send">Send</button>
          <button type="button" id="stop" hidden>Stop</button>
        </div>
      </div>
    </footer>
    <p hidden id="stage">Waiting</p>
  </div>
  <script nonce="${escapeHtml(nonce)}">
    ${client}
    const vscode = acquireVsCodeApi();
    const prompt = document.getElementById("prompt");
    const send = document.getElementById("send");
    const stop = document.getElementById("stop");
    const model = document.getElementById("model");
    const mode = document.getElementById("mode");
    const stage = document.getElementById("stage");
    const activity = document.getElementById("activity");
    const projectDecision = document.getElementById("project-decision");
    const messages = document.getElementById("messages");
    const tools = document.getElementById("tools");
    const result = document.getElementById("result");
    const chips = document.getElementById("chips");
    const notice = document.getElementById("notice");
    const empty = document.getElementById("empty");
    const drop = document.getElementById("drop");
    const mic = document.getElementById("mic");
    const thread = document.getElementById("thread");
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    let rec = null;
    let listening = false;
    let spoken = "";
    let running = false;
    let sending = false;
    let requestId = "";
    let epoch = 0;
    let shownRun = "";
    let draft = "";
    function sendPrompt() {
      stopVoice();
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
    prompt.addEventListener("input", () => {
      prompt.style.height = "auto";
      prompt.style.height = Math.min(180, prompt.scrollHeight) + "px";
    });
    send.addEventListener("click", sendPrompt);
    stop.addEventListener("click", () => vscode.postMessage({ type: "cancel", requestId }));
    document.getElementById("attach").addEventListener("click", () => vscode.postMessage({ type: "pick" }));
    function setMic(on) {
      listening = on;
      mic.classList.toggle("on", on);
      mic.setAttribute("aria-pressed", on ? "true" : "false");
      mic.title = on ? "Stop voice" : "Voice to text";
      mic.textContent = on ? "Stop" : "Voice";
    }
    function stopVoice() {
      if (rec) {
        try { rec.stop(); } catch {}
      }
      setMic(false);
    }
    function startVoice() {
      const action = composerVoiceAction(listening, Boolean(Speech));
      if (action === "unavailable") {
        notice.textContent = "Voice to text is not available in this window.";
        return;
      }
      if (action === "stop") {
        stopVoice();
        return;
      }
      rec = new Speech();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || "en-GB";
      spoken = prompt.value;
      rec.onresult = (event) => {
        let interim = "";
        let done = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i][0].transcript;
          if (event.results[i].isFinal) done += piece;
          else interim += piece;
        }
        if (done) spoken = (spoken && !/\\s$/.test(spoken) ? spoken + " " : spoken) + done.trim();
        prompt.value = [spoken, interim.trim()].filter(Boolean).join(spoken && interim ? " " : "");
        prompt.dispatchEvent(new Event("input"));
      };
      rec.onerror = (event) => {
        if (event.error === "not-allowed") notice.textContent = "Microphone access is blocked.";
        else if (event.error !== "aborted" && event.error !== "no-speech") notice.textContent = "Voice to text stopped.";
        setMic(false);
      };
      rec.onend = () => setMic(false);
      try {
        rec.start();
        setMic(true);
        notice.textContent = "";
      } catch {
        notice.textContent = "Voice to text could not start.";
        setMic(false);
      }
    }
    mic.addEventListener("click", startVoice);
    model.addEventListener("change", () => {
      const option = model.selectedOptions[0];
      if (!option) return;
      vscode.postMessage({ type: "select-model", provider: option.dataset.provider, id: option.value });
    });
    mode.addEventListener("change", () => vscode.postMessage({ type: "select-mode", mode: mode.value }));
    const shell = document.querySelector(".shell");
    function acceptDrag(event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      shell.classList.add("over");
    }
    document.addEventListener("dragenter", acceptDrag);
    document.addEventListener("dragover", acceptDrag);
    document.addEventListener("dragleave", (event) => {
      if (!document.documentElement.contains(event.relatedTarget)) shell.classList.remove("over");
    });
    document.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      shell.classList.remove("over");
      collectDrops(event.dataTransfer).then((files) => {
        vscode.postMessage({ type: "attach", files });
      });
    });
    async function collectDrops(transfer) {
      const listed = droppedPaths(transfer);
      const files = listed.map((item) => ({ path: item.path }));
      const names = new Set(files.map((item) => String(item.path || "").split("/").pop()));
      if (!transfer || !transfer.files) return files;
      for (const file of transfer.files) {
        if (file.path) {
          if (!files.some((item) => item.path === file.path)) files.push({ path: file.path, name: file.name, type: file.type, size: file.size });
          continue;
        }
        if (names.has(file.name)) continue;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const chunk = 0x8000;
        let binary = "";
        for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        files.push({ name: file.name, type: file.type, size: file.size, contents: btoa(binary) });
      }
      return files;
    }
    function current(message) {
      return !(typeof message.epoch === "number" && message.epoch !== epoch);
    }
    function applyState(state) {
      if (!current(state)) return;
      if (state.requestId) requestId = state.requestId;
      running = Boolean(state.running);
      stage.textContent = state.stage || "Waiting";
      stage.dataset.stage = state.stage || "Waiting";
      stage.dataset.runId = state.runId || "";
      stage.dataset.running = running ? "true" : "false";
      stage.dataset.model = state.selected ? state.selected.id : "";
      stage.dataset.provider = state.selected ? state.selected.provider : "";
      const line = state.activity || "";
      activity.textContent = line;
      activity.classList.toggle("on", running && Boolean(line));
      stop.hidden = !running;
      send.hidden = running;
      send.disabled = running || sending;
      prompt.disabled = false;
      notice.textContent = state.notice || "";
      const picked = normalizeComposerMode(state.composerMode || state.mode);
      document.getElementById("perm").textContent = composerModeLabel(picked);
      mode.value = picked;
      model.innerHTML = "";
      for (const item of state.models || []) {
        const option = document.createElement("option");
        option.value = item.id;
        option.dataset.provider = item.provider;
        option.dataset.source = "provider";
        option.textContent = item.label;
        option.selected = Boolean(state.selected && state.selected.id === item.id && state.selected.provider === item.provider);
        model.appendChild(option);
      }
      chips.innerHTML = "";
      for (const item of state.attachments || []) {
        const chip = document.createElement("span");
        chip.className = "chip";
        const label = document.createElement("span");
        label.textContent = item.name + " · " + (item.type || "text/plain") + " · " + formatSize(item.size);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.setAttribute("aria-label", "Remove " + item.name);
        remove.addEventListener("click", () => vscode.postMessage({ type: "detach", id: item.id }));
        chip.appendChild(label);
        chip.appendChild(remove);
        chips.appendChild(chip);
      }
      renderThread(state.thread || []);
      renderProjectDecision(state.projectDecision || null);
      renderTools(state.tools || []);
      if (running) {
        result.innerHTML = "";
        shownRun = "";
      } else if (state.outcome && state.runId && state.runId !== shownRun) {
        shownRun = state.runId;
        renderResult(state);
      }
      empty.hidden = Boolean(messages.childElementCount || running);
      thread.scrollTop = thread.scrollHeight;
    }
    function renderProjectDecision(decision) {
      projectDecision.innerHTML = "";
      projectDecision.classList.toggle("on", Boolean(decision));
      if (!decision) return;

      const title = document.createElement("p");
      title.className = "project-decision-title";
      title.textContent = "Project type: " + (decision.label || decision.kind || "Unknown");

      const meta = document.createElement("p");
      meta.className = "project-decision-meta";
      const dependencies = decision.dependenciesRequired === true
        ? "Dependencies allowed when required"
        : decision.dependenciesRequired === false
          ? "No dependencies required"
          : "Preserve existing dependencies";
      meta.textContent = dependencies + (decision.framework ? " · " + decision.framework : "");

      const reason = document.createElement("p");
      reason.className = "project-decision-reason";
      reason.textContent = decision.reason || "";

      projectDecision.appendChild(title);
      projectDecision.appendChild(meta);
      if (reason.textContent) projectDecision.appendChild(reason);
    }

    function formatSize(size) {
      const bytes = Number(size) || 0;
      if (bytes >= 1024) return Math.round(bytes / 1024) + " KB";
      return bytes + " B";
    }
    function outcomeText(state) {
      const outcome = state.outcome || {};
      return String(outcome.summary || outcome.reason || state.stage || "").trim();
    }
    function renderTools(items) {
      tools.innerHTML = "";
      if (!items || !items.length) return;
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const row = document.createElement("details");
        row.className = "tool-card " + (item.status || "");
        const hasPreview = Boolean((item.name === "file.write" || item.name === "file.patch") && item.preview && item.preview.lines && item.preview.lines.length);
        row.open = hasPreview && (item.status === "running" || index >= items.length - 3);

        const summary = document.createElement("summary");
        const kind = document.createElement("span");
        kind.className = "tool-kind";
        kind.textContent = toolKind(item);
        const label = document.createElement("span");
        label.className = "tool-label";
        label.textContent = toolLabel(item);
        summary.appendChild(kind);
        summary.appendChild(label);

        if ((item.name === "file.write" || item.name === "file.patch") && item.preview) {
          const stats = document.createElement("span");
          stats.className = "tool-stats";
          const add = document.createElement("span");
          add.className = "tool-add";
          add.textContent = "+" + Number(item.preview.additions || 0);
          const remove = document.createElement("span");
          remove.className = "tool-remove";
          remove.textContent = "-" + Number(item.preview.removals || 0);
          stats.appendChild(add);
          stats.appendChild(remove);
          summary.appendChild(stats);
        }

        const state = document.createElement("span");
        state.className = "tool-state";
        state.textContent = item.status === "running" ? "●" : (item.status === "failed" ? "!" : "✓");
        summary.appendChild(state);
        row.appendChild(summary);

        if (hasPreview) {
          const preview = document.createElement("div");
          preview.className = "code-preview";
          for (const line of item.preview.lines) {
            const code = document.createElement("div");
            code.className = "code-line " + (line.type || "context");
            const number = document.createElement("span");
            number.className = "code-no";
            number.textContent = String(line.newNumber || line.oldNumber || "");
            const sign = document.createElement("span");
            sign.className = "code-sign";
            sign.textContent = line.type === "add" ? "+" : (line.type === "remove" ? "−" : " ");
            const body = document.createElement("span");
            body.className = "code-text";
            body.textContent = line.text || " ";
            code.appendChild(number);
            code.appendChild(sign);
            code.appendChild(body);
            preview.appendChild(code);
          }
          if (item.preview.truncated) {
            const more = document.createElement("div");
            more.className = "code-truncated";
            more.textContent = "Preview shortened — the full file was still written.";
            preview.appendChild(more);
          }
          row.appendChild(preview);
        }

        tools.appendChild(row);
      }
    }
    function toolKind(item) {
      if (item.name === "file.write" || item.name === "file.patch" || item.name === "file.read") {
        const name = String(item.path || "");
        const dot = name.lastIndexOf(".");
        return dot >= 0 ? name.slice(dot + 1).toUpperCase().slice(0, 4) : "FILE";
      }
      if (item.name === "dir.create" || item.name === "dir.list") return "DIR";
      if (item.name === "workspace.inspect") return "WS";
      if (item.name === "repo.search") return "FIND";
      if (item.name === "tests.run") return "TEST";
      if (item.name === "terminal.run") return "TERM";
      if (item.name === "process.start") return "PROC";
      if (item.name === "browser.check") return "WEB";
      if (item.name === "capability.invoke" || item.name === "capability.list") return "HUB";
      if (item.name === "diagnostics.run") return "DIAG";
      if (item.name === "git.diff" || item.name === "git.status") return "GIT";
      return "TOOL";
    }
    function toolLabel(item) {
      const live = item.status === "running";
      if (item.name === "workspace.inspect") return live ? "Inspecting workspace" : "Inspected workspace";
      if (item.name === "dir.list") return (live ? "Listing " : "Listed ") + (item.path || "workspace");
      if (item.name === "dir.create") return (live ? "Creating folder " : "Created folder ") + (item.path || "");
      if (item.name === "file.read") return (live ? "Reading " : "Read ") + (item.path || "file");
      if (item.name === "file.write") {
        const verb = item.operation === "create"
          ? (live ? "Creating " : "Created ")
          : (live ? "Editing " : "Edited ");
        return verb + (item.path || "file");
      }
      if (item.name === "file.patch") return (live ? "Patching " : "Patched ") + (item.path || "file");
      if (item.name === "repo.search") return (live ? "Searching " : "Searched ") + (item.path || "workspace");
      if (item.name === "tests.run") return live ? "Running tests" : "Ran tests";
      if (item.name === "terminal.run") return live ? "Running command" : "Ran command";
      if (item.name === "process.start") return live ? "Starting preview process" : "Started preview process";
      if (item.name === "browser.check") return live ? "Checking preview" : "Checked preview";
      if (item.name === "diagnostics.run") return live ? "Checking diagnostics" : "Checked diagnostics";
      if (item.name === "git.diff") return live ? "Reviewing changes" : "Reviewed changes";
      if (item.name === "git.status") return live ? "Checking Git status" : "Checked Git status";
      if (item.name === "capability.invoke") return live ? "Researching documentation" : "Researched documentation";
      if (item.name === "capability.list") return live ? "Checking available capabilities" : "Checked available capabilities";
      return item.name;
    }
    function renderResult(state) {
      result.innerHTML = "";
      const files = state.fileDiffs && state.fileDiffs.length ? state.fileDiffs : (state.filesChanged || []).map((file) => ({ path: file, diff: "" }));
      const title = document.createElement("p");
      title.className = "result-title";
      title.textContent = state.stage === "Complete" ? "Complete" : (state.stage === "Cancelled" ? "Stopped" : (state.stage || ""));
      result.appendChild(title);
      const summary = document.createElement("p");
      summary.className = "result-summary";
      summary.textContent = outcomeText(state);
      result.appendChild(summary);
      if (state.verification && state.verification.status && state.verification.status !== "pending") {
        const verify = document.createElement("p");
        verify.className = "result-count";
        verify.textContent = "Verification " + state.verification.status + (state.verification.summary ? ": " + state.verification.summary : "");
        result.appendChild(verify);
      }
      if (files.length) {
        const count = document.createElement("p");
        count.className = "result-count";
        count.textContent = files.length + (files.length === 1 ? " file changed" : " files changed");
        result.appendChild(count);
        for (const file of files) {
          const row = document.createElement("details");
          row.className = "file";
          const header = document.createElement("summary");
          header.textContent = file.path;
          row.appendChild(header);
          if (file.diff) {
            const pre = document.createElement("pre");
            pre.textContent = file.diff;
            row.appendChild(pre);
          }
          result.appendChild(row);
        }
      }
    }
    function renderThread(items) {
      messages.innerHTML = "";
      for (const item of items) addMessage(item.role, item.text);
    }
    function addMessage(role, text) {
      const item = document.createElement("div");
      item.className = "bubble " + role;
      item.textContent = text;
      messages.appendChild(item);
      empty.hidden = true;
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
        prompt.style.height = "";
        draft = "";
        sending = false;
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
