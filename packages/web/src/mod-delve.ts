/**
 * Shareable mod-set snapshots: encode/decode, merge-or-replace resolution, and
 * the version-mismatch walk for a "Delve" file (docs/MOD_PROFILES.md, #87).
 *
 * WHAT THIS OWNS, AND WHAT IT DOES NOT. This module is the pure, host-free
 * half: the file format, classifying an imported mod against what is already
 * installed, and computing the enabled-set / flag-choice results of applying
 * one. It never touches storage, the network, or the DOM - `mods.ts` wires
 * this to `ModStore`, `deps.modBrowse` (mod-discover.ts's own repository walk)
 * and the screen prompts, the same separation `mod-discover.ts` itself
 * describes ("a row can be shown, judged incompatible and refused without
 * anything ever touching storage").
 *
 * THE FORMAT MIRRORS `.neochar` ON PURPOSE. `save-transfer.ts`'s `magic` +
 * `version` shape is the reason a wrong-kind file is refused before anything
 * else is read, and this format reuses that shape rather than inventing a
 * third vocabulary for "what kind of file is this."
 *
 * VERSION MISMATCH DOES NOT REUSE `discoverMod`'s PINNED-TAG REFUSAL. A
 * Delve's per-mod `tag` is a *preference*, not a pin the way a player's own
 * typed `owner/repo/tree/<tag>` URL is (docs/MOD_PROFILES.md, "Version
 * mismatch"): a pin the loader refuses is owed a clean refusal, because the
 * player asked for it by name, but a Delve's tag is somebody else's hint. So
 * `resolveDelveModVersion` tries the named tag first and, if it does not run
 * here, falls back to the SAME newest-runnable walk `mod-discover.ts` already
 * does for "Install a mod..." (`pickRunnableVersion`, reached here through the
 * caller's own `discover` function so there is exactly one copy of that
 * search, never a second one).
 */

/** The file's own kind marker - the gate on import, never the file extension. */
export const DELVE_MAGIC = "neo-angband-delve";

/**
 * Bumped only when an older reader would MISREAD a newer file, mirroring
 * `TRANSFER_VERSION`'s own rule (save-transfer.ts) - not on every additive
 * change.
 */
export const DELVE_FORMAT_VERSION = 1;

/** The suggested extension. The importer gates on `magic`, never on this. */
export const DELVE_EXT = ".ndelve";

/**
 * Import size ceiling. A Delve is "a few kilobytes of readable text"
 * (docs/MOD_PROFILES.md) even for a dozen mods, since it carries no mod code
 * or archives - this leaves generous headroom (the same spirit as
 * `save-transfer.ts`'s own limits) while still keeping a hostile paste out
 * of renderer memory.
 */
export const DELVE_MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** One mod's entry in a Delve (docs/MOD_PROFILES.md, "The file format"). */
export interface DelveMod {
  readonly id: string;
  readonly name: string;
  readonly repo: string;
  readonly tag: string;
  readonly version: string;
  readonly sha?: string;
  /**
   * Whether this mod should end up enabled when the Delve is applied. The
   * Save-a-Delve screen only ever writes `true` here - unchecking a mod in
   * its checklist drops the entry entirely rather than writing `false` - but
   * the FORMAT itself carries the field for a hand-authored or edited file
   * (docs/MOD_PROFILES.md's own example shows both), so a general reader
   * has to honour it either way.
   */
  readonly enabled: boolean;
  /**
   * A flat map of namespaced flag -> the RAW choice `ModStore.getRuleChoices`
   * recorded, never the resolved value - so importing against a different
   * version of the same mod still resolves against that version's defaults.
   */
  readonly flags: Readonly<Record<string, boolean>>;
  /** Capabilities the exporting install had approved. PREVIEW ONLY - never a grant. */
  readonly consents?: readonly string[];
}

/** `options.game`, mirroring `OptionStateData` minus its own `birth` field. */
export interface DelveGameOptions {
  readonly values: Readonly<Record<string, boolean>>;
  readonly hitpointWarn: number;
  readonly delayFactor: number;
  readonly lazymoveDelay: number;
}

/** `options`, both children independently optional (see docs/MOD_PROFILES.md). */
export interface DelveOptions {
  readonly birth?: Readonly<Record<string, boolean>>;
  readonly game?: DelveGameOptions;
}

/** A Delve file, exactly the shape docs/MOD_PROFILES.md's "The file format" specifies. */
export interface DelveFile {
  readonly magic: typeof DELVE_MAGIC;
  readonly formatVersion: number;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly createdWithEngine: string;
  readonly mods: readonly DelveMod[];
  readonly options?: DelveOptions;
}

/** Build a Delve object from its parts. Pure; `encodeDelve` serialises it. */
export function buildDelveFile(input: {
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly createdWithEngine: string;
  readonly mods: readonly DelveMod[];
  readonly options?: DelveOptions;
}): DelveFile {
  return {
    magic: DELVE_MAGIC,
    formatVersion: DELVE_FORMAT_VERSION,
    name: input.name,
    ...(input.description !== undefined && input.description !== ""
      ? { description: input.description }
      : {}),
    createdAt: input.createdAt,
    createdWithEngine: input.createdWithEngine,
    mods: input.mods.map((m) => ({ ...m, flags: { ...m.flags } })),
    ...(input.options !== undefined ? { options: input.options } : {}),
  };
}

/** Pretty-printed JSON: this is a file a human may open, paste, or read in Discord. */
export function encodeDelve(file: DelveFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** A filename a player will recognise later, safe on every filesystem. */
export function delveFilename(name: string): string {
  const safe = name.replace(/[^\w.-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return `${safe || "delve"}${DELVE_EXT}`;
}

export type DelveDecodeResult =
  | {
      readonly ok: true;
      readonly file: DelveFile;
      /** False when `formatVersion` is newer than this build knows - see the
       * doc's "Version mismatch" section: the shape still parsed, so every
       * field this build understands was applied, and this says so. */
      readonly recognized: boolean;
    }
  | { readonly ok: false; readonly why: string };

/**
 * Read a Delve file, or say why it is not one.
 *
 * GATE ORDER MATTERS. `magic` is checked before `formatVersion` - a save
 * file, a pref file, or somebody's unrelated JSON is refused as the wrong
 * KIND of thing rather than as a version problem the player might try to
 * solve, mirroring `save-transfer.ts`'s `parseEnvelope`.
 *
 * DEGRADE, NOT REFUSE, ON AN UNRECOGNISED VERSION. A `formatVersion` this
 * build does not recognise is still read when the top-level shape parses (a
 * future version that only added fields); `recognized: false` tells the
 * caller some of what the file says may not have been understood. Only a
 * `formatVersion` whose SHAPE this build cannot parse at all is refused,
 * naming the version.
 */
export function decodeDelve(text: string): DelveDecodeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      why: `that is not a Delve - it is not even JSON (${e instanceof Error ? e.message : String(e)})`,
    };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, why: "that is not a Delve" };
  }
  const o = raw as Record<string, unknown>;
  if (o["magic"] !== DELVE_MAGIC) {
    return { ok: false, why: "that is not a Neo Angband Delve" };
  }
  const version = o["formatVersion"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, why: "that Delve does not say which format it is in" };
  }
  const modsField = o["mods"];
  if (modsField !== undefined && !Array.isArray(modsField)) {
    return {
      ok: false,
      why: `that Delve is format ${String(version)} and its mod list is not a list this build can read`,
    };
  }
  const mods: DelveMod[] = [];
  for (const entry of Array.isArray(modsField) ? modsField : []) {
    const mod = readDelveMod(entry);
    if (mod) mods.push(mod);
    /* A malformed entry is skipped rather than refusing the whole file - the
     * same "one bad record does not cost the rest" rule mod-install.ts's
     * archiveFaults / mod-discover.ts's per-mod refusals already apply. */
  }
  const name = typeof o["name"] === "string" ? o["name"] : "";
  const createdAt = typeof o["createdAt"] === "string" ? o["createdAt"] : "";
  const createdWithEngine =
    typeof o["createdWithEngine"] === "string" ? o["createdWithEngine"] : "";
  const description = typeof o["description"] === "string" ? o["description"] : undefined;
  const options = readDelveOptions(o["options"]);
  const file: DelveFile = {
    magic: DELVE_MAGIC,
    formatVersion: version,
    name,
    ...(description !== undefined && description !== "" ? { description } : {}),
    createdAt,
    createdWithEngine,
    mods,
    ...(options !== undefined ? { options } : {}),
  };
  return { ok: true, file, recognized: version <= DELVE_FORMAT_VERSION };
}

function readDelveMod(entry: unknown): DelveMod | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const m = entry as Record<string, unknown>;
  const id = typeof m["id"] === "string" ? m["id"] : "";
  const repo = typeof m["repo"] === "string" ? m["repo"] : "";
  const tag = typeof m["tag"] === "string" ? m["tag"] : "";
  /* id and repo are what a preview row and an install both key off; a
   * mod-shaped entry missing either names nothing this can act on. */
  if (id === "" || repo === "") return null;
  const flagsField = m["flags"];
  const flags: Record<string, boolean> = {};
  if (flagsField !== null && typeof flagsField === "object" && !Array.isArray(flagsField)) {
    for (const [flag, v] of Object.entries(flagsField as Record<string, unknown>)) {
      if (typeof v === "boolean") flags[flag] = v;
    }
  }
  const consentsField = m["consents"];
  const consents = Array.isArray(consentsField)
    ? consentsField.filter((c): c is string => typeof c === "string")
    : undefined;
  return {
    id,
    name: typeof m["name"] === "string" && m["name"] !== "" ? m["name"] : id,
    repo,
    tag,
    version: typeof m["version"] === "string" ? m["version"] : "",
    ...(typeof m["sha"] === "string" && m["sha"] !== "" ? { sha: m["sha"] } : {}),
    enabled: m["enabled"] !== false,
    flags,
    ...(consents !== undefined ? { consents } : {}),
  };
}

function readDelveOptions(value: unknown): DelveOptions | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const o = value as Record<string, unknown>;
  const birthField = o["birth"];
  const birth =
    birthField !== null && typeof birthField === "object" && !Array.isArray(birthField)
      ? readBoolMap(birthField as Record<string, unknown>)
      : undefined;
  const game = readDelveGameOptions(o["game"]);
  if (birth === undefined && game === undefined) return undefined;
  return {
    ...(birth !== undefined ? { birth } : {}),
    ...(game !== undefined ? { game } : {}),
  };
}

function readBoolMap(o: Record<string, unknown>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

function readDelveGameOptions(value: unknown): DelveGameOptions | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const g = value as Record<string, unknown>;
  const valuesField = g["values"];
  const values =
    valuesField !== null && typeof valuesField === "object" && !Array.isArray(valuesField)
      ? readBoolMap(valuesField as Record<string, unknown>)
      : {};
  const num = (k: string, fallback: number): number => {
    const n = g[k];
    return typeof n === "number" && Number.isFinite(n) ? n : fallback;
  };
  return {
    values,
    hitpointWarn: num("hitpointWarn", 3),
    delayFactor: num("delayFactor", 40),
    lazymoveDelay: num("lazymoveDelay", 0),
  };
}

/* ------------------------------------------------------------------ *
 * Preview classification: what an imported mod's row should say, before
 * anything is fetched.
 * ------------------------------------------------------------------ */

export type DelveInstalledState = "same-version" | "different-version" | "not-installed";

/**
 * Classify one Delve entry against what is already installed, with no
 * network involved - the first thing the preview screen can say about a row.
 * `installedTag` is `InstalledModMeta.tag` for this id, or null when it is
 * not installed at all.
 */
export function classifyDelveInstalled(
  entry: Pick<DelveMod, "tag">,
  installedTag: string | null,
): DelveInstalledState {
  if (installedTag === null) return "not-installed";
  return installedTag === entry.tag ? "same-version" : "different-version";
}

/** The subset of `DiscoveredMod` (mod-discover.ts) this module reads. */
export interface DelveDiscoveredMod {
  readonly repo: string;
  readonly tag: string;
  readonly version: string;
  readonly sha?: string | null;
  readonly compatible: boolean;
  readonly engineNote: string | null;
}

/**
 * One repository lookup, exactly what `mods.ts` wires to `deps.modBrowse.discover`
 * (which itself wraps `discoverMod`, mod-discover.ts, with the player's channel
 * already applied). Kept as an injected function so this module needs no network
 * of its own and its tests need no fetch.
 *
 * GENERIC OVER THE REAL DiscoveredMod, deliberately. `M` is the caller's own
 * mod-discover.ts `DiscoveredMod` - a much wider shape than `DelveDiscoveredMod`
 * needs to read - so the object this module hands back (`DelveResolution.mod`)
 * is still exactly what `deps.modBrowse.install(mod, ...)` requires, with no
 * cast at the call site. Defaults to `DelveDiscoveredMod` for a caller (or a
 * test) that only wants the fields this module itself reads.
 */
export interface DelveDiscover<M extends DelveDiscoveredMod = DelveDiscoveredMod> {
  (ref: { readonly repo: string; readonly tag?: string }): Promise<
    { readonly ok: true; readonly mod: M } | { readonly ok: false; readonly problem: string }
  >;
}

export type DelveResolution<M extends DelveDiscoveredMod = DelveDiscoveredMod> =
  | { readonly ok: true; readonly mod: M; readonly usedRequestedTag: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * THE VERSION-MISMATCH WALK (docs/MOD_PROFILES.md, "Version mismatch"): try
 * the Delve's own named tag first; if it does not install cleanly here, fall
 * back to `discover`'s own newest-runnable search (the SAME search
 * `mod-discover.ts`'s `pickRunnableVersion` already does for "Install a
 * mod..." - reached here through the caller's `discover`, never re-walked).
 *
 * A named tag that does not EXIST at all (wrong id, deleted release) makes
 * `discover({repo, tag})` answer `ok: false` outright (mod-discover.ts:
 * a pinned tag whose manifest cannot be read at all reports the read failure
 * rather than a compatibility verdict) - which falls through to the same
 * walk, exactly as one that exists but will not run here does.
 */
export async function resolveDelveModVersion<M extends DelveDiscoveredMod = DelveDiscoveredMod>(
  entry: Pick<DelveMod, "repo" | "tag">,
  discover: DelveDiscover<M>,
): Promise<DelveResolution<M>> {
  const pinned = await discover({ repo: entry.repo, tag: entry.tag });
  if (pinned.ok && pinned.mod.compatible) {
    return { ok: true, mod: pinned.mod, usedRequestedTag: true };
  }
  const walked = await discover({ repo: entry.repo });
  if (!walked.ok) return { ok: false, reason: walked.problem };
  if (!walked.mod.compatible) {
    return {
      ok: false,
      reason:
        walked.mod.engineNote ??
        `${entry.repo}: no version of this mod runs on this build.`,
    };
  }
  return { ok: true, mod: walked.mod, usedRequestedTag: walked.mod.tag === entry.tag };
}

/* ------------------------------------------------------------------ *
 * Applying an accepted import: the enabled-set merge and the flag choices.
 * ------------------------------------------------------------------ */

/**
 * The enabled-id set after applying a Delve's ACCEPTED entries (the preview
 * rows the player left checked), in either merge mode.
 *
 * `replace` ("Replace my mod set"): the result is exactly the file's own
 * enabled ids, in file order - every mod not named in the file ends up off,
 * "matching the file exactly" (docs/MOD_PROFILES.md).
 *
 * `!replace` ("Add to my current set"): everything the player already has
 * stays, in place, EXCEPT a named mod the file itself says `enabled: false`
 * for (an explicit instruction about that one mod, honoured either way);
 * every named mod the file says `enabled: true` for is added if not already
 * present. Nothing not named in the file is touched.
 */
export function resolveDelveEnabledIds(opts: {
  readonly currentEnabled: readonly string[];
  readonly entries: readonly Pick<DelveMod, "id" | "enabled">[];
  readonly replace: boolean;
}): string[] {
  if (opts.replace) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const e of opts.entries) {
      if (e.enabled && !seen.has(e.id)) {
        out.push(e.id);
        seen.add(e.id);
      }
    }
    return out;
  }
  const named = new Map(opts.entries.map((e) => [e.id, e.enabled] as const));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of opts.currentEnabled) {
    if (named.get(id) === false) continue; // the file explicitly turns this one off
    if (!seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  for (const [id, enabled] of named) {
    if (enabled && !seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  return out;
}

/**
 * The flat flag -> boolean choices to write (one `ModStore.setRuleChoice`
 * call per entry), pooled across every accepted mod regardless of which
 * mod's block in the file it came from - the same flat namespace
 * `ModStore.getRuleChoices` already uses.
 */
export function delveFlagChoices(
  entries: readonly Pick<DelveMod, "flags">[],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const e of entries) {
    for (const [flag, v] of Object.entries(e.flags)) out[flag] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Building the export list (Save a Delve...'s checklist), and planning a
 * whole import in one pass (Load a Delve...'s preview screen).
 * ------------------------------------------------------------------ */

/**
 * Only the CHECKED ids from the export checklist end up in the Delve - an
 * unchecked mod is dropped entirely, never written with `enabled: false`
 * ("off means absent", docs/MOD_PROFILES.md). `candidates` is every ENABLED
 * mod the checklist offered; anything not enabled was never a candidate at
 * all, since the checklist only ever lists the player's current enabled set.
 */
export function selectDelveMods(
  candidates: readonly DelveMod[],
  checkedIds: ReadonlySet<string>,
): DelveMod[] {
  return candidates.filter((m) => checkedIds.has(m.id)).map((m) => ({ ...m, enabled: true }));
}

/** One row of the Load-a-Delve preview screen, after resolution. */
export interface DelvePlanRow<M extends DelveDiscoveredMod = DelveDiscoveredMod> {
  readonly entry: DelveMod;
  readonly state: DelveInstalledState;
  /**
   * Present only for a "not-installed" or "different-version" row: whether a
   * usable copy could actually be found, and at which tag. Absent for
   * "same-version" - nothing to fetch, so nothing to resolve.
   */
  readonly resolution?: DelveResolution<M>;
}

/**
 * Resolve every entry in a Delve against what is installed and, where
 * needed, against the mod's own repository - the whole preview screen's
 * data, in one pass. Each entry is resolved INDEPENDENTLY and never allowed
 * to throw: a `discover` rejection for one mod becomes that row's own
 * unreachable reason rather than losing every other row's result, the same
 * "one bad repository in a batch must not take the good ones with it" rule
 * `installModFromRepo` (mod-install.ts) already states.
 */
export async function resolveDelveImportPlan<M extends DelveDiscoveredMod = DelveDiscoveredMod>(
  entries: readonly DelveMod[],
  installed: ReadonlyMap<string, string>,
  discover: DelveDiscover<M>,
): Promise<readonly DelvePlanRow<M>[]> {
  return Promise.all(
    entries.map(async (entry): Promise<DelvePlanRow<M>> => {
      const state = classifyDelveInstalled(entry, installed.get(entry.id) ?? null);
      if (state === "same-version") return { entry, state };
      try {
        const resolution = await resolveDelveModVersion(entry, discover);
        return { entry, state, resolution };
      } catch (e) {
        return {
          entry,
          state,
          resolution: {
            ok: false,
            reason: e instanceof Error ? e.message : String(e),
          },
        };
      }
    }),
  );
}
