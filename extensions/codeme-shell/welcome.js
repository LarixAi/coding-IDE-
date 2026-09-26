function renderWelcome(view, nonce) {
  const detail = (view && view.detail) || "Checking the local model.";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${escapeHtml(nonce)}';" />
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #171b23; color: #dfe4ec; font-family: var(--vscode-font-family); font-size: 13px; }
    main { width: min(40rem, calc(100% - 48px)); padding: 32px 0; }
    header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .mark { width: 32px; height: 32px; border-radius: 6px; background: #7fd3ea26; color: #7fd3ea; display: flex; align-items: center; justify-content: center; font-family: ui-monospace, monospace; font-size: 12px; font-weight: 650; }
    h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
    p { margin: 0; color: #6b7689; line-height: 1.45; }
    .pill { max-width: 16rem; border-radius: 999px; background: #7fd3ea22; color: #9fd7ea; padding: 4px 10px; font-size: 11px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button.card { text-align: left; border-radius: 6px; background: #1c2027; color: inherit; padding: 12px; cursor: pointer; }
    button.card.primary { border: 1px solid #7fd3ea66; }
    button.card.secondary { border: 1px solid #2a3038; }
    button.card:hover { background: #242a35; }
    .card-title { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 6px; }
    .icon { width: 28px; height: 28px; border-radius: 6px; background: #7fd3ea22; color: #7fd3ea; display: flex; align-items: center; justify-content: center; font-size: 14px; }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } header { flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <div class="brand"><span class="mark">CM</span><h1>CodeMe</h1></div>
        <p>Open a folder to start working. Clone, create, or connect the local model when you need them.</p>
      </div>
      <div class="pill">${escapeHtml(detail)}</div>
    </header>
    <div class="grid">
      <button class="card primary" type="button" data-action="open"><div class="card-title"><span class="icon">⌂</span>Open Folder</div><p>Open a real folder on this computer.</p></button>
      <button class="card secondary" type="button" data-action="clone"><div class="card-title"><span class="icon">⎇</span>Clone Repository</div><p>Clone a Git repository.</p></button>
      <button class="card secondary" type="button" data-action="create"><div class="card-title"><span class="icon">+</span>Create Project</div><p>Create a folder with a README and .gitignore.</p></button>
      <button class="card secondary" type="button" data-action="connect"><div class="card-title"><span class="icon">⌁</span>Connect AI Provider</div><p>Discover installed local models through Ollama.</p></button>
    </div>
  </main>
  <script nonce="${escapeHtml(nonce)}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll("button[data-action]").forEach((button) => {
      button.addEventListener("click", () => vscode.postMessage({ type: "welcome", action: button.getAttribute("data-action") }));
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

module.exports = { renderWelcome };
