const fs = require("fs");
const path = require("path");

const VISION_RE = /(?:^|[-_.:])(vl|vision)(?:$|[-_.:])|llava|moondream|minicpm-v|bakllava|cogvlm|internvl|qwen.*vl|gemma.*vision|llama.*vision/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 4;

function endpoints() {
  const local = process.env.CODEME_LOCAL_OLLAMA_URL || process.env.CODEME_OLLAMA_URL || "http://127.0.0.1:11434";
  const server = process.env.CODEME_SERVER_OLLAMA_URL || "";
  return [
    ...(server ? [{ id: "server", label: "Server", url: String(server).replace(/\/$/, "") }] : []),
    { id: "local", label: "Local", url: String(local).replace(/\/$/, "") },
  ];
}

async function jsonFetch(url, options = {}, timeoutMs = 8000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signals = [timeout];
  if (options.signal) signals.push(options.signal);
  const signal = AbortSignal.any(signals);
  const response = await fetch(url, { ...options, signal });
  if (!response.ok) throw new Error("HTTP " + response.status + " from " + url);
  return response.json();
}

async function modelsAt(endpoint, signal) {
  const data = await jsonFetch(endpoint.url + "/api/tags", { signal }, 5000);
  return (Array.isArray(data && data.models) ? data.models : [])
    .map((item) => String(item && (item.name || item.model) || "").trim())
    .filter(Boolean);
}

function modelMatches(candidate, wanted) {
  const a=String(candidate||""), b=String(wanted||"");
  return a===b || a.startsWith(b+":") || b.startsWith(a+":");
}

async function selectVisionModel(signal) {
  const preferred = String(process.env.CODEME_VISION_MODEL || "").trim();
  const discovered = [];
  for (const endpoint of endpoints()) {
    try {
      const models = await modelsAt(endpoint, signal);
      for (const model of models) discovered.push({ endpoint, model });
    } catch {}
  }
  if (preferred) {
    const exact = discovered.find((item) => modelMatches(item.model, preferred));
    if (exact) return exact;
  }
  return discovered.find((item) => VISION_RE.test(item.model)) || null;
}

function safeAttachmentPath(root, relative) {
  const base=path.resolve(String(root||""));
  const target=path.resolve(base, String(relative||"").replace(/^\/+/, ""));
  if (!base || (target!==base && !target.startsWith(base+path.sep))) throw new Error("Attachment path escaped the workspace");
  return target;
}

function readImages(root, attachments) {
  const images=[];
  let total=0;
  for (const item of (attachments||[]).filter((x)=>x&&x.kind==="image").slice(0,MAX_IMAGES)) {
    const file=safeAttachmentPath(root,item.path);
    const stat=fs.statSync(file);
    if (!stat.isFile() || stat.size<1 || stat.size>MAX_IMAGE_BYTES) continue;
    total+=stat.size;
    if (total>MAX_IMAGE_BYTES*2) break;
    images.push({
      name:String(item.name||path.basename(file)),
      type:String(item.type||"image/png"),
      base64:fs.readFileSync(file).toString("base64"),
    });
  }
  return images;
}

function parseObject(text) {
  const source=String(text||"").trim();
  const first=source.indexOf("{"), last=source.lastIndexOf("}");
  if (first>=0 && last>first) {
    try { return JSON.parse(source.slice(first,last+1)); } catch {}
  }
  return null;
}

function stringArray(value, limit=30) {
  return (Array.isArray(value) ? value : [])
    .map((item)=>String(item||"").trim())
    .filter(Boolean)
    .slice(0,limit);
}

function normalizeVisionSpec(raw, fallbackText="") {
  const value=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{};
  return {
    kind:["website","mockup","error","diagram","other"].includes(String(value.kind||""))
      ? String(value.kind)
      : (stringArray(value.errors,1).length ? "error" : "other"),
    summary:String(value.summary||fallbackText||"No summary returned").trim().slice(0,3000),
    layout:String(value.layout||"").trim().slice(0,2500),
    visualHierarchy:String(value.visualHierarchy||value.hierarchy||"").trim().slice(0,2500),
    sections:stringArray(value.sections),
    palette:stringArray(value.palette,20),
    typography:String(value.typography||"").trim().slice(0,2000),
    spacing:String(value.spacing||"").trim().slice(0,1200),
    components:stringArray(value.components),
    textContent:stringArray(value.textContent||value.visibleText,80),
    errors:stringArray(value.errors,30),
    implementationNotes:stringArray(value.implementationNotes,40),
    detectedUrl:typeof value.detectedUrl==="string"&&value.detectedUrl.trim()
      ? value.detectedUrl.trim().slice(0,1000)
      : null,
  };
}

function formatVisionSpec(spec) {
  return JSON.stringify(normalizeVisionSpec(spec), null, 2);
}

async function analyzeImages(root, attachments, goal, signal) {
  const images=readImages(root,attachments);
  if (!images.length) return { ok:false, reason:"no_images" };
  const selected=await selectVisionModel(signal);
  if (!selected) return { ok:false, reason:"vision_model_missing", notice:"No installed vision model was found." };
  const prompt=[
    "Analyze these attached images for a coding assistant.",
    "Be factual. Do not invent details that are not visible.",
    "For UI screenshots extract layout, visual hierarchy, section order, palette/colours, typography, spacing, reusable components, and all important visible text.",
    "For error screenshots transcribe visible errors and list concrete diagnostic clues without guessing hidden state.",
    "If a browser address bar, footer domain, or clear URL is visible, include detectedUrl; otherwise use null.",
    "Return JSON only with keys: kind, summary, layout, visualHierarchy, sections, palette, typography, spacing, components, textContent, errors, implementationNotes, detectedUrl.",
    goal ? "User request: "+String(goal).slice(0,2500) : "",
  ].filter(Boolean).join("\n\n");
  const body={
    model:selected.model,
    stream:false,
    think:false,
    messages:[{ role:"user", content:prompt, images:images.map((item)=>item.base64) }],
    options:{ temperature:0.1 },
  };
  const response=await jsonFetch(selected.endpoint.url+"/api/chat",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(body),
    signal,
  },240000);
  const text=String(response && response.message && response.message.content || "").trim();
  const parsed=parseObject(text);
  return {
    ok:true,
    source:selected.endpoint.id,
    sourceLabel:selected.endpoint.label,
    model:selected.model,
    imageCount:images.length,
    spec:normalizeVisionSpec(parsed, text || "Vision model returned no text."),
  };
}

module.exports={
  VISION_RE,
  endpoints,
  selectVisionModel,
  analyzeImages,
  safeAttachmentPath,
  normalizeVisionSpec,
  formatVisionSpec,
};
