"use strict";

function isWebsiteBuildGoal(value) {
  const text = String(value || "").toLowerCase();
  const surface = /\b(website|web site|webpage|landing page|frontend|front-end|web app|web application|dashboard|portal|shop|store|dealership|booking site)\b/.test(text);
  const build = /\b(build|create|develop|implement|design|redesign|rebuild|make|scaffold)\b/.test(text);
  const broad = /\b(full|complete|end[- ]?to[- ]?end|professional|production|responsive|multi[- ]?page)\b/.test(text);
  return surface && (build || broad);
}

const WEBSITE_QUALITY_SECTIONS = Object.freeze([
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

function websiteQualityContract() {
  return [
    "WEBSITE QUALITY CONTRACT",
    "",
    "Treat a website build as a product, architecture, implementation, visual-design, conversion, accessibility, and QA task — not only as files that render.",
    "",
    "Product Manager angle:",
    "- Define target users, primary jobs-to-be-done, page/section information architecture, success outcome, and priority.",
    "- Define the primary CTA and secondary CTA(s), the intended conversion journey, trust signals, and what content must persuade the user to act.",
    "- Define required pages, forms, empty/loading/error/success states, mobile expectations, and concrete acceptance criteria.",
    "",
    "Software Architect angle:",
    "- Preserve an existing framework/runtime when present; for an empty workspace choose the smallest suitable architecture.",
    "- Define page/route and component structure, data/state boundaries, form/API boundaries, and the actual served entrypoint.",
    "- Define a real CSS strategy: stylesheet ownership, reset/base styles, design tokens, typography scale, spacing scale, layout primitives, component states, and responsive breakpoints.",
    "- Plan semantic HTML, accessibility, SEO/meta, asset/image handling, performance, and verification before implementation.",
    "",
    "Developer angle:",
    "- Implement the complete visual system, not only markup or JavaScript. Confirm the CSS that produces the page is actually loaded by the active runtime.",
    "- Build deliberate visual hierarchy, consistent spacing/alignment, typography, colour, buttons/CTAs, cards, forms, navigation, footer, and responsive layout.",
    "- Implement hover, focus, active, disabled, loading, validation, success, and error states where relevant.",
    "- Avoid placeholder copy, generic template leftovers, duplicated unused files, broken image paths, horizontal overflow, and desktop-only layouts.",
    "",
    "Browser/Test angle:",
    "- Verify the real served runtime, not a similarly named source file.",
    "- Verify CSS/assets load successfully with no missing-file or console failures.",
    "- Check the main page/route structure, navigation, primary CTA, secondary CTA, forms, interactive controls, links, and important states.",
    "- Check desktop, tablet, and mobile behaviour where the available browser tooling supports it; otherwise combine browser evidence with CSS/source breakpoint evidence.",
    "- Check keyboard/focus behaviour, labels/semantics, obvious contrast/readability issues, responsive images, and layout overflow.",
    "- Confirm the product requirements and conversion journey are actually present, not merely technically functional.",
    "",
    "Reviewer angle:",
    "- Review product completeness, architecture consistency, CSS quality, visual polish, CTA prominence, conversion flow, responsiveness, accessibility, content quality, and verification evidence.",
    "- Reject a technically working page that still looks unfinished, generic, inconsistent, poorly spaced, weakly styled, or does not support the intended user journey.",
    "",
    "For website builds, the final Test Agent report must include a WEB QUALITY MATRIX covering: product, architecture, visual, responsive, interaction, accessibility, content, SEO, performance, verification.",
  ].join("\n");
}

function websiteRoleInstructions(role) {
  const contract = websiteQualityContract();
  const roleKey = String(role || "").toLowerCase();

  if (roleKey === "product") {
    return [
      contract,
      "",
      "PRODUCT MANAGER WEBSITE DELIVERABLE:",
      "- Include sections named AUDIENCE, INFORMATION ARCHITECTURE, CTA / CONVERSION, CONTENT & TRUST, STATES, RESPONSIVE EXPECTATIONS, and ACCEPTANCE CRITERIA.",
      "- Do not approve a vague brief such as 'make it modern'. Make the visual/product outcome testable.",
    ].join("\n");
  }

  if (roleKey === "cto") {
    return [
      contract,
      "",
      "SOFTWARE ARCHITECT WEBSITE DELIVERABLE:",
      "- Include sections named RUNTIME PATH, ROUTES / COMPONENTS, CSS ARCHITECTURE, RESPONSIVE STRATEGY, ACCESSIBILITY, SEO / PERFORMANCE, and VERIFICATION PLAN.",
      "- Name which active files should own global CSS, page styles, component styles, and theme/design tokens based on the actual workspace.",
    ].join("\n");
  }

  if (roleKey === "developer") {
    return [
      contract,
      "",
      "DEVELOPER WEBSITE DELIVERABLE:",
      "- Inspect the existing CSS/styling path before editing when one exists.",
      "- Do not finish after HTML/JS alone if styling is part of the requested outcome.",
      "- Verify the primary CTA and core user path in the owned browser preview after the final edit.",
    ].join("\n");
  }

  if (roleKey === "test") {
    return [
      contract,
      "",
      "TEST AGENT WEBSITE DELIVERABLE:",
      "- Include a WEB QUALITY MATRIX with one PASS/FAIL line for every required category.",
      "- Include evidence for the active CSS path and primary CTA.",
      "- If any required category is unverified or materially poor, end with TEST: FAIL - <specific reason>.",
      "- Only when the full matrix passes may you include WEB QUALITY: PASS and end with exactly: TEST: PASS",
    ].join("\n");
  }

  if (roleKey === "reviewer") {
    return [
      contract,
      "",
      "REVIEWER WEBSITE DELIVERABLE:",
      "- Independently challenge the Test Agent's WEB QUALITY MATRIX.",
      "- Inspect whether styling, CTA/conversion, responsiveness, content, accessibility, and runtime evidence are strong enough for a finished product.",
      "- A browser load alone is insufficient approval evidence.",
      "- Only when the product is complete and polished may you include WEB REVIEW: APPROVED and end with exactly: REVIEW: APPROVED",
    ].join("\n");
  }

  return contract;
}

module.exports = {
  WEBSITE_QUALITY_SECTIONS,
  isWebsiteBuildGoal,
  websiteQualityContract,
  websiteRoleInstructions,
};
