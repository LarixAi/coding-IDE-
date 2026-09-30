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
    body { margin: 0; color: #d9dee7; background: #191c21; font-family: var(--vscode-font-family); font-size: 12px; overflow: hidden; }
    .shell { position: relative; height: 100%; min-width: 0; display: flex; flex-direction: column; }
    header { display: flex; align-items: center; min-height: 30px; padding: 0 7px 0 10px; flex-shrink: 0; border-bottom: 1px solid #252a31; }
    .title-tools { display: flex; align-items: center; gap: 3px; min-width: 0; width: 100%; }
    h1 { margin: 0 auto 0 0; font-size: 11px; font-weight: 600; letter-spacing: 0.01em; color: #cfd5df; }
    .header-action { display: inline-flex; align-items: center; justify-content: center; height: 22px; min-width: 22px; padding: 0 5px; border: 0; border-radius: 4px; background: transparent; color: #778291; cursor: pointer; font: inherit; font-size: 10px; }
    .header-action:hover { background: #232830; color: #d9dee7; }
    .header-action:disabled { opacity: 0.35; cursor: default; }
    #new-chat { font-size: 15px; line-height: 1; }
    .history-panel { display: none; position: absolute; z-index: 20; top: 32px; left: 7px; right: 7px; max-height: min(420px, 62%); overflow: hidden; border: 1px solid #343a44; border-radius: 7px; background: #171a1f; box-shadow: 0 12px 28px #0008; }
    .history-panel.on { display: flex; flex-direction: column; }
    .history-head { display: flex; align-items: center; justify-content: space-between; min-height: 32px; padding: 0 9px; border-bottom: 1px solid #292e36; color: #d9dee7; font-size: 11px; }
    .history-head button { border: 0; background: transparent; color: #778291; cursor: pointer; font-size: 15px; }
    .history-list { overflow: auto; padding: 4px; }
    .history-empty { padding: 14px 9px; color: #687382; font-size: 10px; text-align: center; }
    .history-item { display: block; width: 100%; padding: 7px 8px; border: 0; border-radius: 5px; background: transparent; color: inherit; cursor: pointer; text-align: left; }
    .history-item:hover { background: #22272e; }
    .history-item.active { background: #252c34; }
    .history-title { display: block; overflow: hidden; color: #c6cdd7; font-size: 11px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
    .history-meta { display: block; margin-top: 2px; color: #66717f; font-size: 9px; }

    .thread { flex: 1; min-height: 0; overflow: auto; padding: 9px 10px 16px; }
    .empty { margin: 24px 2px 0; color: #67717f; font-size: 11px; line-height: 1.5; }
    .bubble { margin: 0 1px 10px; max-width: 100%; min-width: 0; line-height: 1.48; white-space: pre-wrap; overflow-wrap: anywhere; }
    .bubble.user { color: #e0e4ea; font-size: 12px; font-weight: 500; }
    .bubble.assistant { color: #c8ced8; }

    .project-decision { display: none; margin: 1px 1px 7px; color: #75808f; font-size: 10px; line-height: 1.35; }
    .project-decision.on { display: flex; align-items: baseline; gap: 5px; flex-wrap: wrap; }
    .project-decision-title, .project-decision-meta, .project-decision-reason { margin: 0; font-size: inherit; font-weight: 400; color: inherit; }
    .project-decision-title { color: #909aa8; }
    .project-decision-reason { display: none; }

    .activity { display: none; margin: 2px 1px 7px; color: #798493; font-size: 10px; }
    .activity.on { display: block; }
    .activity.on::before { content: "●"; margin-right: 5px; color: #7fc9dd; animation: codeme-pulse 1.1s ease-in-out infinite; }

    .tools { display: flex; flex-direction: column; gap: 1px; margin: 0 0 9px; }
    .work-note { margin: 8px 1px 5px; color: #c8ced8; font-size: 12px; line-height: 1.48; white-space: pre-wrap; overflow-wrap: anywhere; }
    .tool-card { overflow: hidden; border: 0; border-radius: 4px; background: transparent; color: #aeb7c3; }
    .tool-card summary { display: flex; align-items: center; gap: 6px; min-height: 23px; padding: 0 2px; cursor: pointer; list-style: none; user-select: none; }
    .tool-card summary::-webkit-details-marker { display: none; }
    .tool-card summary:hover { background: #22272e; }
    .tool-card.failed summary { background: #342025; color: #efb5ba; }
    .tool-kind { flex: 0 0 auto; width: 17px; color: #778291; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 11px; text-align: center; }
    .tool-card.failed .tool-kind { color: #ff918b; }
    .tool-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #aeb7c3; font-size: 11px; font-weight: 400; }
    .tool-card.failed .tool-label { color: #efb5ba; }
    .tool-stats { display: inline-flex; gap: 4px; flex: 0 0 auto; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 10px; }
    .tool-add { color: #64bd88; }
    .tool-remove { color: #df7780; }
    .tool-state { flex: 0 0 auto; width: 12px; color: #687382; font-size: 10px; text-align: center; }
    .tool-card.running .tool-state { color: #7fc9dd; animation: codeme-pulse 1.1s ease-in-out infinite; }
    .tool-card.failed .tool-state { color: #ff918b; }
    @keyframes codeme-pulse { 50% { opacity: 0.35; } }

    .tool-detail { margin: 2px 4px 6px 24px; padding: 7px 8px; max-height: 220px; overflow: auto; border-left: 1px solid #343b45; background: #15181c; color: #9ba5b3; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 10px; line-height: 1.45; }
    .code-preview { margin: 2px 4px 6px 24px; max-height: 260px; overflow: auto; border-left: 1px solid #343b45; background: #15181c; font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 10px; line-height: 1.5; }
    .code-line { display: grid; grid-template-columns: 34px 16px minmax(0, 1fr); min-height: 17px; }
    .code-line.add { background: #173024; }
    .code-line.remove { background: #351f24; }
    .code-no { padding: 0 6px 0 3px; color: #5f6976; text-align: right; border-right: 1px solid #252a31; user-select: none; }
    .code-sign { text-align: center; color: #5f6976; user-select: none; }
    .code-line.add .code-sign { color: #64bd88; }
    .code-line.remove .code-sign { color: #df7780; }
    .code-text { min-width: 0; padding: 0 7px 0 2px; white-space: pre; overflow-x: visible; color: #bbc2cc; }
    .code-truncated { padding: 5px 8px; border-top: 1px solid #252a31; color: #687382; font-size: 9px; }

    .result { margin: 7px 0 0; }
    .result-summary { margin: 0 1px 8px; color: #c8ced8; line-height: 1.48; white-space: pre-wrap; }
    .error { margin: 0 1px 7px; color: #ff918b; font-size: 11px; }

    footer { flex-shrink: 0; padding: 0 7px 7px; background: linear-gradient(to bottom, #191c2100, #191c21 10px); }
    .changed-files { display: none; margin: 0 1px 6px; padding-top: 6px; border-top: 1px solid #272c33; }
    .changed-files.on { display: block; }
    .changed-head { display: flex; align-items: center; justify-content: space-between; min-height: 20px; color: #909aa8; font-size: 10px; }
    .changed-hint { color: #687382; }
    .changed-row { margin: 0; border-radius: 4px; }
    .changed-row summary { display: flex; align-items: center; gap: 5px; min-height: 22px; padding: 0 2px; list-style: none; cursor: pointer; color: #aeb7c3; font-size: 10px; }
    .changed-row summary::-webkit-details-marker { display: none; }
    .changed-row summary:hover { background: #22272e; }
    .changed-icon { width: 17px; color: #778291; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); text-align: center; }
    .changed-path { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .changed-stats { display: inline-flex; gap: 4px; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
    .changed-diff { margin: 2px 2px 5px 24px; padding: 6px 7px; max-height: 180px; overflow: auto; border-left: 1px solid #343b45; background: #15181c; color: #929caa; white-space: pre; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 9px; line-height: 1.45; }

    .notice { min-height: 0; margin: 0 2px 4px; color: #d8ad59; font-size: 10px; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 2px 5px; }
    .chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-width: 0; padding: 2px 4px; border-radius: 4px; background: #22272e; color: #909aa8; font-size: 10px; }
    .chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip button { border: 0; background: transparent; color: #687382; cursor: pointer; padding: 0; }

    .composer { display: flex; flex-direction: column; min-width: 0; border: 1px solid #343a44; border-radius: 8px; background: #20242a; padding: 2px 4px 4px; box-shadow: 0 1px 0 #0004; }
    .shell.over .composer { outline: 1px solid #7fc9dd88; outline-offset: 2px; background: #7fc9dd0d; }
    textarea { width: 100%; min-height: 45px; max-height: 160px; box-sizing: border-box; border: 0; resize: none; background: transparent; color: #e0e4ea; font: inherit; font-size: 12px; line-height: 1.4; padding: 7px 5px 3px; outline: none; }
    textarea::placeholder { color: #697482; }
    .bar { display: flex; align-items: center; gap: 3px; min-width: 0; }
    .bar button, .bar select { border: 0; background: transparent; color: #909aa8; height: 24px; padding: 0 5px; cursor: pointer; font: inherit; font-size: 10px; border-radius: 4px; }
    .bar button:hover, .bar select:hover { background: #2a2f36; color: #d6dbe3; }
    .bar button:disabled, .bar select:disabled { opacity: 0.4; cursor: default; }
    #attach { flex: 0 0 auto; }
    #mode { flex: 0 0 auto; max-width: 64px; color: #b8c0cb; }
    #model { min-width: 0; max-width: 118px; color: #b8c0cb; text-overflow: ellipsis; }
    #model-refresh { flex: 0 0 auto; width: 22px; padding: 0; font-size: 13px; }
    #model-refresh.loading { animation: codeme-spin 0.8s linear infinite; }
    @keyframes codeme-spin { to { transform: rotate(360deg); } }
    #send { margin-left: auto; width: 24px; padding: 0; border-radius: 6px; background: #7fc9dd; color: #172027; font-size: 14px; font-weight: 700; }
    #send:hover { background: #91d7e8; color: #172027; }
    #send:disabled { opacity: 0.35; }
    #stop { width: 24px; padding: 0; color: #aab3bf; }
    #send[hidden], #stop[hidden] { display: none; }
    #mic.on { color: #ff918b; }
    #n8n-toggle.on { color: #7fc9dd; }
    .n8n-panel { display: none; margin: 0 0 6px; padding: 8px; border: 1px solid #343a44; border-radius: 7px; background: #1d2127; }
    .n8n-panel.on { display: block; }
    .n8n-title { margin: 0 0 6px; color: #d7dce4; font-size: 10.5px; font-weight: 650; }
    .n8n-row { display: flex; align-items: center; gap: 5px; margin: 5px 0; color: #9da7b4; font-size: 10px; }
    .n8n-row input[type="text"], .n8n-row input[type="password"] { flex: 1; min-width: 0; border: 1px solid #303640; border-radius: 5px; background: #15191e; color: #dfe4ec; padding: 5px 6px; font: inherit; font-size: 10px; }
    .n8n-row button { border: 1px solid #303640; border-radius: 5px; background: #252a31; color: #c5ccd6; padding: 4px 7px; cursor: pointer; font: inherit; font-size: 10px; }
    .n8n-status { min-height: 13px; margin-top: 4px; color: #7fc9dd; font-size: 10px; overflow-wrap: anywhere; }
    .n8n-divider { margin: 7px 0; border-top: 1px solid #2b3037; }
    .perm { display: none; }

    @media (max-width: 230px) {
      h1 { display: none; }
      #model { max-width: 86px; }
      #attach { width: 24px; overflow: hidden; white-space: nowrap; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="title-tools">
        <h1>CodeMe</h1>
        <button type="button" class="header-action" id="new-chat" title="New chat" aria-label="New chat">＋</button>
        <button type="button" class="header-action" id="history-toggle" title="Chat history" aria-label="Chat history">History</button>
      </div>
    </header>
    <div class="history-panel" id="history-panel">
      <div class="history-head">
        <strong>Chat history</strong>
        <button type="button" id="history-close" aria-label="Close chat history">×</button>
      </div>
      <div class="history-list" id="history-list"></div>
    </div>
    <div class="thread" id="thread">
      <p class="empty" id="empty">Ask about this workspace.</p>
      <div id="messages"></div>
      <div class="project-decision" id="project-decision"></div>
      <p class="activity" id="activity"></p>
      <div class="tools" id="tools"></div>
      <div class="result" id="result"></div>
    </div>
    <footer>
      <div class="changed-files" id="changed-files"></div>
      <p class="notice" id="notice"></p>
      <div class="chips" id="chips"></div>
      <div class="n8n-panel" id="n8n-panel">
        <p class="n8n-title">n8n MCP & prompt pre-flight</p>
        <label class="n8n-row"><input type="checkbox" id="n8n-enabled" /> Use n8n workflows as agent tools</label>
        <div class="n8n-row"><input type="text" id="n8n-url" placeholder="http://127.0.0.1:5678/mcp-server/http" /></div>
        <div class="n8n-row"><input type="password" id="n8n-token" placeholder="MCP token · stored securely" /></div>
        <div class="n8n-row"><button type="button" id="n8n-save">Save settings</button><button type="button" id="n8n-test">Test connection</button></div>
        <div class="n8n-status" id="n8n-status"></div>
        <div class="n8n-divider"></div>
        <div class="n8n-row"><input type="text" id="n8n-enhance-url" placeholder="Prompt enhancer webhook URL (optional)" /></div>
        <label class="n8n-row"><input type="checkbox" id="n8n-auto" /> Enhance every prompt on send</label>
      </div>
      <div class="composer" id="drop">
        <textarea id="prompt" placeholder="Ask CodeMe anything, @ files or type /" rows="2"></textarea>
        <div class="bar">
          <button type="button" id="attach" title="Add context">＋ Context</button>
          <button type="button" id="mic" title="Voice to text" aria-pressed="false">Mic</button>
          <button type="button" id="enhance" title="Enhance prompt before running">✨</button>
          <button type="button" id="n8n-toggle" title="n8n MCP tools">n8n</button>
          <select id="mode" aria-label="Mode">
            <option value="chat">Chat</option>
            <option value="ask">Ask</option>
            <option value="plan">Plan</option>
            <option value="code">Code</option>
          </select>
          <select id="model" aria-label="Model"></select>
          <button type="button" id="model-refresh" title="Refresh models" aria-label="Refresh models">↻</button>
          <span class="perm" id="perm"></span>
          <button type="button" id="stop" hidden title="Stop run" aria-label="Stop run">■</button>
          <button type="button" id="send" title="Send" aria-label="Send">↑</button>
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
    const modelRefresh = document.getElementById("model-refresh");
    const mode = document.getElementById("mode");
    const stage = document.getElementById("stage");
    const activity = document.getElementById("activity");
    const newChat = document.getElementById("new-chat");
    const historyToggle = document.getElementById("history-toggle");
    const historyPanel = document.getElementById("history-panel");
    const historyClose = document.getElementById("history-close");
    const historyList = document.getElementById("history-list");
    const projectDecision = document.getElementById("project-decision");
    const messages = document.getElementById("messages");
    const tools = document.getElementById("tools");
    const result = document.getElementById("result");
    const changedFiles = document.getElementById("changed-files");
    const chips = document.getElementById("chips");
    const notice = document.getElementById("notice");
    const empty = document.getElementById("empty");
    const drop = document.getElementById("drop");
    const mic = document.getElementById("mic");
    const enhance = document.getElementById("enhance");
    const n8nToggle = document.getElementById("n8n-toggle");
    const n8nPanel = document.getElementById("n8n-panel");
    const n8nEnabled = document.getElementById("n8n-enabled");
    const n8nUrl = document.getElementById("n8n-url");
    const n8nToken = document.getElementById("n8n-token");
    const n8nSave = document.getElementById("n8n-save");
    const n8nTest = document.getElementById("n8n-test");
    const n8nStatus = document.getElementById("n8n-status");
    const n8nEnhanceUrl = document.getElementById("n8n-enhance-url");
    const n8nAuto = document.getElementById("n8n-auto");
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
    let deferredFinal = "";
    let draft = "";
    let sendTimer = null;

    function clearSendPending() {
      if (sendTimer) {
        clearTimeout(sendTimer);
        sendTimer = null;
      }
      sending = false;
      send.disabled = false;
    }
    function sendPrompt() {
      stopVoice();
      if (sending) return;
      const text = prompt.value;
      if (!text.trim() && !chips.childElementCount) return;
      sending = true;
      draft = text;
      epoch += 1;
      send.disabled = true;
      notice.textContent = "Sending…";
      if (sendTimer) clearTimeout(sendTimer);
      const sentEpoch = epoch;
      sendTimer = setTimeout(() => {
        if (!sending || sentEpoch !== epoch) return;
        clearSendPending();
        notice.textContent = "Send did not receive a response. Try again.";
      }, 4000);
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
    newChat.addEventListener("click", () => {
      historyPanel.classList.remove("on");
      vscode.postMessage({ type: "new-chat" });
      prompt.focus();
    });
    historyToggle.addEventListener("click", () => {
      historyPanel.classList.toggle("on");
    });
    historyClose.addEventListener("click", () => historyPanel.classList.remove("on"));
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
    enhance.addEventListener("click", () => {
      const text = prompt.value.trim();
      if (!text || sending) return;
      enhance.disabled = true;
      n8nStatus.textContent = "Enhancing prompt…";
      vscode.postMessage({ type: "enhance-prompt", text });
    });
    n8nToggle.addEventListener("click", () => n8nPanel.classList.toggle("on"));
    n8nSave.addEventListener("click", () => {
      const patch = {
        mcpEnabled: Boolean(n8nEnabled.checked),
        mcpUrl: n8nUrl.value,
        autoEnhance: Boolean(n8nAuto.checked),
        enhanceWebhookUrl: n8nEnhanceUrl.value,
      };
      if (n8nToken.value.trim()) patch.mcpToken = n8nToken.value.trim();
      n8nStatus.textContent = "Saving…";
      vscode.postMessage({ type: "n8n-config", patch });
    });
    n8nTest.addEventListener("click", () => {
      n8nStatus.textContent = "Checking n8n MCP…";
      n8nTest.disabled = true;
      vscode.postMessage({ type: "n8n-test" });
    });
    model.addEventListener("change", () => {
      const option = model.selectedOptions[0];
      if (!option || !option.dataset.provider) return;
      vscode.postMessage({ type: "select-model", provider: option.dataset.provider, id: option.value });
    });
    modelRefresh.addEventListener("click", () => {
      modelRefresh.classList.add("loading");
      modelRefresh.disabled = true;
      vscode.postMessage({ type: "refresh-models" });
      setTimeout(() => {
        modelRefresh.classList.remove("loading");
        modelRefresh.disabled = false;
      }, 1200);
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
      if (running && sending) {
        prompt.value = "";
        prompt.style.height = "";
        draft = "";
        clearSendPending();
      }
      stage.textContent = state.stage || "Waiting";
      stage.dataset.stage = state.stage || "Waiting";
      stage.dataset.runId = state.runId || "";
      stage.dataset.running = running ? "true" : "false";
      stage.dataset.model = state.selected ? state.selected.id : "";
      stage.dataset.provider = state.selected ? state.selected.provider : "";
      const line = state.activity || "";
      activity.textContent = line;
      const liveStream = state.stream || state.tools || [];
      activity.classList.toggle("on", running && !liveStream.length && Boolean(line));
      stop.hidden = !running;
      send.hidden = false;
      send.disabled = sending;
      send.title = running ? "Add follow-up" : "Send";
      send.setAttribute("aria-label", running ? "Add follow-up" : "Send");
      mode.disabled = running;
      model.disabled = running;
      modelRefresh.disabled = false;
      modelRefresh.classList.remove("loading");
      prompt.disabled = false;
      if (!sending) notice.textContent = state.notice || "";
      renderN8n(state.n8n || null);
      const picked = normalizeComposerMode(state.composerMode || state.mode);
      document.getElementById("perm").textContent = composerModeLabel(picked);
      mode.value = picked;
      model.innerHTML = "";
      const sourceStates = Array.isArray(state.modelSources) ? state.modelSources : [];
      const modelsBySource = new Map();
      for (const item of state.models || []) {
        const source = item.source || (item.provider === "ollama-server" ? "Server" : item.provider === "ollama-local" ? "Local" : "Other");
        if (!modelsBySource.has(source)) modelsBySource.set(source, []);
        modelsBySource.get(source).push(item);
      }

      const renderedSources = new Set();
      const addSourceGroup = (label, sourceState) => {
        const items = modelsBySource.get(label) || [];
        const group = document.createElement("optgroup");
        group.label = label;
        if (items.length) {
          for (const item of items) {
            const option = document.createElement("option");
            option.value = item.id;
            option.dataset.provider = item.provider;
            option.dataset.source = item.source || label;
            option.textContent = item.label;
            option.selected = Boolean(state.selected && state.selected.id === item.id && state.selected.provider === item.provider);
            group.appendChild(option);
          }
        } else {
          const status = document.createElement("option");
          status.disabled = true;
          status.textContent = label + " · " + (
            sourceState
              ? (!sourceState.configured ? "not configured" : sourceState.available ? "no models installed" : "unavailable")
              : "no models"
          );
          group.appendChild(status);
        }
        model.appendChild(group);
        renderedSources.add(label);
      };

      for (const sourceState of sourceStates) addSourceGroup(sourceState.label, sourceState);
      for (const [label] of modelsBySource) {
        if (!renderedSources.has(label)) addSourceGroup(label, null);
      }

      if (!model.children.length) {
        const option = document.createElement("option");
        option.disabled = true;
        option.textContent = "No models available";
        model.appendChild(option);
      }

      model.title = sourceStates.map((source) => {
        if (!source.configured) return source.label + ": not configured";
        if (!source.available) return source.label + ": unavailable";
        return source.label + ": " + source.count + " model" + (source.count === 1 ? "" : "s");
      }).join(" · ");
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
      const streamItems = state.stream || state.tools || [];
      renderThread(state.thread || [], !running && Boolean(state.runId) && streamItems.length > 0);
      renderHistory(state.conversations || [], state.conversationId || "");
      newChat.disabled = running;
      historyToggle.disabled = running;
      renderProjectDecision(state.projectDecision || null);
      renderTools(streamItems);
      renderChangedFiles(state);
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
    function renderN8n(settings) {
      if (!settings) {
        n8nToggle.classList.remove("on");
        return;
      }
      n8nEnabled.checked = settings.mcpEnabled !== false;
      if (document.activeElement !== n8nUrl) n8nUrl.value = settings.mcpUrl || "";
      if (document.activeElement !== n8nEnhanceUrl) n8nEnhanceUrl.value = settings.enhanceWebhookUrl || "";
      n8nAuto.checked = Boolean(settings.autoEnhance);
      n8nToggle.classList.toggle("on", Boolean(settings.toolCount));
      n8nToggle.title = settings.toolCount
        ? "n8n MCP · " + settings.toolCount + " tool" + (settings.toolCount === 1 ? "" : "s") + " discovered"
        : "n8n MCP tools";
      if (!n8nStatus.textContent || /Saving|Checking|Enhancing/.test(n8nStatus.textContent)) {
        if (settings.lastError) n8nStatus.textContent = "MCP: " + settings.lastError;
        else if (settings.toolCount) n8nStatus.textContent = settings.toolCount + " MCP tool(s) available";
        else n8nStatus.textContent = settings.tokenConfigured ? "MCP configured · press Test connection" : "MCP token not configured";
      }
      n8nToken.placeholder = settings.tokenConfigured
        ? "MCP token stored securely · enter a new token to replace"
        : "MCP token · stored securely";
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

    function renderHistory(items, activeId) {
      historyList.innerHTML = "";
      if (!items.length) {
        const emptyHistory = document.createElement("div");
        emptyHistory.className = "history-empty";
        emptyHistory.textContent = "No previous chats in this workspace.";
        historyList.appendChild(emptyHistory);
        return;
      }
      for (const item of items) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "history-item" + (item.id === activeId ? " active" : "");
        row.dataset.chatId = item.id;

        const title = document.createElement("span");
        title.className = "history-title";
        title.textContent = item.title || "New chat";

        const meta = document.createElement("span");
        meta.className = "history-meta";
        const count = Number(item.messageCount || 0);
        meta.textContent = formatChatTime(item.updatedAt) + " · " + count + (count === 1 ? " message" : " messages");

        row.appendChild(title);
        row.appendChild(meta);
        row.addEventListener("click", () => {
          historyPanel.classList.remove("on");
          vscode.postMessage({ type: "open-chat", id: item.id });
        });
        historyList.appendChild(row);
      }
    }

    function formatChatTime(value) {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return "Recently";
      const today = new Date();
      const sameDay = date.getFullYear() === today.getFullYear()
        && date.getMonth() === today.getMonth()
        && date.getDate() === today.getDate();
      return sameDay
        ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : date.toLocaleDateString([], { day: "numeric", month: "short" });
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
      for (const item of items) {
        if (item.type === "narration") {
          const note = document.createElement("p");
          note.className = "work-note";
          note.textContent = item.text || "";
          tools.appendChild(note);
          continue;
        }

        const row = document.createElement("details");
        row.className = "tool-card " + (item.status || "");
        const hasPreview = Boolean((item.name === "file.write" || item.name === "file.patch") && item.preview && item.preview.lines && item.preview.lines.length);
        row.open = item.status === "failed";

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

        const detailParts = [];
        if (item.command) detailParts.push("Command\\n" + item.command);
        if (item.targetText || item.expectedText || item.beforeText || item.afterText) {
          const interaction = [];
          if (item.targetText) interaction.push("Target: " + item.targetText);
          if (item.beforeText) interaction.push("Before: " + item.beforeText);
          if (item.afterText) interaction.push("After: " + item.afterText);
          if (item.expectedText) interaction.push("Expected: " + item.expectedText);
          if (interaction.length) detailParts.push(interaction.join("\\n"));
        }
        if (item.name === "sandbox.run") {
          const sandboxInfo = [];
          if (item.isolation) sandboxInfo.push("Isolation: " + item.isolation);
          sandboxInfo.push("OS security boundary: " + (item.securityBoundary ? "yes" : "no"));
          if (item.network) sandboxInfo.push("Network: " + item.network);
          if (item.discarded) sandboxInfo.push("Writes discarded: yes");
          if (item.changedPaths && item.changedPaths.length) sandboxInfo.push("Temporary changes: " + item.changedPaths.join(", "));
          if (sandboxInfo.length) detailParts.push(sandboxInfo.join("\\n"));
        }
        if (item.error) detailParts.push("Error\\n" + item.error);
        if (item.output) detailParts.push("Output\\n" + item.output);
        if (detailParts.length) {
          const detail = document.createElement("pre");
          detail.className = "tool-detail";
          detail.textContent = detailParts.join("\\n\\n");
          row.appendChild(detail);
        }

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
      if (item.name === "file.read" || item.name === "dir.list" || item.name === "workspace.inspect" || item.name === "repo.search") return "›";
      if (item.name === "file.write" || item.name === "file.patch" || item.name === "dir.create") return "<>";
      if (item.name === "terminal.run" || item.name === "tests.run" || item.name === "sandbox.run") return "$";
      if (item.name === "process.start" || item.name === "process.status" || item.name === "process.logs") return "◆";
      if (item.name === "browser.check" || item.name === "browser.interact") return "◉";
      if (item.name === "capability.invoke" || item.name === "capability.list") return "◇";
      if (/^mcp_n8n_/.test(String(item.name || ""))) return "N8N";
      if (item.name === "diagnostics.run") return "✓";
      if (item.name === "git.diff" || item.name === "git.status") return "↕";
      return "›";
    }
    function toolLabel(item) {
      const live = item.status === "running";
      if (item.name === "workspace.inspect") return live ? "Inspecting workspace" : "Inspected workspace";
      if (item.name === "dir.list") return (live ? "Listing " : "Listed ") + (item.path || "workspace");
      if (item.name === "dir.create") return (live ? "Creating " : "Created ") + (item.path || "folder");
      if (item.name === "file.read") return (live ? "Reading " : "Read ") + (item.path || "file");
      if (item.name === "file.write" || item.name === "file.patch") return (live ? "Editing " : "Edited ") + (item.path || "file");
      if (item.name === "repo.search") return (live ? "Searching " : "Searched ") + (item.path || "workspace");
      if (item.name === "tests.run") return live ? "Running tests" : "Tests";
      if (item.name === "terminal.run") return item.command || (live ? "Running command" : "Command");
      if (item.name === "sandbox.run") return item.command || (live ? "Running sandbox" : "Sandbox");
      if (item.name === "process.start") {
        if (!live && item.suppressed && item.reused) return "Reused preview process";
        if (!live && item.suppressed && item.requiresLogs) return "Preview restart needs logs";
        return live ? "Starting preview" : "Preview process";
      }
      if (item.name === "process.status") return live ? "Checking preview process" : "Preview status";
      if (item.name === "process.logs") return live ? "Reading preview logs" : "Preview logs";
      if (item.name === "browser.check") {
        if (item.status === "failed") return "Browser check";
        return (live ? "Checking browser" : "Browser") + (item.path ? "  " + item.path : "");
      }
      if (item.name === "browser.interact") {
        if (item.status === "failed") return "Browser interaction";
        if (!live && item.targetText && item.afterText) return 'Clicked "' + item.targetText + '" → "' + item.afterText + '"';
        if (!live && item.afterText) return "Browser → " + item.afterText;
        return live ? "Testing browser interaction" : "Verified browser interaction";
      }
      if (item.name === "diagnostics.run") return live ? "Checking diagnostics" : "Diagnostics";
      if (item.name === "git.diff") return live ? "Reviewing changes" : "Reviewed changes";
      if (item.name === "git.status") return live ? "Checking Git status" : "Git status";
      if (item.name === "capability.invoke") return live ? "Researching" : "Research";
      if (item.name === "capability.list") return live ? "Checking capabilities" : "Capabilities";
      if (/^mcp_n8n_/.test(String(item.name || ""))) {
        const target = String(item.name).replace(/^mcp_n8n_/, "").replace(/_/g, " ");
        return (live ? "Running n8n workflow " : "Ran n8n workflow ") + target;
      }
      return item.name;
    }
    function diffCounts(diff) {
      let additions = 0;
      let removals = 0;
      for (const line of String(diff || "").split("\\n")) {
        if (line.startsWith("+++") || line.startsWith("---")) continue;
        if (line.startsWith("+")) additions += 1;
        else if (line.startsWith("-")) removals += 1;
      }
      return { additions, removals };
    }
    function renderChangedFiles(state) {
      changedFiles.innerHTML = "";
      const files = state.fileDiffs && state.fileDiffs.length
        ? state.fileDiffs
        : (state.filesChanged || []).map((file) => ({ path: file, diff: "" }));
      changedFiles.classList.toggle("on", files.length > 0);
      if (!files.length) return;

      const head = document.createElement("div");
      head.className = "changed-head";
      const count = document.createElement("span");
      count.textContent = files.length + (files.length === 1 ? " file changed" : " files changed");
      const hint = document.createElement("span");
      hint.className = "changed-hint";
      hint.textContent = "Expand to review";
      head.appendChild(count);
      head.appendChild(hint);
      changedFiles.appendChild(head);

      for (const file of files) {
        const row = document.createElement("details");
        row.className = "changed-row";
        const summary = document.createElement("summary");
        const icon = document.createElement("span");
        icon.className = "changed-icon";
        icon.textContent = "<>";
        const label = document.createElement("span");
        label.className = "changed-path";
        label.textContent = file.path;
        const counts = diffCounts(file.diff);
        const stats = document.createElement("span");
        stats.className = "changed-stats";
        const add = document.createElement("span");
        add.className = "tool-add";
        add.textContent = "+" + counts.additions;
        const remove = document.createElement("span");
        remove.className = "tool-remove";
        remove.textContent = "-" + counts.removals;
        stats.appendChild(add);
        stats.appendChild(remove);
        summary.appendChild(icon);
        summary.appendChild(label);
        if (file.diff) summary.appendChild(stats);
        row.appendChild(summary);
        if (file.diff) {
          const pre = document.createElement("pre");
          pre.className = "changed-diff";
          pre.textContent = file.diff;
          row.appendChild(pre);
        }
        changedFiles.appendChild(row);
      }
    }
    function renderResult(state) {
      result.innerHTML = "";
      if (deferredFinal) {
        const final = document.createElement("div");
        final.className = "bubble assistant";
        final.textContent = deferredFinal;
        result.appendChild(final);
      } else if (state.stage !== "Complete") {
        const summary = document.createElement("p");
        summary.className = state.stage === "Failed" ? "error" : "result-summary";
        summary.textContent = outcomeText(state);
        result.appendChild(summary);
      } else {
        const summary = outcomeText(state);
        if (summary) {
          const final = document.createElement("div");
          final.className = "bubble assistant";
          final.textContent = summary;
          result.appendChild(final);
        }
      }

      if (state.verification && state.verification.status === "failed") {
        const verify = document.createElement("p");
        verify.className = "error";
        verify.textContent = "Verification issue" + (state.verification.summary ? " — " + state.verification.summary : "");
        result.appendChild(verify);
      }
    }
    function renderThread(items, deferLastAssistant) {
      messages.innerHTML = "";
      deferredFinal = "";
      const shown = Array.isArray(items) ? items.slice() : [];
      if (deferLastAssistant && shown.length && shown[shown.length - 1].role === "assistant") {
        deferredFinal = String(shown.pop().text || "");
      }
      for (const item of shown) addMessage(item.role, item.text);
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
      if (message.type === "submitting" && current(message)) {
        notice.textContent = "Sending…";
      }
      if (message.type === "accepted" && current(message)) {
        requestId = message.requestId || requestId;
        prompt.value = "";
        prompt.style.height = "";
        draft = "";
        clearSendPending();
        notice.textContent = "";
      }
      if (message.type === "rejected" && current(message)) {
        clearSendPending();
        notice.textContent = message.message || "Could not send.";
        if (!prompt.value && draft) prompt.value = draft;
      }
      if (message.type === "n8n-config-result") {
        n8nStatus.textContent = message.ok ? "n8n settings saved" : (message.message || "Could not save n8n settings");
        if (message.ok) n8nToken.value = "";
      }
      if (message.type === "n8n-test-result") {
        n8nTest.disabled = Boolean(message.checking);
        if (message.checking) n8nStatus.textContent = "Checking n8n MCP…";
        else if (message.ok) n8nStatus.textContent = message.count + " MCP tool(s) available";
        else n8nStatus.textContent = "Failed: " + (message.message || "n8n MCP unavailable");
      }
      if (message.type === "enhanced-prompt") {
        enhance.disabled = false;
        if (message.ok) {
          prompt.value = message.prompt || prompt.value;
          prompt.dispatchEvent(new Event("input"));
          n8nStatus.textContent = message.source === "n8n" ? "Prompt enhanced by n8n" : "Prompt enhanced locally";
        } else {
          n8nStatus.textContent = "Enhancement failed: " + (message.message || "unknown error");
        }
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
