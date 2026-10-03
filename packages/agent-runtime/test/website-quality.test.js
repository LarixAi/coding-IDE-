const assert = require("assert");
const {
  WEBSITE_QUALITY_SECTIONS,
  isWebsiteBuildGoal,
  websiteQualityContract,
  websiteRoleInstructions,
} = require("../website-quality");

assert.strictEqual(isWebsiteBuildGoal("Build a full dealership website with booking"), true);
assert.strictEqual(isWebsiteBuildGoal("Redesign this responsive landing page"), true);
assert.strictEqual(isWebsiteBuildGoal("Change the heading to Hello"), false);

const contract = websiteQualityContract();
for (const phrase of [
  "Product Manager angle",
  "Software Architect angle",
  "Developer angle",
  "Browser/Test angle",
  "Reviewer angle",
  "primary CTA",
  "CSS strategy",
  "responsive breakpoints",
  "accessibility",
  "SEO/meta",
  "performance",
  "WEB QUALITY MATRIX",
]) {
  const escaped = phrase.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
  assert.match(contract, new RegExp(escaped, "i"));
}

assert.deepStrictEqual(WEBSITE_QUALITY_SECTIONS, [
  "product",
  "architecture",
  "visual",
  "responsive",
  "interaction",
  "accessibility",
  "content",
  "seo",
  "performance",
  "verification",
]);

assert.match(websiteRoleInstructions("product"), /CTA \/ CONVERSION/);
assert.match(websiteRoleInstructions("cto"), /CSS ARCHITECTURE/);
assert.match(websiteRoleInstructions("developer"), /Inspect the existing CSS/i);
assert.match(websiteRoleInstructions("test"), /WEB QUALITY: PASS/);
assert.match(websiteRoleInstructions("reviewer"), /WEB REVIEW: APPROVED/);

console.log("ok website quality contract covers product, architecture, CSS, CTA, responsive, accessibility, and QA");
