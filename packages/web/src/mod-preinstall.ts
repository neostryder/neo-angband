/**
 * The pre-install summary: what a pasted repository would actually do, before
 * a single byte is stored (docs/modding/MOD_LIFECYCLE.md, "From a git
 * repository" - the paste-a-URL door, mod-browse.ts's "Add from a repository
 * address").
 *
 * Discovery (mod-discover.ts) already answers what a mod IS: its name,
 * version, size, and whether it will even load here. What it does not answer
 * is what installing it would DO to a player's existing setup - the question
 * this module exists to answer, from data discovery already has plus one
 * extra read of the mod's own content files:
 *
 *   - what it ADDS: new records, by content file.
 *   - what it PATCHES, REPLACES or REMOVES, and whose record that is - so a
 *     compatibility patch aimed at a mod the player does not have enabled
 *     says so, instead of silently doing nothing.
 *   - its capabilities, in the SAME plain language capability-describe.ts
 *     already uses for the enable-time consent screen. Not a second copy of
 *     that wording - imported from it.
 *   - whether it, or anything the player has enabled, DECLARES a conflict
 *     with the other (mod-conflicts.ts's declaredConflicts, reused rather
 *     than reimplemented).
 *
 * WHY THE CONTENT SCAN IS SEPARATE FROM DISCOVERY. Every row of a mod list
 * calls discoverMod, so discovery deliberately fetches only manifest.json and
 * a tree listing - fetching every content file for every row in "Recommended
 * mods" would multiply the request count for no reason nobody asked to pay.
 * This module's fetch only ever runs once, for the ONE repository a player
 * just pasted a URL for, right before the confirm screen.
 *
 * NOT ATTEMPTED: composing the candidate's content against the player's
 * already-enabled mods (mod-sdk's computeConflictReport / resolveLoadOrder).
 * That needs the candidate to already look like an installed, dependency-
 * checked pack, which is exactly what has not happened yet - and folding an
 * unvalidated remote candidate into a full load-order resolution risks
 * failing for reasons that have nothing to do with what this screen is
 * asking. Reporting each patched/replaced/removed ref's OWNER, and whether
 * that owner is currently enabled, answers "does this do anything with what
 * I have installed" honestly without needing that machinery.
 */

import type { DeclaredConflict, PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { describeCapabilities, type CapabilityDescription } from "./capability-describe";
import { declaredConflicts } from "./mod-conflicts";
import type { DiscoveredMod } from "./mod-discover";

/** One record a candidate mod's content touches, and whose record it is. */
export interface RecordTouch {
  /** The record reference, e.g. "core:kobold". */
  readonly ref: string;
  /** The content file the touch was declared in (e.g. "monster.json"). */
  readonly file: string;
  /** The `<owner>` half of `ref` - "core", or another mod's id. */
  readonly owner: string;
  /** Whether `owner` is "core", the candidate itself, or a currently enabled mod. */
  readonly ownerEnabled: boolean;
}

/** What a candidate mod's own content files declare, read straight from them. */
export interface ContentTouches {
  /** New records the mod adds, one entry per content file that adds any. */
  readonly adds: readonly { readonly file: string; readonly count: number }[];
  readonly patches: readonly RecordTouch[];
  readonly replaces: readonly RecordTouch[];
  readonly removes: readonly RecordTouch[];
  /**
   * Content files that could not be read or parsed, so the summary can say
   * "this could not be checked" rather than silently under-reporting. Never
   * fails the summary as a whole: one bad file is that file's problem, the
   * way `pack.ts`'s readPack treats one bad record file as that file's
   * problem rather than the whole pack's.
   */
  readonly unreadable: readonly { readonly file: string; readonly problem: string }[];
}

/** Everything the pre-install summary screen shows beyond what a browse row already does. */
export interface PreInstallSummary {
  readonly capabilities: readonly CapabilityDescription[];
  readonly license: string | null;
  /** Declared `conflicts` claims that apply once this mod is added to the player's set. */
  readonly conflicts: readonly DeclaredConflict[];
  readonly content: ContentTouches;
}

/** The `<owner>` half of a namespaced ref ("core:kobold" -> "core"). */
function ownerOf(ref: string): string {
  const at = ref.indexOf(":");
  return at === -1 ? ref : ref.slice(0, at);
}

const SKIPPED_CONTENT_FILES = new Set(["manifest.json", "load-order.json"]);

/**
 * Whether a payload path is a content record file worth reading - a declared
 * or guessed FILE entry, JSON, and neither the manifest itself nor the
 * directory-level load order file. Mirrors disk-packs.ts's readPack, which
 * applies the identical filter to a locally-installed pack's files.
 */
function isContentPayloadPath(path: string): boolean {
  if (!path.toLowerCase().endsWith(".json")) return false;
  const base = (path.split("/").pop() ?? path).toLowerCase();
  return !SKIPPED_CONTENT_FILES.has(base);
}

/** The shape of one content file this module reads (compose.ts's FileContribution). */
interface RawFileContribution {
  readonly records?: unknown;
  readonly patches?: unknown;
  readonly replaces?: unknown;
  readonly removes?: unknown;
  readonly sections?: unknown;
}

/** Tally one FileContribution-shaped object into `into`, recursing into `sections`. */
function collectTouches(
  file: string,
  body: RawFileContribution,
  enabledIds: ReadonlySet<string>,
  modId: string,
  into: {
    adds: { file: string; count: number }[];
    patches: RecordTouch[];
    replaces: RecordTouch[];
    removes: RecordTouch[];
  },
): void {
  const touch = (ref: string): RecordTouch => {
    const owner = ownerOf(ref);
    return {
      ref,
      file,
      owner,
      ownerEnabled: owner === "core" || owner === modId || enabledIds.has(owner),
    };
  };

  if (Array.isArray(body.records) && body.records.length > 0) {
    into.adds.push({ file, count: body.records.length });
  }
  if (typeof body.patches === "object" && body.patches !== null && !Array.isArray(body.patches)) {
    for (const ref of Object.keys(body.patches)) into.patches.push(touch(ref));
  }
  if (typeof body.replaces === "object" && body.replaces !== null && !Array.isArray(body.replaces)) {
    for (const ref of Object.keys(body.replaces)) into.replaces.push(touch(ref));
  }
  if (Array.isArray(body.removes)) {
    for (const ref of body.removes) if (typeof ref === "string") into.removes.push(touch(ref));
  }
  /* A section is an ordinary FileContribution attributed to a named part of the
   * pack (MOD_LIFECYCLE.md, "Sections"); its own patches/replaces/removes are
   * real touches too, so they are folded in under the same file rather than
   * dropped for not being at the top level. */
  if (typeof body.sections === "object" && body.sections !== null && !Array.isArray(body.sections)) {
    for (const section of Object.values(body.sections as Record<string, unknown>)) {
      if (typeof section === "object" && section !== null && !Array.isArray(section)) {
        collectTouches(file, section as RawFileContribution, enabledIds, modId, into);
      }
    }
  }
}

/**
 * Read one candidate mod's own declared content, at its pinned tag, and tally
 * what it adds, patches, replaces and removes.
 *
 * `readRepoFile` is injected so this needs no real network: it is handed the
 * repo, tag and path exactly as mod-install.ts's own fetch loop uses them
 * (`rawUrl(mod.repo, mod.tag, entry.path)`), and is expected to throw or
 * reject on anything that is not a 2xx body.
 */
export async function candidateContentTouches(
  mod: DiscoveredMod,
  enabledIds: ReadonlySet<string>,
  readRepoFile: (repo: string, tag: string, path: string) => Promise<string>,
): Promise<ContentTouches> {
  const adds: { file: string; count: number }[] = [];
  const patches: RecordTouch[] = [];
  const replaces: RecordTouch[] = [];
  const removes: RecordTouch[] = [];
  const unreadable: { file: string; problem: string }[] = [];

  for (const entry of mod.payload) {
    if (entry.kind !== "file" || !isContentPayloadPath(entry.path)) continue;
    let text: string;
    try {
      text = await readRepoFile(mod.repo, mod.tag, entry.path);
    } catch (e) {
      unreadable.push({ file: entry.path, problem: e instanceof Error ? e.message : String(e) });
      continue;
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (e) {
      unreadable.push({
        file: entry.path,
        problem: `not valid JSON (${e instanceof Error ? e.message : String(e)})`,
      });
      continue;
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) continue;
    collectTouches(entry.path, body as RawFileContribution, enabledIds, mod.id, {
      adds,
      patches,
      replaces,
      removes,
    });
  }

  return { adds, patches, replaces, removes, unreadable };
}

/**
 * A stand-in PackManifest carrying only what `declaredConflicts` reads: the
 * candidate's own id and compat claims. Never stored or composed - built
 * fresh here so the existing conflict check can be asked about a mod that is
 * not installed yet, without a second implementation of what a "conflicts"
 * claim means.
 */
function candidateManifestFacade(mod: DiscoveredMod): PackManifest {
  return { id: mod.id, compat: mod.compat ?? [] } as unknown as PackManifest;
}

/**
 * Build the full pre-install summary for one discovered, compatible mod.
 *
 * `enabledManifests` is the player's current enabled set (in whatever order
 * the caller has it in - order does not matter here, only membership does).
 */
export async function buildPreInstallSummary(
  mod: DiscoveredMod,
  enabledManifests: readonly PackManifest[],
  readRepoFile: (repo: string, tag: string, path: string) => Promise<string>,
): Promise<PreInstallSummary> {
  const enabledIds = new Set(enabledManifests.map((m) => m.id));
  const content = await candidateContentTouches(mod, enabledIds, readRepoFile);
  return {
    capabilities: describeCapabilities(mod.capabilities ?? []),
    license: mod.license ?? null,
    /* Both directions in one call: the candidate's OWN `conflicts` claims
     * against something already enabled, and an already-enabled mod's claim
     * against the candidate - declaredConflicts finds both once the
     * candidate is in the same list (see its own doc comment). */
    conflicts: declaredConflicts([...enabledManifests, candidateManifestFacade(mod)]),
    content,
  };
}
