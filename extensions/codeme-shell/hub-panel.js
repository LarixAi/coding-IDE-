function renderComposer(view, nonce) {
  const model = view && view.model;
  const modelDetail = escapeHtml((model && model.detail) || "Checking the local model server.");
  const connected = Boolean(view && view.connected);
  const capabilities = Array.isArray(view && view.capabilities) ? view.capabilities : [];
  const actions = [
    ["research.problem", "Research"],
    ["knowledge.lookup", "Lookup"],
    ["task.decompose", "Decompose"],
  ].filter(([name]) => capabilities.includes(name));
  const buttons = actions.map(([name, label]) => `<button type="button" data-action="${escapeHtml(name)}">${escapeHtml(label)}</button>`).join("");
  const hub = connected
    ? `<div class="hub"><p>${escapeHtml(view.detail || "Intelligence hub connected.")} File edits stay off.</p><div class="actions">${buttons}</div><pre id="hub-result"></pre></div>`
    : `<p class="quiet">${escapeHtml((view && view.detail) || "Intelligence hub is not reachable.")} File edits stay off.</p>`;
  const suggestions = [
    "Add password validation to the login form",
    "Explain how session refresh works",
    "Remove the console statements and run tests",
  ].map((text) => `<button type="button" class="suggestion" data-fill="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${escapeHtml(nonce)}';" />
  <style>
    html, body { height: 100%; }
    body { margin: 0; color: #dfe4ec; background: #1c2027; font-family: var(--vscode-font-family); font-size: 13px; }
    .shell { height: 100%; display: flex; flex-direction: column; }
    header { display: flex; align-items: center; height: 34px; padding: 0 12px; border-bottom: 1px solid #2a3038; background: #171b23; }
    h1 { margin: 0; font-size: 12px; font-weight: 600; }
    .thread { flex: 1; overflow: auto; padding: 16px; }
    .lead { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-size: 13px; font-weight: 600; }
    .mark { color: #7fd3ea; }
    .quiet, .hint { margin: 0 0 12px; color: #6b7689; line-height: 1.45; }
    .suggestion, .actions button, .modes button { border: 1px solid #2a3038; background: #171b23; color: #97a3b6; border-radius: 6px; }
    .suggestion { display: block; width: 100%; text-align: left; margin: 0 0 6px; padding: 6px 10px; cursor: pointer; }
    .suggestion:hover, .modes button:hover, .actions button:hover { border-color: #7fd3ea99; color: #dfe4ec; }
    .bubble { margin: 0 0 10px; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; line-height: 1.45; }
    .bubble.user { background: #2b3a48; }
    .bubble.assistant { background: #171b23; border: 1px solid #2a3038; }
    footer { border-top: 1px solid #2a3038; background: #1c2027; padding: 8px; }
    .modes { display: flex; gap: 4px; margin-bottom: 6px; }
    .modes button { height: 24px; padding: 0 8px; font-size: 11.5px; cursor: pointer; }
    .modes button.active { background: #7fd3ea26; color: #7fd3ea; border-color: transparent; }
    .model { margin: 0 0 6px; color: #6b7689; font-size: 11px; }
    .composer { display: flex; gap: 8px; align-items: flex-end; border: 1px solid #2a3038; border-radius: 6px; background: #171b23; padding: 8px; }
    .composer:focus-within { border-color: #7fd3ea; }
    textarea { flex: 1; min-height: 52px; resize: none; border: 0; background: transparent; color: #dfe4ec; font: inherit; outline: none; }
    #send { width: 24px; height: 24px; border: 0; border-radius: 6px; background: #7fd3ea; color: #171b23; font-weight: 700; cursor: pointer; }
    #send:disabled { opacity: 0.4; }
    .hub { margin-top: 8px; }
    .actions { display: flex; gap: 6px; }
    .actions button { padding: 4px 8px; cursor: pointer; }
    pre { margin: 8px 0 0; white-space: pre-wrap; color: #97a3b6; font-size: 11px; }
  </style>
</head>
<body>
  <div class="shell">
    <header><h1>CodeMe Agent</h1></header>
    <div class="thread" id="thread">
      <div id="empty">
        <p class="lead"><span class="mark">✦</span> Delegate work to CodeMe</p>
        <p class="hint">Ask and Plan read the open folder. File edits stay off.</p>
        ${suggestions}
      </div>
      <div id="messages"></div>
    </div>
    <footer>
      <div class="modes">
        <button type="button" class="active" data-mode="ask" title="Read-only answers about the codebase">Ask</button>
        <button type="button" data-mode="plan" title="Inspect the repo and draft an implementation plan">Plan</button>
        <button type="button" data-mode="agent" title="Editing stays off in this build">Agent</button>
      </div>
      <p class="model">Local model · ${modelDetail}</p>
      <div class="composer">
        <textarea id="prompt" maxlength="4000" placeholder="Describe the change…"></textarea>
        <button type="button" id="send" aria-label="Send to agent">↑</button>
      </div>
      ${hub}
    </footer>
  </div>
  <script nonce="${escapeHtml(nonce)}">
    const vscode = acquireVsCodeApi();
    const prompt = document.getElementById("prompt");
    const messages = document.getElementById("messages");
    const empty = document.getElementById("empty");
    const send = document.getElementById("send");
    let mode = "ask";
    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        mode = button.getAttribute("data-mode");
        document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("active", item === button));
        prompt.placeholder = mode === "ask" ? "Ask about this codebase…" : mode === "plan" ? "Describe what should be planned…" : "Describe the change…";
      });
    });
    document.querySelectorAll("[data-fill]").forEach((button) => {
      button.addEventListener("click", () => {
        prompt.value = button.getAttribute("data-fill") || "";
        prompt.focus();
      });
    });
    function addMessage(role, text) {
      empty.hidden = true;
      const item = document.createElement("div");
      item.className = "bubble " + role;
      item.textContent = text;
      messages.appendChild(item);
      messages.parentElement.scrollTop = messages.parentElement.scrollHeight;
    }
    function submit() {
      const text = (prompt.value || "").trim();
      if (!text) return;
      addMessage("user", text);
      prompt.value = "";
      send.disabled = true;
      vscode.postMessage({ type: "chat", text, mode });
    }
    send.addEventListener("click", submit);
    prompt.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });
    ${connected ? `document.querySelectorAll("button[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const result = document.getElementById("hub-result");
        if (result) result.textContent = "Working…";
        vscode.postMessage({ type: "hub", action: button.getAttribute("data-action"), text: prompt.value || "" });
      });
    });` : ""}
    window.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.type === "chat") {
        addMessage(message.role || "assistant", message.text || "");
        if (message.done !== false) send.disabled = false;
      }
      if (message.type === "result") {
        const result = document.getElementById("hub-result");
        if (result) result.textContent = message.text || "";
      }
    });
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
