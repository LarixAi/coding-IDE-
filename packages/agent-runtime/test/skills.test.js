const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  BUILTIN_SKILLS,
  parseSkillMarkdown,
  loadSkills,
  matchSlashSkill,
  skillCatalogText,
  runSkill,
} = require("../skills");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeme-skills-"));
const skillDir = path.join(root, ".codeme", "skills", "debug-api");
fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(
  path.join(skillDir, "SKILL.md"),
  [
    "---",
    "name: debug-api",
    "description: Diagnose an API failure",
    "---",
    "1. Read the failure.",
    "2. Inspect the route.",
    "3. Run the focused test.",
    "",
  ].join("\n"),
  "utf8",
);

const parsed = parseSkillMarkdown("---\nname: Deploy App\ndescription: Ship safely\n---\n1. test\n2. deploy", "fallback");
assert.strictEqual(parsed.name, "deploy-app");
assert.strictEqual(parsed.description, "Ship safely");

const skills = loadSkills(root);
assert.ok(BUILTIN_SKILLS.some((skill) => skill.name === "fix-terminal-error"));
assert.ok(skills.some((skill) => skill.name === "add-tests"));
assert.ok(BUILTIN_SKILLS.some((skill) => skill.name === "website-build"));
assert.ok(skills.some((skill) => skill.name === "verify-website"));
const websiteBuild = runSkill(skills, "website-build");
assert.strictEqual(websiteBuild.ok, true);
assert.match(websiteBuild.data.instructions, /WEBSITE QUALITY CONTRACT/);
assert.match(websiteBuild.data.instructions, /CSS strategy/i);
assert.match(websiteBuild.data.instructions, /primary CTA/i);
const custom = skills.find((skill) => skill.name === "debug-api");
assert.ok(custom);
assert.strictEqual(custom.source, "workspace");

const matched = matchSlashSkill("/debug-api payments endpoint", skills);
assert.ok(matched);
assert.strictEqual(matched.rest, "payments endpoint");

const catalog = skillCatalogText(skills);
assert.match(catalog, /\/debug-api/);
assert.match(catalog, /\/fix-terminal-error/);

const result = runSkill(skills, "debug-api");
assert.strictEqual(result.ok, true);
assert.match(result.data.instructions, /Run the focused test/);

const unknown = runSkill(skills, "does-not-exist");
assert.strictEqual(unknown.ok, false);
assert.strictEqual(unknown.error.code, "unknown_skill");

console.log("ok CodeMe skills loading, slash invocation, and skill.run");
