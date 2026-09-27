function renderWelcome(view, nonce) {
  const detail = (view && view.detail) || "Checking the local model.";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${escapeHtml(nonce)}';" />
  <style>
    html, body { height: 100%; }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #171b23; color: #dfe4ec; font-family: var(--vscode-font-family, sans-serif); font-size: 13px; }
    main { width: min(44rem, calc(100% - 48px)); padding: 40px 0; }
    .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
    .mark { width: 36px; height: 36px; border-radius: 8px; background: #7fd3ea26; color: #7fd3ea; display: flex; align-items: center; justify-content: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; font-weight: 700; }
    h1 { margin: 0; font-size: 28px; font-weight: 600; letter-spacing: -0.03em; }
    .lede { margin: 0 0 8px; color: #97a3b6; line-height: 1.5; max-width: 36rem; }
    .pill { display: inline-flex; margin: 0 0 22px; border-radius: 999px; background: #7fd3ea18; color: #9fd7ea; padding: 5px 10px; font-size: 11px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    button.card {
      appearance: none; -webkit-appearance: none;
      display: block; width: 100%; min-height: 6.25rem; box-sizing: border-box;
      text-align: left; border-radius: 10px; background: #1c2027; color: inherit;
      padding: 16px; cursor: pointer; border: 1px solid #2a3038;
    }
    button.card.primary { border-color: #7fd3ea88; background: #1a242c; }
    button.card:hover { background: #242a35; border-color: #3a4452; }
    button.card.primary:hover { background: #1e2c35; border-color: #7fd3ea; }
    button.card:focus { outline: none; }
    button.card:focus-visible { outline: 2px solid #1ed1cd; outline-offset: 2px; }
    button.card:disabled { opacity: 0.55; cursor: wait; }
    .card-title { display: flex; align-items: center; gap: 10px; font-weight: 650; margin-bottom: 8px; font-size: 14px; }
    .icon { width: 30px; height: 30px; border-radius: 7px; background: #7fd3ea22; color: #7fd3ea; display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
    button.card p { margin: 0; color: #6b7689; line-height: 1.45; }
    .error { display: none; margin: 14px 0 0; color: #ff918b; font-size: 12px; }
    .error.on { display: block; }
    .note { min-height: 1.2em; margin: 12px 0 0; color: #97a3b6; font-size: 12px; }
    body.busy .note { color: #9fd7ea; }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } h1 { font-size: 24px; } }
  </style>
</head>
<body>
  <main>
    <div class="brand"><span class="mark">CM</span><h1>Code Me</h1></div>
    <p class="lede">Open a folder to start, or create a project folder. New projects get a README.md and .gitignore, then open in this window.</p>
    <div class="pill" id="pill">${escapeHtml(detail)}</div>
    <div class="grid">
      <button class="card primary" type="button" data-action="open" aria-label="Open Folder">
        <div class="card-title"><span class="icon">⌂</span>Open Folder</div>
        <p>Open an existing folder on this computer.</p>
      </button>
      <button class="card" type="button" data-action="create" aria-label="Create Project">
        <div class="card-title"><span class="icon">+</span>Create Project</div>
        <p>Create or pick a folder. CodeMe adds README.md and .gitignore if they are missing, then opens it.</p>
      </button>
      <button class="card" type="button" data-action="clone" aria-label="Clone Repository">
        <div class="card-title"><span class="icon">⎇</span>Clone Repository</div>
        <p>Clone a Git repository into a new folder.</p>
      </button>
      <button class="card" type="button" data-action="connect" aria-label="Connect AI Provider">
        <div class="card-title"><span class="icon">⌁</span>Connect AI Provider</div>
        <p>Check the local Ollama models already installed.</p>
      </button>
    </div>
    <p class="error" id="error" role="alert"></p>
    <p class="note" id="note"></p>
  </main>
  <script nonce="${escapeHtml(nonce)}">
    const vscode = acquireVsCodeApi();
    const buttons = Array.from(document.querySelectorAll("button[data-action]"));
    const error = document.getElementById("error");
    const note = document.getElementById("note");
    const pill = document.getElementById("pill");
    let busy = false;

    function setBusy(on, action) {
      busy = on;
      document.body.classList.toggle("busy", on);
      buttons.forEach((button) => { button.disabled = on; });
      note.textContent = on ? (action === "create" ? "Choosing project folder…" : action === "open" ? "Opening folder…" : "Working…") : "";
    }

    function showError(message) {
      error.textContent = message || "";
      error.classList.toggle("on", Boolean(message));
    }

    buttons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        if (busy) return;
        const action = button.getAttribute("data-action");
        showError("");
        setBusy(true, action);
        vscode.postMessage({ type: "welcome", action });
      });
    });

    window.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.type === "welcome-status" && pill) {
        pill.textContent = message.detail || "";
        return;
      }
      if (message.type !== "welcome-done") return;
      setBusy(false);
      showError(message.error || "");
    });

    vscode.postMessage({ type: "welcome", action: "ready" });
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

module.exports = { renderWelcome };
