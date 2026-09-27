function decideProject(goal, workspace = {}) {
  const state = String(workspace && workspace.state || "unknown");
  const existing = state !== "empty";
  const text = String(goal || "").toLowerCase();

  if (existing) {
    const frameworks = Array.isArray(workspace.frameworks) ? workspace.frameworks.filter(Boolean) : [];
    return {
      kind: "existing_project_edit",
      label: "Existing project",
      workspaceState: state,
      framework: frameworks[0] || null,
      dependenciesRequired: null,
      dependencyPolicy: "preserve_existing",
      reason: frameworks.length
        ? `The workspace already contains a project using ${frameworks.join(", ")}. Preserve its architecture.`
        : "The workspace already contains project files. Preserve the existing architecture instead of scaffolding a new one.",
    };
  }

  const framework = detectFramework(text);
  const fullStack = /\b(full[- ]?stack|frontend and backend|backend and frontend)\b/.test(text)
    || (hasProductSurface(text) && /\b(payment|payments|checkout|auth|authentication|login|database|bid|bidding|orders?|accounts?|admin)\b/.test(text));
  if (fullStack) {
    return {
      kind: "full_stack",
      label: "Full-stack application",
      workspaceState: state,
      framework,
      dependenciesRequired: true,
      dependencyPolicy: "allowed_when_required",
      reason: "The request includes application features that need both a user-facing interface and server-side capabilities.",
    };
  }

  const backend = /\b(api|backend|back-end|server|express|fastify|nestjs|database service|rest api|graphql)\b/.test(text);
  if (backend) {
    return {
      kind: "backend_service",
      label: "Backend service",
      workspaceState: state,
      framework: framework || detectBackendFramework(text),
      dependenciesRequired: true,
      dependencyPolicy: "allowed_when_required",
      reason: "The request explicitly asks for server-side or API functionality.",
    };
  }

  const frontend = Boolean(framework)
    || /\b(frontend|front-end|single page app|spa|web app|web application|typescript app)\b/.test(text)
    || (/\b(app|application)\b/.test(text) && !/\b(static|plain html|html only)\b/.test(text));
  if (frontend) {
    return {
      kind: "frontend_app",
      label: framework ? `${frameworkLabel(framework)} frontend app` : "Frontend application",
      workspaceState: state,
      framework,
      dependenciesRequired: true,
      dependencyPolicy: "allowed_when_required",
      reason: framework
        ? `The request explicitly asks for ${frameworkLabel(framework)}.`
        : "The request asks for an application rather than a dependency-free static page.",
    };
  }

  return {
    kind: "static_site",
    label: "Static website",
    workspaceState: state,
    framework: null,
    dependenciesRequired: false,
    dependencyPolicy: "none",
    reason: "The request can be satisfied with browser-native HTML, CSS, and optional JavaScript, so no framework or server dependency is needed.",
  };
}

function hasProductSurface(text) {
  return /\b(website|site|web app|application|app|shop|store|dashboard|portal|dealership|booking)\b/.test(text);
}

function detectFramework(text) {
  const checks = [
    ["next", /\bnext(?:\.js|js)?\b/],
    ["react", /\breact\b/],
    ["vue", /\bvue\b/],
    ["nuxt", /\bnuxt\b/],
    ["sveltekit", /\bsveltekit\b/],
    ["svelte", /\bsvelte\b/],
    ["angular", /\bangular\b/],
    ["vite", /\bvite\b/],
  ];
  for (const [name, pattern] of checks) if (pattern.test(text)) return name;
  return null;
}

function detectBackendFramework(text) {
  if (/\bexpress\b/.test(text)) return "express";
  if (/\bfastify\b/.test(text)) return "fastify";
  if (/\bnestjs|nest\.js\b/.test(text)) return "nestjs";
  return null;
}

function frameworkLabel(value) {
  const labels = {
    react: "React",
    next: "Next.js",
    vue: "Vue",
    nuxt: "Nuxt",
    svelte: "Svelte",
    sveltekit: "SvelteKit",
    angular: "Angular",
    vite: "Vite",
    express: "Express",
    fastify: "Fastify",
    nestjs: "NestJS",
  };
  return labels[value] || value || "";
}

function isDependencyFreeStatic(decision) {
  return Boolean(decision && decision.kind === "static_site" && decision.workspaceState === "empty");
}

function projectDecisionContext(decision) {
  if (!decision) return "";
  return [
    `Project type: ${decision.label}.`,
    `Dependencies required: ${decision.dependenciesRequired === true ? "yes" : decision.dependenciesRequired === false ? "no" : "preserve existing project"}.`,
    decision.framework ? `Framework: ${frameworkLabel(decision.framework)}.` : "",
    `Reason: ${decision.reason}`,
  ].filter(Boolean).join(" ");
}

module.exports = {
  decideProject,
  detectFramework,
  isDependencyFreeStatic,
  projectDecisionContext,
};
