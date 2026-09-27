async function decomposeGoal(body, complete, brief) {
  const started = Date.now();
  if (body.capability && body.capability !== "task.decompose") {
    return planEnvelope(body, "error", null, { code: "capability_unavailable", message: "This workflow only serves task.decompose" }, started);
  }
  const goal = clip(body.input && (body.input.goal || body.input.problem), 4000);
  if (!goal) return planEnvelope(body, "error", null, { code: "invalid_input", message: "input.goal is required" }, started);

  let raw = "";
  try {
    const response = await complete({
      model: "qwen3.5:9b",
      stream: false,
      think: false,
      format: "json",
      options: { temperature: 0, num_predict: 500 },
      messages: [
        {
          role: "system",
          content: `${brief ? String(brief).slice(0, 2000) + " " : ""}Split one software goal into a dependency-ordered task graph for a small coding model. Return JSON only with project and tasks. Each task has id, title, dependsOn, objective, and doneWhen. Use at most 4 tasks. Keep every field short. Do not write code.`,
        },
        { role: "user", content: goal },
      ],
    });
    raw = response && response.message && response.message.content ? response.message.content : response;
  } catch (error) {
    return planEnvelope(body, "error", null, { code: "model_unreachable", message: clip(error && error.message, 300) || "The planning model was unreachable" }, started);
  }

  const plan = normalizePlan(raw, goal);
  if (!plan) {
    return planEnvelope(body, "error", null, { code: "invalid_plan", message: "The planning model did not return a task graph" }, started, ["No substitute plan was invented"]);
  }
  return planEnvelope(body, "ok", plan, null, started, ["Work the first task whose dependencies are complete. CodeMe keeps the master plan."]);
}

function normalizePlan(raw, goal) {
  const text = String(raw || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.tasks)) return null;
  const tasks = [];
  for (const item of parsed.tasks) {
    if (!item || typeof item !== "object") continue;
    const id = clip(item.id, 16);
    const title = clip(item.title, 160);
    const objective = clip(item.objective, 400);
    const doneWhen = clip(item.doneWhen || item.done_when, 240);
    if (!id || !title || !objective) continue;
    const dependsOn = Array.isArray(item.dependsOn) ? item.dependsOn.map((dep) => clip(dep, 16)).filter(Boolean).slice(0, 8) : [];
    tasks.push({ id, title, dependsOn, objective, doneWhen });
    if (tasks.length >= 8) break;
  }
  if (!tasks.length) return null;
  const ids = new Set(tasks.map((task) => task.id));
  for (const task of tasks) task.dependsOn = task.dependsOn.filter((dep) => dep !== task.id && ids.has(dep));
  return { project: clip(parsed.project, 160) || clip(goal, 160), tasks };
}

function planEnvelope(body, status, data, error, started, warnings) {
  return {
    protocolVersion: 1,
    requestId: body.requestId,
    status,
    data,
    sources: [],
    warnings: warnings || [],
    error,
    duration: Date.now() - started,
  };
}

function clip(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

module.exports = { decomposeGoal, normalizePlan };
