/**
 * The one front-end slot.
 *
 * THE DEFAULT GOES THROUGH THE SAME DOOR. Core's glyph renderer is candidate
 * zero in the same list, declaring `frontend` and `display:replace` exactly as a
 * mod does, and it wins by the ordinary last-in-load-order rule when no mod
 * declares one. That is the whole point of phase 5: if the seam could not
 * express the front end the game already ships, "a mod can replace the front
 * end" would be a claim about a shape nobody had ever built through it. It also
 * deletes the branch this file used to carry - there is no null selection and no
 * fallback parameter threaded through the render path, because there is always
 * exactly one selected front end.
 *
 * Front ends are deliberately selected before they are invoked: a lower-loaded
 * plugin must not mount a screen or retain game data when a later plugin wins.
 * Candidate zero is the exception, and only because it is the RECOVERY target -
 * a replacement that faults hands the map back to it mid-session, so it has to
 * have been constructed before it is needed.
 */

import { CapabilitySet, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModPlugin, ModPluginContext } from "./mod-plugin";
import { snapshotWorldFrame, type WorldFrameSink } from "./world-view";

/** Candidate zero's id: the game's own glyph renderer, as a front end. */
export const CORE_FRONTEND_ID = "core";

/**
 * What a mod must ask for in its manifest before `frontend()` is called.
 *
 * A front end owns everything the player sees of the dungeon, which is a bigger
 * grant than any single `registry:` domain and is invisible from a mod's
 * description - so it is consented to by name, the way `controller` requires
 * `command:add`. Declaring `frontend` without it is that mod's fault, reported
 * with the fix, and the next eligible candidate takes the slot.
 */
export const DISPLAY_CAPABILITY = "display:replace";

export interface FrontendPlugin {
  readonly id: string;
  /** Read for `capabilities` only; the loader has already validated it. */
  readonly manifest: PackManifest;
  readonly plugin: Pick<ModPlugin, "frontend">;
}

export interface InstalledFrontend {
  readonly id: string;
  readonly sink: WorldFrameSink;
  /**
   * Candidate zero's sink - what resumes when a replacement faults. Equal to
   * `sink` when candidate zero won, which is the unmodded case.
   */
  readonly recovery: WorldFrameSink;
}

/** Core's own renderer as an ordinary candidate. Always first in the list. */
export function coreFrontendCandidate(sink: WorldFrameSink): FrontendPlugin {
  return {
    id: CORE_FRONTEND_ID,
    manifest: {
      id: CORE_FRONTEND_ID,
      name: "Neo Angband",
      version: "0.0.0",
      shape: "plugin",
      capabilities: [DISPLAY_CAPABILITY],
    },
    /* Ignores the context on purpose: core's renderer is already wired to the
     * live terminal. It still takes one, because taking a different argument
     * from every other candidate would be the special case this removes. */
    plugin: { frontend: () => sink },
  };
}

/**
 * Core holding the slot with no mod code loaded yet - the title screen, and
 * every frame before the mod boot runs `installFrontend`.
 *
 * Spelled out rather than routed through `installFrontend([core], ...)` for one
 * reason: that function must build a ModPluginContext for whatever it invokes,
 * and at main.ts module scope the session facts a context carries do not exist
 * yet. Core needs no context - it has no pack - so asking for one would mean
 * main.ts building a context that is missing a field every OTHER context has,
 * which `mod-context.test.ts` correctly refuses.
 *
 * The equivalence to the selection path is asserted behaviourally in
 * `frontend-mod.node.test.ts` (same id, same sink-is-recovery identity, same
 * pixels), not assumed from the two being written to look alike.
 */
export function coreOnlyFrontend(sink: WorldFrameSink): InstalledFrontend {
  return { id: CORE_FRONTEND_ID, sink, recovery: sink };
}

/** True when this candidate declares a front end AND is allowed to hold one. */
function eligible(
  candidate: FrontendPlugin,
  reportFault: (id: string, message: string, error: unknown) => void,
): boolean {
  if (candidate.plugin.frontend === undefined) return false;
  let granted: boolean;
  try {
    granted = CapabilitySet.fromManifest(candidate.manifest).has(DISPLAY_CAPABILITY);
  } catch (error) {
    reportFault(candidate.id, `its capabilities could not be read, so it cannot take the display`, error);
    return false;
  }
  if (!granted) {
    reportFault(
      candidate.id,
      `declares frontend() without the "${DISPLAY_CAPABILITY}" capability, so the display stays with the game; ` +
        `add "${DISPLAY_CAPABILITY}" to its manifest capabilities`,
      undefined,
    );
    return false;
  }
  return true;
}

/**
 * The candidates actually competing for the slot, for the contested-claim
 * report. A refused claim is NOT a contender: it is reported as that mod's own
 * fault, and listing it here as well would tell the player two mods are
 * fighting over the display when only one of them can hold it.
 */
export function frontendClaimants(
  candidates: readonly FrontendPlugin[],
): readonly string[] {
  return candidates.filter((c) => eligible(c, () => {})).map((c) => c.id);
}

/**
 * The last eligible candidate in load order is the only one that gets invoked.
 * Returns undefined only when nothing in the list is eligible, which cannot
 * happen for a list that starts with `coreFrontendCandidate`.
 */
export function selectedFrontendPlugin(
  candidates: readonly FrontendPlugin[],
  reportFault: (id: string, message: string, error: unknown) => void = () => {},
): FrontendPlugin | undefined {
  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i]!;
    if (eligible(candidate, reportFault)) return candidate;
  }
  return undefined;
}

/** Construct one candidate's sink, or null if it declines or faults. */
function construct(
  candidate: FrontendPlugin,
  contextFor: (id: string) => ModPluginContext,
  reportFault: (id: string, message: string, error: unknown) => void,
): WorldFrameSink | null {
  try {
    const sink = candidate.plugin.frontend!.call(candidate.plugin, contextFor(candidate.id));
    if (sink === undefined) return null;
    if (typeof sink !== "object" || sink === null || typeof sink.present !== "function") {
      reportFault(candidate.id, "frontend() did not return a WorldFrameSink; the glyph front end stays active", sink);
      return null;
    }
    /* The SDK owns the public frame type; world-view's live frame is
     * structurally identical and this adapter keeps the runtime boundary local. */
    return { present: (frame) => sink.present(frame) };
  } catch (error) {
    reportFault(candidate.id, "frontend() failed, so the glyph front end stays active", error);
    return null;
  }
}

/**
 * Select and install the front end. Total by construction: candidate zero is
 * core's own and it is always constructed, both because it may win and because
 * it is what a faulting replacement falls back to.
 *
 * Throws only if the caller supplied no candidate zero, which is a host bug
 * rather than a mod's - there is no map to draw and nothing to report it with.
 */
export function installFrontend(
  candidates: readonly FrontendPlugin[],
  contextFor: (id: string) => ModPluginContext,
  reportFault: (id: string, message: string, error: unknown) => void,
): InstalledFrontend {
  const core = candidates[0];
  if (!core || core.id !== CORE_FRONTEND_ID) {
    throw new RangeError("installFrontend: candidate zero must be coreFrontendCandidate()");
  }
  const recovery = construct(core, contextFor, reportFault);
  if (!recovery) throw new RangeError("installFrontend: the core front end declined its own slot");
  const selected = selectedFrontendPlugin(candidates, reportFault);
  if (!selected || selected.id === CORE_FRONTEND_ID) {
    return { id: CORE_FRONTEND_ID, sink: recovery, recovery };
  }
  const sink = construct(selected, contextFor, reportFault);
  return sink ? { id: selected.id, sink, recovery } : { id: CORE_FRONTEND_ID, sink: recovery, recovery };
}

/**
 * Route the live map producer to the selected front end. A plugin receives an
 * immutable, structurally owned snapshot, and a fault hands the map back to
 * core's renderer for the rest of the session rather than stranding the player
 * on a blank screen.
 *
 * Core's own selection costs nothing here: `sink === recovery`, so the frame is
 * neither snapshotted nor wrapped, and the unmodded paint path is the one it
 * always was.
 */
export function frontendWorldFrameSink(
  frontend: InstalledFrontend,
  reportFault: (id: string, message: string, error: unknown) => void,
): WorldFrameSink {
  if (frontend.sink === frontend.recovery) return frontend.recovery;
  let active = true;
  return {
    present(frame) {
      if (!active) {
        frontend.recovery.present(frame);
        return;
      }
      try {
        frontend.sink.present(snapshotWorldFrame(frame));
      } catch (error) {
        active = false;
        reportFault(frontend.id, "frontend display failed; the glyph front end has resumed", error);
        frontend.recovery.present(frame);
      }
    },
  };
}
