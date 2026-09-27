const assert = require("assert");
const { decideProject, isDependencyFreeStatic } = require("../project-decision");

function empty() {
  return {
    state: "empty",
    root: "demo",
    entries: 0,
    git: false,
    projectMarkers: [],
    languages: [],
    frameworks: [],
    packageManager: null,
    scripts: {},
  };
}

async function main() {
  {
    const decision = decideProject("Create a simple website with a heading that says Hello CodeMe.", empty());
    assert.strictEqual(decision.kind, "static_site");
    assert.strictEqual(decision.dependenciesRequired, false);
    assert.strictEqual(isDependencyFreeStatic(decision), true);
  }

  {
    const decision = decideProject("Create a React website with a heading that says Hello CodeMe.", empty());
    assert.strictEqual(decision.kind, "frontend_app");
    assert.strictEqual(decision.framework, "react");
    assert.strictEqual(decision.dependenciesRequired, true);
    assert.strictEqual(isDependencyFreeStatic(decision), false);
  }

  {
    const decision = decideProject("Create an Express API for customer bookings.", empty());
    assert.strictEqual(decision.kind, "backend_service");
    assert.strictEqual(decision.framework, "express");
    assert.strictEqual(decision.dependenciesRequired, true);
  }

  {
    const decision = decideProject("Create a dealership website with login, bidding and payments.", empty());
    assert.strictEqual(decision.kind, "full_stack");
    assert.strictEqual(decision.dependenciesRequired, true);
  }

  {
    const decision = decideProject("Add a login page.", {
      ...empty(),
      state: "project",
      entries: 8,
      projectMarkers: ["package.json"],
      frameworks: ["react", "vite"],
      packageManager: "npm",
    });
    assert.strictEqual(decision.kind, "existing_project_edit");
    assert.strictEqual(decision.framework, "react");
    assert.strictEqual(decision.dependencyPolicy, "preserve_existing");
  }

  console.log("ok project decision");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
