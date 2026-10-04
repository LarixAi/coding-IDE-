const path = require("path");
const zlib = require("zlib");

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 32 * 1024 * 1024;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function formatFor(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".docx") return "docx";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".txt") return "text";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".pdf") return "pdf";
  return "";
}

function typeFor(format) {
  if (format === "docx") return DOCX_TYPE;
  if (format === "markdown") return "text/markdown";
  if (format === "html") return "text/html";
  if (format === "text") return "text/plain";
  if (format === "pdf") return "application/pdf";
  return "application/octet-stream";
}

function ensureSupported(filePath, write = false) {
  const format = formatFor(filePath);
  if (!format) fail("unsupported_document", "Supported documents are .docx, .md, .txt, and .html.");
  if (format === "pdf") {
    fail(write ? "pdf_edit_unsupported" : "pdf_reader_unavailable",
      write ? "PDF editing is not enabled in this document tool." : "PDF text reading is not enabled in this document tool.");
  }
  return format;
}

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlUnescape(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function readZip(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || []);
  if (buffer.length > MAX_BYTES) fail("document_too_large", "Document is larger than 32 MB.");
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) fail("invalid_docx", "The DOCX ZIP directory could not be found.");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) fail("invalid_docx", "The DOCX ZIP directory is invalid.");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) fail("invalid_docx", "The DOCX ZIP entry is invalid.");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else fail("unsupported_docx_compression", "Unsupported DOCX ZIP compression method: " + method);
    entries.push({ name, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function writeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || "");
    const compressed = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(compressed.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

function paragraph(text, style) {
  const prop = style ? "<w:pPr><w:pStyle w:val=\"" + style + "\"/></w:pPr>" : "";
  return "<w:p>" + prop + "<w:r><w:t xml:space=\"preserve\">" + xmlEscape(text) + "</w:t></w:r></w:p>";
}

function bodyFromText(contents, title) {
  const rows = String(contents || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  if (title) out.push(paragraph(title, "Title"));
  for (const row of rows) {
    if (/^###\s+/.test(row)) out.push(paragraph(row.replace(/^###\s+/, ""), "Heading3"));
    else if (/^##\s+/.test(row)) out.push(paragraph(row.replace(/^##\s+/, ""), "Heading2"));
    else if (/^#\s+/.test(row)) out.push(paragraph(row.replace(/^#\s+/, ""), "Heading1"));
    else if (/^[-*]\s+/.test(row)) out.push(paragraph("• " + row.replace(/^[-*]\s+/, "")));
    else out.push(paragraph(row));
  }
  return out.join("");
}

function createDocx(contents, options = {}) {
  const documentXml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
    "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>" +
    bodyFromText(contents, String(options.title || "").trim()) +
    "<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\"/></w:sectPr></w:body></w:document>";
  const styles = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
    "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
    "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/></w:style>" +
    "<w:style w:type=\"paragraph\" w:styleId=\"Title\"><w:name w:val=\"Title\"/><w:rPr><w:b/><w:sz w:val=\"36\"/></w:rPr></w:style>" +
    "<w:style w:type=\"paragraph\" w:styleId=\"Heading1\"><w:name w:val=\"heading 1\"/><w:rPr><w:b/><w:sz w:val=\"32\"/></w:rPr></w:style>" +
    "<w:style w:type=\"paragraph\" w:styleId=\"Heading2\"><w:name w:val=\"heading 2\"/><w:rPr><w:b/><w:sz w:val=\"28\"/></w:rPr></w:style>" +
    "<w:style w:type=\"paragraph\" w:styleId=\"Heading3\"><w:name w:val=\"heading 3\"/><w:rPr><w:b/><w:sz w:val=\"24\"/></w:rPr></w:style></w:styles>";
  const entries = [
    { name: "[Content_Types].xml", data: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/><Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/></Types>" },
    { name: "_rels/.rels", data: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>" },
    { name: "word/document.xml", data: documentXml },
    { name: "word/styles.xml", data: styles },
    { name: "word/_rels/document.xml.rels", data: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>" }
  ];
  return writeZip(entries.map((entry) => ({ name: entry.name, data: Buffer.from(entry.data, "utf8") })));
}

function docxXml(entries) {
  const entry = entries.find((item) => item.name === "word/document.xml");
  if (!entry) fail("invalid_docx", "word/document.xml is missing.");
  return entry.data.toString("utf8");
}

function docxText(buffer) {
  const xml = docxXml(readZip(buffer));
  const blocks = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  return blocks.map((block) => {
    let text = "";
    const token = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;
    let match;
    while ((match = token.exec(block))) {
      if (match[1] !== undefined) text += xmlUnescape(match[1]);
      else if (/w:tab/.test(match[0])) text += "\t";
      else text += "\n";
    }
    return text;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function patchParagraph(block, oldText, newText) {
  const re = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  const nodes = [];
  let match;
  let joined = "";
  while ((match = re.exec(block))) {
    const text = xmlUnescape(match[2]);
    nodes.push({ start: match.index, end: re.lastIndex, attrs: match[1] || "", raw: match[0], text, from: joined.length, to: joined.length + text.length });
    joined += text;
  }
  const at = joined.indexOf(oldText);
  if (at < 0) return null;
  const end = at + oldText.length;
  let used = false;
  let cursor = 0;
  let output = "";
  for (const node of nodes) {
    output += block.slice(cursor, node.start);
    let value = node.text;
    const overlapStart = Math.max(at, node.from);
    const overlapEnd = Math.min(end, node.to);
    if (overlapStart < overlapEnd) {
      const a = overlapStart - node.from;
      const b = overlapEnd - node.from;
      value = value.slice(0, a) + (used ? "" : newText) + value.slice(b);
      used = true;
      output += "<w:t" + node.attrs + ">" + xmlEscape(value) + "</w:t>";
    } else {
      output += node.raw;
    }
    cursor = node.end;
  }
  output += block.slice(cursor);
  return output;
}

function editDocx(buffer, oldText, newText) {
  const entries = readZip(buffer);
  const entry = entries.find((item) => item.name === "word/document.xml");
  if (!entry) fail("invalid_docx", "word/document.xml is missing.");
  const xml = entry.data.toString("utf8");
  const blocks = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  let matches = 0;
  for (const block of blocks) {
    const text = (block.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [])
      .map((token) => {
        const m = token.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/);
        return m ? xmlUnescape(m[1]) : "";
      }).join("");
    let from = 0;
    while (oldText && (from = text.indexOf(oldText, from)) >= 0) { matches += 1; from += oldText.length; }
  }
  if (!matches) fail("document_text_not_found", "The requested text was not found in the document.");
  if (matches > 1) fail("document_edit_ambiguous", "The requested text appears more than once; provide a more specific oldText.");

  let changed = false;
  const nextXml = xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (block) => {
    if (changed) return block;
    const patched = patchParagraph(block, oldText, newText);
    if (!patched) return block;
    changed = true;
    return patched;
  });
  entry.data = Buffer.from(nextXml, "utf8");
  return writeZip(entries);
}

function readDocument(filePath, bytes) {
  const format = ensureSupported(filePath, false);
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (buffer.length > MAX_BYTES) fail("document_too_large", "Document is larger than 32 MB.");
  const contents = format === "docx" ? docxText(buffer) : buffer.toString("utf8");
  return { path: filePath, format, type: typeFor(format), bytes: buffer.length, contents };
}

function createDocument(filePath, contents, options = {}) {
  const format = ensureSupported(filePath, true);
  const bytes = format === "docx"
    ? createDocx(String(contents || ""), options)
    : Buffer.from(String(contents || ""), "utf8");
  return { format, type: typeFor(format), bytes };
}

function editDocument(filePath, bytes, oldText, newText) {
  const format = ensureSupported(filePath, true);
  if (typeof oldText !== "string" || !oldText) fail("invalid_args", "document.edit requires non-empty oldText.");
  if (typeof newText !== "string") fail("invalid_args", "document.edit requires string newText.");
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (format === "docx") {
    const next = editDocx(input, oldText, newText);
    return { format, type: typeFor(format), bytes: next, changed: !next.equals(input), replacements: 1 };
  }
  const before = input.toString("utf8");
  const first = before.indexOf(oldText);
  if (first < 0) fail("document_text_not_found", "The requested text was not found in the document.");
  if (before.indexOf(oldText, first + oldText.length) >= 0) fail("document_edit_ambiguous", "The requested text appears more than once; provide a more specific oldText.");
  const after = before.slice(0, first) + newText + before.slice(first + oldText.length);
  return { format, type: typeFor(format), bytes: Buffer.from(after, "utf8"), changed: after !== before, replacements: after !== before ? 1 : 0 };
}

module.exports = { DOCX_TYPE, readDocument, createDocument, editDocument };
