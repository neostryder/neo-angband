/**
 * The host half of the resource seam: find what the enabled mods offer, ask this
 * machine whether it can use it, and hand the survivors to the five consumers.
 *
 * mod-sdk's resources.ts holds the rule that is the same everywhere - is the
 * declaration well-formed, and who wins when two mods offer the same thing. This
 * file holds the question that has no answer until you are standing on the
 * machine: CAN THESE BYTES BE USED HERE. Those are different questions and they
 * fail differently. A path escaping the mod folder is wrong on every computer
 * and is caught by reading the manifest. Whether an `.ogg` plays depends on the
 * browser, its codecs, and whether the file is what its name claims - and only
 * opening it will say.
 *
 * ## Three checks, cheapest first
 *
 * 1. THE DECLARATION (`resourceComplaint`, mod-sdk). Free, and catches the
 *    author's mistakes: an unknown kind, a `..` in a path, a `.mp4` declared as
 *    art, a slot no screen paints.
 * 2. THE INVENTORY. Free as well, and this is the one that catches the mistake
 *    authors actually make - a typo in a filename. A pack read from a folder or
 *    from IndexedDB arrives with a list of every file it holds (`DiskPack.assets`),
 *    so "does `sounds/hit.mp3` exist" is a set lookup rather than a request. It
 *    is unavailable for a BUNDLED mod, whose files are copied into the site
 *    rather than enumerated; check 3 catches those instead, which is why it is
 *    absence and not failure when there is no inventory to consult.
 * 3. THE RUNTIME. Costs a fetch or a decode, and is the only one that can answer
 *    "this build cannot play Vorbis" or "this JSON is not a font". Injected
 *    (ResourceRuntime) so the decisions are testable without a browser, because
 *    a decision made only inside a DOM call is a decision no test can reach.
 *
 * ## What failing costs
 *
 * The resource, never the mod - see resources.ts for the argument. What matters
 * at this end is that the refusal is REPORTED: an unusable resource that falls
 * back silently is indistinguishable from a mod that does nothing, which is the
 * single most common thing a mod author gets an unreproducible bug report about.
 * Every refusal goes to reportModFault, so it lands on that mod's own row in the
 * manager beside everything else known about it.
 *
 * ## Why the result is latched
 *
 * Verification is asynchronous - it fetches - and every consumer is synchronous:
 * the terminal wants its font while constructing, the title screen wants its art
 * while painting. So `installModResources` runs once at boot and the accessors
 * below read what it latched. That is the same shape mod-code.ts and
 * mod-problems.ts already use, and it is sound for the same reason: enabling or
 * disabling a mod takes effect on RELOAD, so nothing can change underneath it
 * within a run.
 */

import {
  chooseResources,
  extensionOf,
  localeFileComplaint,
  localeFileTag,
  RESOURCE_KINDS,
  resourceComplaint,
  type ContributedResource,
  type PackResource,
  type ResourceKind,
} from "@rpgm-tools/neo-angband-mod-sdk";
import type { DiskPackReport } from "./disk-packs";
import { urlBaseResolver, type PackFileResolver } from "./pack-files";
import { engineAllows } from "./mod-engine";
import { reportModFault, type ModProblem } from "./mod-problems";
import { discoverMods, type ModAssetSource } from "./tile-mods";
import type { BitmapFontData } from "./font-16x24";

/** One resource a mod offers, with everything needed to reach and name it. */
export interface LocatedResource {
  readonly modId: string;
  /** The mod's display name, for a message and for a menu row. */
  readonly modName: string;
  readonly resource: PackResource;
  /**
   * Reaches this mod's files by MOD-relative path - so `resolve(resource.path)`
   * is the resource itself, and `resolve(`${path}/${name}`)` is one file inside a
   * directory resource.
   *
   * Null when the mod's source cannot serve assets at all (a data-only source).
   * That is a real state and not a failure of this module: such a mod's records
   * still compose, and only its resources are out of reach.
   */
  readonly resolve: PackFileResolver | null;
}

/** A mod manifest's `resources`, read tolerantly from raw JSON. */
function readResources(raw: unknown): unknown[] {
  const list = (raw as { resources?: unknown } | null)?.resources;
  return Array.isArray(list) ? list : [];
}

function readModName(raw: unknown, id: string): string {
  const name = (raw as { name?: unknown } | null)?.name;
  return typeof name === "string" && name.trim() !== "" ? name : id;
}

function readEngineRange(raw: unknown): string | undefined {
  const e = (raw as { engine?: unknown } | null)?.engine;
  return typeof e === "string" ? e : undefined;
}

/**
 * Every resource the enabled mods declare, arbitrated, plus what was refused
 * before any bytes were touched.
 *
 * Pure over already-discovered inputs, exactly as `enabledTileModes` is, so the
 * whole selection - gate, complaint, merge, shadowing - is testable with no
 * browser and no mods folder. That matters more here than usual: a SHADOWED
 * resource is invisible by construction, and a test is the only thing that can
 * see one.
 */
export function locateResources(input: {
  manifests: ReadonlyMap<string, unknown>;
  sources: ReadonlyMap<string, ModAssetSource>;
  enabledIds: readonly string[];
}): { located: LocatedResource[]; problems: ModProblem[] } {
  const problems: ModProblem[] = [];
  const contributions: ContributedResource[] = [];
  const names = new Map<string, string>();

  for (const id of input.enabledIds) {
    const raw = input.manifests.get(id);
    if (!raw) continue;
    /* The engine gate, on the resources door, with the same single
     * implementation the content, code and tiles doors use. A gate only three of
     * four doors check is not a gate - which is the exact hole mod-engine.ts was
     * written to close, back when only the plugin loader had one. */
    const range = readEngineRange(raw);
    /* `modApi` GOES THROUGH TOO, and leaving it out was a real defect the test
     * beside this caught: it is the field that decides whether a mismatched
     * range GATES the pack or merely labels it, because it is declared by
     * exactly the packs that ship a plugin.js. Passing only `engine` makes every
     * pack look like data, so a code pack written for a build this is not would
     * have been waved through here while the content and code doors refused it -
     * a gate that disagrees with itself depending on which door you knock on. */
    const modApi = (raw as { modApi?: unknown } | null)?.modApi;
    if (
      !engineAllows({
        id,
        ...(range === undefined ? {} : { engine: range }),
        ...(typeof modApi === "number" ? { modApi } : {}),
      })
    ) {
      continue;
    }
    names.set(id, readModName(raw, id));
    for (const entry of readResources(raw)) {
      const complaint = resourceComplaint(entry, id);
      if (complaint !== null) {
        problems.push({ id, why: complaint });
        continue;
      }
      contributions.push({ modId: id, resource: entry as PackResource });
    }
  }

  const { chosen, shadowed } = chooseResources(contributions);
  for (const loser of shadowed) {
    const spec = RESOURCE_KINDS[loser.resource.kind];
    problems.push({
      id: loser.modId,
      why:
        `its ${spec.describe} (${loser.resource.path}) is not in use - another mod ` +
        `later in the load order supplies one too, and the last one wins. Move this ` +
        `mod later to make it the one that applies.`,
    });
  }

  const located = chosen.map((c) => {
    const source = input.sources.get(c.modId);
    return {
      modId: c.modId,
      modName: names.get(c.modId) ?? c.modId,
      resource: c.resource,
      resolve: source === undefined ? null : modRootResolver(source, c.modId),
    } satisfies LocatedResource;
  });
  return { located, problems };
}

/**
 * Reach a mod's own files by mod-relative path - the MOD ROOT, not any
 * subdirectory of it.
 *
 * Deliberately not `tilePackResolver`, which is the same idea rooted one level
 * down: a tile pack is a directory inside a mod, so that function requires a
 * `path` and refuses an empty one. A resource is addressed from the mod root,
 * because a sound pack has to reach the files inside itself and a file resource
 * is one resolve away. The two cases mirror ModAssetSource's two kinds for the
 * same reason they do there: a bundled mod has a real site path, and everything
 * else has only a function that mints URLs a file at a time.
 */
function modRootResolver(source: ModAssetSource, modId: string): PackFileResolver {
  if (source.kind === "bundle") return urlBaseResolver(`${source.base}/${modId}`);
  const assetUrl = source.assetUrl;
  return (rel) => assetUrl(modId, rel);
}

/**
 * What the host can be asked about a file, injected so every decision below is
 * reachable from a test.
 *
 * Two questions rather than one `probe(url)`, because they cost differently and
 * one of them needs no request at all: `canPlayAudio` consults the platform's
 * codec table, and only `readText` touches the network.
 *
 * There is no image question, because there is no image resource - every kind a
 * mod can supply is text or a directory of samples. See RESOURCE_KINDS' `art`
 * entry for why the splash is `.txt`.
 */
export interface ResourceRuntime {
  /** The file's text, or null if it cannot be read at all. */
  readText(url: string): Promise<string | null>;
  /** Whether this build claims it can play this audio MIME type. */
  canPlayAudio(mime: string): boolean;
}

/**
 * The audio types a sound pack may be made of - the same two `sound.ts` asks
 * the engine for, in the same order.
 *
 * Derived from one place rather than two would be better, and cannot be: the
 * core's SoundFileType list is extensions and the codec table wants MIME types,
 * and there is no mapping either side owns. Kept adjacent and short instead.
 */
const SOUND_FORMATS: readonly { ext: string; mime: string }[] = [
  { ext: ".mp3", mime: "audio/mpeg" },
  { ext: ".ogg", mime: "audio/ogg" },
];

/**
 * Whether these bytes are a bitmap font the terminal can actually draw from.
 *
 * A REAL structural check and not a `typeof`: `BitmapFontData` is a cell size
 * plus one row of scanline bit masks per glyph, and a JSON that parses but whose
 * `glyphs` rows are the wrong length would draw garbage in every cell of the
 * screen. A font is the single resource whose failure is total - there is no
 * "this one glyph did not load" - so it is the one worth checking hardest.
 */
export function bitmapFontComplaint(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "is not a bitmap font object";
  }
  const f = value as Record<string, unknown>;
  const w = f["w"];
  const h = f["h"];
  if (typeof w !== "number" || !Number.isInteger(w) || w < 1 || w > 32) {
    /* 32 because a scanline is stored as ONE number used as a bit mask, and the
     * terminal reads bits 0..w-1 out of it; a wider cell would need a
     * representation this font format does not have. */
    return `has cell width ${String(w)}, which is not a whole number of 1..32 pixels`;
  }
  if (typeof h !== "number" || !Number.isInteger(h) || h < 1 || h > 64) {
    return `has cell height ${String(h)}, which is not a whole number of 1..64 pixels`;
  }
  const glyphs = f["glyphs"];
  if (!Array.isArray(glyphs) || glyphs.length === 0) {
    return "has no glyphs";
  }
  for (let i = 0; i < glyphs.length; i++) {
    const row = glyphs[i];
    if (!Array.isArray(row) || row.length !== h) {
      return (
        `has a glyph (#${i}) with ${Array.isArray(row) ? String(row.length) : "no"} ` +
        `scanlines where the declared cell height is ${String(h)}`
      );
    }
    for (const scan of row) {
      if (typeof scan !== "number" || !Number.isInteger(scan) || scan < 0) {
        return `has a glyph (#${i}) whose scanlines are not whole non-negative numbers`;
      }
    }
  }
  return null;
}

/** A pack-relative path set per mod, for the free existence check. */
export type ResourceInventory = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Which files each disk pack holds, so a declared path can be checked without a
 * request. Bundled mods are absent by construction - their files are copied into
 * the site rather than listed - and absence means "no inventory", not "empty".
 */
export function inventoryOf(disk: DiskPackReport): ResourceInventory {
  const out = new Map<string, ReadonlySet<string>>();
  for (const pack of disk.packs) {
    out.set(pack.manifest.id, new Set(pack.assets));
  }
  return out;
}

/** Why this resource cannot be used here, or null when it can. */
export async function verifyResource(
  located: LocatedResource,
  runtime: ResourceRuntime,
  inventory: ResourceInventory,
): Promise<string | null> {
  const { resource } = located;
  const spec = RESOURCE_KINDS[resource.kind];
  const files = inventory.get(located.modId);

  if (located.resolve === null) {
    return (
      `declares ${spec.describe} (${resource.path}) but the place it was installed ` +
      `from cannot serve files, so it cannot be loaded`
    );
  }

  if (spec.directory) {
    /* A DIRECTORY cannot be fetched and cannot be probed, so the two checks that
     * apply are the inventory (does it hold anything of the right type) and the
     * codec table (could we play it if it did). */
    const playable = SOUND_FORMATS.filter((f) => runtime.canPlayAudio(f.mime));
    if (playable.length === 0) {
      return (
        `supplies ${spec.describe} and this build can play none of ` +
        `${SOUND_FORMATS.map((f) => f.ext).join(" or ")}, so it stays silent`
      );
    }
    if (files !== undefined) {
      const prefix = resource.path === "." ? "" : `${resource.path}/`;
      const found = [...files].some(
        (p) => p.startsWith(prefix) && playable.some((f) => extensionOf(p) === f.ext),
      );
      if (!found) {
        return (
          `declares ${spec.describe} at "${resource.path}", and no ` +
          `${playable.map((f) => f.ext).join(" or ")} file is there`
        );
      }
    }
    return null;
  }

  if (files !== undefined && !files.has(resource.path)) {
    /* The typo check, and the reason the inventory is worth having: this is the
     * mistake authors actually make, and without it the only symptom is a mod
     * that appears to load and does nothing. */
    return `declares ${spec.describe} at "${resource.path}", and there is no such file in it`;
  }

  const url = await located.resolve(resource.path);
  if (url === null) {
    return `declares ${spec.describe} at "${resource.path}", which could not be reached`;
  }

  const text = await runtime.readText(url);
  if (text === null) {
    return `declares ${spec.describe} at "${resource.path}", which could not be read`;
  }
  if (resource.kind === "font" || resource.kind === "locale") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return `supplies ${spec.describe} "${resource.path}" that is not valid JSON (${message(e)})`;
    }
    if (resource.kind === "font") {
      const complaint = bitmapFontComplaint(parsed);
      if (complaint !== null) {
        return (
          `supplies a font "${resource.path}" that ${complaint} - this terminal draws ` +
          `from a bitmap, so a font is {w, h, glyphs} with one scanline number per row`
        );
      }
    } else {
      const complaint = localeFileComplaint(parsed, resource.path);
      if (complaint !== null) return complaint;
      /* THE SLOT AND THE FILE ARE TWO STATEMENTS OF THE SAME FACT, and they can
       * disagree. The slot is what arbitrates between two mods and puts the row
       * in the language menu; the tag inside is what the game switches to. A
       * file saying `de` behind a slot saying `fr` would be offered as French
       * and read as German, which is the sort of wrong nobody would think to
       * look for. */
      const tag = localeFileTag(parsed);
      if (tag !== resource.slot) {
        return (
          `supplies a translation declared for "${String(resource.slot)}" whose file ` +
          `says "${String(tag)}" - the slot and the file's own tag must agree`
        );
      }
    }
  }
  return null;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** What survived, and the sentence for each thing that did not. */
export interface VerifiedResources {
  readonly usable: readonly LocatedResource[];
  readonly refused: readonly ModProblem[];
}

/** Run every resource past the three checks, concurrently. */
export async function verifyResources(
  located: readonly LocatedResource[],
  runtime: ResourceRuntime,
  inventory: ResourceInventory,
): Promise<VerifiedResources> {
  const verdicts = await Promise.all(
    located.map(async (r) => {
      try {
        return { r, why: await verifyResource(r, runtime, inventory) };
      } catch (e) {
        /* A probe that THROWS is a refusal and not a crash. Every call in here
         * reaches the network or a decoder, and neither is required to behave;
         * letting one rejected promise take down boot would make a mod's broken
         * PNG a game that does not start. */
        return { r, why: `could not be checked (${message(e)})` };
      }
    }),
  );
  return {
    usable: verdicts.filter((v) => v.why === null).map((v) => v.r),
    refused: verdicts
      .filter((v) => v.why !== null)
      .map((v) => ({ id: v.r.modId, why: v.why as string })),
  };
}

/** The browser's answers, and the only part of this file a test cannot drive. */
export function browserResourceRuntime(): ResourceRuntime {
  return {
    readText: async (url) => {
      try {
        const res = await fetch(url);
        return res.ok ? await res.text() : null;
      } catch {
        return null;
      }
    },
    canPlayAudio: (mime) => {
      try {
        /* "maybe" counts. The spec's three answers are "", "maybe" and
         * "probably", and a browser says "maybe" for formats it plays perfectly
         * well - treating anything short of "probably" as a refusal would mute
         * every sound pack on several real browsers. */
        return new Audio().canPlayType(mime) !== "";
      } catch {
        return false;
      }
    },
  };
}

/* --- What boot latched, and the five readers of it ------------------------ */

let installed: readonly LocatedResource[] = [];

/**
 * Discover, gate, verify and latch the enabled mods' resources. Call once, early
 * in boot, before the terminal is constructed - a font arriving after that would
 * need the whole screen torn down and rebuilt.
 *
 * Never throws and never blocks boot on a mod: everything it learns becomes a
 * line on a mod's row, and the game carries on with core's own resources, which
 * is what would have happened had the mod not been installed.
 */
export async function installModResources(
  runtime: ResourceRuntime = browserResourceRuntime(),
): Promise<VerifiedResources> {
  try {
    const discovered = discoverMods();
    const { located, problems } = locateResources(discovered);
    for (const p of problems) if (p.id !== null) reportModFault(p.id, p.why);
    const verified = await verifyResources(located, runtime, inventoryOf(discovered.disk));
    for (const p of verified.refused) if (p.id !== null) reportModFault(p.id, p.why);
    installed = verified.usable;
    return verified;
  } catch (e) {
    /* Discovery itself failing (an unreadable mods folder, a storage error) is
     * not a mod's fault and has nowhere to be attributed, so it goes where the
     * unattributed problems go rather than being hung on an arbitrary mod. */
    reportModFault("mods", `resources could not be discovered (${message(e)})`);
    installed = [];
    return { usable: [], refused: [] };
  }
}

/** Everything usable, for tests and for the mod manager's detail view. */
export function activeModResources(): readonly LocatedResource[] {
  return installed;
}

/** Replace the latched set, for tests. */
export function setModResources(resources: readonly LocatedResource[]): void {
  installed = resources;
}

/** Forget everything, so a test starts where a fresh boot does. */
export function resetModResources(): void {
  installed = [];
}

/**
 * The single winner of a `one`-merge kind, or null when no mod supplies it.
 *
 * `chooseResources` has already left at most one of these in the set, so this
 * takes the first rather than arbitrating again - two spellings of the winner
 * rule is how the two come to disagree.
 */
function soleResource(kind: ResourceKind): LocatedResource | null {
  return installed.find((l) => l.resource.kind === kind) ?? null;
}

/**
 * Where the winning sound pack's samples live, or null for core's own.
 *
 * A base URL rather than the resolver, because the sound engine builds
 * `${base}${name}${ext}` for 149 samples and asking it to await a resolver per
 * sample would put an async hop inside a synchronous load hook. A resolver that
 * cannot produce a stable base (IndexedDB, whose URLs are minted per blob)
 * yields null here and the pack simply is not used - which is honest, and better
 * than 149 blob URLs held open for the life of the process.
 */
export async function modSoundBase(): Promise<string | null> {
  const pack = soleResource("sound");
  if (pack === null || pack.resolve === null) return null;
  const probe = await pack.resolve(
    pack.resource.path === "." ? "" : `${pack.resource.path}/`,
  );
  return probe;
}

/** The winning terminal font's JSON text, or null for core's bitmap font. */
export async function modFontData(): Promise<BitmapFontData | null> {
  const pack = soleResource("font");
  if (pack === null || pack.resolve === null) return null;
  const url = await pack.resolve(pack.resource.path);
  if (url === null) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const parsed: unknown = await res.json();
    /* CHECKED AGAIN, at the point of use. Verification ran at boot against the
     * same bytes, so this should never fire - but "should never fire" is exactly
     * the claim that decays, and the cost of being wrong is a screen of garbage
     * rather than a message. */
    return bitmapFontComplaint(parsed) === null ? (parsed as BitmapFontData) : null;
  } catch {
    return null;
  }
}

/**
 * The art a mod supplies for a named slot, as its lines, or null for core's.
 *
 * Lines rather than a URL because the consumer is a TERMINAL: art here is
 * `{colour}...{/}` markup painted row by row, which is what upstream's own
 * news.txt is. Trailing `\r` is dropped so a file authored on Windows does not
 * paint a stray glyph at the end of every row.
 */
export async function modArtLines(slot: string): Promise<string[] | null> {
  const found = installed.find(
    (l) => l.resource.kind === "art" && l.resource.slot === slot,
  );
  if (found === undefined || found.resolve === null) return null;
  const url = await found.resolve(found.resource.path);
  if (url === null) return null;
  const text = await browserResourceRuntime().readText(url);
  return text === null ? null : text.split("\n").map((l) => l.replace(/\r$/u, ""));
}

/** Every pref file the enabled mods supply, in load order. */
export function modPrefResources(): readonly LocatedResource[] {
  return installed.filter((l) => l.resource.kind === "prefs");
}

/** Every help page the enabled mods supply. */
export function modHelpResources(): readonly LocatedResource[] {
  return installed.filter((l) => l.resource.kind === "help");
}

/** Every translation the enabled mods supply, one per language tag. */
export function modLocaleResources(): readonly LocatedResource[] {
  return installed.filter((l) => l.resource.kind === "locale");
}
