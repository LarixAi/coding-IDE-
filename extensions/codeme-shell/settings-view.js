"use strict";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(value) {
  return JSON.stringify(value == null ? {} : value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function dot(status) {
  const value = String(status || "offline");
  const label = value === "online" ? "Online" : value === "degraded" ? "Degraded" : value === "starting" ? "Starting" : "Offline";
  return '<span class="health-dot ' + escapeHtml(value) + '"></span><span>' + label + "</span>";
}

function toggle(path, label, checked, hint) {
  return [
    '<label class="setting-row">',
    '<span class="setting-copy"><strong>' + escapeHtml(label) + '</strong>',
    hint ? '<small>' + escapeHtml(hint) + '</small>' : "",
    '</span>',
    '<input class="toggle" type="checkbox" data-setting="' + escapeHtml(path) + '"' + (checked ? " checked" : "") + ' />',
    "</label>",
  ].join("");
}

function selectRow(path, label, value, options, hint) {
  const items = options.map((item) => {
    const selected = String(item.value) === String(value) ? " selected" : "";
    return '<option value="' + escapeHtml(item.value) + '"' + selected + ">" + escapeHtml(item.label) + "</option>";
  }).join("");
  return [
    '<label class="setting-row">',
    '<span class="setting-copy"><strong>' + escapeHtml(label) + '</strong>',
    hint ? '<small>' + escapeHtml(hint) + '</small>' : "",
    '</span>',
    '<select data-setting="' + escapeHtml(path) + '">' + items + "</select>",
    "</label>",
  ].join("");
}

function planned(title, text) {
  return '<div class="planned"><span>Planned</span><div><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(text) + "</p></div></div>";
}

function healthCard(name, item) {
  const detail = item && item.detail ? item.detail : "";
  return [
    '<div class="health-card">',
    '<div class="health-title"><strong>' + escapeHtml(name) + '</strong><span class="health-state">' + dot(item && item.status) + "</span></div>",
    '<p>' + escapeHtml(detail) + "</p>",
    "</div>",
  ].join("");
}

function renderModels(state) {
  const models = state.models || {};
  const selected = models.selected || {};
  const sources = Array.isArray(models.sources) ? models.sources : [];
  const available = Array.isArray(models.available) ? models.available : [];
  return [
    '<div class="hero-card"><span class="eyebrow">Selected model</span><h3>' + escapeHtml(selected.label || "No model selected") + "</h3>",
    '<p>Model selection stays owned by CodeMe. Paperclip and n8n never select or route the model.</p></div>',
    '<div class="card"><h3>Providers</h3>',
    sources.length ? sources.map((source) => [
      '<div class="list-row"><span><strong>' + escapeHtml(source.label || source.id) + '</strong><small>' + escapeHtml(source.url || "") + "</small></span>",
      '<span class="badge ' + (source.available ? "ok" : "") + '">' + escapeHtml(source.available ? String(source.count || 0) + " models" : source.message || "Unavailable") + "</span></div>",
    ].join("")).join("") : '<p class="muted">No model sources have been discovered yet.</p>',
    "</div>",
    '<div class="card"><h3>Available models</h3>',
    available.length ? available.map((model) => '<div class="list-row"><span><strong>' + escapeHtml(model.label || model.id) + '</strong><small>' + escapeHtml(model.provider || "") + '</small></span></div>').join("") : '<p class="muted">No available models.</p>',
    "</div>",
  ].join("");
}

function renderAgents(state) {
  const paperclip = state.paperclip || {};
  const agents = paperclip.team && Array.isArray(paperclip.team.agents) ? paperclip.team.agents : [];
  return [
    '<div class="hero-card"><span class="eyebrow">Team architecture</span><h3>Paperclip coordinates. CodeMe executes.</h3>',
    '<p>The selected CodeMe model remains unchanged while Paperclip delegates CTO, Developer, Test and Reviewer phases.</p></div>',
    '<div class="card"><h3>Configured team</h3>',
    agents.length ? agents.map((agent) => [
      '<div class="list-row"><span><strong>' + escapeHtml(agent.label || agent.role) + '</strong><small>' + escapeHtml((agent.role || "") + " · " + (agent.mode || "")) + '</small></span>',
      '<span class="badge ' + (agent.configured ? "ok" : "") + '">' + escapeHtml(agent.configured ? "Ready" : "Not configured") + "</span></div>",
    ].join("")).join("") : '<p class="muted">No Paperclip team is configured.</p>',
    "</div>",
    planned("Custom agents", "Create specialist agents, define their responsibilities, capabilities, permissions and escalation rules."),
    planned("Team workflow editor", "Visually configure phase order, optional roles, approvals and bounded repair loops."),
  ].join("");
}

function renderPaperclip(state) {
  const p = state.paperclip || {};
  const health = state.health && state.health.paperclip || {};
  const orchestration = p.orchestration || {};
  return [
    '<div class="hero-card"><div class="hero-line"><div><span class="eyebrow">Paperclip</span><h3>' + dot(health.status) + '</h3></div><button data-action="refresh-health">Test connection</button></div><p>' + escapeHtml(health.detail || "") + "</p></div>",
    '<div class="card"><h3>Connection</h3>',
    '<div class="info-row"><span>Control plane</span><code>' + escapeHtml(p.apiUrl || "Not configured") + "</code></div>",
    '<div class="info-row"><span>CodeMe bridge</span><code>' + escapeHtml(p.bridgeUrl || "Not configured") + "</code></div>",
    '<div class="info-row"><span>Authentication</span><span class="badge ' + (p.configured ? "ok" : "") + '">' + escapeHtml(p.configured ? "Configured" : "Incomplete") + "</span></div>",
    "</div>",
    '<div class="card"><h3>Orchestration</h3>',
    '<div class="info-row"><span>Team orchestration</span><span class="badge ' + (orchestration.enabled ? "ok" : "") + '">' + escapeHtml(orchestration.enabled ? "Enabled" : "Disabled") + "</span></div>",
    '<div class="info-row"><span>Team mode</span><span>' + escapeHtml((p.team && p.team.mode) || "single-agent") + "</span></div>",
    '<div class="info-row"><span>Active controller runs</span><span>' + escapeHtml(String((p.controller && p.controller.active && p.controller.active.length) || 0)) + "</span></div>",
    '<div class="info-row"><span>Active orchestrations</span><span>' + escapeHtml(String((orchestration.active && orchestration.active.length) || 0)) + "</span></div>",
    "</div>",
    '<div class="notice">Paperclip credentials are not displayed here. Runtime credentials remain outside normal settings storage.</div>',
  ].join("");
}

function renderN8n(state) {
  const n = state.n8n || {};
  const health = state.health && state.health.n8n || {};
  const categories = n.categories && typeof n.categories === "object" ? Object.entries(n.categories) : [];
  return [
    '<div class="hero-card"><div class="hero-line"><div><span class="eyebrow">n8n & Automation</span><h3>' + dot(health.status) + '</h3></div><button data-action="refresh-health">Test connection</button></div><p>' + escapeHtml(health.detail || "") + "</p></div>",
    '<div class="card"><h3>Connection</h3>',
    '<label class="field"><span>MCP URL</span><input id="n8n-mcp-url" value="' + escapeHtml(n.mcpUrl || "") + '" /></label>',
    '<label class="field"><span>Prompt enhancement webhook</span><input id="n8n-enhance-url" value="' + escapeHtml(n.enhanceWebhookUrl || "") + '" /></label>',
    '<label class="setting-row"><span class="setting-copy"><strong>Enable MCP tools</strong><small>Allow CodeMe to discover safe n8n MCP capabilities.</small></span><input id="n8n-enabled" class="toggle" type="checkbox"' + (n.mcpEnabled ? " checked" : "") + " /></label>",
    '<label class="setting-row"><span class="setting-copy"><strong>Automatic prompt enhancement</strong><small>Run prompt.enrich before eligible requests.</small></span><input id="n8n-auto-enhance" class="toggle" type="checkbox"' + (n.autoEnhance ? " checked" : "") + " /></label>",
    '<label class="setting-row"><span class="setting-copy"><strong>Allow image upload</strong><small>Images are never sent to n8n when this is off.</small></span><input id="n8n-image-upload" class="toggle" type="checkbox"' + (n.imageUploadAllowed ? " checked" : "") + " /></label>",
    '<label class="field"><span>MCP bearer token</span><input id="n8n-token" type="password" value="" placeholder="' + escapeHtml(n.tokenConfigured ? "Configured — leave blank to keep" : "Not configured") + '" /></label>',
    '<div class="actions"><button data-action="save-n8n">Save n8n settings</button><button class="secondary" data-action="refresh-health">Refresh capabilities</button></div>',
    "</div>",
    '<div class="card"><h3>Capabilities</h3>',
    '<div class="info-row"><span>Safe tools discovered</span><span>' + escapeHtml(String(n.safeToolCount || n.toolCount || 0)) + "</span></div>",
    categories.length ? categories.map(([name, count]) => '<div class="info-row"><span>' + escapeHtml(name) + '</span><span class="badge">' + escapeHtml(String(count)) + "</span></div>").join("") : '<p class="muted">No capability categories discovered.</p>',
    "</div>",
  ].join("");
}

function renderOverview(state, values) {
  const health = state.health || {};
  const workspace = state.workspace || {};
  return [
    '<div class="page-title"><div><span class="eyebrow">CodeMe</span><h2>Settings overview</h2><p>Configure CodeMe globally or override supported settings for this workspace.</p></div><button data-action="refresh-health">Refresh health</button></div>',
    '<div class="health-grid">',
    healthCard("Paperclip", health.paperclip || {}),
    healthCard("n8n", health.n8n || {}),
    healthCard("Model server", health.model || {}),
    "</div>",
    '<div class="card"><h3>Current workspace</h3><div class="info-row"><span>Name</span><span>' + escapeHtml(workspace.name || "No folder open") + '</span></div><div class="info-row"><span>Path</span><code>' + escapeHtml(workspace.path || "") + "</code></div></div>",
    '<div class="card"><h3>Chat defaults</h3>',
    '<div class="info-row"><span>Default mode</span><span>' + escapeHtml(values.general.defaultMode) + "</span></div>",
    '<div class="info-row"><span>Service status indicators</span><span>' + escapeHtml(values.appearance.showServiceStatus ? "Shown" : "Hidden") + "</span></div>",
    '<div class="info-row"><span>Unused service activity</span><span>Hidden</span></div>',
    "</div>",
  ].join("");
}

function renderPanel(id, state, values) {
  if (id === "overview") return renderOverview(state, values);
  if (id === "general") return [
    '<div class="page-title"><div><h2>General</h2><p>Core CodeMe behaviour and startup preferences.</p></div></div>',
    '<div class="card">',
    toggle("general.autoSave", "Auto-save CodeMe settings", values.general.autoSave, "Save supported settings immediately after changes."),
    selectRow("general.defaultMode", "Default agent mode", values.general.defaultMode, [
      { value: "ask", label: "Ask" }, { value: "plan", label: "Plan" }, { value: "code", label: "Code" }, { value: "team", label: "Team" },
    ], "Used when a new chat starts once Team mode is connected."),
    toggle("general.openLastWorkspace", "Restore last workspace", values.general.openLastWorkspace, "Keep normal Code - OSS workspace restore behaviour."),
    "</div>",
  ].join("");
  if (id === "appearance") return [
    '<div class="page-title"><div><h2>Appearance</h2><p>Settings-page and chat presentation preferences.</p></div></div>',
    '<div class="card">',
    selectRow("appearance.chatDensity", "Chat density", values.appearance.chatDensity, [
      { value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" },
    ], "Activity cards will use this preference when the live-activity gate is connected."),
    toggle("appearance.showServiceStatus", "Show service status", values.appearance.showServiceStatus, "Keep small Paperclip and n8n health indicators visible without adding chat messages."),
    "</div>",
  ].join("");
  if (id === "models") return '<div class="page-title"><div><h2>Models & Providers</h2><p>Discover model servers and see the model currently selected by CodeMe.</p></div></div>' + renderModels(state);
  if (id === "agents") return '<div class="page-title"><div><h2>Agents & Teams</h2><p>Paperclip team structure and future custom-agent management.</p></div></div>' + renderAgents(state);
  if (id === "paperclip") return '<div class="page-title"><div><h2>Paperclip</h2><p>Control-plane health, bridge state and team orchestration.</p></div></div>' + renderPaperclip(state);
  if (id === "n8n") return '<div class="page-title"><div><h2>n8n & Automation</h2><p>Prompt enhancement, research and MCP capability access.</p></div></div>' + renderN8n(state);
  if (id === "mcp") return [
    '<div class="page-title"><div><h2>MCP & Tools</h2><p>One place for CodeMe tools, n8n MCP capabilities and future connectors.</p></div></div>',
    '<div class="card"><h3>Current external tool hub</h3><div class="info-row"><span>n8n MCP tools</span><span>' + escapeHtml(String((state.n8n && state.n8n.toolCount) || 0)) + '</span></div><div class="info-row"><span>Action tools</span><span class="badge">Locked</span></div></div>',
    planned("MCP server registry", "Add, remove, enable and inspect multiple MCP servers without changing the CodeMe core."),
  ].join("");
  if (id === "research") return [
    '<div class="page-title"><div><h2>Research & Web</h2><p>Control when current external evidence is required.</p></div></div><div class="card">',
    toggle("research.requireFreshEvidenceWhenNeeded", "Require fresh evidence when needed", values.research.requireFreshEvidenceWhenNeeded, "Do not let a coding model guess current APIs or published rules."),
    toggle("research.preferN8nResearch", "Prefer n8n research capability", values.research.preferN8nResearch, "Use the shared hub when research is required and available."),
    "</div>",
  ].join("");
  if (id === "memory") return [
    '<div class="page-title"><div><h2>Memory & Knowledge</h2><p>Project knowledge and reusable context preferences.</p></div></div><div class="card">',
    toggle("memory.projectKnowledgeEnabled", "Project knowledge", values.memory.projectKnowledgeEnabled, "Allow CodeMe to use project-scoped knowledge when the knowledge capability is connected."),
    toggle("memory.reusableMemoryEnabled", "Reusable memory", values.memory.reusableMemoryEnabled, "Prepare for durable reusable knowledge across related work."),
    "</div>",
  ].join("");
  if (id === "workspace") return '<div class="page-title"><div><h2>Workspace</h2><p>Workspace boundaries, indexing and external-path policy.</p></div></div>' + planned("Workspace policy", "Configure allowed roots, ignore patterns, indexing rules and explicit outside-workspace approvals.");
  if (id === "terminal") return '<div class="page-title"><div><h2>Terminal</h2><p>Shell execution and command approval policy.</p></div></div>' + planned("Terminal permissions", "Separate safe commands, app startup, dependency installs, destructive commands and sudo into Allow / Ask / Block policies.");
  if (id === "browser") return '<div class="page-title"><div><h2>Browser & Preview</h2><p>Preview lifecycle and browser verification defaults.</p></div></div>' + planned("Preview policy", "Manage preview ports, process reuse, browser verification and automatic startup checks.");
  if (id === "git") return '<div class="page-title"><div><h2>Git & GitHub</h2><p>Source-control behaviour and remote actions.</p></div></div>' + planned("Git permissions", "Configure diff, commit, push, force-push and GitHub write approvals separately.");
  if (id === "chat") return [
    '<div class="page-title"><div><h2>Chat & Activity</h2><p>Keep service health visible while hiding unused activity.</p></div></div><div class="card">',
    toggle("chatActivity.showPaperclipStatus", "Show Paperclip status", values.chatActivity.showPaperclipStatus, "Display a small health indicator even when Paperclip is not being used."),
    toggle("chatActivity.showN8nStatus", "Show n8n status", values.chatActivity.showN8nStatus, "Display a small health indicator even when n8n is not being used."),
    toggle("chatActivity.showCodeMeTools", "Show CodeMe tool activity", values.chatActivity.showCodeMeTools, "Show tools that are actually called."),
    toggle("chatActivity.showPaperclipOnlyWhenUsed", "Paperclip activity only when used", values.chatActivity.showPaperclipOnlyWhenUsed, "Do not add Paperclip activity to the chat unless a Paperclip run actually occurs."),
    toggle("chatActivity.showN8nOnlyWhenUsed", "n8n activity only when used", values.chatActivity.showN8nOnlyWhenUsed, "Do not show skipped or unused n8n workflows."),
    toggle("chatActivity.collapseCompleted", "Collapse completed activity", values.chatActivity.collapseCompleted, "Keep the thread readable after work completes."),
    toggle("chatActivity.autoExpandErrors", "Auto-expand errors", values.chatActivity.autoExpandErrors, "Show failure evidence immediately."),
    toggle("chatActivity.showRawJson", "Show raw JSON automatically", values.chatActivity.showRawJson, "Off by default. Raw events should stay behind View details."),
    '</div><div class="notice">These preferences are stored now. The next Chat Service Visibility gate will connect them to the Composer UI.</div>',
  ].join("");
  if (id === "permissions") return '<div class="page-title"><div><h2>Permissions & Approvals</h2><p>Future Allow / Ask / Block policy across files, terminal, Git, secrets and external services.</p></div></div><div class="warning">Permission controls are intentionally not editable yet because they are not enforced by the runtime. We will only expose a switch once the enforcement path exists.</div>' + planned("Permission manager", "Enforce policies centrally instead of relying on prompts or visual toggles.");
  if (id === "secrets") return [
    '<div class="page-title"><div><h2>Secrets & Connections</h2><p>Connection state without exposing secret values.</p></div></div>',
    '<div class="card"><div class="info-row"><span>n8n bearer token</span><span class="badge ' + (state.n8n && state.n8n.tokenConfigured ? "ok" : "") + '">' + escapeHtml(state.n8n && state.n8n.tokenConfigured ? "Configured" : "Not configured") + '</span></div><div class="info-row"><span>Paperclip credentials</span><span class="badge ' + (state.paperclip && state.paperclip.configured ? "ok" : "") + '">' + escapeHtml(state.paperclip && state.paperclip.configured ? "Configured" : "Incomplete") + "</span></div></div>",
    '<div class="notice">Secrets are never rendered into this settings page. n8n tokens use VS Code SecretStorage; existing Paperclip credentials remain in runtime configuration.</div>',
  ].join("");
  if (id === "diagnostics") return [
    '<div class="page-title"><div><h2>Diagnostics</h2><p>Quick health view before opening logs or Terminal.</p></div><button data-action="refresh-health">Run diagnostic</button></div>',
    '<div class="health-grid">' + healthCard("Paperclip", state.health && state.health.paperclip || {}) + healthCard("n8n", state.health && state.health.n8n || {}) + healthCard("Model server", state.health && state.health.model || {}) + "</div>",
    planned("Diagnostic report", "Generate a single copyable report with service health, recent failures and safe configuration metadata."),
  ].join("");
  if (id === "advanced") return [
    '<div class="page-title"><div><h2>Backup & Advanced</h2><p>Settings portability and experimental features.</p></div></div><div class="card">',
    toggle("advanced.experimentalFeatures", "Experimental features", values.advanced.experimentalFeatures, "Keep unstable CodeMe features opt-in."),
    '</div>',
    planned("Export / Import", "Export non-secret settings and workspace overrides with versioned migrations."),
  ].join("");
  return renderOverview(state, values);
}

function renderSettings(state, nonce) {
  const settings = state.settings || {};
  const values = settings.effective || {};
  const scope = settings.scope === "workspace" ? "workspace" : "global";
  const nav = [
    ["overview", "Overview", "GENERAL"],
    ["general", "General", "GENERAL"],
    ["appearance", "Appearance", "GENERAL"],
    ["models", "Models & Providers", "AI"],
    ["agents", "Agents & Teams", "AI"],
    ["paperclip", "Paperclip", "SERVICES"],
    ["n8n", "n8n & Automation", "SERVICES"],
    ["mcp", "MCP & Tools", "SERVICES"],
    ["research", "Research & Web", "KNOWLEDGE"],
    ["memory", "Memory & Knowledge", "KNOWLEDGE"],
    ["workspace", "Workspace", "RUNTIME"],
    ["terminal", "Terminal", "RUNTIME"],
    ["browser", "Browser & Preview", "RUNTIME"],
    ["git", "Git & GitHub", "SOURCE CONTROL"],
    ["chat", "Chat & Activity", "CHAT"],
    ["permissions", "Permissions", "SECURITY"],
    ["secrets", "Secrets & Connections", "SECURITY"],
    ["diagnostics", "Diagnostics", "SYSTEM"],
    ["advanced", "Backup & Advanced", "SYSTEM"],
  ];
  let group = "";
  const navHtml = nav.map(([id, label, nextGroup]) => {
    const heading = nextGroup !== group ? '<div class="nav-group">' + escapeHtml(nextGroup) + "</div>" : "";
    group = nextGroup;
    return heading + '<button class="nav-item' + (id === "overview" ? " active" : "") + '" data-panel="' + id + '" data-search="' + escapeHtml((label + " " + nextGroup).toLowerCase()) + '">' + escapeHtml(label) + "</button>";
  }).join("");

  const panelIds = nav.map((item) => item[0]);
  const panels = panelIds.map((id) => '<section class="panel' + (id === "overview" ? " active" : "") + '" id="panel-' + id + '">' + renderPanel(id, state, values) + "</section>").join("");

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + escapeHtml(nonce) + '\';" />'
    + '<meta name="viewport" content="width=device-width,initial-scale=1" />'
    + '<style>'
    + 'html,body{height:100%}body{margin:0;background:#181b20;color:#d8dde6;font-family:var(--vscode-font-family);font-size:13px}.shell{height:100%;display:grid;grid-template-columns:250px minmax(0,1fr)}'
    + '.sidebar{border-right:1px solid #2a2f37;background:#15181d;display:flex;flex-direction:column;min-height:0}.side-head{padding:16px 14px 10px;border-bottom:1px solid #252a31}.side-head h1{font-size:15px;margin:0 0 10px}.search{width:100%;box-sizing:border-box;background:#20242b;border:1px solid #343a44;border-radius:5px;color:#e1e6ee;padding:7px 9px;outline:none}.scope{margin-top:9px;width:100%;background:#20242b;border:1px solid #343a44;border-radius:5px;color:#d8dde6;padding:6px 8px}.nav{padding:8px;overflow:auto}.nav-group{padding:12px 8px 4px;color:#66717f;font-size:9px;font-weight:700;letter-spacing:.08em}.nav-item{display:block;width:100%;text-align:left;border:0;border-radius:5px;background:transparent;color:#aab3bf;padding:7px 9px;cursor:pointer;font:inherit}.nav-item:hover{background:#20242b;color:#e1e6ee}.nav-item.active{background:#262d35;color:#fff}.main{min-width:0;overflow:auto}.topbar{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:10px 20px;border-bottom:1px solid #272c33;background:#181b20ee;backdrop-filter:blur(8px)}'
    + '.topbar .saved{color:#7e8997;font-size:11px}.content{max-width:940px;margin:0 auto;padding:24px 30px 50px}.panel{display:none}.panel.active{display:block}.page-title{display:flex;gap:20px;justify-content:space-between;align-items:flex-start;margin-bottom:18px}.page-title h2{margin:0 0 5px;font-size:22px}.page-title p,.hero-card p,.card p{margin:0;color:#8d98a6;line-height:1.5}.eyebrow{display:block;color:#71808f;font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}'
    + '.card,.hero-card{border:1px solid #2f353e;border-radius:8px;background:#1d2127;margin:0 0 14px;padding:14px 16px}.hero-card{background:#1b2026}.hero-card h3,.card h3{margin:0 0 10px;font-size:14px}.hero-line{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.health-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:14px}.health-card{border:1px solid #2f353e;border-radius:8px;padding:12px;background:#1d2127}.health-title{display:flex;justify-content:space-between;gap:10px;align-items:center}.health-card p{margin:8px 0 0;color:#7f8a98;font-size:11px;line-height:1.4}.health-state{display:inline-flex;gap:5px;align-items:center;color:#aab3bf;font-size:11px}.health-dot{width:7px;height:7px;border-radius:50%;background:#697482}.health-dot.online{background:#6fbd8b}.health-dot.degraded{background:#d7ad67}.health-dot.starting{background:#7fb7dd}.health-dot.offline{background:#d36f78}'
    + '.setting-row,.list-row,.info-row{display:flex;align-items:center;justify-content:space-between;gap:18px;min-height:42px;border-top:1px solid #2a3038}.setting-row:first-child,.list-row:first-child,.info-row:first-child{border-top:0}.setting-copy,.list-row span:first-child{display:flex;flex-direction:column;min-width:0}.setting-copy small,.list-row small{margin-top:3px;color:#778391;font-size:10px}.toggle{width:16px;height:16px}.badge{border:1px solid #39414b;border-radius:999px;padding:2px 7px;color:#9ca7b5;font-size:10px}.badge.ok{border-color:#355743;color:#82c99d}code{color:#b9c2ce;font-family:var(--vscode-editor-font-family,monospace);font-size:11px;overflow-wrap:anywhere}'
    + 'select,input,button{font:inherit}select,.field input{background:#181c21;border:1px solid #353c46;border-radius:5px;color:#d8dde6;padding:6px 8px}.field{display:flex;flex-direction:column;gap:5px;margin:0 0 11px}.field span{color:#aeb7c3;font-size:11px}.field input{width:100%;box-sizing:border-box}button{border:1px solid #3b4652;border-radius:5px;background:#2b3943;color:#dce4ea;padding:6px 10px;cursor:pointer}button:hover{background:#344650}.secondary{background:transparent}.actions{display:flex;gap:8px;margin-top:12px}.planned,.notice,.warning{display:flex;gap:10px;border:1px dashed #39414b;border-radius:8px;padding:12px 14px;margin:0 0 12px;color:#909baa}.planned>span{height:max-content;border:1px solid #46505c;border-radius:999px;padding:2px 6px;font-size:9px;text-transform:uppercase}.planned strong{color:#c5ccd6}.planned p{margin:3px 0 0;color:#7e8996}.notice{display:block;border-style:solid;background:#1b2228}.warning{display:block;border-color:#64513a;background:#251f19;color:#d7b987}.muted{color:#76818f!important}'
    + '@media(max-width:760px){.shell{grid-template-columns:190px minmax(0,1fr)}.health-grid{grid-template-columns:1fr}.content{padding:20px 16px}}'
    + '</style></head><body><div class="shell"><aside class="sidebar"><div class="side-head"><h1>CodeMe Settings</h1><input id="search" class="search" placeholder="Search settings..." /><select id="scope" class="scope"><option value="global"' + (scope === "global" ? " selected" : "") + '>Global</option><option value="workspace"' + (scope === "workspace" ? " selected" : "") + '>Workspace: ' + escapeHtml((state.workspace && state.workspace.name) || "current") + "</option></select></div><nav class=\"nav\">" + navHtml + '</nav></aside>'
    + '<main class="main"><div class="topbar"><span id="scope-label">' + escapeHtml(scope === "workspace" ? "Workspace overrides" : "Global settings") + '</span><span class="saved" id="saved">● Saved</span></div><div class="content">' + panels + "</div></main></div>"
    + '<script nonce="' + escapeHtml(nonce) + '">const vscode=acquireVsCodeApi();const initial=' + safeJson(state) + ';'
    + 'const nav=[...document.querySelectorAll(".nav-item")],panels=[...document.querySelectorAll(".panel")],saved=document.getElementById("saved");let scope=document.getElementById("scope").value;'
    + 'function openPanel(id){nav.forEach(b=>b.classList.toggle("active",b.dataset.panel===id));panels.forEach(p=>p.classList.toggle("active",p.id==="panel-"+id));vscode.setState({panel:id,scope});}'
    + 'nav.forEach(b=>b.addEventListener("click",()=>openPanel(b.dataset.panel)));const prior=vscode.getState();if(prior&&prior.panel)openPanel(prior.panel);'
    + 'document.getElementById("search").addEventListener("input",e=>{const q=String(e.target.value||"").toLowerCase().trim();nav.forEach(b=>b.style.display=!q||b.dataset.search.includes(q)?"":"none");});'
    + 'document.getElementById("scope").addEventListener("change",e=>{scope=e.target.value;saved.textContent="Refreshing…";vscode.postMessage({type:"settings-scope",scope});});'
    + 'document.querySelectorAll("[data-setting]").forEach(el=>el.addEventListener("change",()=>{const value=el.type==="checkbox"?el.checked:el.value;saved.textContent="Saving…";vscode.postMessage({type:"settings-save",scope,path:el.dataset.setting,value});}));'
    + 'document.querySelectorAll("[data-action]").forEach(el=>el.addEventListener("click",()=>{const action=el.dataset.action;if(action==="refresh-health"){saved.textContent="Refreshing…";vscode.postMessage({type:"settings-refresh",scope});}if(action==="save-n8n"){const token=document.getElementById("n8n-token");saved.textContent="Saving…";vscode.postMessage({type:"settings-n8n-update",scope,patch:{mcpEnabled:document.getElementById("n8n-enabled").checked,mcpUrl:document.getElementById("n8n-mcp-url").value,autoEnhance:document.getElementById("n8n-auto-enhance").checked,enhanceWebhookUrl:document.getElementById("n8n-enhance-url").value,mcpToken:token&&token.value?token.value:undefined,allowImageUpload:document.getElementById("n8n-image-upload").checked}});}}));'
    + 'window.addEventListener("message",event=>{const m=event.data||{};if(m.type==="settings-saved"){saved.textContent="● Saved";}if(m.type==="settings-error"){saved.textContent="! "+String(m.message||"Could not save");}if(m.type==="settings-reload"){location.reload();}});'
    + '</script></body></html>';
}

module.exports = { renderSettings, escapeHtml, safeJson };
