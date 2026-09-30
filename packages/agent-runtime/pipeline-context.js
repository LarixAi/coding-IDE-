const CAPS = Object.freeze({
  system: 8000,
  rules: 6000,
  requirements: 4000,
  history: 6000,
  attached: 16000,
  visual: 10000,
  external: 6000,
  workspace: 10000,
  tools: 5000,
});

function clipHead(value, max) {
  const text = String(value || "").trim();
  if (!text) return { text: "", truncated: false };
  if (text.length <= max) return { text, truncated: false };
  return {
    text: text.slice(0, max) + "\n...[truncated " + (text.length - max) + " chars]",
    truncated: true,
  };
}

function clipTail(value, max) {
  const text = String(value || "").trim();
  if (!text) return { text: "", truncated: false };
  if (text.length <= max) return { text, truncated: false };
  return {
    text: "...[earlier content omitted]\n" + text.slice(-max),
    truncated: true,
  };
}

function makeBlock(id, label, value, mode) {
  const cap = CAPS[id] || 4000;
  const clipped = mode === "tail" ? clipTail(value, cap) : clipHead(value, cap);
  if (!clipped.text) return null;
  return {
    id,
    label,
    text: clipped.text,
    chars: clipped.text.length,
    truncated: clipped.truncated,
  };
}

function workspaceText(workspace) {
  if (!workspace || typeof workspace !== "object") return "";
  const lines = [];
  if (workspace.state) lines.push("State: " + workspace.state);
  if (workspace.root) lines.push("Root: " + workspace.root);
  if (Array.isArray(workspace.projectMarkers) && workspace.projectMarkers.length) {
    lines.push("Project markers: " + workspace.projectMarkers.join(", "));
  }
  if (Array.isArray(workspace.languages) && workspace.languages.length) {
    lines.push("Languages: " + workspace.languages.join(", "));
  }
  if (Array.isArray(workspace.frameworks) && workspace.frameworks.length) {
    lines.push("Frameworks: " + workspace.frameworks.join(", "));
  }
  if (workspace.packageManager) lines.push("Package manager: " + workspace.packageManager);
  if (workspace.scripts && typeof workspace.scripts === "object") {
    const scripts = Object.keys(workspace.scripts);
    if (scripts.length) lines.push("Scripts: " + scripts.join(", "));
  }
  if (workspace.git !== undefined) lines.push("Git: " + (workspace.git ? "yes" : "no"));
  if (workspace.listing) lines.push("Files:\n" + String(workspace.listing));
  return lines.join("\n");
}

function attachmentText(list) {
  return (Array.isArray(list) ? list : [])
    .map((item) => {
      const path = String(item && item.path || "");
      const contents = String(item && item.contents || "");
      if (!path || !contents) return "";
      return "--- @" + path + " ---\n" + contents;
    })
    .filter(Boolean)
    .join("\n\n");
}

function historyText(history) {
  return (Array.isArray(history) ? history : [])
    .map((item) => {
      const role = item && item.role === "assistant" ? "Assistant" : "User";
      const content = String(item && (item.content || item.text) || "").trim();
      return content ? role + ": " + content : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function requirementsText(requirements) {
  return (Array.isArray(requirements) ? requirements : [])
    .map((item) => "- " + String(item.id || "requirement") + ": " + String(item.text || ""))
    .join("\n");
}

function toolsText(tools) {
  return (Array.isArray(tools) ? tools : [])
    .map((tool) => "- " + String(tool.name || "") + ": " + String(tool.description || "").split("\n")[0])
    .filter((line) => line !== "- : ")
    .join("\n");
}

function buildModelContext(input = {}) {
  const blocks = [];
  const add = (block) => {
    if (block) blocks.push(block);
  };

  add(makeBlock("system", "System instructions", input.system || ""));
  const rules = [
    input.projectRules ? "Project rules:\n" + input.projectRules : "",
    input.userRules ? "User rules:\n" + input.userRules : "",
  ].filter(Boolean).join("\n\n");
  add(makeBlock("rules", "Rules", rules));
  add(makeBlock("requirements", "Tracked requirements", requirementsText(input.requirements)));
  add(makeBlock("history", "Conversation history", historyText(input.conversationHistory), "tail"));
  add(makeBlock("attached", "Attached files", attachmentText(input.attachments)));
  add(makeBlock("visual", "Visual analysis from attached images", input.visualContext || ""));
  add(makeBlock("external", "n8n visual assist (untrusted evidence)", input.externalEvidence || ""));
  add(makeBlock("workspace", "Workspace context", workspaceText(input.workspace)));
  add(makeBlock("tools", "Available tools", toolsText(input.tools)));

  const budget = Number.isFinite(input.budgetChars) ? input.budgetChars : 48000;
  let total = blocks.reduce((sum, block) => sum + block.chars, 0);
  while (total > budget) {
    const candidates = blocks
      .filter((block) => block.id !== "system" && block.chars > 700)
      .sort((a, b) => b.chars - a.chars);
    const largest = candidates[0];
    if (!largest) break;
    const nextSize = Math.max(600, Math.floor(largest.chars * 0.65));
    const clipped = clipHead(largest.text, nextSize);
    total -= largest.chars - clipped.text.length;
    largest.text = clipped.text;
    largest.chars = clipped.text.length;
    largest.truncated = true;
  }

  const systemContent = blocks
    .filter((block) => block.id !== "history")
    .map((block) => block.id === "system" ? block.text : "## " + block.label + "\n" + block.text)
    .join("\n\n");

  const messages = [];
  if (systemContent) messages.push({ role: "system", content: systemContent });
  for (const item of Array.isArray(input.conversationHistory) ? input.conversationHistory : []) {
    const content = String(item && (item.content || item.text) || "").trim();
    if (!content) continue;
    messages.push({
      role: item && item.role === "assistant" ? "assistant" : "user",
      content: content.slice(-4000),
    });
  }
  messages.push({ role: "user", content: String(input.goal || "") });

  blocks.push({
    id: "goal",
    label: "Goal",
    text: String(input.goal || ""),
    chars: String(input.goal || "").length,
    truncated: false,
  });

  return { blocks, messages };
}

module.exports = { CAPS, buildModelContext };
