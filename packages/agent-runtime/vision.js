const DEFAULT_VISION_MODEL = process.env.CODEME_VISION_MODEL || "qwen2.5vl:7b";
const VISION_MODEL_RE = /(?:^|[-_.:])(vl|vision)(?:$|[-_.:])|llava|moondream|minicpm-v|bakllava|cogvlm|internvl|qwen.*vl|gemma.*vision|llama.*vision/i;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const DESIGN_SPEC_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["website", "mockup", "error", "diagram", "photo", "other"] },
    summary: { type: "string" },
    layout: { type: "string" },
    visualHierarchy: { type: "string" },
    sections: { type: "array", items: { type: "string" } },
    palette: { type: "array", items: { type: "string" } },
    typography: { type: "string" },
    spacing: { type: "string" },
    components: { type: "array", items: { type: "string" } },
    implementationNotes: { type: "array", items: { type: "string" } },
    textContent: { type: "array", items: { type: "string" } },
    detectedUrl: { type: ["string", "null"] },
  },
  required: [
    "kind",
    "summary",
    "layout",
    "visualHierarchy",
    "sections",
    "palette",
    "typography",
    "spacing",
    "components",
    "implementationNotes",
    "textContent",
    "detectedUrl",
  ],
  additionalProperties: false,
};

function installedModel(models, wanted) {
  const target = String(wanted || "").trim();
  if (!target) return null;
  return (models || []).find((item) => {
    const id = String(item && item.id || "");
    return id === target || id.startsWith(target + ":") || target.startsWith(id + ":");
  }) || null;
}

function pickVisionModel(models, preferred = DEFAULT_VISION_MODEL) {
  const exact = installedModel(models, preferred);
  if (exact) return String(exact.id);
  const discovered = (models || []).find((item) => VISION_MODEL_RE.test(String(item && item.id || "")));
  return discovered ? String(discovered.id) : null;
}

function promptForImages(goal, attachments) {
  const names = (attachments || []).map((item) => item.name || item.path).filter(Boolean).join(", ");
  return [
    "You are CodeMe's vision stage. Analyze the attached image(s) for a coding agent.",
    "Return a factual structured visual specification. Do not claim to see details that are not visible.",
    "For UI, website, app, or mockup screenshots: describe layout, visual hierarchy, sections, colours, typography, spacing, reusable components, and implementation implications.",
    "For error screenshots: transcribe the visible error text and identify concrete diagnostic clues in textContent and implementationNotes.",
    "For diagrams or other images: describe the visible structure and the facts that matter to the user's coding request.",
    "Transcribe visible headings, labels, buttons, error text, and other important copy into textContent.",
    "If a URL or domain is visibly present, set detectedUrl to it; otherwise use null.",
    names ? "Attached images: " + names : "",
    goal ? "User request:\n" + String(goal).slice(0, 3000) : "",
    "Respond with one JSON object matching the requested schema.",
  ].filter(Boolean).join("\n\n");
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 40);
}

function normalizeSpec(raw) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const allowedKinds = new Set(["website", "mockup", "error", "diagram", "photo", "other"]);
  const kind = allowedKinds.has(String(value.kind || "")) ? String(value.kind) : "other";
  const detected = typeof value.detectedUrl === "string" && value.detectedUrl.trim()
    ? value.detectedUrl.trim().slice(0, 1000)
    : null;
  return {
    kind,
    summary: String(value.summary || "").trim() || "No visual summary returned",
    layout: String(value.layout || "").trim() || "Not specified",
    visualHierarchy: String(value.visualHierarchy || "").trim() || "Not specified",
    sections: asStringArray(value.sections),
    palette: asStringArray(value.palette),
    typography: String(value.typography || "").trim() || "Not specified",
    spacing: String(value.spacing || "").trim() || "Not specified",
    components: asStringArray(value.components),
    implementationNotes: asStringArray(value.implementationNotes),
    textContent: asStringArray(value.textContent),
    detectedUrl: detected,
  };
}

function parseJsonObject(text) {
  const source = String(text || "").trim();
  if (!source) throw new Error("Vision model returned an empty response");
  const candidates = [source];
  for (const match of source.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
    candidates.push(String(match[1] || "").trim());
  }
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(source.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  throw new Error("Vision model did not return valid JSON");
}

async function analyzeImageAttachments(options = {}) {
  const attachments = (Array.isArray(options.attachments) ? options.attachments : [])
    .filter((item) => item && item.kind === "image")
    .slice(0, MAX_IMAGES);
  if (!attachments.length) return { ok: false, skipped: true, reason: "no_images", spec: null, model: null };
  if (!options.provider || typeof options.provider.completeVision !== "function") {
    return {
      ok: false,
      skipped: false,
      reason: "vision_provider_unavailable",
      spec: null,
      model: null,
      notice: "The selected model provider does not support image analysis.",
    };
  }
  if (typeof options.readAttachment !== "function") {
    return {
      ok: false,
      skipped: false,
      reason: "image_reader_unavailable",
      spec: null,
      model: null,
      notice: "CodeMe could not read the attached image bytes.",
    };
  }

  let models;
  try {
    models = typeof options.provider.listModels === "function"
      ? await options.provider.listModels({ strict: true })
      : [];
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      reason: "model_list_failed",
      spec: null,
      model: null,
      notice: error instanceof Error ? error.message : String(error),
    };
  }

  const preferred = options.preferredModel || DEFAULT_VISION_MODEL;
  const model = pickVisionModel(models, preferred);
  if (!model) {
    return {
      ok: false,
      skipped: false,
      reason: "vision_model_missing",
      spec: null,
      model: null,
      notice: "No vision model is installed on this Ollama source. Install " + preferred + " or another VL/vision model.",
    };
  }

  const images = [];
  const used = [];
  for (const attachment of attachments) {
    let bytes;
    try {
      bytes = await options.readAttachment(attachment);
    } catch {
      continue;
    }
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) continue;
    images.push(buffer.toString("base64"));
    used.push(attachment);
  }
  if (!images.length) {
    return {
      ok: false,
      skipped: false,
      reason: "image_read_failed",
      spec: null,
      model,
      notice: "The attached image could not be read or exceeded the 8 MB image limit.",
    };
  }

  try {
    const result = await options.provider.completeVision({
      model,
      prompt: promptForImages(options.goal, used),
      images,
      schema: DESIGN_SPEC_SCHEMA,
      signal: options.signal,
    });
    const parsed = parseJsonObject(result && result.text);
    const spec = normalizeSpec(parsed);
    return {
      ok: true,
      skipped: false,
      reason: "ok",
      model,
      imageCount: images.length,
      spec,
      usage: result && result.usage || null,
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      reason: "vision_failed",
      spec: null,
      model,
      notice: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatVisualSpec(spec) {
  if (!spec) return "";
  return JSON.stringify(spec, null, 2);
}

module.exports = {
  DEFAULT_VISION_MODEL,
  DESIGN_SPEC_SCHEMA,
  VISION_MODEL_RE,
  pickVisionModel,
  analyzeImageAttachments,
  formatVisualSpec,
};
