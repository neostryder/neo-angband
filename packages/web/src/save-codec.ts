/**
 * The save compressor for this front end (core's SaveCodec seam, save/compress.ts).
 *
 * Core owns the envelope and refuses to guess at a codec it does not have; a
 * front end supplies the one it can actually run. This build's constraint is
 * that the save path is SYNCHRONOUS all the way down, because `z-file.c` is - so
 * the browser's own `CompressionStream` is unusable here (it is async, and making
 * the save path async would push `await` up through the command layer and let the
 * storage transport reshape the game's control flow). fflate is a synchronous
 * DEFLATE in plain JS, which is why it is a dependency at all.
 *
 * WHY IT MATTERS HERE MORE THAN ANYWHERE. A `localStorage` origin is documented
 * at ~5 MB, and base64 costs another third on top. Measured, a fresh character
 * serializes to 180 KiB base64'd in town and 521 KiB at DL50, so the roster hit
 * the quota at around nine characters - fewer with `birth_levels_persist`, whose
 * level cache can exhaust it on its own. Under decision 16 (no save-scumming,
 * death is permanent) a failed write is a lost character, not a lost preference.
 * gzip measures at ratio 0.04 on this data, which turns 521 KiB into 22 KiB.
 *
 * The 5 MB is the number to DESIGN to, but it is not what every engine enforces:
 * probed on 2026-08-03, the desktop shell's Chromium origin accepted 50 MB into
 * localStorage without refusing (read back at each step, so not a silent
 * truncation), and the probe stopped at its own loop limit rather than a wall. So
 * the ceiling that matters is the web build's, where ~5 MB is real - and 5 MB of
 * 22 KiB saves is around two hundred characters, which is why this is recorded as
 * headroom rather than acted on. Do not re-derive it from the desktop build.
 *
 * The desktop build renders this same bundle, so it gets the same codec; when
 * Phase 5 moves desktop saves to real files through the host bridge, the encoding
 * still happens here and the files are gzip too. That is deliberate - one savefile
 * format for both front ends is what makes import/export between them a copy.
 */

import { Gunzip, gunzipSync, gzipSync } from "fflate";
import type { SaveCodec } from "@rpgm-tools/neo-angband-core";

/* Feeding fflate's synchronous stream in small pieces bounds the output it can
 * allocate before our callback rejects an over-limit import. */
const GUNZIP_INPUT_CHUNK_BYTES = 1024;

/**
 * gzip, not raw deflate: the 18-byte header costs nothing next to a 20x saving
 * and makes a savefile's payload identifiable by any ordinary tool, which is
 * worth having when someone reports a save that will not load.
 */
export const gzipCodec: SaveCodec = {
  id: "gzip",
  compress: (bytes) => gzipSync(bytes),
  decompress: (bytes, maxOutputLength) =>
    maxOutputLength === undefined ? gunzipSync(bytes) : gunzipWithLimit(bytes, maxOutputLength),
};

function gunzipWithLimit(bytes: Uint8Array, maxOutputLength: number): Uint8Array {
  if (!Number.isSafeInteger(maxOutputLength) || maxOutputLength < 0) {
    throw new Error("invalid gzip output limit");
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  const stream = new Gunzip((chunk) => {
    if (chunk.length > maxOutputLength - length) {
      throw new Error(`gzip output exceeds ${String(maxOutputLength)} bytes`);
    }
    length += chunk.length;
    chunks.push(chunk);
  });
  for (let offset = 0; offset < bytes.length; offset += GUNZIP_INPUT_CHUNK_BYTES) {
    const end = Math.min(offset + GUNZIP_INPUT_CHUNK_BYTES, bytes.length);
    stream.push(bytes.subarray(offset, end), end === bytes.length);
  }
  if (bytes.length === 0) stream.push(bytes, true);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * The codec used for NEW saves. Kept as its own name so the write side and the
 * read side cannot drift apart.
 */
export const SAVE_CODEC = gzipCodec;

/**
 * Every codec this build can READ. Strictly a superset of the write codec, and
 * the reason it is a list: retiring a codec later must not orphan the saves it
 * wrote, so an entry is added here and removed from `SAVE_CODEC` - never deleted
 * outright while any save might still carry it.
 */
export const SAVE_CODECS: readonly SaveCodec[] = [gzipCodec];
