const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = 1;
const MAX_CONVERSATIONS_PER_WORKSPACE = 100;
const MAX_MESSAGES_PER_CONVERSATION = 200;

class ConversationStore {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, "conversations.json");
  }

  list(workspace) {
    const data = this.read();
    return data.conversations
      .filter((item) => item.workspace === normalizeWorkspace(workspace))
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      .map((item) => ({
        id: item.id,
        title: item.title || "New chat",
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        messageCount: Array.isArray(item.messages) ? item.messages.length : 0,
      }));
  }

  get(id, workspace) {
    if (!id) return null;
    const normalized = normalizeWorkspace(workspace);
    const item = this.read().conversations.find((candidate) => (
      candidate.id === id && (!normalized || candidate.workspace === normalized)
    ));
    return item ? cloneConversation(item) : null;
  }

  active(workspace) {
    const normalized = normalizeWorkspace(workspace);
    if (!normalized) return null;
    const data = this.read();
    const id = data.activeByWorkspace[normalized];
    return id ? this.get(id, normalized) : null;
  }

  create(workspace, title) {
    const normalized = normalizeWorkspace(workspace);
    const now = new Date().toISOString();
    const conversation = {
      id: `chat_${crypto.randomBytes(8).toString("hex")}`,
      workspace: normalized,
      title: cleanTitle(title) || "New chat",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    const data = this.read();
    data.conversations.push(conversation);
    data.activeByWorkspace[normalized] = conversation.id;
    this.prune(data, normalized);
    this.write(data);
    return cloneConversation(conversation);
  }

  append(id, workspace, message) {
    const normalized = normalizeWorkspace(workspace);
    const role = message && message.role === "assistant" ? "assistant" : "user";
    const text = String(message && message.text || "").trim();
    if (!id || !text) return null;

    const data = this.read();
    const conversation = data.conversations.find((item) => item.id === id && item.workspace === normalized);
    if (!conversation) return null;

    conversation.messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    conversation.messages.push({
      role,
      text,
      at: message && message.at ? String(message.at) : new Date().toISOString(),
      runId: message && message.runId ? String(message.runId) : "",
    });
    if (conversation.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
      conversation.messages = conversation.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
    }
    if ((!conversation.title || conversation.title === "New chat") && role === "user") {
      conversation.title = cleanTitle(text) || "New chat";
    }
    conversation.updatedAt = new Date().toISOString();
    data.activeByWorkspace[normalized] = conversation.id;
    this.write(data);
    return cloneConversation(conversation);
  }

  setActive(workspace, id) {
    const normalized = normalizeWorkspace(workspace);
    const data = this.read();
    const exists = data.conversations.some((item) => item.id === id && item.workspace === normalized);
    if (!exists) return false;
    data.activeByWorkspace[normalized] = id;
    this.write(data);
    return true;
  }

  clearActive(workspace) {
    const normalized = normalizeWorkspace(workspace);
    const data = this.read();
    delete data.activeByWorkspace[normalized];
    this.write(data);
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return normalizeData(parsed);
    } catch {
      return emptyData();
    }
  }

  write(data) {
    fs.mkdirSync(this.directory, { recursive: true });
    const normalized = normalizeData(data);
    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }

  prune(data, workspace) {
    const same = data.conversations
      .filter((item) => item.workspace === workspace)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    if (same.length <= MAX_CONVERSATIONS_PER_WORKSPACE) return;
    const keep = new Set(same.slice(0, MAX_CONVERSATIONS_PER_WORKSPACE).map((item) => item.id));
    data.conversations = data.conversations.filter((item) => item.workspace !== workspace || keep.has(item.id));
  }
}

function emptyData() {
  return { schemaVersion: SCHEMA_VERSION, activeByWorkspace: {}, conversations: [] };
}

function normalizeData(value) {
  const data = value && typeof value === "object" ? value : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    activeByWorkspace: data.activeByWorkspace && typeof data.activeByWorkspace === "object"
      ? { ...data.activeByWorkspace }
      : {},
    conversations: Array.isArray(data.conversations)
      ? data.conversations.map(normalizeConversation).filter(Boolean)
      : [],
  };
}

function normalizeConversation(value) {
  if (!value || !value.id) return null;
  return {
    id: String(value.id),
    workspace: normalizeWorkspace(value.workspace),
    title: cleanTitle(value.title) || "New chat",
    createdAt: String(value.createdAt || new Date().toISOString()),
    updatedAt: String(value.updatedAt || value.createdAt || new Date().toISOString()),
    messages: Array.isArray(value.messages)
      ? value.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES_PER_CONVERSATION)
      : [],
  };
}

function normalizeMessage(value) {
  if (!value || !String(value.text || "").trim()) return null;
  return {
    role: value.role === "assistant" ? "assistant" : "user",
    text: String(value.text).trim(),
    at: String(value.at || ""),
    runId: String(value.runId || ""),
  };
}

function normalizeWorkspace(value) {
  const text = String(value || "").trim();
  return text ? path.resolve(text) : "";
}

function cleanTitle(value) {
  const first = String(value || "").trim().split(/\r?\n/)[0].replace(/\s+/g, " ");
  if (!first) return "";
  return first.length > 54 ? `${first.slice(0, 51)}…` : first;
}

function cloneConversation(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  ConversationStore,
  cleanTitle,
};
