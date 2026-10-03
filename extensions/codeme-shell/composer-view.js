const fs = require("fs");
const path = require("path");
const { modeOptions } = require("./mode-contracts");

function renderComposer(nonce) {
  const client = fs.readFileSync(path.join(__dirname, "composer-client.js"), "utf8")
    .replace(/if \(typeof module[\s\S]*$/, "");
  const modeHtml = modeOptions()
    .map((item) => '<option value="' + escapeHtml(item.internalComposerMode) + '">' + escapeHtml(item.label) + '</option>')
    .join("");
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
    .workspace-actions { display: inline-flex; align-items: center; gap: 1px; margin-right: 3px; }
    .workspace-action { min-width: 0; padding: 0 5px; color: #8b96a4; font-size: 9px; }
    .workspace-action:hover { color: #d9dee7; }
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
    .bubble.assistant { color: #c8ced8; white-space: normal; }
    .bubble.assistant p { margin: 0 0 8px; }
    .bubble.assistant p:last-child { margin-bottom: 0; }
    .bubble.assistant h2, .bubble.assistant h3, .bubble.assistant h4 { margin: 10px 0 5px; color: #e1e6ee; line-height: 1.3; }
    .bubble.assistant h2 { font-size: 13px; }
    .bubble.assistant h3 { font-size: 12px; }
    .bubble.assistant h4 { font-size: 11px; }
    .bubble.assistant ul, .bubble.assistant ol { margin: 4px 0 8px 18px; padding: 0; }
    .bubble.assistant li { margin: 2px 0; }
    .bubble.assistant strong { color: #e1e6ee; font-weight: 600; }
    .bubble.assistant code { padding: 1px 3px; border-radius: 3px; background: #252a31; color: #d7dde6; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 0.94em; }
    .bubble.assistant pre { margin: 6px 0 9px; padding: 7px 8px; overflow: auto; border-left: 1px solid #39414b; background: #15181c; white-space: pre; }
    .bubble.assistant pre code { padding: 0; background: transparent; }

    .project-decision { display: none; margin: 1px 1px 7px; color: #75808f; font-size: 10px; line-height: 1.35; }
    .project-decision.on { display: flex; align-items: baseline; gap: 5px; flex-wrap: wrap; }
    .project-decision-title, .project-decision-meta, .project-decision-reason { margin: 0; font-size: inherit; font-weight: 400; color: inherit; }
    .project-decision-title { color: #909aa8; }
    .project-decision-reason { display: none; }

    .clarification { margin: 2px 0 10px; }
    .clarification[hidden] { display: none; }
    .clarification-card { padding: 10px; border: 1px solid #343a44; border-radius: 7px; background: #1d2127; }
    .clarification-title { margin: 0 0 4px; color: #dce2ea; font-size: 11px; font-weight: 600; }
    .clarification-summary { margin: 0 0 9px; color: #aeb7c3; font-size: 10px; line-height: 1.45; }
    .clarification-question { margin: 0 0 8px; }
    .clarification-label { display: flex; align-items: baseline; gap: 5px; margin: 0 0 4px; color: #cbd2dc; font-size: 10px; font-weight: 500; line-height: 1.35; }
    .clarification-optional { color: #697482; font-size: 9px; font-weight: 400; }
    .clarification-card textarea.clarification-input { min-height: 34px; max-height: 110px; padding: 6px 7px; border: 1px solid #323944; border-radius: 5px; resize: vertical; background: #181c21; color: #dce2ea; font-size: 11px; }
    .clarification-card textarea.clarification-input:focus { border-color: #55717c; outline: none; }
    .clarification-card textarea.clarification-input.missing { border-color: #9a5458; }
    .clarification-reason { margin: 3px 1px 0; color: #687382; font-size: 9px; line-height: 1.35; }
    .clarification-hint { margin: 5px 0 0; color: #687382; font-size: 9px; }
    .clarification-actions { display: flex; align-items: center; gap: 7px; margin-top: 9px; }
    .clarification-error { flex: 1; min-width: 0; color: #ff918b; font-size: 9px; line-height: 1.3; }
    .clarification-continue { flex: 0 0 auto; height: 25px; padding: 0 9px; border: 0; border-radius: 5px; background: #7fc9dd; color: #172027; cursor: pointer; font: inherit; font-size: 10px; font-weight: 600; }
    .clarification-continue:hover { background: #91d7e8; }
    .clarification-continue:disabled { opacity: 0.45; cursor: default; }

    .activity { display: none; margin: 2px 1px 7px; color: #798493; font-size: 10px; }
    .activity.on { display: block; }
    .activity.on::before { content: "●"; margin-right: 5px; color: #7fc9dd; animation: codeme-pulse 1.1s ease-in-out infinite; }

    .work-panel { margin: 0 0 9px; border: 0; }
    .work-panel[hidden] { display: none; }
    .work-panel > summary { display: flex; align-items: center; gap: 6px; min-height: 23px; padding: 0 2px; cursor: pointer; list-style: none; color: #87919f; font-size: 10px; user-select: none; }
    .work-panel > summary::-webkit-details-marker { display: none; }
    .work-panel > summary:hover { color: #b8c0cb; }
    .work-chevron { display: inline-block; width: 12px; color: #687382; transform: rotate(0deg); transition: transform 90ms ease; }
    .work-panel[open] .work-chevron { transform: rotate(90deg); }
    .work-panel-body { padding-top: 2px; }
    .tools { display: flex; flex-direction: column; gap: 1px; margin: 0; }
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
    .tool-action, .changed-open { flex: 0 0 auto; height: 19px; padding: 0 5px; border: 0; border-radius: 4px; background: transparent; color: #7f8a98; cursor: pointer; font: inherit; font-size: 9px; }
    .tool-action:hover, .changed-open:hover { background: #2a3038; color: #d9dee7; }
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

    .timeout-card { margin: 4px 0 8px; padding: 8px 9px; border: 1px solid #3a414b; border-radius: 6px; background: #1d2127; color: #aeb7c3; font-size: 10px; line-height: 1.45; }
    .timeout-card[hidden] { display: none; }
    .timeout-head { display:flex; align-items:center; gap:7px; margin-bottom:5px; color:#d5dbe4; }
    .timeout-state { margin-left:auto; color:#7fc9dd; }
    .timeout-state.failed { color:#ff918b; }
    .timeout-grid { display:grid; grid-template-columns:88px minmax(0,1fr); gap:2px 7px; }
    .timeout-key { color:#6f7a88; }
    .timeout-value { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .timeout-actions { margin-top:7px; display:flex; gap:6px; }
    .timeout-actions button { height:22px; padding:0 7px; border:1px solid #3b4652; border-radius:4px; background:#252c34; color:#c8ced8; cursor:pointer; font:inherit; font-size:9px; }
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

    .composer { position: relative; display: flex; flex-direction: column; min-width: 0; border: 1px solid #343a44; border-radius: 8px; background: #20242a; padding: 2px 4px 4px; box-shadow: 0 1px 0 #0004; }
    .hub-panel { display: none; position: absolute; z-index: 30; left: 4px; right: 4px; bottom: 34px; max-height: 260px; overflow: auto; border: 1px solid #39414b; border-radius: 7px; background: #171a1f; box-shadow: 0 12px 28px #0009; }
    .hub-panel.on { display: block; }
    .hub-head { display: flex; align-items: center; gap: 7px; min-height: 30px; padding: 0 8px; border-bottom: 1px solid #292e36; color: #c8ced8; font-size: 10px; }
    .hub-state { margin-left: auto; color: #74808e; }
    .hub-flags { padding: 6px 8px 2px; color: #788492; font-size: 9px; line-height: 1.45; }
    .hub-tools { padding: 4px; }
    .hub-tool { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; padding: 5px 6px; border-radius: 4px; }
    .hub-tool:hover { background: #22272e; }
    .hub-tool-name { overflow: hidden; color: #b7c0cb; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
    .hub-tool-meta { color: #6f7a88; font-size: 9px; white-space: nowrap; }
    #hub-tools-button.on { color: #7fc9dd; }
    .shell.over .composer { outline: 1px solid #7fc9dd88; outline-offset: 2px; background: #7fc9dd0d; }
    textarea { width: 100%; min-height: 45px; max-height: 160px; box-sizing: border-box; border: 0; resize: none; background: transparent; color: #e0e4ea; font: inherit; font-size: 12px; line-height: 1.4; padding: 7px 5px 3px; outline: none; }
    textarea::placeholder { color: #697482; }
    .bar { display: flex; align-items: center; gap: 3px; min-width: 0; }
    .bar button, .bar select { border: 0; background: transparent; color: #909aa8; height: 24px; padding: 0 5px; cursor: pointer; font: inherit; font-size: 10px; border-radius: 4px; }
    .bar button:hover, .bar select:hover { background: #2a2f36; color: #d6dbe3; }
    .bar button:disabled, .bar select:disabled { opacity: 0.4; cursor: default; }
    #attach { flex: 0 0 auto; }
    #mode { flex: 0 0 auto; max-width: 92px; color: #b8c0cb; }
    #model { flex: 1 1 128px; min-width: 96px; max-width: 160px; color: #b8c0cb; text-overflow: ellipsis; overflow: hidden; }
    #model-refresh { flex: 0 0 auto; width: 22px; padding: 0; font-size: 13px; }
    #model-refresh.loading { animation: codeme-spin 0.8s linear infinite; }
    @keyframes codeme-spin { to { transform: rotate(360deg); } }
    #send { margin-left: auto; width: 24px; padding: 0; border-radius: 6px; background: #7fc9dd; color: #172027; font-size: 14px; font-weight: 700; }
    #send:hover { background: #91d7e8; color: #172027; }
    #send:disabled { opacity: 0.35; }
    #stop { width: 24px; padding: 0; color: #aab3bf; }
    #send[hidden], #stop[hidden] { display: none; }
    #mic.on { color: #ff918b; }
    .perm { display: none; }

    @media (max-width: 310px) {
      .workspace-actions { display: none; }
    }
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
        <div class="workspace-actions" aria-label="Workspace">
          <button type="button" class="header-action workspace-action" id="explorer-button" title="Show real Explorer">Files</button>
          <button type="button" class="header-action workspace-action" id="terminal-button" title="Show real Terminal">Terminal</button>
          <button type="button" class="header-action workspace-action" id="preview-button" title="Open real integrated Preview">Preview</button>
        </div>
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
      <div class="clarification" id="clarification" hidden></div>
      <div class="project-decision" id="project-decision"></div>
      <p class="activity" id="activity"></p>
      <details class="work-panel" id="work-panel" hidden>
        <summary><span class="work-chevron">›</span><span id="work-panel-label">View technical activity</span></summary>
        <div class="work-panel-body"><div class="tools" id="tools"></div></div>
      </details>
      <div class="timeout-card" id="timeout-card" hidden></div>
      <div class="result" id="result"></div>
    </div>
    <footer>
      <div class="changed-files" id="changed-files"></div>
      <p class="notice" id="notice"></p>
      <div class="chips" id="chips"></div>
      <div class="composer" id="drop">
        <div class="hub-panel" id="hub-panel">
          <div class="hub-head">
            <strong>n8n MCP tools</strong>
            <span class="hub-state" id="hub-state">checking…</span>
          </div>
          <div class="hub-flags" id="hub-flags"></div>
          <div class="hub-tools" id="hub-tool-list"></div>
        </div>
        <textarea id="prompt" placeholder="Ask CodeMe anything, @ files or type /" rows="2"></textarea>
        <div class="bar">
          <button type="button" id="attach" title="Add context">＋ Context</button>
          <button type="button" id="mic" title="Voice to text" aria-pressed="false">Mic</button>
          <button type="button" id="hub-tools-button" title="n8n MCP tools" aria-expanded="false">n8n</button>
          <select id="mode" aria-label="Mode">${modeHtml}</select>
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
    const explorerButton = document.getElementById("explorer-button");
    const terminalButton = document.getElementById("terminal-button");
    const previewButton = document.getElementById("preview-button");
    const projectDecision = document.getElementById("project-decision");
    const messages = document.getElementById("messages");
    const clarification = document.getElementById("clarification");
    const workPanel = document.getElementById("work-panel");
    const workPanelLabel = document.getElementById("work-panel-label");
    const tools = document.getElementById("tools");
    const timeoutCard = document.getElementById("timeout-card");
    const result = document.getElementById("result");
    const changedFiles = document.getElementById("changed-files");
    const chips = document.getElementById("chips");
    const notice = document.getElementById("notice");
    const empty = document.getElementById("empty");
    const drop = document.getElementById("drop");
    const mic = document.getElementById("mic");
    const hubToolsButton = document.getElementById("hub-tools-button");
    const hubPanel = document.getElementById("hub-panel");
    const hubState = document.getElementById("hub-state");
    const hubFlags = document.getElementById("hub-flags");
    const hubToolList = document.getElementById("hub-tool-list");
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

    function clearSendPending() {
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
      notice.textContent = "Understanding your request…";
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
    hubToolsButton.addEventListener("click", () => {
      const open = !hubPanel.classList.contains("on");
      hubPanel.classList.toggle("on", open);
      hubToolsButton.classList.toggle("on", open);
      hubToolsButton.setAttribute("aria-expanded", open ? "true" : "false");
    });
    newChat.addEventListener("click", () => {
      historyPanel.classList.remove("on");
      vscode.postMessage({ type: "new-chat" });
      prompt.focus();
    });
    historyToggle.addEventListener("click", () => {
      historyPanel.classList.toggle("on");
    });
    historyClose.addEventListener("click", () => historyPanel.classList.remove("on"));
    explorerButton.addEventListener("click", () => vscode.postMessage({ type: "open-explorer" }));
    terminalButton.addEventListener("click", () => vscode.postMessage({ type: "open-terminal" }));
    previewButton.addEventListener("click", () => vscode.postMessage({ type: "open-preview" }));
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
      if (!option || !option.dataset.provider) return;
      vscode.postMessage({
        type: "select-model",
        provider: option.dataset.provider,
        id: option.dataset.modelId || option.value,
      });
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
      notice.textContent = "Adding dropped files…";
      collectDrops(event.dataTransfer).then((files) => {
        if (!files.length) {
          notice.textContent = "No readable files were found in that drop.";
          return;
        }
        notice.textContent = "Adding " + files.length + " file" + (files.length === 1 ? "" : "s") + "…";
        vscode.postMessage({ type: "attach", files });
      }).catch((error) => {
        notice.textContent = "Could not read dropped files: " + String(error && error.message || error);
      });
    });

    function browserDropFiles(transfer) {
      if (!transfer) return [];
      const fromItems = [];
      if (transfer.items && transfer.items.length) {
        for (const item of transfer.items) {
          if (!item || item.kind !== "file" || typeof item.getAsFile !== "function") continue;
          const file = item.getAsFile();
          if (file) fromItems.push(file);
        }
      }
      if (fromItems.length) return fromItems;
      return transfer.files ? Array.from(transfer.files) : [];
    }

    function dropBasename(value) {
      const raw = String(value || "").replace(/\\/g, "/");
      const last = raw.split("/").pop() || raw;
      try { return decodeURIComponent(last); } catch { return last; }
    }

    async function inlineDropFile(file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const chunk = 0x8000;
      let binary = "";
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return {
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        contents: btoa(binary),
      };
    }

    async function collectDrops(transfer) {
      const listed = droppedPaths(transfer);
      const files = [];
      const pathKeys = new Set();
      const pathNames = new Map();

      for (const item of listed) {
        const rawPath = String(item && item.path || "").trim();
        if (!rawPath) continue;
        const key = rawPath.replace(/\\/g, "/");
        if (pathKeys.has(key)) continue;
        pathKeys.add(key);
        files.push({ path: rawPath });
        const base = dropBasename(rawPath);
        if (base) pathNames.set(base, (pathNames.get(base) || 0) + 1);
      }

      for (const file of browserDropFiles(transfer)) {
        if (!file) continue;
        if (file.path) {
          const key = String(file.path).replace(/\\/g, "/");
          const existing = files.find((item) => String(item.path || "").replace(/\\/g, "/") === key);
          if (existing) {
            existing.name = existing.name || file.name;
            existing.type = existing.type || file.type;
            existing.size = existing.size || file.size;
          } else {
            files.push({ path: file.path, name: file.name, type: file.type, size: file.size });
            pathKeys.add(key);
          }
          continue;
        }

        // Code OSS may expose file:// resource paths and browser File objects for
        // the same item. Only skip the in-memory copy when exactly one path already
        // identifies that basename; otherwise preserve the File so multi-selects
        // with duplicate names are not silently collapsed.
        if ((pathNames.get(file.name) || 0) === 1) continue;
        files.push(await inlineDropFile(file));
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
      activity.classList.toggle("on", running && Boolean(line));
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
      const picked = normalizeComposerMode(state.composerMode || state.mode);
      document.getElementById("perm").textContent = composerModeLabel(picked);
      mode.value = picked;
      model.innerHTML = "";
      const sourceStates = Array.isArray(state.modelSources) ? state.modelSources : [];
      const availableModels = Array.isArray(state.models) ? state.models : [];

      // Keep the native select flat. Electron/Chromium can render a selected
      // option from an optgroup as visually blank in a narrow VS Code webview.
      // Prefix each label instead so Local and Server stay obvious.
      for (const item of availableModels) {
        const source = item.source
          || (item.provider === "ollama-server" ? "Server"
            : item.provider === "ollama-local" ? "Local"
            : "Model");
        const option = document.createElement("option");
        option.value = item.provider + "::" + item.id;
        option.dataset.provider = item.provider;
        option.dataset.modelId = item.id;
        option.dataset.source = source;
        const rawLabel = item.label || item.id;
        option.textContent = rawLabel.startsWith(source + " · ")
          ? rawLabel
          : source + " · " + rawLabel;
        model.appendChild(option);
      }

      // Surface discovery failures directly in the dropdown rather than
      // leaving it blank and making the user guess whether a source failed.
      for (const sourceState of sourceStates) {
        const hasModels = availableModels.some((item) => {
          const source = item.source
            || (item.provider === "ollama-server" ? "Server"
              : item.provider === "ollama-local" ? "Local"
              : "Model");
          return source === sourceState.label;
        });
        if (hasModels) continue;
        const status = document.createElement("option");
        status.disabled = true;
        status.value = "status::" + sourceState.id;
        const stateText = !sourceState.configured
          ? "not configured"
          : sourceState.available
            ? "no models installed"
            : "unavailable";
        const reason = !sourceState.available && sourceState.message
          ? " — " + sourceState.message
          : "";
        status.textContent = sourceState.label + " · " + stateText + reason;
        model.appendChild(status);
      }

      if (!model.options.length) {
        const option = document.createElement("option");
        option.disabled = true;
        option.textContent = "No models available";
        model.appendChild(option);
      }

      if (state.selected) {
        const selectedValue = state.selected.provider + "::" + state.selected.id;
        const match = Array.from(model.options).find((option) => option.value === selectedValue);
        if (match) {
          model.value = selectedValue;
        } else {
          const fallback = document.createElement("option");
          fallback.value = selectedValue;
          fallback.dataset.provider = state.selected.provider;
          fallback.dataset.modelId = state.selected.id;
          fallback.textContent = state.selected.label || state.selected.id;
          fallback.selected = true;
          model.insertBefore(fallback, model.firstChild);
        }
      }
      model.title = sourceStates.map((source) => {
        if (!source.configured) return source.label + ": not configured";
        if (!source.available) return source.label + ": unavailable";
        return source.label + ": " + source.count + " model" + (source.count === 1 ? "" : "s");
      }).join(" · ");
      renderHub(state.hub || null);
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
      renderClarification(state.clarification || null);
      renderProjectDecision(state.projectDecision || null);
      renderTools(streamItems);
      workPanel.hidden = !streamItems.length;
      workPanelLabel.textContent = "View technical activity" + (streamItems.length ? " · " + streamItems.length : "");
      renderChangedFiles(state);
      renderTimeoutDiagnostics(state.timeoutDiagnostics || null, state.reconnect || null);
      if (running) {
        result.innerHTML = "";
        shownRun = "";
      } else if (state.outcome && state.runId && state.runId !== shownRun) {
        shownRun = state.runId;
        renderResult(state);
      }
      empty.hidden = Boolean(messages.childElementCount || state.clarification || running);
      thread.scrollTop = thread.scrollHeight;
    }

    function renderClarification(data) {
      clarification.innerHTML = "";
      clarification.hidden = !data;
      if (!data) return;

      const card = document.createElement("form");
      card.className = "clarification-card";

      const title = document.createElement("div");
      title.className = "clarification-title";
      title.textContent = "A few details before I start";
      card.appendChild(title);

      if (data.summary) {
        const summary = document.createElement("p");
        summary.className = "clarification-summary";
        summary.textContent = data.summary;
        card.appendChild(summary);
      }

      const questions = Array.isArray(data.questions) ? data.questions.slice(0, 5) : [];
      for (const question of questions) {
        const field = document.createElement("div");
        field.className = "clarification-question";

        const label = document.createElement("label");
        label.className = "clarification-label";
        const labelText = document.createElement("span");
        labelText.textContent = question.question || "Please clarify";
        label.appendChild(labelText);
        if (question.required === false) {
          const optional = document.createElement("span");
          optional.className = "clarification-optional";
          optional.textContent = "optional";
          label.appendChild(optional);
        }

        const input = document.createElement("textarea");
        input.className = "clarification-input";
        input.rows = 1;
        input.dataset.questionId = question.id || "";
        input.dataset.required = question.required === false ? "false" : "true";
        input.placeholder = question.required === false ? "Optional answer" : "Type your answer…";
        input.addEventListener("input", () => {
          input.classList.remove("missing");
          input.style.height = "auto";
          input.style.height = Math.min(110, input.scrollHeight) + "px";
        });

        field.appendChild(label);
        field.appendChild(input);

        if (question.reason) {
          const reason = document.createElement("p");
          reason.className = "clarification-reason";
          reason.textContent = question.reason;
          field.appendChild(reason);
        }
        card.appendChild(field);
      }

      const hint = document.createElement("p");
      hint.className = "clarification-hint";
      hint.textContent = "Answer here, or reply naturally in the chat box below.";
      card.appendChild(hint);

      const actions = document.createElement("div");
      actions.className = "clarification-actions";
      const error = document.createElement("span");
      error.className = "clarification-error";
      error.id = "clarification-error";
      const button = document.createElement("button");
      button.type = "submit";
      button.className = "clarification-continue";
      button.id = "clarification-continue";
      button.textContent = "Continue";
      actions.appendChild(error);
      actions.appendChild(button);
      card.appendChild(actions);

      card.addEventListener("submit", (event) => {
        event.preventDefault();
        const inputs = Array.from(card.querySelectorAll(".clarification-input"));
        let firstMissing = null;
        const answers = [];
        for (const input of inputs) {
          const answer = input.value.trim();
          const required = input.dataset.required !== "false";
          if (required && !answer) {
            input.classList.add("missing");
            if (!firstMissing) firstMissing = input;
          }
          if (answer) answers.push({ id: input.dataset.questionId || "answer", answer });
        }
        if (firstMissing) {
          error.textContent = "Please answer the required questions.";
          firstMissing.focus();
          return;
        }
        if (!answers.length) {
          error.textContent = "Add an answer before continuing.";
          return;
        }

        epoch += 1;
        button.disabled = true;
        button.textContent = "Checking…";
        error.textContent = "";
        const text = answers.map((item) => item.answer).join("\\n");
        vscode.postMessage({ type: "clarification-submit", answers, text, epoch });
      });

      clarification.appendChild(card);
    }

    function renderHub(hub) {
      const connected = Boolean(hub && hub.connected);
      const toolItems = hub && Array.isArray(hub.tools) ? hub.tools : [];
      hubState.textContent = connected
        ? toolItems.length + " tool" + (toolItems.length === 1 ? "" : "s")
        : "offline";
      hubToolsButton.title = connected
        ? "n8n MCP connected · " + toolItems.length + " tool" + (toolItems.length === 1 ? "" : "s")
        : "n8n MCP offline";
      hubFlags.textContent = connected
        ? "Raw image upload: " + (hub.imageUploadAllowed ? "allowed" : "blocked")
          + " · External actions: " + (hub.actionsAllowed ? "allowed" : "blocked")
        : "Connect n8n MCP to discover tools.";
      hubToolList.innerHTML = "";
      if (!toolItems.length) {
        const emptyHub = document.createElement("div");
        emptyHub.className = "history-empty";
        emptyHub.textContent = connected ? "No MCP tools published." : "n8n MCP is not connected.";
        hubToolList.appendChild(emptyHub);
        return;
      }
      for (const item of toolItems) {
        const row = document.createElement("div");
        row.className = "hub-tool";
        const name = document.createElement("span");
        name.className = "hub-tool-name";
        name.textContent = item.externalName || item.name || "n8n tool";
        const meta = document.createElement("span");
        meta.className = "hub-tool-meta";
        const labels = [item.category || "general"];
        if (item.acceptsImage) labels.push("image");
        if (item.sideEffect) labels.push("action");
        else labels.push("read");
        meta.textContent = labels.join(" · ");
        row.appendChild(name);
        row.appendChild(meta);
        hubToolList.appendChild(row);
      }
    }

    function renderTimeoutDiagnostics(data, reconnect) {
      timeoutCard.innerHTML = "";
      const offline = reconnect && reconnect.status === "offline";
      if (!data && !offline) {
        timeoutCard.hidden = true;
        return;
      }
      timeoutCard.hidden = false;

      const d = data || {};
      const outcome = offline ? "failed" : String(d.outcome || "retrying");
      const label = offline ? "Model offline" : outcome === "recovered" ? "Recovered" : outcome === "failed" ? "Retry failed" : "Retrying…";

      const head = document.createElement("div");
      head.className = "timeout-head";
      const title = document.createElement("strong");
      title.textContent = offline ? "Model connection interrupted" : "Model timed out";
      const stateLabel = document.createElement("span");
      stateLabel.className = "timeout-state" + (outcome === "failed" ? " failed" : "");
      stateLabel.textContent = label;
      head.appendChild(title);
      head.appendChild(stateLabel);
      timeoutCard.appendChild(head);

      const rows = [];
      if (d.model) rows.push(["Model", d.model]);
      if (d.turn) rows.push(["Turn", String(d.turn)]);
      if (d.deadlineMs) rows.push(["Deadline", Math.round(d.deadlineMs / 1000) + "s · retry " + Math.round((d.retryDeadlineMs || d.deadlineMs) / 1000) + "s"]);
      if (Array.isArray(d.filesRead)) rows.push(["Files read", d.filesRead.length ? d.filesRead.slice(0, 5).join(", ") : "none"]);
      if (Array.isArray(d.filesChanged)) rows.push(["Files changed", d.filesChanged.length ? d.filesChanged.slice(0, 5).join(", ") : "none"]);
      if (d.compaction) rows.push(["Compaction", Math.round(Number(d.compaction.beforeChars || 0) / 1000) + "k → " + Math.round(Number(d.compaction.afterChars || 0) / 1000) + "k chars · " + Number(d.compaction.summarized || 0) + " summarized"]);
      if (d.retry) rows.push(["Retry", String(d.retry) + "/" + String(d.maxRetries || 1)]);
      if (reconnect && reconnect.status === "retrying") rows.push(["Reconnect", String(reconnect.attempt || 0) + "/" + String(reconnect.max || 0)]);

      const grid = document.createElement("div");
      grid.className = "timeout-grid";
      for (const row of rows) {
        const key = document.createElement("span");
        key.className = "timeout-key";
        key.textContent = row[0];
        const value = document.createElement("span");
        value.className = "timeout-value";
        value.textContent = row[1];
        grid.appendChild(key);
        grid.appendChild(value);
      }
      timeoutCard.appendChild(grid);

      if (outcome === "failed" || offline) {
        const actions = document.createElement("div");
        actions.className = "timeout-actions";
        const resume = document.createElement("button");
        resume.type = "button";
        resume.textContent = "Resume from checkpoint";
        resume.addEventListener("click", () => vscode.postMessage({ type: "resume-run" }));
        const copy = document.createElement("button");
        copy.type = "button";
        copy.textContent = "Copy diagnostics";
        copy.addEventListener("click", () => {
          const text = rows.map((row) => row[0] + ": " + row[1]).join("\\n");
          navigator.clipboard && navigator.clipboard.writeText(text);
        });
        actions.appendChild(resume);
        actions.appendChild(copy);
        timeoutCard.appendChild(actions);
      }
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

        const action = document.createElement("button");
        action.type = "button";
        action.className = "tool-action";
        let actionMessage = null;
        if (item.path && /^file\./.test(String(item.name || ""))) {
          action.textContent = "Open";
          action.title = "Open in the real editor";
          actionMessage = { type: "open-file", path: item.path };
        } else if (/^(terminal\.|tests\.|process\.|sandbox\.)/.test(String(item.name || ""))) {
          action.textContent = "Terminal";
          action.title = "Show the real integrated terminal";
          actionMessage = { type: "open-terminal" };
        } else if (/^browser\./.test(String(item.name || ""))) {
          action.textContent = "Preview";
          action.title = "Open the real integrated preview";
          actionMessage = { type: "open-preview" };
        }
        if (actionMessage) {
          action.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            vscode.postMessage(actionMessage);
          });
          summary.appendChild(action);
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
      hint.textContent = "Review here · open in editor";
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
        const open = document.createElement("button");
        open.type = "button";
        open.className = "changed-open";
        open.textContent = "Open";
        open.title = "Open " + file.path + " in the real editor";
        open.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          vscode.postMessage({ type: "open-file", path: file.path });
        });
        summary.appendChild(open);
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
    function appendInlineMarkdown(parent, value) {
      let rest = String(value || "");
      const inlineCodeTick = String.fromCharCode(96);
      while (rest) {
        const boldAt = rest.indexOf("**");
        const codeAt = rest.indexOf(inlineCodeTick);
        let next = -1;
        let kind = "";
        if (boldAt >= 0 && (codeAt < 0 || boldAt < codeAt)) { next = boldAt; kind = "bold"; }
        else if (codeAt >= 0) { next = codeAt; kind = "code"; }
        if (next < 0) { parent.appendChild(document.createTextNode(rest)); break; }
        if (next > 0) parent.appendChild(document.createTextNode(rest.slice(0, next)));
        if (kind === "bold") {
          const end = rest.indexOf("**", 2);
          if (end < 0) { parent.appendChild(document.createTextNode(rest)); break; }
          const strong = document.createElement("strong");
          strong.textContent = rest.slice(2, end);
          parent.appendChild(strong);
          rest = rest.slice(end + 2);
        } else {
          const end = rest.indexOf(inlineCodeTick, 1);
          if (end < 0) { parent.appendChild(document.createTextNode(rest)); break; }
          const code = document.createElement("code");
          code.textContent = rest.slice(1, end);
          parent.appendChild(code);
          rest = rest.slice(end + 1);
        }
      }
    }

    function renderMarkdownText(container, value) {
      container.innerHTML = "";
      const lines = String(value || "").replace(/\\r\\n/g, "\\n").split("\\n");
      const codeFence = String.fromCharCode(96, 96, 96);
      let list = null;
      let listKind = "";
      let pre = null;
      let codeLines = [];
      const closeList = () => { list = null; listKind = ""; };
      const flushCode = () => {
        if (!pre) return;
        const code = document.createElement("code");
        code.textContent = codeLines.join("\\n");
        pre.appendChild(code);
        container.appendChild(pre);
        pre = null;
        codeLines = [];
      };
      for (const rawLine of lines) {
        const line = String(rawLine || "");
        if (line.trim().startsWith(codeFence)) {
          closeList();
          if (pre) flushCode();
          else pre = document.createElement("pre");
          continue;
        }
        if (pre) { codeLines.push(line); continue; }
        if (!line.trim()) { closeList(); continue; }

        const heading = line.match(/^(#{1,4})\\s+(.+)$/);
        if (heading) {
          closeList();
          const level = Math.min(4, Math.max(2, heading[1].length + 1));
          const node = document.createElement("h" + level);
          appendInlineMarkdown(node, heading[2]);
          container.appendChild(node);
          continue;
        }

        const bullet = line.match(/^\\s*[-*]\\s+(.+)$/);
        const numbered = line.match(/^\\s*\\d+[.)]\\s+(.+)$/);
        if (bullet || numbered) {
          const kind = bullet ? "ul" : "ol";
          if (!list || listKind !== kind) {
            list = document.createElement(kind);
            listKind = kind;
            container.appendChild(list);
          }
          const item = document.createElement("li");
          appendInlineMarkdown(item, (bullet || numbered)[1]);
          list.appendChild(item);
          continue;
        }

        closeList();
        const paragraph = document.createElement("p");
        appendInlineMarkdown(paragraph, line);
        container.appendChild(paragraph);
      }
      flushCode();
    }

    function renderResult(state) {
      result.innerHTML = "";
      if (deferredFinal) {
        const final = document.createElement("div");
        final.className = "bubble assistant";
        renderMarkdownText(final, deferredFinal);
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
          renderMarkdownText(final, summary);
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
      if (role === "assistant") renderMarkdownText(item, text);
      else item.textContent = text;
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
        notice.textContent = "Understanding your request…";
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
      if (message.type === "clarification-submitting" && current(message)) {
        const button = document.getElementById("clarification-continue");
        if (button) {
          button.disabled = true;
          button.textContent = "Checking…";
        }
      }
      if (message.type === "clarification-rejected" && current(message)) {
        const button = document.getElementById("clarification-continue");
        const error = document.getElementById("clarification-error");
        if (button) {
          button.disabled = false;
          button.textContent = "Continue";
        }
        if (error) error.textContent = message.message || "Could not continue.";
      }
      if (message.type === "clarification-accepted" && current(message)) {
        if (message.status === "NEEDS_CLARIFICATION") return;
        const button = document.getElementById("clarification-continue");
        if (button) {
          button.disabled = true;
          button.textContent = "Continuing…";
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
