const fs = require("fs");
const path = require("path");
const { createProjectBrain } = require("./project-brain");

const BRAIN_DIR = ".codeme";
const BRAIN_FILE = "project-brain.json";
function brainPath(root) { return path.join(root, BRAIN_DIR, BRAIN_FILE); }
function loadProjectBrain(root) {
  const file = brainPath(root);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function saveProjectBrain(root, brain) {
  const dir = path.join(root, BRAIN_DIR); fs.mkdirSync(dir, { recursive:true });
  const file = brainPath(root), temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(brain,null,2) + "\n", "utf8");
  fs.renameSync(temp,file); return file;
}
function loadOrCreateProjectBrain(root, input = {}) { return loadProjectBrain(root) || createProjectBrain({ ...input, root }); }
module.exports = { BRAIN_DIR, BRAIN_FILE, brainPath, loadProjectBrain, saveProjectBrain, loadOrCreateProjectBrain };
