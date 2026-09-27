function renderEmptyEditor(nonce) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${escapeHtml(nonce)}';" />
  <style>
    html, body { height: 100%; }
    body { margin: 0; background: #171b23; color: #dfe4ec; font-family: var(--vscode-font-family, sans-serif); font-size: 13px; }
    main { padding: 36px 32px; max-width: 20rem; }
    h1 { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
    p { margin: 0 0 18px; color: #97a3b6; }
    button { display: block; margin: 0 0 10px; padding: 0; border: 0; background: transparent; color: #7fd3ea; font: inherit; cursor: pointer; text-align: left; }
    button:hover { color: #dfe4ec; }
  </style>
</head>
<body>
  <main>
    <h1>CodeMe</h1>
    <p>Open a file or ask the agent.</p>
    <button type="button" data-action="open">Open File</button>
    <button type="button" data-action="search">Search Files</button>
    <button type="button" data-action="terminal">Open Terminal</button>
    <button type="button" data-action="ask">Ask CodeMe</button>
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
