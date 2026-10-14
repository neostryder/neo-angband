/**
 * Runtime health for mod code: every call the host makes into a mod goes
 * through `modHealth().run`, which attributes the call, times it, counts its faults
 * and switches the mod off for the session when it keeps failing.
 *
 * What it counts as a fault: a throw, a rejected promise, and a repeated breach
 * of the hard time ceiling. Three faults within FAULT_WINDOW_TURNS game turns
 * switch the mod off until the page next loads. The enabled set in the mod
 * store is left alone, so the mod comes back on the next start; the player
 * turns it off on the Mods screen if they want it gone for good.
 *
 * Time is self time: a mod call that re-enters another mod is charged only for
 * its own part. It is summed per budget period, which is one game turn, cut
 * short by `newPeriod()` (the host calls it on every key and tap, so a player
 * browsing menus without taking a turn does not pile every menu's cost onto one
 * turn) and by MAX_PERIOD_MS of wall time (so a sink that draws while the game
 * sits idle is not charged for every frame since the last turn). Only the synchronous part of a call is timed; an async callback's
 * awaited work runs outside the call and is not CPU time spent inside the turn.
 *
 * A Worker mod is measured on two more axes, apart from CPU time: how long it
 * takes to answer what the host asks it (response latency), and how long its
 * network requests keep it waiting on the host's broker. Neither is time spent
 * inside a turn, so neither counts against the budget. A Worker that stops
 * answering at all is switched off at once (`switchOff`), with the same notice.
 *
 * Callers keep their own recovery. `run` rethrows whatever the mod threw, so a
 * site that already turned a throw into a neutral answer (core's guardModHooks,
 * the event subscription, the UI runtimes' fall back to the game's own drawing)
 * still does. A switched-off mod is refused with ModSwitchedOffError before its
 * code runs; sites that can stay silent check `isOff` first instead.
 *
 * Enforcement is off until the host turns it on (`configureModHealth` with
 * `enforce: true`, from main.ts). Unit tests of the UI runtimes run without it,
 * so a test that makes one mod id fault many times measures the same as before.
 */

import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";

/** Faults within the window that switch a mod off for the session. */
export const FAULT_LIMIT = 3;
/** How many game turns a fault counts against a mod. */
export const FAULT_WINDOW_TURNS = 200;
/** A mod's time per turn when its manifest declares no budget. */
export const DEFAULT_TURN_BUDGET_MS = 50;
/** No declared budget goes above this, and a turn over it is a breach. */
export const HARD_CEILING_MS = 500;
/** The longest a budget period lasts in wall time, whether or not a turn passes. */
export const MAX_PERIOD_MS = 1000;

/** A mod that has been switched off for the rest of the session. */
export interface ModSwitchOff {
  readonly id: string;
  /** Where the fault that tipped it over happened (`register()`, `messageText hook`). */
  readonly site: string;
  /** That fault's message. */
  readonly why: string;
  /** The game turn it happened on. */
  readonly turn: number;
  /** Absent or "faults" for repeated faults; "stall" for a Worker that stopped answering and was terminated. */
  readonly reason?: "faults" | "stall";
}

/** One turn in which a mod went over its time budget. */
export interface ModOverBudget {
  readonly id: string;
  readonly turn: number;
  /** Time the mod had used in this period when it crossed the line. */
  readonly ms: number;
  readonly budgetMs: number;
  /** True when it crossed HARD_CEILING_MS rather than only its own budget. */
  readonly ceiling: boolean;
}

/** One fault as it is counted, with what the mod raised. */
export interface ModFault {
  readonly id: string;
  readonly site: string;
  /** What the mod threw, or what its promise rejected with. */
  readonly error: unknown;
  readonly turn: number;
  /** True when the fault arrived as a rejected promise rather than a throw. */
  readonly rejected: boolean;
}

/** What the profiler screen shows for one mod. */
export interface ModHealthStats {
  readonly id: string;
  /** Calls into the mod this session, refused ones excluded. */
  readonly calls: number;
  /** Total self time in milliseconds. */
  readonly cpuMs: number;
  /** The longest single call, in milliseconds, and where it was. */
  readonly worstMs: number;
  readonly worstSite: string | null;
  /** Every fault this session, including ones that have left the window. */
  readonly faults: number;
  /** Periods in which the mod went over its own budget. */
  readonly overBudget: number;
  /** Periods in which it went over HARD_CEILING_MS. */
  readonly ceilingBreaches: number;
  /** Bytes the mod sent across a Worker boundary, or null where none was measured. */
  readonly payloadBytes: number | null;
  /** Answers a Worker mod gave to what the host asked it. */
  readonly replies: number;
  /** Total time those answers took, in milliseconds (response latency). */
  readonly replyMs: number;
  /** The slowest single answer, in milliseconds. */
  readonly worstReplyMs: number;
  /** Time spent waiting on this mod's network requests, in milliseconds, or null where it made none. */
  readonly netMs: number | null;
  /** Replies that arrived for a request the host had already given up on, and were dropped. */
  readonly stale: number;
  /** The switch-off, when it happened. */
  readonly switchedOff: ModSwitchOff | null;
}

export interface ModHealthOptions {
  /** The current game turn. Defaults to 0, which keeps every fault in one window. */
  readonly turn?: () => number;
  /** A millisecond clock. Defaults to performance.now. */
  readonly now?: () => number;
  /** Whether three faults switch a mod off. Off by default. */
  readonly enforce?: boolean;
  /** This mod's time budget per turn in milliseconds (see turnBudgetMs). */
  readonly budgetFor?: (id: string) => number;
  /** Told once per mod, at the moment it is switched off. */
  readonly onSwitchOff?: (off: ModSwitchOff) => void;
  /** Told each time a mod first crosses its budget or the ceiling in a period. */
  readonly onOverBudget?: (report: ModOverBudget) => void;
  /** Told about every fault as it is counted (the headless runner reads the errors). */
  readonly onFault?: (fault: ModFault) => void;
  /** A headless host must wait for returned promises before it reports the run. */
  readonly onAsync?: (id: string, site: string, promise: PromiseLike<unknown>) => void;
}

/** Thrown by `run` for a mod that is switched off, before any of its code runs. */
export class ModSwitchedOffError extends Error {
  readonly modId: string;
  constructor(modId: string) {
    super("this mod was switched off for the rest of the session after failing repeatedly");
    this.name = "ModSwitchedOffError";
    this.modId = modId;
  }
}

/**
 * A mod's time budget per turn.
 *
 * A missing or invalid budget takes the default; declarations stop at the ceiling.
 */
export function turnBudgetMs(declared?: number): number {
  if (declared === undefined || !Number.isFinite(declared) || declared <= 0) {
    return DEFAULT_TURN_BUDGET_MS;
  }
  return Math.min(declared, HARD_CEILING_MS);
}

export function manifestBudgetFor(id: string, manifests: readonly Pick<PackManifest, "id" | "budget">[]): number {
  return turnBudgetMs(manifests.find((manifest) => manifest.id === id)?.budget?.msPerTurn);
}

interface Mutable {
  calls: number;
  cpuMs: number;
  worstMs: number;
  worstSite: string | null;
  faults: number;
  overBudget: number;
  ceilingBreaches: number;
  payloadBytes: number | null;
  replies: number;
  replyMs: number;
  worstReplyMs: number;
  netMs: number | null;
  stale: number;
  switchedOff: ModSwitchOff | null;
  /** Game turns of the faults still inside the window. */
  faultTurns: number[];
  /** Game turns of the ceiling breaches still inside the window. */
  breachTurns: number[];
}

interface Frame {
  childMs: number;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ModHealthMonitor {
  private options: ModHealthOptions;
  private readonly mods = new Map<string, Mutable>();
  private readonly stack: Frame[] = [];
  /** Time each mod has used in the current period, and which lines it crossed. */
  private periodTurn: number | null = null;
  private periodStart = 0;
  private readonly periodMs = new Map<string, number>();
  private readonly periodCrossed = new Map<string, "budget" | "ceiling">();

  constructor(options: ModHealthOptions = {}) {
    this.options = options;
  }

  /** Replace some of the options; the counts so far are kept. */
  configure(options: ModHealthOptions): void {
    this.options = { ...this.options, ...options };
  }

  /** Forget everything, options included (tests). */
  reset(options: ModHealthOptions = {}): void {
    this.options = options;
    this.mods.clear();
    this.stack.length = 0;
    this.periodTurn = null;
    this.periodMs.clear();
    this.periodCrossed.clear();
  }

  /** True once this mod has been switched off for the session. */
  isOff(id: string): boolean {
    return this.mods.get(id)?.switchedOff != null;
  }

  /**
   * Call into mod `id` at `site`. Returns what `fn` returns and rethrows what
   * it throws, after recording both. A returned promise that later rejects is
   * recorded as a fault too, and handed back unchanged.
   *
   * `always` runs the call even for a switched-off mod, for teardown, which
   * has to run whatever state the mod is in.
   */
  run<R>(id: string, site: string, fn: () => R, opts?: { readonly always?: boolean }): R {
    const record = this.record(id);
    if (record.switchedOff && opts?.always !== true) throw new ModSwitchedOffError(id);
    const now = this.options.now ?? defaultNow;
    const frame: Frame = { childMs: 0 };
    this.stack.push(frame);
    const start = now();
    let result: R;
    try {
      result = fn();
    } catch (error) {
      this.finish(id, site, record, frame, now() - start);
      this.fault(id, site, error);
      throw error;
    }
    this.finish(id, site, record, frame, now() - start);
    if (isThenable(result)) {
      result.then(undefined, (error: unknown) => {
        this.fault(id, site, error, true);
      });
      this.options.onAsync?.(id, site, result);
    }
    return result;
  }

  /** Record a fault the host found without calling the mod (a refused Worker message). */
  recordFault(id: string, site: string, error: unknown): void {
    this.fault(id, site, error);
  }

  /** Add bytes a mod sent across a Worker boundary. */
  recordPayload(id: string, bytes: number): void {
    const record = this.record(id);
    record.payloadBytes = (record.payloadBytes ?? 0) + bytes;
  }

  /** Record how long a Worker mod took to answer something the host asked it. */
  recordReply(id: string, ms: number): void {
    const record = this.record(id);
    record.replies += 1;
    record.replyMs += ms;
    if (ms > record.worstReplyMs) record.worstReplyMs = ms;
  }

  /** Add time a mod's network request kept it waiting on the host's broker. */
  recordNetWait(id: string, ms: number): void {
    const record = this.record(id);
    record.netMs = (record.netMs ?? 0) + ms;
  }

  /** Count a reply that came for a request the host had already given up on. */
  recordStale(id: string): void {
    this.record(id).stale += 1;
  }

  /**
   * Switch a mod off now, without waiting for three faults: a Worker that
   * stopped answering, which the caller has already terminated. Counts as a
   * fault, and tells `onSwitchOff` as a repeated fault does, whether or not
   * enforcement is on, because the Worker is gone either way.
   */
  switchOff(id: string, site: string, error: unknown): void {
    const record = this.record(id);
    const turn = this.turn();
    record.faults += 1;
    if (record.switchedOff !== null) return;
    const off: ModSwitchOff = { id, site, why: messageOf(error), turn, reason: "stall" };
    record.switchedOff = off;
    try {
      this.options.onSwitchOff?.(off);
    } catch (reportError) {
      queueMicrotask(() => {
        throw reportError;
      });
    }
  }

  /** End the current budget period early (a key or a tap from the player). */
  newPeriod(): void {
    this.periodTurn = null;
    this.periodMs.clear();
    this.periodCrossed.clear();
  }

  /** Every mod that has been called or had a fault, in first-seen order. */
  stats(): ModHealthStats[] {
    return [...this.mods.entries()].map(([id, r]) => ({
      id,
      calls: r.calls,
      cpuMs: r.cpuMs,
      worstMs: r.worstMs,
      worstSite: r.worstSite,
      faults: r.faults,
      overBudget: r.overBudget,
      ceilingBreaches: r.ceilingBreaches,
      payloadBytes: r.payloadBytes,
      replies: r.replies,
      replyMs: r.replyMs,
      worstReplyMs: r.worstReplyMs,
      netMs: r.netMs,
      stale: r.stale,
      switchedOff: r.switchedOff,
    }));
  }

  private record(id: string): Mutable {
    let r = this.mods.get(id);
    if (!r) {
      r = {
        calls: 0,
        cpuMs: 0,
        worstMs: 0,
        worstSite: null,
        faults: 0,
        overBudget: 0,
        ceilingBreaches: 0,
        payloadBytes: null,
        replies: 0,
        replyMs: 0,
        worstReplyMs: 0,
        netMs: null,
        stale: 0,
        switchedOff: null,
        faultTurns: [],
        breachTurns: [],
      };
      this.mods.set(id, r);
    }
    return r;
  }

  private turn(): number {
    return this.options.turn?.() ?? 0;
  }

  private finish(id: string, site: string, record: Mutable, frame: Frame, elapsed: number): void {
    this.stack.pop();
    const parent = this.stack[this.stack.length - 1];
    if (parent) parent.childMs += elapsed;
    const self = Math.max(0, elapsed - frame.childMs);
    record.calls += 1;
    record.cpuMs += self;
    if (self > record.worstMs) {
      record.worstMs = self;
      record.worstSite = site;
    }
    this.charge(id, site, record, self);
  }

  private charge(id: string, site: string, record: Mutable, ms: number): void {
    const turn = this.turn();
    const now = (this.options.now ?? defaultNow)();
    if (this.periodTurn !== turn || now - this.periodStart > MAX_PERIOD_MS) {
      this.newPeriod();
      this.periodTurn = turn;
      this.periodStart = now;
    }
    const spent = (this.periodMs.get(id) ?? 0) + ms;
    this.periodMs.set(id, spent);
    const crossed = this.periodCrossed.get(id);
    if (crossed === "ceiling") return;
    const budgetMs = turnBudgetMs(this.options.budgetFor?.(id));
    if (spent > HARD_CEILING_MS) {
      this.periodCrossed.set(id, "ceiling");
      if (crossed === undefined) record.overBudget += 1;
      record.ceilingBreaches += 1;
      this.options.onOverBudget?.({ id, turn, ms: spent, budgetMs: HARD_CEILING_MS, ceiling: true });
      /* The first breach in the window is recorded and reported; each further
       * one in the window counts as a fault. */
      record.breachTurns = inWindow(record.breachTurns, turn);
      record.breachTurns.push(turn);
      if (record.breachTurns.length > 1) {
        this.fault(
          id,
          site,
          new Error(`it used ${Math.round(spent)} ms in one turn, over the ${HARD_CEILING_MS} ms limit`),
        );
      }
      return;
    }
    if (crossed === undefined && spent > budgetMs) {
      this.periodCrossed.set(id, "budget");
      record.overBudget += 1;
      this.options.onOverBudget?.({ id, turn, ms: spent, budgetMs, ceiling: false });
    }
  }

  private fault(id: string, site: string, error: unknown, rejected = false): void {
    const record = this.record(id);
    const turn = this.turn();
    record.faults += 1;
    if (this.options.onFault) {
      try {
        this.options.onFault({ id, site, error, turn, rejected });
      } catch (reportError) {
        queueMicrotask(() => {
          throw reportError;
        });
      }
    }
    record.faultTurns = inWindow(record.faultTurns, turn);
    record.faultTurns.push(turn);
    if (
      this.options.enforce === true &&
      record.switchedOff === null &&
      record.faultTurns.length >= FAULT_LIMIT
    ) {
      const off: ModSwitchOff = { id, site, why: messageOf(error), turn };
      record.switchedOff = off;
      try {
        this.options.onSwitchOff?.(off);
      } catch (reportError) {
        queueMicrotask(() => {
          throw reportError;
        });
      }
    }
  }
}

/**
 * The turns still inside the window ending at `turn`. A turn later than `turn`
 * belongs to another game (a character loaded after it) and is dropped too.
 */
function inWindow(turns: readonly number[], turn: number): number[] {
  return turns.filter((t) => t <= turn && turn - t < FAULT_WINDOW_TURNS);
}

function defaultNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

const monitor = new ModHealthMonitor();

/** The page's one monitor. */
export function modHealth(): ModHealthMonitor {
  return monitor;
}

/** Set the page monitor's turn source, clock, enforcement and listeners (main.ts at boot, and tests). */
export function configureModHealth(options: ModHealthOptions): void {
  monitor.configure(options);
}

/**
 * What the player is told when a mod is switched off, as lines.
 *
 * `name` is the mod's proper name from its manifest. Without one the notice is
 * worded so it needs none; the id is never shown.
 */
export function switchOffNotice(off: ModSwitchOff, name: string | undefined): string[] {
  const what = off.reason === "stall" ? "stopped responding" : "kept failing";
  return [
    name === undefined
      ? `A mod ${what}, so it is switched off until the game next starts.`
      : `${name} ${what}, so it is switched off until the game next starts.`,
    "",
    ...(off.reason === "stall"
      ? [`${off.why.charAt(0).toUpperCase()}${off.why.slice(1)}, so the game stopped it.`]
      : [`It failed ${String(FAULT_LIMIT)} times within ${String(FAULT_WINDOW_TURNS)} game turns. The last failure, in ${off.site}:`, off.why]),
    "",
    "It is still on in your mod list and will load again next time. To keep it",
    "off, turn it off on the Mods screen. The game itself carries on as normal.",
    "",
    "Reporting it helps its author fix it. The report page lists where to send it.",
  ];
}
