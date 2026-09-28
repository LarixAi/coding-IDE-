function renderWelcome(view, nonce) {
  const detail = (view && view.detail) || "Checking the local model.";
  const ready = Boolean(view && view.ready);
  const modelLabel = (view && view.modelLabel) || "";
  const recent = Array.isArray(view && view.recent) ? view.recent : [];
  const status = ready
    ? `<span class="dot ready"></span><span>Local model ready</span>${modelLabel ? `<span class="rule"></span><span>${escapeHtml(modelLabel)}</span>` : ""}<span class="chev">${icon("chevron")}</span>`
    : `<span class="dot"></span><span>${escapeHtml(detail)}</span>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${escapeHtml(nonce)}';" />
  <style>
    :root {
      --bg: #0f1319;
      --card: #161b22;
      --card-hover: #1b2129;
      --line: #232a33;
      --text: #e8edf4;
      --muted: #8b95a5;
      --faint: #6b7689;
      --accent: #7fd3ea;
      --ready: #3dd68c;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: var(--vscode-font-family, ui-sans-serif, system-ui, sans-serif);
      font-size: 13px;
    }
    main {
      width: min(64rem, calc(100% - 64px));
      margin: 0 auto;
      padding: 40px 0 20px;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .hero { text-align: center; margin: 0 0 28px; }
    .mark {
      width: 52px;
      height: 52px;
      margin: 0 auto 22px;
      border-radius: 50%;
      background: var(--accent);
      color: #0b1c22;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.04em;
    }
    h1 { margin: 0 0 10px; font-size: 34px; font-weight: 650; letter-spacing: -0.035em; }
    .lede { margin: 0 auto; max-width: 34rem; color: var(--muted); line-height: 1.5; font-size: 14px; }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 18px;
      border: 1px solid var(--line);
      background: #12171e;
      color: var(--muted);
      border-radius: 999px;
      padding: 6px 12px 6px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    .status:hover { border-color: #33404c; color: var(--text); }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #5b6573; }
    .dot.ready { background: var(--ready); box-shadow: 0 0 0 3px #3dd68c22; }
    .rule { width: 1px; height: 12px; background: #2c3540; }
    .chev { width: 14px; height: 14px; color: var(--faint); display: inline-flex; }
    .actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 28px; }
    button.card, button.row, button.link, button.status {
      font: inherit;
      color: inherit;
      border: 0;
      background: transparent;
    }
    button.card {
      text-align: left;
      min-height: 148px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 18px 18px 16px;
      border-radius: 14px;
      background: var(--card);
      border: 1px solid var(--line);
      cursor: pointer;
    }
    button.card:hover { background: var(--card-hover); border-color: #2d3844; }
    .icon-box {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: #202833;
      color: #c9d3df;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    svg { width: 16px; height: 16px; display: block; flex: 0 0 auto; }
    .card-title { font-size: 14px; font-weight: 650; }
    button.card p { margin: 0; color: var(--muted); line-height: 1.45; flex: 1; }
    .go { margin-top: auto; color: var(--faint); width: 16px; height: 16px; }
    .lower { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 64px; flex: 1; }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
    }
    .section-head .left { display: flex; align-items: center; gap: 8px; }
    .mini { color: var(--faint); display: inline-flex; }
    button.link { color: #8ec8d8; cursor: pointer; padding: 0; display: inline-flex; align-items: center; gap: 4px; }
    button.link:hover { color: var(--accent); }
    .list { display: flex; flex-direction: column; }
    button.row {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 8px;
      border-radius: 10px;
      cursor: pointer;
      text-align: left;
    }
    button.row:hover { background: #171d25; }
    .row-title { color: var(--text); font-weight: 600; }
    .row-sub { color: var(--faint); font-size: 12px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .when, .tail { color: var(--faint); font-size: 12px; }
    .empty { color: var(--faint); padding: 10px 8px; }
    footer {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-top: 20px;
      padding-top: 14px;
      border-top: 1px solid #1c232c;
      color: var(--faint);
      font-size: 12px;
    }
    footer .tip { display: flex; align-items: center; gap: 8px; }
    @media (max-width: 920px) {
      .actions { grid-template-columns: 1fr 1fr; }
      .lower, footer { grid-template-columns: 1fr; display: grid; }
    }
    @media (max-width: 560px) {
      main { width: calc(100% - 32px); padding-top: 32px; }
      h1 { font-size: 28px; }
      .actions { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header class="hero">
      <div class="mark">CM</div>
      <h1>Welcome to CodeMe</h1>
      <p class="lede">Open a project, create something new, or connect your tools to start coding with AI.</p>
      <button class="status" type="button" data-action="connect">${status}</button>
    </header>
    <section class="actions">
      <button class="card" type="button" data-action="open">
        <span class="icon-box">${icon("folder")}</span>
        <div class="card-title">Open Folder</div>
        <p>Open a real folder on this computer.</p>
        <span class="go">${icon("arrow")}</span>
      </button>
      <button class="card" type="button" data-action="create">
        <span class="icon-box">${icon("plus")}</span>
        <div class="card-title">Create Project</div>
        <p>Create a new project from a template.</p>
        <span class="go">${icon("arrow")}</span>
      </button>
      <button class="card" type="button" data-action="clone">
        <span class="icon-box">${icon("branch")}</span>
        <div class="card-title">Clone Repository</div>
        <p>Clone a Git repository from GitHub or elsewhere.</p>
        <span class="go">${icon("arrow")}</span>
      </button>
      <button class="card" type="button" data-action="connect">
        <span class="icon-box">${icon("cloud")}</span>
        <div class="card-title">Connect AI Provider</div>
        <p>Configure and use AI models through Ollama.</p>
        <span class="go">${icon("arrow")}</span>
      </button>
    </section>
    <section class="lower">
      <div>
        <div class="section-head">
          <span class="left"><span class="mini">${icon("clock")}</span>Recent Projects</span>
          <button class="link" type="button" data-action="recents">View All ${icon("arrow")}</button>
        </div>
        <div class="list">${renderRecent(recent)}</div>
      </div>
      <div>
        <div class="section-head">
          <span class="left"><span class="mini">${icon("book")}</span>Quick Start</span>
        </div>
        <div class="list">
          <button class="row" type="button" data-action="learn">
            <span class="mini">${icon("compass")}</span>
            <span><span class="row-title">Learn the basics</span><div class="row-sub">Get familiar with CodeMe</div></span>
            <span class="tail">${icon("chevron")}</span>
          </button>
          <button class="row" type="button" data-action="shortcuts">
            <span class="mini">${icon("keys")}</span>
            <span><span class="row-title">Shortcuts</span><div class="row-sub">Boost your productivity</div></span>
            <span class="tail">${icon("chevron")}</span>
          </button>
          <button class="row" type="button" data-action="docs">
            <span class="mini">${icon("page")}</span>
            <span><span class="row-title">Documentation</span><div class="row-sub">Read the guides</div></span>
            <span class="tail">${icon("chevron")}</span>
          </button>
        </div>
      </div>
    </section>
    <footer>
      <div class="tip">${icon("bulb")} Tip: You can drag and drop a folder into CodeMe to open it quickly.</div>
      <button class="link" type="button" data-action="docs">Need help? Open documentation</button>
    </footer>
  </main>
  <script nonce="${escapeHtml(nonce)}">
    if (typeof acquireVsCodeApi !== "function") window.acquireVsCodeApi = function () { return { postMessage: function () {} }; };
    const vscode = acquireVsCodeApi();
    document.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => vscode.postMessage({
        type: "welcome",
        action: button.getAttribute("data-action"),
        uri: button.getAttribute("data-uri") || "",
      }));
    });
  </script>
</body>
</html>`;
}

function renderRecent(recent) {
  if (!recent.length) {
    return `<p class="empty">Folders you open will show up here.</p>`;
  }
  return recent.map((item) => {
    const name = escapeHtml(item.name || "Untitled");
    const location = escapeHtml(item.path || "");
    const when = escapeHtml(item.when || "");
    const uri = escapeHtml(item.uri || "");
    return `<button class="row" type="button" data-action="recent" data-uri="${uri}">
      <span class="mini">${icon("folder")}</span>
      <span><span class="row-title">${name}</span><div class="row-sub">${location}</div></span>
      <span class="when">${when}</span>
    </button>`;
  }).join("");
}

function formatRelativeTime(ms, now = Date.now()) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return "";
  const delta = Math.max(0, now - value);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  if (delta < hour) return "just now";
  if (delta < day) {
    const count = Math.floor(delta / hour);
    return count === 1 ? "1 hour ago" : `${count} hours ago`;
  }
  if (delta < week) {
    const count = Math.floor(delta / day);
    return count === 1 ? "1 day ago" : `${count} days ago`;
  }
  if (delta < 30 * day) {
    const count = Math.floor(delta / week);
    return count === 1 ? "1 week ago" : `${count} weeks ago`;
  }
  const count = Math.floor(delta / (30 * day));
  return count === 1 ? "1 month ago" : `${count} months ago`;
}

function icon(name) {
  const paths = {
    folder: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l1.5 1.5h7.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    branch: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M6 8v2a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V8M12 16V12"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.5-1.5A3.5 3.5 0 0 0 7 18z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
    book: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21.5z"/><path d="M5 5.5v16"/>',
    compass: '<circle cx="12" cy="12" r="8"/><path d="m15 9-2 6-6 2 2-6z"/>',
    keys: '<rect x="4" y="7" width="16" height="10" rx="2"/><path d="M8 11h.01M12 11h4"/>',
    page: '<path d="M7 4h7l4 4v12H7z"/><path d="M14 4v4h4"/>',
    bulb: '<path d="M9 18h6M10 21h4M8 15a6 6 0 1 1 8 0c-.8.8-1.2 1.6-1.3 2.5H9.3C9.2 16.6 8.8 15.8 8 15z"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
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

module.exports = { renderWelcome, formatRelativeTime, escapeHtml };
