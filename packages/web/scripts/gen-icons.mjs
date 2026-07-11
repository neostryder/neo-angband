// Dependency-free PWA icon generator for Neo Angband.
//
// Rasterizes a classic roguelike mark: a green "@" glyph on a near-black
// background, scaled up with nearest-neighbor and centered inside a safe zone.
// PNG encoding uses only Node built-ins (zlib for the IDAT deflate, a hand
// rolled CRC32 per chunk). No image libraries.
//
// Run: node scripts/gen-icons.mjs  (or: pnpm gen-icons)

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "icons");

// Colors.
const BG = [0x0b, 0x0b, 0x0b, 0xff]; // near-black #0b0b0b
const FG = [0x33, 0xff, 0x66, 0xff]; // green #33ff66

// 8x8 "@" bitmap (1 = green pixel, 0 = background).
const GLYPH = [
  [0, 1, 1, 1, 1, 1, 0, 0],
  [1, 0, 0, 0, 0, 0, 1, 0],
  [1, 0, 1, 1, 1, 0, 1, 0],
  [1, 0, 1, 0, 1, 0, 1, 0],
  [1, 0, 1, 1, 1, 1, 1, 0],
  [1, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];
const GLYPH_SIZE = 8;

// CRC32 table + helper (per PNG spec).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "latin1");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Build an RGBA raster and encode it as a PNG buffer.
function encodePng(size, raster) {
  // IHDR: width, height, bit depth 8, color type 6 (RGBA), no interlace.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Filtered scanlines: each row prefixed with filter byte 0 (None).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type None
    raster.copy(raw, rowStart + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    magic,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Render the "@" glyph onto a size x size RGBA raster.
// padFraction is the fraction of the canvas reserved as empty safe-zone
// margin on each side (e.g. 0.15 => glyph occupies the middle 70%).
function renderIcon(size, padFraction) {
  const raster = Buffer.alloc(size * size * 4);
  // Fill background.
  for (let i = 0; i < size * size; i++) {
    raster[i * 4] = BG[0];
    raster[i * 4 + 1] = BG[1];
    raster[i * 4 + 2] = BG[2];
    raster[i * 4 + 3] = BG[3];
  }

  // Glyph draw area (square, centered).
  const draw = Math.max(1, Math.round(size * (1 - 2 * padFraction)));
  const scale = Math.max(1, Math.floor(draw / GLYPH_SIZE));
  const glyphPx = scale * GLYPH_SIZE;
  const offset = Math.floor((size - glyphPx) / 2);

  for (let gy = 0; gy < GLYPH_SIZE; gy++) {
    for (let gx = 0; gx < GLYPH_SIZE; gx++) {
      if (!GLYPH[gy][gx]) continue;
      // Nearest-neighbor upscale of this glyph cell.
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = offset + gx * scale + sx;
          const py = offset + gy * scale + sy;
          if (px < 0 || py < 0 || px >= size || py >= size) continue;
          const idx = (py * size + px) * 4;
          raster[idx] = FG[0];
          raster[idx + 1] = FG[1];
          raster[idx + 2] = FG[2];
          raster[idx + 3] = FG[3];
        }
      }
    }
  }
  return raster;
}

function writeIcon(name, size, padFraction) {
  const raster = renderIcon(size, padFraction);
  const png = encodePng(size, raster);
  const path = join(OUT_DIR, name);
  writeFileSync(path, png);
  // Sanity check: PNG magic header + non-empty.
  const okMagic =
    png.length > 8 &&
    png[0] === 0x89 &&
    png[1] === 0x50 &&
    png[2] === 0x4e &&
    png[3] === 0x47;
  if (!okMagic) {
    throw new Error(`Generated ${name} is not a valid PNG`);
  }
  console.log(`wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}

mkdirSync(OUT_DIR, { recursive: true });

// Standard icons use a ~15% safe-zone. Maskable uses ~25% so the glyph
// survives aggressive platform masking (circles, squircles, etc.).
writeIcon("icon-192.png", 192, 0.15);
writeIcon("icon-512.png", 512, 0.15);
writeIcon("icon-512-maskable.png", 512, 0.25);
writeIcon("apple-touch-icon-180.png", 180, 0.15);

console.log("icons generated in " + OUT_DIR);
