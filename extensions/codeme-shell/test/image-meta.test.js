const assert = require("assert");
const { describeFileRead, describeImage } = require("../image-meta");

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c6360000002000100ffff03000006000557bf0000000049454e44ae426082",
  "hex",
);

const image = describeFileRead("shot.png", PNG);
assert.strictEqual(image.path, "shot.png");
assert.strictEqual(image.kind, "image");
assert.strictEqual(image.type, "image/png");
assert.strictEqual(image.bytes, PNG.length);
assert.strictEqual(image.width, 1);
assert.strictEqual(image.height, 1);
assert.ok(!Object.prototype.hasOwnProperty.call(image, "contents"));
assert.ok(!String(image.type).includes("�"));

const meta = describeImage(PNG);
assert.strictEqual(meta.kind, "image");
assert.strictEqual(meta.width, 1);

const text = describeFileRead("notes.txt", Buffer.from("hello\n", "utf8"));
assert.strictEqual(text.contents, "hello\n");
assert.ok(!text.kind);

console.log("ok image-meta");
