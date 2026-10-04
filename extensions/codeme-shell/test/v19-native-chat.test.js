"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { renderComposer } = require("../composer-view");

const root = path.join(__dirname, "..");
const html = renderComposer("test-nonce");

for (const marker of [
  "V19 native Composer skin",
  'id="v19-compose-status"',
  'id="v19-compose-status-text"',
  '<strong>CodeMe AI</strong>',
  'id="new-chat"',
  'id="history-toggle"',
  'id="attach"',
  'id="mode"',
  'id="model"',
  'id="send"',
  "Ready · can edit",
  "Ready · read-only",
]) {
  assert.ok(html.includes(marker), "missing native V19 chat marker: " + marker);
}

assert.ok(html.includes(".workspace-actions {"));
assert.ok(html.includes("display: none;"));
assert.ok(html.includes("#history-toggle::before"));
assert.ok(html.includes('content: "☰"'));
assert.ok(html.includes("background: #242424"));
assert.ok(html.includes("border-radius: 9px"));
assert.ok(html.includes("@media (max-width: 380px)"));
assert.ok(html.includes("grid-template-columns: 28px 34px 34px minmax(0, 1fr) 28px 29px"));
assert.ok(html.includes("#model { grid-column: 1 / 7; grid-row: 2;"));
assert.ok(html.includes("V19 composer toolbar refinement"));
assert.ok(html.includes("Cursor-style control strip"));
assert.ok(html.includes("Unified Composer V20"));
assert.ok(html.includes("Unified Composer V21"));
assert.ok(html.includes('viewBox="0 0 24 24"'));
assert.ok(html.includes(".unified-composer .v19-compose-status.ready"));
assert.ok(html.includes("display: none;"));
assert.ok(html.includes("appearance: none"));
assert.ok(html.includes("content: none"));
assert.ok(html.includes('mic.setAttribute("aria-label", on ? "Stop voice" : "Voice to text")'));
assert.ok(!html.includes('mic.textContent = on ? "Stop" : "Voice"'));

assert.ok(html.includes('class="composer unified-composer"'));
assert.ok(html.includes('class="bar unified-composer-bar"'));
assert.ok(html.includes('class="composer-left"'));
assert.ok(html.includes('class="composer-right"'));
assert.ok(html.includes(".unified-composer textarea"));
assert.ok(html.includes(".unified-composer #mode"));
assert.ok(html.includes(".unified-composer #model"));
assert.ok(html.includes(".unified-composer #attach"));
assert.ok(html.includes(".unified-composer #mic"));
assert.ok(html.includes(".unified-composer #send"));

assert.ok(html.includes("grid-template-columns: 30px 34px 38px 72px minmax(112px, 1fr) 28px 34px"));
assert.ok(html.includes("@media (max-width: 470px)"));
assert.ok(html.includes("#model {"));
assert.ok(html.includes("grid-column: 1 / 7"));

assert.ok(html.includes("function threadNearBottom(threshold = 48)"));
assert.ok(html.includes("const stickThreadToBottom = forceThreadBottom || threadNearBottom()"));
assert.ok(html.includes("restoreThreadScroll(stickThreadToBottom, previousThreadTop)"));
assert.ok(html.includes("forceThreadBottom = true"));
assert.equal(
  (html.match(/thread\.scrollTop = thread\.scrollHeight/g) || []).length,
  1,
  "scroll-to-bottom should only exist inside the sticky-scroll helper",
);


const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const view = manifest.contributes.views.codemeAgent.find((item) => item.id === "codeme.agent");
assert.equal(view.name, "CodeMe");

console.log("ok V19 native Composer skin");
