const fs = require("fs");
const path = require("path");

const BUILTIN_SKILLS = Object.freeze([
  {
    name: "fix-terminal-error",
    description: "Diagnose and repair the latest terminal or process failure, then rerun the failing command and verify.",
    instructions: [
      "1. Read the latest process/terminal failure evidence before editing.",
      "2. Read every source file named by the error.",
      "3. Make the smallest root-cause fix.",
      "4. Rerun the same command or the closest deterministic test.",
      "5. If it is a web app, verify the running app in CodeMe browser tools.",
      "6. Save the verified root cause to Project Brain.",
    ].join("\n"),
    source: "builtin",
  },
  {
    name: "add-tests",
    description: "Add focused tests for a file or feature and run them until green.",
    instructions: [
      "1. Detect the project's existing test runner and conventions.",
      "2. Read the target code and nearby tests.",
      "3. Add focused behavior and edge-case tests matching project style.",
      "4. Run the narrowest relevant test command.",
      "5. Fix implementation only when the test exposes a real defect.",
    ].join("\n"),
    source: "builtin",
  },
  {
    name: "review-changes",
    description: "Review the current git diff for correctness, regressions, security issues, and missing tests.",
    instructions: [
      "1. Inspect git status and git diff.",
      "2. Read enough surrounding source to understand each change.",
      "3. Report concrete findings ordered by severity.",
      "4. Do not edit unless the user asked for fixes.",
    ].join("\n"),
    source: "builtin",
  },
  {
    name: "verify-website",
    description: "Run a web project and verify the requested behavior in CodeMe's owned browser preview.",
    instructions: [
      "1. Inspect the project and identify the existing start command.",
      "2. Start or reuse the CodeMe-owned preview process.",
      "3. Read process logs if startup fails.",
      "4. Use browser.check or browser.interact against the owned preview.",
      "5. Repair failures and re-verify after the last edit.",
    ].join("\n"),
    source: "builtin",
  },
]);

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "skill";
}

function parseSkillMarkdown(text, fallbackName) {
  let body = String(text || "");
  let name = slug(fallbackName);
  let description = "";
  const front = body.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (front) {
    body = body.slice(front[0].length);
    for (const line of front[1].split(/\r?\n/)) {
      const match = line.match(/^(\w+)\s*:\s*(.*)$/);
      if (!match) continue;
      const value = String(match[2] || "").trim().replace(/^["']|["']$/g, "");
      if (match[1] === "name" && value) name = slug(value);
      if (match[1] === "description") description = value;
    }
  }
  if (!description) {
    description = body
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find(Boolean) || "";
  }
  return {
    name,
    description: description.slice(0, 300),
    instructions: body.trim().slice(0, 12000),
  };
}

function workspaceSkillFiles(root) {
  if (!root) return [];
  const files = [];
  for (const parent of [".codeme/skills", ".cursor/skills"]) {
    const dir = path.join(root, parent);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(dir, entry.name, "SKILL.md");
      if (fs.existsSync(file) && fs.statSync(file).isFile()) files.push({ file, fallback: entry.name });
    }
  }
  return files;
}

function loadSkills(root) {
  const byName = new Map(BUILTIN_SKILLS.map((skill) => [skill.name, { ...skill }]));
  for (const item of workspaceSkillFiles(root)) {
    try {
      const parsed = parseSkillMarkdown(fs.readFileSync(item.file, "utf8"), item.fallback);
      byName.set(parsed.name, {
        ...parsed,
        source: "workspace",
        path: path.relative(root, item.file).split(path.sep).join("/"),
      });
    } catch {
      // A malformed custom skill should not break the agent.
    }
  }
  return [...byName.values()];
}

function matchSlashSkill(prompt, skills) {
  const match = String(prompt || "").trim().match(/^\/([\w-]+)\s*([\s\S]*)$/);
  if (!match) return null;
  const skill = (skills || []).find((item) => item.name === slug(match[1]));
  return skill ? { skill, rest: String(match[2] || "").trim() } : null;
}

function skillCatalogText(skills) {
  if (!Array.isArray(skills) || !skills.length) return "";
  return [
    "Available CodeMe skills:",
    ...skills.map((skill) => "- /" + skill.name + ": " + skill.description),
    "Use skill.run only when a skill clearly helps the current task.",
  ].join("\n");
}

function skillToolDefinition() {
  return {
    name: "skill.run",
    description: "Load a reusable CodeMe skill by name and return its step-by-step workflow.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  };
}

function runSkill(skills, name) {
  const wanted = slug(name);
  const skill = (skills || []).find((item) => item.name === wanted);
  if (!skill) {
    return {
      ok: false,
      tool: "skill.run",
      error: {
        code: "unknown_skill",
        message: "Unknown skill " + wanted + ". Available: " + (skills || []).map((item) => item.name).join(", "),
      },
    };
  }
  return {
    ok: true,
    tool: "skill.run",
    data: {
      name: skill.name,
      source: skill.source,
      instructions: skill.instructions,
    },
  };
}

module.exports = {
  BUILTIN_SKILLS,
  slug,
  parseSkillMarkdown,
  loadSkills,
  matchSlashSkill,
  skillCatalogText,
  skillToolDefinition,
  runSkill,
};
