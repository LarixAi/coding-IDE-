function renderEmptyEditor(nonce) {
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
    .lede { margin: 0 0 22px; color: #97a3b6; line-height: 1.5; max-width: 36rem; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    button.card {
      appearance: none; -webkit-appearance: none;
      display: block; width: 100%; min-height: 5.5rem; box-sizing: border-box;
      text-align: left; border-radius: 10px; background: #1c2027; color: inherit;
      padding: 16px; cursor: pointer; border: 1px solid #2a3038;
    }
    button.card.primary { border-color: #7fd3ea88; background: #1a242c; }
    button.card:hover { background: #242a35; border-color: #3a4452; }
    button.card:focus { outline: none; }
    button.card:focus-visible { outline: 2px solid #1ed1cd; outline-offset: 2px; }
    .card-title { display: flex; align-items: center; gap: 10px; font-weight: 650; margin-bottom: 8px; font-size: 14px; }
    .icon { width: 30px; height: 30px; border-radius: 7px; background: #7fd3ea22; color: #7fd3ea; display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
    button.card p { margin: 0; color: #6b7689; line-height: 1.45; }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } h1 { font-size: 24px; } }
  </style>
</head>
<body>
  <main>
    <div class="brand"><span class="mark">CM</span><h1>Code Me</h1></div>
    <p class="lede">This folder is open, but no file is. Open a file, or create another project if this is the wrong place.</p>
    <div class="grid">
      <button class="card primary" type="button" data-action="open" aria-label="Open File">
        <div class="card-title"><span class="icon">≡</span>Open File</div>
        <p>Jump to a file in this folder.</p>
      </button>
      <button class="card" type="button" data-action="search" aria-label="Search Files">
        <div class="card-title"><span class="icon">⌕</span>Search Files</div>
        <p>Search the workspace for text.</p>
      </button>
      <button class="card" type="button" data-action="folder" aria-label="Open Folder">
        <div class="card-title"><span class="icon">⌂</span>Open Folder</div>
        <p>Switch to another folder on this computer.</p>
      </button>
      <button class="card" type="button" data-action="create" aria-label="Create Project">
        <div class="card-title"><span class="icon">+</span>Create Project</div>
        <p>Create or pick a folder. CodeMe adds README.md and .gitignore if they are missing.</p>
      </button>
    </div>
  </main>
  <script nonce="${escapeHtml(nonce)}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll("button[data-action]").forEach((button) => {
      button.addEventListener("click", () => vscode.postMessage({ type: "empty", action: button.getAttribute("data-action") }));
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

module.exports = { renderEmptyEditor };
