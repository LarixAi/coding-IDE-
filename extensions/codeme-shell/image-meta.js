function describeImage(bytes, kindHint) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const type = sniffType(buf) || (kindHint === "image" ? "application/octet-stream" : "");
  if (!type && kindHint !== "image") return null;
  const size = dimensions(buf, type);
  return {
    kind: "image",
    type: type || "application/octet-stream",
    bytes: buf.length,
    width: size.width,
    height: size.height,
  };
}

function describeFileRead(filePath, bytes, kindHint) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const image = describeImage(buf, kindHint);
  if (image) {
    return {
      path: filePath,
      kind: "image",
      type: image.type,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
    };
  }
  return { path: filePath, contents: buf.toString("utf8") };
}

function sniffType(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && buf.slice(0, 3).toString("ascii") === "GIF") return "image/gif";
  if (buf.length >= 12 && buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return "";
}

function dimensions(buf, type) {
  if (type === "image/png" && buf.length >= 24) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (type === "image/gif" && buf.length >= 10) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (type === "image/webp") return webpSize(buf);
  if (type === "image/jpeg") return jpegSize(buf);
  return { width: 0, height: 0 };
}

function webpSize(buf) {
  if (buf.length >= 30 && buf.slice(12, 16).toString("ascii") === "VP8 ") {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (buf.length >= 24 && buf.slice(12, 16).toString("ascii") === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return { width: 0, height: 0 };
}

function jpegSize(buf) {
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    const size = buf.readUInt16BE(offset + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + size;
  }
  return { width: 0, height: 0 };
}

module.exports = { describeImage, describeFileRead };
