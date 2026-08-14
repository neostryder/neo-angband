/**
 * Who may put a rectangle of their own on the player's screen.
 *
 * THE FIFTH OWNER RUNTIME, after `frontend-runtime.ts` (the map),
 * `hud-runtime.ts` (the vitals, the messages, the status line),
 * `menu-runtime.ts` (the questions) and `screen-runtime.ts` (the full screens).
 * Same furniture as all four: one capability read from the manifest, a claim
 * that is reported by name when the hook is declared without it, a construction
 * step that cannot take the game down, and faults that name the mod.
 *
 * AND IT HAS NO SELECTION, which is the one thing that is different and the
 * reason this file is not a copy of `screen-runtime.ts` with the nouns changed.
 * The other four all answer "who wins", because the map, a HUD region, the menu
 * seam and the screen seam are each ONE THING and two mods cannot both have it.
 * A region is not one thing. Two mods declaring a region are not in contention
 * at all - they are two pieces of furniture, and they COEXIST, each at its own
 * band, in load order. So every eligible candidate is constructed, every valid
 * declaration is pushed, and the phrase "last in load order wins" appears here
 * only in its ordinary form: within a band, the later-loaded region is drawn on
 * top. That is the same rule the other four apply, in the one shape it takes
 * when the resource is not exclusive.
 *
 * WHAT IT DOES INSTEAD OF SELECTING IS VALIDATE, PER REGION. A mod hands over a
 * list, and one bad entry in that list must not cost the mod its other regions
 * or cost another mod anything at all. So the unit of failure is the
 * DECLARATION: a rectangle with no `paint`, a band that does not exist, a
 * duplicate name, a `paint` that throws on its first frame - each takes out
 * exactly one region, is reported once with the fix in the sentence, and leaves
 * the rest of the screen alone.
 *
 * A FAULTING REGION IS WITHDRAWN, not left as an empty rectangle. This is the
 * one place the mechanical answer is wrong: `ui-stack.ts` records a `paint()`
 * throw as a fault and leaves the region in the composite, which is right for a
 * core screen that still owns the keyboard and would otherwise become invisible
 * furniture the player is typing into. A mod's decorative panel has no such
 * claim - left in the stack it is a phantom OCCLUDER, and a replacement front
 * end asking `occludersOf(stack, "map")` would stand its canvas down for a
 * region that has drawn nothing since the first frame. So the handle is
 * released, and the region vanishes WITH a message rather than persisting
 * without one.
 *
 * THE ID IS NAMESPACED, and that is a correctness rule rather than tidiness. A
 * mod naming its region `map` would put a second `map` in the live stack, and
 * `occludersOf` finds the FIRST entry with a matching id - so the front end's
 * one question would silently start being answered about somebody else's
 * rectangle. `${modId}:${declared}` makes that unreachable and gives the player
 * a name they can act on when something is in the way.
 */

import { CapabilitySet, type PackManifest, type RegionDeclaration } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModPluginContext } from "./mod-plugin";
import { MOD_REGION_LAYERS, type ModRegionLayer } from "./regions";
import { pushRegion, type RegionHandle, type RegionSpec, type StackGrid } from "./ui-stack";
import type { GridSurface } from "./term";

/** What a mod must hold in its manifest before it may add a region of its own. */
export const REGION_CAPABILITY = "ui:region.create";

/**
 * The `regions()` member, TYPED LOCALLY - on purpose, and temporarily.
 *
 * It belongs on `ModPlugin` (`web/src/mod-plugin.ts`) and on the SDK's authoring
 * copy, and those two are not the only places: `validateModPlugin` and the
 * SDK's `bin/neo-angband-mod-build.mjs` each carry their own list of the ABI's
 * members, and `plugin-abi-agreement.test.ts` fails the moment those two lists
 * part. Adding the member is therefore a four-file change, and declaring it
 * structurally here keeps the runtime boundary local until those four move
 * together - exactly what `screen-runtime.ts` already does with
 * `YieldingScreen`, for the same reason.
 *
 * `api` is required rather than decorative: with only an optional member this
 * would be a WEAK TYPE, and TypeScript refuses to assign a `ModPlugin` to a
 * weak type it shares no property with. The declaration to add to all four
 * files, verbatim, is in this commit's report.
 */
export interface RegionDeclaring {
  readonly api: number;
  regions?(ctx: ModPluginContext): readonly RegionDeclaration[] | undefined;
}

export interface RegionPlugin {
  readonly id: string;
  /** Read for `capabilities` only; the loader has already validated it. */
  readonly manifest: PackManifest;
  readonly plugin: RegionDeclaring;
}

/** One region a mod asked for and got. */
export interface InstalledRegion {
  /** Whose it is. */
  readonly modId: string;
  /** The id as the live stack carries it: `${modId}:${declared}`. */
  readonly id: string;
  /** Released when the mod set changes, or by a fault in its own `paint()`. */
  readonly handle: RegionHandle;
}

type ReportFault = (id: string, message: string, error: unknown) => void;

/**
 * Whether this candidate may add regions at all: it declares `regions()` AND its
 * manifest grants `ui:region.create`.
 *
 * Declaring the hook without the capability is reported once with the fix in the
 * sentence - the same treatment `menuClaimed`, `screenClaimed` and
 * `hudRegionsClaimed` give, because a mod whose interface silently does nothing
 * is the worst outcome for everyone including the player.
 *
 * NOTE FOR ANYONE READING THE CAPABILITY: `ui:*.replace` does NOT grant this.
 * The wildcard ranges over which of the GAME's regions changes hands; adding one
 * of your own is a different sentence for a player to agree to, and until #261
 * the grant comparison ignored the action and let the wildcard carry it.
 */
export function regionsClaimed(candidate: RegionPlugin, reportFault: ReportFault = () => {}): boolean {
  if (candidate.plugin.regions === undefined) return false;
  let capabilities: CapabilitySet;
  try {
    capabilities = CapabilitySet.fromManifest(candidate.manifest);
  } catch (error) {
    reportFault(candidate.id, "its capabilities could not be read, so it cannot add regions", error);
    return false;
  }
  if (!capabilities.has(REGION_CAPABILITY)) {
    reportFault(
      candidate.id,
      `declares regions() without the "${REGION_CAPABILITY}" capability, so nothing of its own is drawn; ` +
        `add "${REGION_CAPABILITY}" to its manifest capabilities (the "ui:*.replace" wildcard does not cover it - ` +
        `replacing one of the game's regions and adding one of your own are two different consents)`,
      undefined,
    );
    return false;
  }
  return true;
}

/**
 * Every candidate that will contribute regions.
 *
 * NOT a contested-claim report, and the difference is the design statement.
 * `frontendClaimants`, `hudClaimants`, `menuClaimants` and `screenClaimants`
 * exist to tell a player that two mods are fighting over one thing. Nobody
 * fights over a region: two mods that both add furniture both get it. This is a
 * plain list of who has any, and `ContestedLayer` gains no arm for it.
 */
export function regionClaimants(candidates: readonly RegionPlugin[]): readonly string[] {
  return candidates.filter((c) => regionsClaimed(c)).map((c) => c.id);
}

/**
 * Why this declaration cannot be put on screen, or undefined when it can.
 *
 * NAMED AS A FAULT rather than returned as a boolean, for the same reason
 * `regionGridFault` is: the author needs the sentence. "Invalid region" is not
 * something anybody can act on; "layer \"system\" is reserved to the game" is.
 *
 * `system` GETS ITS OWN SENTENCE rather than falling into the general
 * bad-band one, because it is the one an author will reach for on purpose -
 * it is a real band, it is the top one, and the reason they may not have it is
 * a reason rather than a typo.
 */
export function regionDeclarationFault(declaration: unknown): string | undefined {
  if (typeof declaration !== "object" || declaration === null) {
    return `regions() returned ${String(declaration)} where a region declaration was expected`;
  }
  /* Read as UNKNOWN fields, not as a `Partial<RegionDeclaration>`. The
   * declaration arrives from a plugin.js that was never type-checked against
   * anything, so the compiler's view of what `layer` can hold is a statement
   * about the SDK rather than about this value - and under `Partial<...>` the
   * `"system"` branch below is a comparison TypeScript proves impossible and
   * rejects, which is exactly the check that has to survive. */
  const d = declaration as { readonly [K in keyof RegionDeclaration]?: unknown };
  if (typeof d.id !== "string" || d.id.length === 0) {
    return `a region has no id; give each one a short name of your own ("carried", "compass")`;
  }
  if (d.id.includes(":")) {
    /* The host owns the prefix. A declared id carrying its own colon would make
     * `my-mod:core:screen` reachable, and the live stack's names are what a
     * player and a front end both read. */
    return `region "${d.id}" has a ":" in its id; the game prefixes your mod id already, so name it "${d.id.replace(/:/gu, "-")}"`;
  }
  if (d.layer === "system") {
    return (
      `region "${d.id}" asks for the "system" layer, which is reserved to the game so that the mod manager ` +
      `and a fault report can always be drawn ABOVE a mod - including above a mod that has gone wrong. ` +
      `Use "overlay" for furniture, or "modal" for something that takes the player's attention`
    );
  }
  if (!MOD_REGION_LAYERS.includes(d.layer as ModRegionLayer)) {
    return `region "${d.id}" asks for the "${String(d.layer)}" layer; it must be one of ${MOD_REGION_LAYERS.map((l) => `"${l}"`).join(", ")}`;
  }
  if (typeof d.place !== "function") {
    return `region "${d.id}" has no place(grid); return the rectangle it should occupy on a terminal of that size`;
  }
  if (typeof d.paint !== "function") {
    /* Optional on `RegionSpec` because a core screen repaints itself from its
     * own key loop and needs no compositor pass. A mod's region has no key loop
     * and nothing else draws it, so a missing painter is a rectangle that
     * reserves space and shows nothing - which reads to the player as the mod
     * being broken, because it is. */
    return `region "${d.id}" has no paint(surface); a region with no painter reserves space and draws nothing`;
  }
  return undefined;
}

/**
 * Turn one validated declaration into a stack spec, with its fault isolation
 * already wrapped around it.
 *
 * The handle is captured by the closure rather than passed in, because it does
 * not exist until `pushRegion` has been called with this very spec. `paint`
 * cannot run before then - the compositor only reaches a region that is in the
 * stack - so the `undefined` window closes before anything can observe it.
 */
function specFor(
  modId: string,
  declaration: RegionDeclaration,
  reportFault: ReportFault,
  handleOf: () => RegionHandle | undefined,
): RegionSpec {
  let broken = false;
  return {
    id: `${modId}:${declaration.id}`,
    layer: declaration.layer,
    /* Forwarded rather than passed through: `ui-stack` already calls this inside
     * a try/catch and turns a throw into a placement fault with the numbers in
     * it, which is the right treatment for a rectangle that cannot be computed
     * and is not worth a second, differently-worded one here. */
    place: (grid) => declaration.place(grid),
    paint: (surface: GridSurface) => {
      if (broken) return;
      try {
        declaration.paint(surface);
      } catch (error) {
        /* ONCE, and then out. A painter that throws on one frame throws on all
         * of them, and a fault report per frame is a worse experience than one
         * report and a region that is gone. */
        broken = true;
        reportFault(
          modId,
          `its "${declaration.id}" region failed while drawing and has been removed for this session; ` +
            `paint(surface) must not throw`,
          error,
        );
        /* WITHDRAWN, not left empty. See this module's header: a region left in
         * the composite is a phantom occluder, and a replacement front end would
         * stand its canvas down for a rectangle that draws nothing. */
        handleOf()?.release();
      }
    },
  };
}

/**
 * Construct every eligible candidate's regions and put them on the stack.
 *
 * EVERY candidate, in load order, because nobody wins here - see this module's
 * header. Claims are read for all of them so a mod that declared `regions()` and
 * forgot the capability hears about it, rather than its mistake becoming
 * invisible because somebody else drew something.
 *
 * `on` is the terminal as the caller has just measured it, forwarded to
 * `pushRegion` for the reason that function documents: the first push commonly
 * happens before any relayout, and a region faulted against a 0x0 grid would be
 * blamed on its author for the host's timing.
 */
export function installRegions(
  candidates: readonly RegionPlugin[],
  contextFor: (id: string) => ModPluginContext,
  reportFault: ReportFault,
  on?: StackGrid,
): readonly InstalledRegion[] {
  const out: InstalledRegion[] = [];
  for (const candidate of candidates) {
    if (!regionsClaimed(candidate, reportFault)) continue;
    let returned: readonly RegionDeclaration[] | undefined;
    try {
      returned = candidate.plugin.regions!.call(candidate.plugin, contextFor(candidate.id));
    } catch (error) {
      reportFault(candidate.id, "regions() failed, so none of its regions are on screen", error);
      continue;
    }
    if (returned === undefined) continue;
    if (!Array.isArray(returned)) {
      reportFault(candidate.id, "regions() did not return a list of region declarations; nothing of its own is drawn", returned);
      continue;
    }
    /* Per MOD rather than global: two mods may both call a region "carried",
     * and they do not collide because the live ids carry the mod. */
    const seen = new Set<string>();
    for (const declaration of returned) {
      const fault = regionDeclarationFault(declaration);
      if (fault !== undefined) {
        reportFault(candidate.id, fault, undefined);
        continue;
      }
      if (seen.has(declaration.id)) {
        reportFault(
          candidate.id,
          `declares two regions called "${declaration.id}"; only the first is on screen, because the live ` +
            `stack is addressed by name and two entries under one name make "what is covering this" ambiguous`,
          undefined,
        );
        continue;
      }
      seen.add(declaration.id);
      /* A box rather than a `let`, because the spec has to be able to reach the
       * handle and the handle does not exist until `pushRegion` has been given
       * the spec. One of the two has to be indirect; a one-field object says so
       * at the point of use, where a forward-declared binding would look like an
       * ordinary variable that a reader has to trace to find out otherwise. */
      const held: { handle?: RegionHandle } = {};
      const spec = specFor(candidate.id, declaration, reportFault, () => held.handle);
      held.handle = pushRegion(spec, on);
      out.push({ modId: candidate.id, id: spec.id, handle: held.handle });
    }
  }
  return out;
}
