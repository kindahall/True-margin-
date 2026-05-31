import { deflateSync } from "node:zlib";
import { mkdir, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const glyphs = {
  " ": ["000", "000", "000", "000", "000", "000", "000"],
  ".": ["000", "000", "000", "000", "000", "110", "110"],
  "-": ["000", "000", "000", "111", "000", "000", "000"],
  A: ["010", "101", "101", "111", "101", "101", "101"],
  B: ["110", "101", "101", "110", "101", "101", "110"],
  C: ["011", "100", "100", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "101", "101", "110"],
  E: ["111", "100", "100", "110", "100", "100", "111"],
  F: ["111", "100", "100", "110", "100", "100", "100"],
  G: ["011", "100", "100", "101", "101", "101", "011"],
  H: ["101", "101", "101", "111", "101", "101", "101"],
  I: ["111", "010", "010", "010", "010", "010", "111"],
  K: ["101", "101", "110", "100", "110", "101", "101"],
  L: ["100", "100", "100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101", "101", "101"],
  N: ["101", "111", "111", "111", "101", "101", "101"],
  O: ["010", "101", "101", "101", "101", "101", "010"],
  P: ["110", "101", "101", "110", "100", "100", "100"],
  R: ["110", "101", "101", "110", "101", "101", "101"],
  S: ["011", "100", "100", "010", "001", "001", "110"],
  T: ["111", "010", "010", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "101", "101", "010"],
  W: ["101", "101", "101", "101", "111", "111", "101"],
  Y: ["101", "101", "101", "010", "010", "010", "010"]
};

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}

function crc32(buffers) {
  let c = 0xffffffff;
  for (const buffer of buffers) {
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32([typeBuffer, data]), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function png(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * width * 4;
    const targetStart = y * (width * 4 + 1);
    raw[targetStart] = 0;
    pixels.copy(raw, targetStart + 1, sourceStart, sourceStart + width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function canvas(width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  const set = (x, y, color) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (Math.floor(y) * width + Math.floor(x)) * 4;
    pixels[i] = color[0];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[2];
    pixels[i + 3] = color[3] ?? 255;
  };
  return { width, height, pixels, set };
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function mix(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), 255];
}

function fillGradient(c, topLeft, bottomRight) {
  for (let y = 0; y < c.height; y += 1) {
    for (let x = 0; x < c.width; x += 1) {
      c.set(x, y, mix(topLeft, bottomRight, (x / c.width + y / c.height) / 2));
    }
  }
}

function rect(c, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) c.set(xx, yy, color);
  }
}

function roundedRect(c, x, y, w, h, r, color) {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      const dx = xx < x + r ? x + r - xx : xx > x + w - r ? xx - (x + w - r) : 0;
      const dy = yy < y + r ? y + r - yy : yy > y + h - r ? yy - (y + h - r) : 0;
      if (dx * dx + dy * dy <= r * r) c.set(xx, yy, color);
    }
  }
}

function circle(c, cx, cy, radius, color) {
  const r2 = radius * radius;
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) c.set(x, y, color);
    }
  }
}

function drawGlyph(c, letter, x, y, scale, color) {
  const glyph = glyphs[letter] ?? glyphs[" "];
  for (let row = 0; row < glyph.length; row += 1) {
    for (let col = 0; col < glyph[row].length; col += 1) {
      if (glyph[row][col] === "1") rect(c, x + col * scale, y + row * scale, scale, scale, color);
    }
  }
}

function drawText(c, text, x, y, scale, color) {
  let offset = 0;
  for (const letter of text.toUpperCase()) {
    drawGlyph(c, letter, x + offset, y, scale, color);
    offset += 4 * scale;
  }
}

function brandIcon(size) {
  const c = canvas(size, size);
  fillGradient(c, [7, 29, 57], [11, 92, 255]);
  circle(c, Math.round(size * 0.79), Math.round(size * 0.2), Math.round(size * 0.22), [49, 196, 141, 255]);
  circle(c, Math.round(size * 0.2), Math.round(size * 0.82), Math.round(size * 0.18), [245, 158, 11, 255]);
  roundedRect(c, Math.round(size * 0.17), Math.round(size * 0.18), Math.round(size * 0.66), Math.round(size * 0.64), Math.round(size * 0.08), [255, 255, 255, 28]);
  const scale = Math.max(8, Math.floor(size / 15));
  drawText(c, "TM", Math.round(size * 0.26), Math.round(size * 0.38), scale, [255, 255, 255, 255]);
  return png(size, size, c.pixels);
}

function banner(width, height, compact = false) {
  const c = canvas(width, height);
  fillGradient(c, [238, 246, 255], [220, 252, 231]);
  rect(c, 0, 0, width, Math.max(12, Math.floor(height * 0.035)), [11, 92, 255, 255]);
  rect(c, 0, Math.max(12, Math.floor(height * 0.035)), width, Math.max(5, Math.floor(height * 0.014)), [49, 196, 141, 255]);
  for (let x = 0; x < width; x += Math.max(48, Math.floor(width / 16))) {
    rect(c, x, Math.floor(height * 0.72), Math.max(14, Math.floor(width / 90)), Math.floor(height * 0.18), [255, 255, 255, 80]);
  }
  circle(c, Math.floor(width * 0.82), Math.floor(height * 0.34), Math.floor(height * 0.24), [11, 92, 255, 42]);
  circle(c, Math.floor(width * 0.9), Math.floor(height * 0.65), Math.floor(height * 0.18), [245, 158, 11, 52]);
  roundedRect(c, Math.floor(width * 0.06), Math.floor(height * 0.2), Math.floor(height * 0.58), Math.floor(height * 0.58), Math.floor(height * 0.08), [7, 29, 57, 255]);
  const iconScale = Math.max(5, Math.floor(height / 40));
  drawText(c, "TM", Math.floor(width * 0.105), Math.floor(height * 0.39), iconScale, [255, 255, 255, 255]);
  const titleScale = Math.max(5, Math.floor(height / (compact ? 33 : 29)));
  drawText(c, "TRUE MARGIN TRACKER", Math.floor(width * 0.26), Math.floor(height * 0.29), titleScale, [14, 27, 52, 255]);
  const subtitleScale = Math.max(3, Math.floor(height / 55));
  drawText(c, "REAL MARGIN AFTER EVERY COST", Math.floor(width * 0.265), Math.floor(height * 0.55), subtitleScale, [31, 78, 121, 255]);
  return png(width, height, c.pixels);
}

const outputRoot = path.join(root, "release/marketplace-assets");
await mkdir(path.join(outputRoot, "shopify"), { recursive: true });
await mkdir(path.join(outputRoot, "wordpress-org"), { recursive: true });

const files = [
  ["app-icon-1024.png", brandIcon(1024)],
  ["shopify/app-icon-1200.png", brandIcon(1200)],
  ["wordpress-org/icon-256x256.png", brandIcon(256)],
  ["wordpress-org/icon-128x128.png", brandIcon(128)],
  ["wordpress-org/banner-1544x500.png", banner(1544, 500)],
  ["wordpress-org/banner-772x250.png", banner(772, 250, true)]
];

for (const [name, bytes] of files) {
  await writeFile(path.join(outputRoot, name), bytes);
}

for (const slug of ["true-margin-tracker", "true-margin-tracker-wordpress", "true-margin-tracker-license-bridge"]) {
  const target = path.join(root, "release/wordpress-org", slug, "assets");
  await mkdir(target, { recursive: true });
  for (const asset of ["icon-256x256.png", "icon-128x128.png", "banner-1544x500.png", "banner-772x250.png"]) {
    await cp(path.join(outputRoot, "wordpress-org", asset), path.join(target, asset), { force: true });
  }
}

console.log("Marketplace assets generated.");
