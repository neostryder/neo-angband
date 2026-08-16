/**
 * The producer for the second character screen's two closed tables: the value
 * COMBINERS and the renderer BACKENDS (game/ui-entry.ts).
 *
 * WHAT WAS SHUT. `ui_entry.json` has always accepted a new row, and a pack may
 * write `combine: "MY_OR"` or `code: "MY_BACKEND"` on it without any parse
 * error. What no pack could do was say what those names MEAN: `COMBINERS` was a
 * nine-entry module const that `combinerLookup` linear-scanned, and
 * `applyRenderer` was six hard-coded `if (backend === UI_ENTRY_RENDERER.X)`
 * arms. So a mod's row selected among nine pre-written reductions and six
 * hand-written render algorithms, or it selected nothing. #271 changed only the
 * FAILURE MODE - an unknown combiner yields `ABSENT_COMBINER` instead of
 * throwing, so the screen survives - and survival is not reach. This is the
 * seam: the DISPATCH of the funcs and the backends, not the name column in the
 * pack.
 *
 * THE KEY IS THE NAME, NOT THE SLOT. Lookup was by name at parse and storage
 * was by POSITION afterwards - a 1-based `combinerIndex` and a 0..5
 * `backendIndex` - so reordering either table silently retargeted every built
 * config. Keeping the slot as the long-lived identity would also have frozen
 * core's table at nine and six and made a post-wire `register()` inert, which is
 * the exact "converted but unreachable" failure the projection wiring tests
 * exist to catch. `UiEntry.combinerName` and `RendererInfo.backendName` /
 * `.combinerName` are what a config now carries, and they are resolved against
 * the LIVE table at compute and apply time. Neither index was ever persisted to
 * a save (nothing under `save/` reads either field), so this is a code change
 * and not a save migration.
 *
 * TWO TABLES, NOT ONE. A combiner is a pure numeric reduction over (val, aux)
 * pairs; a backend is a large UI algorithm that turns those pairs into cell
 * symbols and palette colours and also needs default palettes of its own. They
 * compose differently and are written by different kinds of mod, so they are two
 * facades rather than one flat registry of everything ui-entry dispatches on.
 *
 * PER CODE, NOT PER TABLE, and PER GAME, NEVER SHARED - the same two rules
 * `ProjectionHandlerRegistry` states at length. A mod installs ONE name at a
 * time and `handlerFor(name)` hands back whatever is installed at that moment,
 * so mod B wraps mod A's combiner exactly as mod A wraps core's. And the
 * registry is constructed per game in `wireGame` with a COPY of core's tables,
 * so one character's mod cannot leak into the next character's game.
 *
 * UNKNOWN NAMES STILL SURVIVE. A combiner name nothing answers for still
 * resolves to `ABSENT_COMBINER` (every route NOT_PRESENT, the row reads as
 * "nothing here"), and a backend name nothing answers for still yields the
 * empty-cell row `applyRenderer` has returned since #271. Opening the table does
 * not make a typo fatal again.
 */

import { coreUiEntryBackends, coreUiEntryCombiners } from "./ui-entry.js";
import type {
  CombinerFuncs,
  RenderDetails,
  RenderedRow,
  RendererInfo,
} from "./ui-entry.js";

/**
 * The palette and formatting defaults a backend contributes to any renderer
 * record naming it - `struct backend_info`'s default_* fields
 * (ui-entry-renderers.c). `buildUiEntryConfig` reads these at parse to augment
 * whatever the pack record supplied (augment_colors / augment_symbols), so a
 * mod's backend can ship a full palette and a pack row need only name it.
 */
export interface UiEntryBackendDefaults {
  /** The combiner used when the renderer record names none - or names one nothing answers for. */
  readonly defaultCombinerName: string;
  /** Cell colours, one colour-index character per palette slot. */
  readonly defaultColors: string;
  /** Label colours, one colour-index character per palette slot. */
  readonly defaultLabelColors: string;
  /** Cell symbols, one code unit per palette slot. */
  readonly defaultSymbols: string;
  /** Digits in a numeric cell. */
  readonly defaultNDigit: number;
  /** "NO_SIGN" | "ALWAYS_SIGN" | "NEGATIVE_SIGN". */
  readonly defaultSign: string;
}

/**
 * One renderer backend: (val, aux) pairs in, a row of cells plus a label colour
 * out. The same five arguments `applyRenderer` receives, plus the combiner it
 * has ALREADY resolved by name against the live table - a backend must not
 * re-resolve, or a mod that replaced `ADD` would be honoured by core's six
 * backends and ignored by everyone else's.
 */
export type UiEntryBackendRender = (
  renderer: RendererInfo,
  vals: number[],
  auxvals: number[],
  details: RenderDetails,
  combiner: CombinerFuncs,
) => RenderedRow;

/** A backend as the registry holds it: the algorithm and its palette defaults. */
export interface UiEntryBackend {
  readonly render: UiEntryBackendRender;
  readonly defaults: UiEntryBackendDefaults;
}

/**
 * One name-keyed table, seeded with a copy of core's.
 *
 * The key is the NAME the pack writes ("ADD", "my-mod:worst-of"), never the
 * slot it happened to occupy: a slot is a coordinate into core's compiled table
 * and a mod's entry has no slot at all.
 */
export class UiEntryNameTable<H> {
  private readonly handlers: Map<string, H>;

  constructor(core: ReadonlyMap<string, H>) {
    this.handlers = new Map(core);
  }

  /** Install (or replace) the handler for one name. */
  set(name: string, handler: H): void {
    this.handlers.set(name, handler);
  }

  /**
   * The handler currently installed for a name, or null. This is the wrap seam:
   * take what is there, install one that calls through to it. What comes back is
   * core's until some mod has replaced it, and that mod's afterwards.
   */
  handlerFor(name: string): H | null {
    return this.handlers.get(name) ?? null;
  }

  /** Whether anything answers for this name. */
  has(name: string): boolean {
    return this.handlers.has(name);
  }

  /** Every name with a handler, in insertion order (core's first). */
  names(): readonly string[] {
    return [...this.handlers.keys()];
  }

  /**
   * The LIVE table the screens dispatch through. Held by identity from wireGame
   * onward, so a `set` after the game is wired is seen by the next character
   * sheet or equip comparison - which is the only time a mod's `register()` can
   * run.
   */
  get table(): ReadonlyMap<string, H> {
    return this.handlers;
  }
}

/**
 * The two ui-entry tables a mod can reach, seeded with core's nine combiners and
 * six renderer backends. Built per game in `wireGame` and published on
 * `GameState.uiEntry`.
 */
export class UiEntryRegistry {
  /** ui-entry-combiner.c's combiners: how several (val, aux) pairs reduce to one. */
  readonly combiners = new UiEntryNameTable<CombinerFuncs>(coreUiEntryCombiners());
  /** ui-entry-renderers.c's backends: how a (val, aux) pair becomes a cell. */
  readonly backends = new UiEntryNameTable<UiEntryBackend>(coreUiEntryBackends());
}
