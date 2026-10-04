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
assert.ok(html.includes("grid-template-columns: 32px 44px 44px 86px minmax(118px, 1fr) 30px 36px"));
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
