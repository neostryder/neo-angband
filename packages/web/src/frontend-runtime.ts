/**
 * The host owns named views. Core is always available as the recovery target.
 * Lazy construction keeps an inactive plugin from mounting display elements.
 */

import { modHealth } from "./mod-health";
import { readSetting, writeSetting, type SettingsWriter } from "./settings-store";
import { CapabilitySet, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModPlugin, ModPluginContext } from "./mod-plugin";
import {
  restatableWorldFrameSink,
  snapshotWorldFrame,
  type RestatableWorldFrameSink,
  type WorldFrameSink,
  type WorldFrame,
} from "./world-view";

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
  readonly current?: () => boolean;
}

const workerViews = new Map<string, FrontendPlugin>();
const viewListeners = new Set<() => void>();

/** The host supplies identity because Worker data cannot rename a mod. */
export function registerWorkerFrontendView(candidate: FrontendPlugin): () => void {
  workerViews.set(candidate.id, candidate);
  for (const listener of viewListeners) listener();
  return () => {
    if (workerViews.get(candidate.id) !== candidate) return;
    workerViews.delete(candidate.id);
    for (const listener of viewListeners) listener();
  };
}

export function failWorkerFrontendView(id: string, error: unknown): void {
  for (const listener of workerFaultListeners) listener(id, error);
}

const workerFaultListeners = new Set<(id: string, error: unknown) => void>();

function orderedViews(candidates: readonly FrontendPlugin[], order?: readonly string[]): readonly FrontendPlugin[] {
  if (!order) return candidates;
  const rank = new Map(order.map((id, index) => [id, index + 1]));
  rank.set(CORE_FRONTEND_ID, 0);
  const after = order.length + 1;
  return [...candidates].sort((left, right) => (rank.get(left.id) ?? after) - (rank.get(right.id) ?? after));
}

/** The shell owns the subscription lifetime across a reload. */
export function watchFrontendViews(frontend: InstalledFrontend, changed: () => void): () => void {
  if (!(frontend instanceof FrontendViews)) return () => {};
  const update = () => { frontend.updateWorkers(); changed(); };
  const fail = (id: string, error: unknown) => frontend.workerFailed(id, error);
  viewListeners.add(update);
  workerFaultListeners.add(fail);
  update();
  return () => {
    viewListeners.delete(update);
    workerFaultListeners.delete(fail);
    frontend.suspend();
  };
}

export interface InstalledFrontend {
  readonly id: string;
  readonly views: readonly { readonly id: string; readonly name: string }[];
  cycle(): void;
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
  return { id: CORE_FRONTEND_ID, sink, recovery: sink, views: [{ id: CORE_FRONTEND_ID, name: "Neo Angband" }], cycle() {} };
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
 * These registrations coexist, so diagnostics do not treat them as contested slots.
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
    const sink = modHealth().run(candidate.id, "frontend()", () =>
      candidate.plugin.frontend!.call(candidate.plugin, contextFor(candidate.id)),
    );
    if (sink === undefined) return null;
    if (typeof sink !== "object" || sink === null || typeof sink.present !== "function") {
      reportFault(candidate.id, "frontend() did not return a WorldFrameSink; the glyph front end stays active", sink);
      return null;
    }
    /* The SDK owns the public frame type; world-view's live frame is
     * structurally identical and this adapter keeps the runtime boundary local. */
    return {
      present: (frame) => modHealth().run(candidate.id, "frontend present", () => sink.present(frame)),
      ...(sink.suspend ? { suspend: () => modHealth().run(candidate.id, "frontend suspend", () => sink.suspend!(), { always: true }) } : {}),
    };
  } catch (error) {
    reportFault(candidate.id, "frontend() failed, so the glyph front end stays active", error);
    return null;
  }
}

/**
 * The initial preference follows load order so existing installs keep their
 * display. Core remains available because mod drawing can fail.
 *
 * Throws only if the caller supplied no candidate zero, which is a host bug
 * rather than a mod's - there is no map to draw and nothing to report it with.
 */
export function installFrontend(
  candidates: readonly FrontendPlugin[],
  contextFor: (id: string) => ModPluginContext,
  reportFault: (id: string, message: string, error: unknown) => void,
  storage?: SettingsWriter | null,
  order?: readonly string[],
): InstalledFrontend {
  const core = candidates[0];
  if (!core || core.id !== CORE_FRONTEND_ID) {
    throw new RangeError("installFrontend: candidate zero must be coreFrontendCandidate()");
  }
  const recovery = construct(core, contextFor, reportFault);
  if (!recovery) throw new RangeError("installFrontend: the core front end declined its own slot");
  const available = orderedViews([...candidates, ...workerViews.values()].filter((candidate) => eligible(candidate, reportFault)), order);
  const saved = readSetting(storage, "activeView");
  const initial = available.find((candidate) => candidate.id === saved) ??
    (saved === undefined ? available.at(-1) : core)!;
  const host = new FrontendViews(available, recovery, contextFor, reportFault, storage, order);
  host.activate(initial.id);
  return host;
}

/** A display preference never enters the character or the turn loop. */
class FrontendViews implements InstalledFrontend {
  private readonly sinks = new Map<string, WorldFrameSink>();
  private readonly failed = new Set<string>();
  private active = CORE_FRONTEND_ID;
  private last: WorldFrame | undefined;
  private chosen = false;
  readonly stream: FrontendMapStream;

  constructor(
    private candidates: readonly FrontendPlugin[],
    readonly recovery: WorldFrameSink,
    private readonly contextFor: (id: string) => ModPluginContext,
    private readonly reportFault: (id: string, message: string, error: unknown) => void,
    private readonly storage?: SettingsWriter | null,
    private readonly order?: readonly string[],
  ) {
    this.sinks.set(CORE_FRONTEND_ID, recovery);
    this.stream = {
      present: (frame) => {
        this.last = snapshotWorldFrame(frame);
        this.draw();
      },
      restate: (stack) => {
        if (!this.last) return;
        this.last = snapshotWorldFrame({ ...this.last, stack });
        if (this.active !== CORE_FRONTEND_ID) this.draw();
      },
    };
  }

  get id(): string { return this.active; }
  get sink(): WorldFrameSink { return this.sinks.get(this.active)!; }
  get views(): InstalledFrontend["views"] {
    return this.candidates.filter((candidate) => !this.failed.has(candidate.id) && (candidate.current?.() ?? true))
      .map((candidate) => ({ id: candidate.id, name: candidate.manifest.name }));
  }

  activate(id: string): void {
    const candidate = this.candidates.find((candidate) => candidate.id === id);
    if (!candidate || this.failed.has(id)) return;
    let sink = this.sinks.get(id);
    if (!sink) {
      sink = construct(candidate, this.contextFor, this.reportFault) ?? undefined;
      if (!sink) {
        this.failed.add(id);
        this.active = CORE_FRONTEND_ID;
        this.remember();
        this.draw();
        return;
      }
      this.sinks.set(id, sink);
    }
    this.active = id;
    this.draw();
  }

  cycle(): void {
    this.chosen = true;
    const views = this.views;
    if (views.length < 2) return;
    const next = views[(views.findIndex((view) => view.id === this.active) + 1) % views.length]!;
    if (!this.release()) return;
    this.activate(next.id);
    this.remember();
  }

  private remember(): void { writeSetting(this.storage, "activeView", this.active); }

  updateWorkers(): void {
    const preceding = this.candidates.filter((candidate) => candidate.current !== undefined);
    this.candidates = orderedViews([...this.candidates.filter((candidate) => candidate.current === undefined), ...workerViews.values()], this.order);
    for (const candidate of preceding) {
      if (workerViews.get(candidate.id) === candidate) continue;
      if (this.active === candidate.id) {
        this.release();
        this.active = CORE_FRONTEND_ID;
        this.draw();
      }
      this.sinks.delete(candidate.id);
    }
    const preferred = readSetting(this.storage, "activeView");
    const incoming = [...workerViews.values()].find((candidate) => candidate.id === preferred) ??
      (!this.chosen && preferred === undefined ? this.candidates.at(-1) : undefined);
    if (incoming && incoming.id !== this.active && !this.failed.has(incoming.id) && this.release()) this.activate(incoming.id);
  }

  workerFailed(id: string, error: unknown): void {
    if (id !== this.active) return;
    this.fail(error);
    modHealth().recordFault(id, "frontend present", error);
  }

  suspend(): void { this.release(); }

  private release(): boolean {
    if (this.active === CORE_FRONTEND_ID) return true;
    try {
      this.hide();
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  private hide(): void {
    if (this.sink.suspend) this.sink.suspend();
    else if (this.last) {
      // Older sinks hide when the host publishes a covering screen.
      const map = this.last.regions?.map.cells;
      const { regions: _regions, ...frame } = this.last;
      this.sink.present(snapshotWorldFrame({ ...frame,
        stack: [...(this.last.stack ?? []), { id: "core:view-switch", layer: "system",
          cells: map ?? { col: 0, row: 0, cols: Number.MAX_SAFE_INTEGER, rows: Number.MAX_SAFE_INTEGER } }] }));
    }
  }

  private fail(error: unknown): void {
    const id = this.active;
    this.failed.add(id);
    try { this.hide(); } catch { /* A broken cleanup must leave recovery reachable. */ }
    this.active = CORE_FRONTEND_ID;
    this.remember();
    this.reportFault(id, "frontend display failed; the glyph front end has resumed", error);
    if (this.last) this.recovery.present(this.last);
  }

  private draw(): void {
    if (!this.last) return;
    if (this.active !== CORE_FRONTEND_ID && this.candidates.find((candidate) => candidate.id === this.active)?.current?.() === false) {
      this.fail(new Error("the view is no longer authorized"));
      return;
    }
    try {
      if (this.candidates.find((candidate) => candidate.id === this.active)?.current) this.recovery.present(this.last);
      this.sink.present(this.last);
    }
    catch (error) {
      if (this.active === CORE_FRONTEND_ID) throw error;
      this.fail(error);
    }
  }
}

/**
 * What the shell holds the map with: a sink, and - only when a MOD holds the
 * display - the ability to show it a changed region stack with no repaint
 * behind it (#261).
 *
 * Core must not repaint on a stack notification because it would cover the
 * screen that just opened. The view host only caches those notifications while
 * core is active, so an incoming mod still receives the current stack.
 */
export type FrontendMapStream = WorldFrameSink & Partial<Pick<RestatableWorldFrameSink, "restate">>;

/**
 * Route the live map producer to the selected front end. A plugin receives an
 * immutable, structurally owned snapshot, and a fault hands the map back to
 * core's renderer for the rest of the session rather than stranding the player
 * on a blank screen.
 *
 * A core-only caller can retain the direct sink. The shell requests cached
 * frames even with no mods so a later Worker registration has a frame to draw.
 */
export function frontendWorldFrameSink(
  frontend: InstalledFrontend,
  reportFault: (id: string, message: string, error: unknown) => void,
  rememberCore = false,
): FrontendMapStream {
  if (frontend instanceof FrontendViews && (rememberCore || frontend.views.length > 1)) return frontend.stream;
  if (frontend.sink === frontend.recovery) return frontend.recovery;
  let active = true;
  return restatableWorldFrameSink({
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
  });
}
