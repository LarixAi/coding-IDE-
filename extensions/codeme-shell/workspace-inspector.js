const path = require("path");

const IGNORED_ROOT_ENTRIES = new Set([".DS_Store", "Thumbs.db"]);
const PROJECT_MARKERS = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "Pipfile",
  "poetry.lock",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
  "mix.exs",
  "pubspec.yaml",
  "CMakeLists.txt",
]);
const LANGUAGE_BY_EXTENSION = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".dart": "dart",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".c": "c",
  ".h": "c",
  ".vue": "vue",
  ".svelte": "svelte",
  ".html": "html",
  ".css": "css",
};

async function inspectWorkspace(vscode) {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) {
    throw Object.assign(new Error("No workspace folder is open"), { code: "no_workspace" });
  }

  const root = folder.uri;
  const rootEntries = await vscode.workspace.fs.readDirectory(root);
  const visible = rootEntries
    .filter(([name]) => !IGNORED_ROOT_ENTRIES.has(name))
    .map(([name, type]) => ({
      name,
      type: type === vscode.FileType.Directory ? "dir" : "file",
    }));

  const files = visible.filter((entry) => entry.type === "file").map((entry) => entry.name).sort();

  if (visible.length === 0) {
    return {
      state: "empty",
      root: folder.name || path.basename(root.fsPath || root.path || ""),
      entries: 0,
      files: [],
      git: false,
      projectMarkers: [],
      languages: [],
      frameworks: [],
      packageManager: null,
      scripts: {},
    };
  }

  const names = new Set(visible.map((entry) => entry.name));
  const projectMarkers = [...PROJECT_MARKERS].filter((name) => names.has(name));
  const solutionMarkers = visible
    .filter((entry) => entry.type === "file" && /\.(sln|csproj|fsproj|vbproj)$/.test(entry.name))
    .map((entry) => entry.name);
  projectMarkers.push(...solutionMarkers);

  const git = names.has(".git");
  const packageInfo = names.has("package.json")
    ? await readPackageJson(vscode, root)
    : null;

  const sample = await sampleWorkspace(vscode, root, visible);
  const languages = detectLanguages(sample);
  const frameworks = detectFrameworks(packageInfo, names, sample);
  const packageManager = detectPackageManager(names, packageInfo);

  const state = projectMarkers.length > 0 || git || looksLikeSourceTree(names, sample)
    ? "project"
    : "folder";

  return {
    state,
    root: folder.name || path.basename(root.fsPath || root.path || ""),
    entries: visible.length,
    files,
    git,
    projectMarkers: [...new Set(projectMarkers)].sort(),
    languages,
    frameworks,
    packageManager,
    scripts: packageInfo && isPlainObject(packageInfo.scripts) ? packageInfo.scripts : {},
  };
}

async function readPackageJson(vscode, root) {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, "package.json"));
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function sampleWorkspace(vscode, root, rootEntries) {
  const sample = rootEntries.map((entry) => entry.name);
  const queue = rootEntries
    .filter((entry) => entry.type === "dir" && ![".git", "node_modules", "vendor", "dist", "build", ".next"].includes(entry.name))
    .slice(0, 12)
    .map((entry) => vscode.Uri.joinPath(root, entry.name));

  while (queue.length && sample.length < 200) {
    const current = queue.shift();
    let children;
    try {
      children = await vscode.workspace.fs.readDirectory(current);
    } catch {
      continue;
    }
    for (const [name, type] of children) {
      if (IGNORED_ROOT_ENTRIES.has(name)) continue;
      const child = vscode.Uri.joinPath(current, name);
      sample.push(vscode.workspace.asRelativePath(child, false));
      if (sample.length >= 200) break;
      if (type === vscode.FileType.Directory && ![".git", "node_modules", "vendor", "dist", "build", ".next"].includes(name)) {
        queue.push(child);
      }
    }
  }
  return sample;
}

function detectLanguages(paths) {
  const found = new Set();
  for (const file of paths) {
    const extension = path.extname(file).toLowerCase();
    const language = LANGUAGE_BY_EXTENSION[extension];
    if (language) found.add(language);
  }
  return [...found].sort();
}

function detectFrameworks(packageInfo, names, sample) {
  const found = new Set();
  const deps = packageInfo ? {
    ...(isPlainObject(packageInfo.dependencies) ? packageInfo.dependencies : {}),
    ...(isPlainObject(packageInfo.devDependencies) ? packageInfo.devDependencies : {}),
  } : {};

  const dependencyMap = {
    react: "react",
    next: "next",
    vue: "vue",
    nuxt: "nuxt",
    svelte: "svelte",
    "@sveltejs/kit": "sveltekit",
    vite: "vite",
    express: "express",
    fastify: "fastify",
    nestjs: "nestjs",
    "@nestjs/core": "nestjs",
  };
  for (const [dependency, framework] of Object.entries(dependencyMap)) {
    if (Object.prototype.hasOwnProperty.call(deps, dependency)) found.add(framework);
  }

  if (names.has("angular.json")) found.add("angular");
  if (names.has("next.config.js") || names.has("next.config.mjs") || names.has("next.config.ts")) found.add("next");
  if (sample.some((file) => /(^|\/)vite\.config\.(js|mjs|ts)$/.test(file))) found.add("vite");
  if (sample.some((file) => /(^|\/)astro\.config\.(js|mjs|ts)$/.test(file))) found.add("astro");

  return [...found].sort();
}

function detectPackageManager(names, packageInfo) {
  if (names.has("pnpm-lock.yaml")) return "pnpm";
  if (names.has("yarn.lock")) return "yarn";
  if (names.has("bun.lock") || names.has("bun.lockb")) return "bun";
  if (names.has("package-lock.json")) return "npm";
  if (packageInfo && typeof packageInfo.packageManager === "string") {
    return packageInfo.packageManager.split("@")[0] || null;
  }
  return packageInfo ? "npm" : null;
}

function looksLikeSourceTree(names, sample) {
  if (["src", "app", "lib", "test", "tests"].some((name) => names.has(name))) return true;
  return sample.some((file) => Object.prototype.hasOwnProperty.call(LANGUAGE_BY_EXTENSION, path.extname(file).toLowerCase()));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  inspectWorkspace,
  detectLanguages,
  detectFrameworks,
  detectPackageManager,
};
