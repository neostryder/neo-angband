/**
 * Save compression: the third word of PORT_PLAN decision 9 ("versioned,
 * schema-validated, compressed JSON"), which the format had never had.
 *
 * This is a PLATFORM ACCOMMODATION, not a nicety, so it belongs in core (the
 * owner's rule, 2026-07-28: what the new platform makes necessary is part of the
 * port; what merely makes the game nicer is a QoL mod candidate). The reason is
 * measured rather than assumed. A freshly born character serializes to:
 *
 *     depth  0   135 KiB JSON   ->  180 KiB once base64'd for localStorage
 *     depth 20   337 KiB        ->  449 KiB
 *     depth 50   391 KiB        ->  521 KiB
 *
 * A `localStorage` origin gets about 5 MB in every current browser, so the web
 * build ran out of room at roughly NINE characters - and that is before
 * `birth_levels_persist`, whose `levelCache` adds another level-sized block per
 * remembered floor and can exhaust the quota with a single character. Under the
 * no-save-scum, death-is-permanent policy (decision 16) a quota failure is not an
 * inconvenience: it is a dead character. gzip measures at ratio 0.04 on this data
 * (the chunk grids and the known-map arrays are enormously repetitive), turning
 * 521 KiB into 22 KiB and the ceiling from ~9 characters into hundreds.
 *
 * WHY A SEAM RATHER THAN A COMPRESSOR IN CORE. `packages/core` has zero runtime
 * dependencies and stays environment-neutral, and the two things that can
 * actually deflate bytes are split by environment: Node has `zlib.gzipSync`,
 * browsers have `CompressionStream` - which is ASYNC, and the save path is
 * synchronous all the way down because `z-file.c` is (see host/io.ts). So core
 * owns the FORMAT - the envelope, the id, the sniffing, and the rule that an
 * unknown codec is reported rather than guessed - and a front end supplies the
 * codec it can actually run. Same shape as save/integrity.ts's SaveIntegrity
 * provider, and for the same reason.
 *
 * BACKWARD COMPATIBILITY IS THE POINT OF THE HEADER. Saves written before this
 * existed are bare JSON, and a bare JSON document cannot begin with the magic
 * (it begins with `{`), so `stripCodec` distinguishes them with certainty rather
 * than by heuristic. An older build reading a NEWER compressed save is the case
 * that actually needs care: it will find a codec id it has never heard of, and
 * must say so instead of reporting a corrupt save, because the two call for
 * opposite responses from a player.
 */

/**
 * A pluggable save compressor. Both directions must be synchronous, which is
 * the whole reason this is injected rather than implemented here.
 *
 * `decompress` MUST throw on input it cannot decode rather than returning
 * partial output: a truncated save that parses into a plausible-but-wrong game
 * is the one outcome worse than a save that fails to load. When
 * `maxOutputLength` is supplied, it MUST also throw before returning more than
 * that many bytes. Importers use that bound before JSON parsing untrusted files;
 * normal saved-game reads intentionally leave it unset.
 */
export interface SaveCodec {
  /**
   * Stable codec identifier, recorded in the envelope and used to pick the
   * decoder on the way back. Lower-case, `[a-z0-9-]`, no colon and no newline
   * (both are envelope delimiters) - `assertCodecId` enforces it.
   */
  readonly id: string;
  compress(bytes: Uint8Array): Uint8Array;
  decompress(bytes: Uint8Array, maxOutputLength?: number): Uint8Array;
}

/**
 * Envelope prefix: `NGSC1:<id>\n` then the codec's bytes. Versioned in the magic
 * itself (`1`) so a future envelope change is a different magic rather than a
 * silent reinterpretation of these bytes.
 */
const CODEC_MAGIC = "NGSC1:";

/** The envelope delimiters, which a codec id therefore may not contain. */
const CODEC_ID_RE = /^[a-z0-9-]+$/;

/** Guard a codec id against the envelope's own delimiters. */
export function assertCodecId(id: string): void {
  if (!CODEC_ID_RE.test(id)) {
    throw new Error(
      `invalid save codec id ${JSON.stringify(id)}: expected [a-z0-9-]+`,
    );
  }
}

/** Wrap compressed bytes in the envelope that names the codec that made them. */
export function applyCodec(json: Uint8Array, codec: SaveCodec): Uint8Array {
  assertCodecId(codec.id);
  const body = codec.compress(json);
  const head = new TextEncoder().encode(`${CODEC_MAGIC}${codec.id}\n`);
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

/** What `stripCodec` found at the front of a savefile payload. */
export interface StrippedCodec {
  /** The codec id from the envelope, or null for an uncompressed save. */
  codecId: string | null;
  /** The bytes after the envelope (the whole input when codecId is null). */
  body: Uint8Array;
}

/**
 * Split the codec envelope off a payload.
 *
 * A payload with no envelope is returned as-is with `codecId: null` - that is
 * every save written before compression existed, and it stays loadable forever.
 */
export function stripCodec(payload: Uint8Array): StrippedCodec {
  const magic = new TextEncoder().encode(CODEC_MAGIC);
  if (payload.length < magic.length) return { codecId: null, body: payload };
  for (let i = 0; i < magic.length; i++) {
    if (payload[i] !== magic[i]) return { codecId: null, body: payload };
  }
  /* The id runs to the first newline. Bound the search so a payload that begins
   * with the magic but carries no terminator cannot scan the whole file. */
  const limit = Math.min(payload.length, magic.length + 64);
  for (let i = magic.length; i < limit; i++) {
    if (payload[i] === 0x0a) {
      const id = new TextDecoder().decode(payload.subarray(magic.length, i));
      return { codecId: id, body: payload.subarray(i + 1) };
    }
  }
  /* Magic present, no terminator: a corrupt header. Reported as an unknown
   * codec ("") rather than silently treated as JSON, which would fail to parse
   * and blame the wrong thing. */
  return { codecId: "", body: payload.subarray(magic.length) };
}

/** Pick the codec for an id out of the codecs a build has, or undefined. */
export function findCodec(
  id: string,
  codecs: readonly SaveCodec[],
): SaveCodec | undefined {
  return codecs.find((c) => c.id === id);
}
