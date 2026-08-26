// Generates the web app's favicon and PWA icon set from the real app-icon
// artwork (packages/desktop/build/icon.png) - the same mascot the desktop
// build ships, rather than a drawn placeholder.
//
// Uses pngjs (already a dependency, used elsewhere for tile PNGs) to decode
// and re-encode. Resizing is a hand-rolled box-filter downsample rather than
// pulling in an image-processing dependency for five call sites.
//
// Run: node scripts/gen-icons.mjs  (or: pnpm gen-icons)

import { PNG } from "pngjs";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(__dirname, "..", "..", "desktop", "build", "icon.png");
const OUT_DIR = join(__dirname, "..", "public", "icons");

// Matches the manifest's background_color/theme_color. Used only behind the
// maskable and Apple touch variants - the two platforms that do not honor
// transparency and would otherwise show whatever the OS defaults to.
const BG = [0x10, 0x10, 0x14, 0xff];

// Box-filter downsample with alpha-premultiplied averaging, so a
// partially-transparent edge pixel does not pull in black from the fully
// transparent pixels beside it - the usual dark-halo downscale artifact.
function resize(src, size) {
  const out = new PNG({ width: size, height: size });
  const sx = src.width / size;
  const sy = src.height / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy2 = y0; sy2 < y1; sy2++) {
        for (let sx2 = x0; sx2 < x1; sx2++) {
          const i = (src.width * sy2 + sx2) << 2;
          const alpha = src.data[i + 3];
          r += (src.data[i] * alpha) / 255;
          g += (src.data[i + 1] * alpha) / 255;
          b += (src.data[i + 2] * alpha) / 255;
          a += alpha;
          n++;
        }
      }
      const outA = a / n;
      const o = (size * y + x) << 2;
      out.data[o] = outA > 0 ? Math.round((r / n / outA) * 255) : 0;
      out.data[o + 1] = outA > 0 ? Math.round((g / n / outA) * 255) : 0;
      out.data[o + 2] = outA > 0 ? Math.round((b / n / outA) * 255) : 0;
      out.data[o + 3] = Math.round(outA);
    }
  }
  return out;
}

// Resizes the source down to a smaller content size, then centers it on an
// opaque size x size canvas filled with `fill`. marginFraction is the empty
// border reserved on each side - 0 for a full-bleed flatten (Apple touch
// icon), 0.25 for the maskable icon's OS-mask safe zone.
function flatten(src, size, marginFraction, fill) {
  const contentSize = Math.round(size * (1 - 2 * marginFraction));
  const content = resize(src, contentSize);
  const out = new PNG({ width: size, height: size });
  for (let i = 0; i < size * size; i++) {
    out.data[i * 4] = fill[0];
    out.data[i * 4 + 1] = fill[1];
    out.data[i * 4 + 2] = fill[2];
    out.data[i * 4 + 3] = fill[3];
  }
  const offset = Math.floor((size - contentSize) / 2);
  for (let y = 0; y < contentSize; y++) {
    for (let x = 0; x < contentSize; x++) {
      const si = (contentSize * y + x) << 2;
      const alpha = content.data[si + 3] / 255;
      const di = (size * (y + offset) + (x + offset)) << 2;
      out.data[di] = Math.round(content.data[si] * alpha + out.data[di] * (1 - alpha));
      out.data[di + 1] = Math.round(content.data[si + 1] * alpha + out.data[di + 1] * (1 - alpha));
      out.data[di + 2] = Math.round(content.data[si + 2] * alpha + out.data[di + 2] * (1 - alpha));
      out.data[di + 3] = 255;
    }
  }
  return out;
}

function write(name, png) {
  const buf = PNG.sync.write(png);
  writeFileSync(join(OUT_DIR, name), buf);
  console.log(`wrote ${name} (${png.width}x${png.height}, ${buf.length} bytes)`);
}

mkdirSync(OUT_DIR, { recursive: true });
const src = PNG.sync.read(readFileSync(SOURCE));

// Full-bleed variants: same framing as the desktop app icon they are copied
// or resized from.
write("favicon-16.png", resize(src, 16));
write("favicon-32.png", resize(src, 32));
write("icon-192.png", resize(src, 192));
copyFileSync(SOURCE, join(OUT_DIR, "icon-512.png"));
console.log(`wrote icon-512.png (copied from ${SOURCE})`);

// Maskable: OS masks (circle, squircle, ...) can crop up to the inner 80%,
// so the art is padded well inside that safe zone.
write("icon-512-maskable.png", flatten(src, 512, 0.25, BG));

// Apple does not honor transparency on home-screen icons.
write("apple-touch-icon-180.png", flatten(src, 180, 0, BG));

console.log(`icons generated in ${OUT_DIR} from ${SOURCE}`);
