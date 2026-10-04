/**
 * Who draws each part of the HUD.
 *
 * The companion to `frontend-runtime.ts`, and deliberately the same shape - core
 * as candidate zero, last eligible candidate in load order wins, a fault hands
 * the work back to core mid-session. One thing is different, and it is the whole
 * point of this file: **ownership is per REGION**.
 *
 * WHY PER REGION. The map has one owner because it is one thing. The HUD is not:
 * the message line, the vitals and the status line are three answers to three
 * questions, and a mod that wants to draw hit points as a bar has no business
 * taking the message log with it. That follows the rule that a screen is
 * COMPOSED of regions rather than covering them (2026-08-13), and it is why the
 * capability is `ui:sidebar.replace` rather than one grant over "the interface":
 * a player consenting is told which part of their screen is changing hands.
 *
 * THE CAPABILITY IS THE CLAIM, which is what lets selection happen BEFORE any
 * candidate is invoked. `frontend-runtime.ts` needs that rule so a losing front
 * end cannot mount a canvas it will never draw into; the same rule has to hold
 * here, and per-region ownership would break it if a claim could only be
 * discovered by calling `hud()` and looking at the keys. So the manifest decides
 * who is selected and the call decides what is delivered: a selected owner that
 * returns no sink for its region simply leaves that region with core, exactly as
 * a declining `frontend()` leaves the map with core. The consequence worth
 * knowing is that ownership does NOT fall through to the next claimant - ask for
 * the regions you actually draw.
 *
 * A SINK FOR A REGION THAT WAS NOT GRANTED IS REFUSED and reported by name. The
 * gate would otherwise be advisory: nothing stops a returned object having three
 * keys when its manifest asked for one.
 */

import { CapabilitySet, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModPlugin, ModPluginContext } from "./mod-plugin";
import {
  hudSections,
  snapshotHudFrame,
  HUD_SECTION_NAMES,
  type HudFrame,
  type HudFrameSink,
  type HudOwnership,
  type HudSection,
  type HudSectionName,
  type HudSectionSink,
} from "./hud-view";

/** Candidate zero's id: the game's own glyph terminal, as a HUD owner. */
export const CORE_HUD_ID = "core";

/** What a mod must hold in its manifest before it may draw `region`. */
export function hudCapability(region: HudSectionName): string {
  return `ui:${region}.replace`;
}

export interface HudPlugin {
  readonly id: string;
  /** Read for `capabilities` only; the loader has already validated it. */
  readonly manifest: PackManifest;
  readonly plugin: Pick<ModPlugin, "hud">;
}

/** Who holds one region, and what they draw it with. */
export interface HudRegionOwner {
  readonly id: string;
  readonly sink: HudSectionSink;
}

export interface InstalledHud {
  /** Every region, always: an unclaimed one is owned by `CORE_HUD_ID`. */
  readonly owners: Readonly<Record<HudSectionName, HudRegionOwner>>;
  /** Candidate zero's sink - what a faulting region is handed back to. */
  readonly recovery: HudSectionSink;
}

/**
 * Core's own terminal as an ordinary candidate. Always first in the list, and it
 * declares all three capabilities and returns all three sinks - the seam has to
 * be able to express the HUD the game already ships, or "a mod can replace the
 * vitals" would be a claim about a shape nobody had built through it.
 */
export function coreHudCandidate(sink: HudSectionSink): HudPlugin {
  return {
    id: CORE_HUD_ID,
    manifest: {
      id: CORE_HUD_ID,
      name: "Neo Angband",
      version: "0.0.0",
      shape: "plugin",
      capabilities: HUD_SECTION_NAMES.map(hudCapability),
    },
    /* Ignores the context on purpose: core's terminal is already wired. It still
     * takes one, because a candidate invoked differently from every other would
     * be the special case this list exists to remove. */
    plugin: { hud: () => Object.fromEntries(HUD_SECTION_NAMES.map((n) => [n, sink])) },
  };
}

/**
 * Core holding every region with no mod code loaded yet - the title screen, and
 * every frame before the mod boot runs `installHud`.
 *
 * Spelled out rather than routed through `installHud([core], ...)` for the same
 * reason `coreOnlyFrontend` is: that function must build a ModPluginContext for
 * whatever it invokes, and at main.ts module scope the session facts a context
 * carries do not exist yet.
 */
export function coreOnlyHud(sink: HudSectionSink): InstalledHud {
  return { owners: coreOwners(sink), recovery: sink };
}

function coreOwners(sink: HudSectionSink): Record<HudSectionName, HudRegionOwner> {
  const owner: HudRegionOwner = { id: CORE_HUD_ID, sink };
  return Object.fromEntries(HUD_SECTION_NAMES.map((name) => [name, owner])) as Record<
    HudSectionName,
    HudRegionOwner
  >;
}

/**
 * The regions this candidate is eligible to hold: it declares `hud()` AND its
 * manifest grants that region.
 *
 * A candidate that declares `hud()` and holds no HUD capability at all is that
 * mod's mistake, reported once with the fix. Holding SOME is not a mistake -
 * that is the seam working - so the regions it did not ask for are silent.
 */
export function hudRegionsClaimed(
  candidate: HudPlugin,
  reportFault: (id: string, message: string, error: unknown) => void = () => {},
): readonly HudSectionName[] {
  if (candidate.plugin.hud === undefined) return [];
  let capabilities: CapabilitySet;
  try {
    capabilities = CapabilitySet.fromManifest(candidate.manifest);
  } catch (error) {
    reportFault(candidate.id, `its capabilities could not be read, so it cannot draw any of the interface`, error);
    return [];
  }
  const claimed = HUD_SECTION_NAMES.filter((name) => capabilities.has(hudCapability(name)));
  if (claimed.length === 0) {
    reportFault(
      candidate.id,
      `declares hud() without any "ui:<region>.replace" capability, so the game keeps drawing its own; ` +
        `add one of ${HUD_SECTION_NAMES.map((n) => `"${hudCapability(n)}"`).join(", ")} to its manifest capabilities`,
      undefined,
    );
  }
  return claimed;
}

/**
 * The candidates actually competing for each region, for the contested-claim
 * report. A refused claim is NOT a contender: it is reported as that mod's own
 * fault, and listing it as well would tell the player two mods are fighting over
 * the vitals when only one of them can hold them.
 */
export function hudClaimants(
  candidates: readonly HudPlugin[],
): readonly { readonly region: HudSectionName; readonly ids: readonly string[] }[] {
  return HUD_SECTION_NAMES.map((region) => ({
    region,
    ids: candidates.filter((c) => hudRegionsClaimed(c).includes(region)).map((c) => c.id),
  })).filter((entry) => entry.ids.length > 0);
}

/**
 * The last eligible candidate in load order, per region. Absent from the map
 * only when nothing claims that region, which cannot happen for a list that
 * starts with `coreHudCandidate`.
 */
export function selectedHudPlugins(
  candidates: readonly HudPlugin[],
  reportFault: (id: string, message: string, error: unknown) => void = () => {},
): ReadonlyMap<HudSectionName, HudPlugin> {
  /* Claims read once per candidate rather than once per region: the ineligible
   * ones report a fault, and reporting it three times would tell a player their
   * mod is broken in triplicate. */
  const claims = candidates.map((candidate) => ({
    candidate,
    regions: new Set(hudRegionsClaimed(candidate, reportFault)),
  }));
  const selected = new Map<HudSectionName, HudPlugin>();
  for (const region of HUD_SECTION_NAMES) {
    for (let i = claims.length - 1; i >= 0; i--) {
      if (claims[i]!.regions.has(region)) {
        selected.set(region, claims[i]!.candidate);
        break;
      }
    }
  }
  return selected;
}

/**
 * Call one candidate's `hud()` once, and keep only the regions it was granted.
 *
 * `granted` is what the manifest asked for; a sink for anything else is dropped
 * and reported. That is the difference between a capability and a suggestion.
 */
function construct(
  candidate: HudPlugin,
  granted: readonly HudSectionName[],
  contextFor: (id: string) => ModPluginContext,
  reportFault: (id: string, message: string, error: unknown) => void,
): Partial<Record<HudSectionName, HudSectionSink>> {
  let returned: HudOwnership | undefined;
  try {
    returned = candidate.plugin.hud!.call(candidate.plugin, contextFor(candidate.id));
  } catch (error) {
    reportFault(candidate.id, "hud() failed, so the game keeps drawing its own interface", error);
    return {};
  }
  if (returned === undefined) return {};
  if (typeof returned !== "object" || returned === null) {
    reportFault(candidate.id, "hud() did not return a set of region sinks; the game keeps drawing its own", returned);
    return {};
  }
  const out: Partial<Record<HudSectionName, HudSectionSink>> = {};
  for (const region of HUD_SECTION_NAMES) {
    const sink = returned[region];
    if (sink === undefined) continue;
    if (typeof sink !== "object" || sink === null || typeof sink.present !== "function") {
      reportFault(candidate.id, `hud() returned no usable sink for "${region}"; the game keeps drawing it`, sink);
      continue;
    }
    if (!granted.includes(region)) {
      reportFault(
        candidate.id,
        `hud() returned a "${region}" sink without the "${hudCapability(region)}" capability, ` +
          `so the game keeps drawing it; add that capability to its manifest`,
        undefined,
      );
      continue;
    }
    /* The SDK owns the public types; the live section is structurally identical
     * and this adapter keeps the runtime boundary local. */
    out[region] = { present: (section, frame) => sink.present(section, frame) };
  }
  return out;
}

/**
 * Select and install every region's owner. Total by construction: candidate zero
 * is core's own and it is always constructed, both because it may win and
 * because it is what a faulting region falls back to.
 *
 * Throws only if the caller supplied no candidate zero, which is a host bug
 * rather than a mod's - there is no HUD to draw and nothing to report it with.
 */
export function installHud(
  candidates: readonly HudPlugin[],
  contextFor: (id: string) => ModPluginContext,
  reportFault: (id: string, message: string, error: unknown) => void,
): InstalledHud {
  const core = candidates[0];
  if (!core || core.id !== CORE_HUD_ID) {
    throw new RangeError("installHud: candidate zero must be coreHudCandidate()");
  }
  /* Core goes through the same call as everyone else - if the seam could not
   * express the HUD the game already ships, "a mod can replace the vitals" would
   * be a claim about a shape nobody had ever built through it. */
  const built = construct(core, HUD_SECTION_NAMES, contextFor, reportFault);
  const missing = HUD_SECTION_NAMES.filter((name) => built[name] === undefined);
  if (missing.length > 0) {
    throw new RangeError(`installHud: the core HUD declined its own ${missing.join(", ")}`);
  }
  /* One sink for all three, taken from the region core is least likely to ever
   * stop drawing. Recovery is singular because core's terminal is: what a
   * faulting sidebar falls back to is the same painter a faulting status line
   * does, and two references to it would be two things to keep in step. */
  const recovery = built.messages!;
  const owners = coreOwners(recovery);
  const selected = selectedHudPlugins(candidates, reportFault);
  /* One call per winning candidate, not one per region it won: `hud()` may
   * create DOM, and a mod holding two regions must not be constructed twice. */
  const constructed = new Map<string, Partial<Record<HudSectionName, HudSectionSink>>>();
  for (const region of HUD_SECTION_NAMES) {
    const candidate = selected.get(region);
    if (!candidate || candidate.id === CORE_HUD_ID) continue;
    if (!constructed.has(candidate.id)) {
      constructed.set(
        candidate.id,
        construct(candidate, hudRegionsClaimed(candidate), contextFor, reportFault),
      );
    }
    const sink = constructed.get(candidate.id)![region];
    if (sink) owners[region] = { id: candidate.id, sink };
  }
  return { owners, recovery };
}

/** True when nothing but core holds anything - the unmodded case. */
export function hudIsAllCore(installed: InstalledHud): boolean {
  return HUD_SECTION_NAMES.every((name) => installed.owners[name].id === CORE_HUD_ID);
}

/**
 * Route the live HUD producer to whoever owns each region.
 *
 * A plugin receives an immutable, structurally owned snapshot, and a fault hands
 * THAT REGION - not the whole HUD - back to core's terminal for the rest of the
 * session. Losing your hit points because the mod drawing the status line threw
 * would be a bigger blast radius than the grant.
 *
 * Core owning everything costs nothing here: the frame is neither snapshotted
 * nor wrapped, and the unmodded paint path is the one it always was.
 */
export function hudFrameSink(
  installed: InstalledHud,
  reportFault: (id: string, message: string, error: unknown) => void,
): HudFrameSink {
  if (hudIsAllCore(installed)) {
    return {
      present(frame) {
        for (const section of hudSections(frame)) installed.recovery.present(section, frame);
      },
    };
  }
  const failed = new Set<HudSectionName>();
  return {
    present(frame) {
      /* Built once and shared by every plugin-owned region: the frame is frozen,
       * so two owners holding the same object cannot reach each other through
       * it, and building one copy per region would triple the cost of the
       * common case of a mod owning two. */
      let snapshot: HudFrame | undefined;
      for (const section of hudSections(frame)) {
        const owner = installed.owners[section.name];
        if (owner.id === CORE_HUD_ID || failed.has(section.name)) {
          installed.recovery.present(section, frame);
          continue;
        }
        snapshot ??= snapshotHudFrame(frame);
        const owned = sectionOf(snapshot, section.name);
        try {
          owner.sink.present(owned, snapshot);
        } catch (error) {
          failed.add(section.name);
          reportFault(owner.id, `drawing the ${section.name} failed; the game has resumed drawing it`, error);
          installed.recovery.present(section, frame);
        }
      }
    },
  };
}

/** The frame's section for one region name. Present by construction: the caller
 *  iterates the frame's own sections, and the snapshot has the same ones. */
function sectionOf(frame: HudFrame, name: HudSectionName): HudSection {
  return name === "messages" ? frame.messages : name === "status" ? frame.status : frame.sidebar!;
}
