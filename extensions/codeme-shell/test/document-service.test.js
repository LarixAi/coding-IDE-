const assert = require("assert");
const { createDocument, readDocument, editDocument } = require("../document-service");

function main() {
  const created = createDocument("notes.docx", "# CodeMe Documents\nHello world\n- Read\n- Edit");
  assert.strictEqual(created.format, "docx");
  assert.ok(created.bytes.length > 500);

  const first = readDocument("notes.docx", created.bytes);
  assert.ok(first.contents.includes("CodeMe Documents"));
  assert.ok(first.contents.includes("Hello world"));
  assert.ok(first.contents.includes("• Read"));

  const edited = editDocument("notes.docx", created.bytes, "Hello world", "Hello CodeMe");
  assert.strictEqual(edited.changed, true);
  const second = readDocument("notes.docx", edited.bytes);
  assert.ok(second.contents.includes("Hello CodeMe"));
  assert.ok(!second.contents.includes("Hello world"));

  const markdown = createDocument("notes.md", "# Heading\nBody");
  assert.strictEqual(readDocument("notes.md", markdown.bytes).contents, "# Heading\nBody");

  assert.throws(
    () => editDocument("notes.txt", Buffer.from("same same"), "same", "new"),
    (error) => error && error.code === "document_edit_ambiguous",
  );
  assert.throws(
    () => readDocument("report.pdf", Buffer.from("%PDF")),
    (error) => error && error.code === "pdf_reader_unavailable",
  );

  console.log("ok document service");
}

main();
