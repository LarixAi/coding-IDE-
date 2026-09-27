function inferRequirements(goal, options = {}) {
  if (Array.isArray(options.requirements) && options.requirements.length) {
    return options.requirements.map((item) => ({
      id: item.id,
      text: item.text,
      status: "unverified",
      inferred: false,
    }));
  }
  if (!options.inferRequirements) return [];
  const text = String(goal || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  return [{ id: "goal", text: text.slice(0, 240), status: "unverified", inferred: true }];
}

function applyFollowUp(run, text) {
  const trimmed = String(text || "").replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  if (!Array.isArray(run.followUps)) run.followUps = [];
  const id = `follow-up-${run.followUps.length + 1}`;
  const entry = { id, text: trimmed, at: new Date().toISOString(), iteration: run.iteration };
  run.followUps.push(entry);
  if (!Array.isArray(run.requirements)) run.requirements = [];
  run.requirements.push({ id, text: trimmed, status: "unverified", source: "follow-up" });
  if (!Array.isArray(run.plan)) run.plan = [];
  run.plan.push({ id, title: trimmed, status: "pending" });
  for (const step of run.plan) {
    if (step.id === "verify" && step.status === "completed") step.status = "pending";
  }
  if (!Array.isArray(run.messages)) run.messages = [];
  run.messages.push({
    role: "user",
    content: `Follow-up. This updates the active requirements and plan. Do not restart the whole job.\n${trimmed}`,
  });
  return entry;
}

module.exports = { inferRequirements, applyFollowUp };
