/**
 * Color-cycle + legacy flicker animation engine, ported from
 * reference/src/ui-visuals.c (Angband 4.2.6).
 *
 * This is the front-end-agnostic half of the visuals subsystem: given a
 * color cycle group/name (or a monster race, or a base selection attr) and a
 * frame counter, it returns the COLOUR_* attr to draw for that frame. It has
 * no DOM/canvas dependency; a front end owns the frame timer and the actual
 * glyph/tile draw. The stateful interpretation that ui-visuals.c performs at
 * parse time is reproduced here in the builders (buildVisualsFlicker /
 * buildVisualsCycler) that consume the compiled visuals.txt pack record.
 *
 * Faithful details preserved from the C:
 *  - visuals_color_cycle_attr_for_frame (L169): step = frame % max_steps.
 *  - visuals_color_cycle_copy (L126): a cycle is compressed to only its valid
 *    colors (preserving order) when moved into a group, so attrForFrame wraps
 *    over the real color count, not the padded VISUALS_STEPS_MAX capacity.
 *  - visuals_flicker_get_attr_for_frame (L633): the flicker table is indexed
 *    by the selection attr (the color code on the `flicker:` line), then by
 *    frame % colors_per_cycle. Out-of-range selection attr -> BASIC_COLORS.
 *  - visuals_flicker_set_color (L574): flicker cycles are filled by the
 *    selection attr, so "the last one listed wins" for a duplicate selection.
 *  - visuals_cycler_set_cycle_for_race (L420) / _get_attr_for_race (L468):
 *    a race->cycle lookup table, growable by ridx, returns BASIC_COLORS when
 *    a race has no cycle.
 *  - do_animation (ui-display.c L1435): animateMonsterAttr replicates the
 *    per-monster branch (RF_ATTR_MULTI random, RF_ATTR_FLICKER cycle ->
 *    flicker -> base fallback, otherwise static).
 */

import { colorCharToAttr } from "../color";

/**
 * z-color.h BASIC_COLORS: the count of the basic color attrs (0..28). It
 * doubles as the "no color / invalid" sentinel the cycler/flicker return on a
 * miss, since it is one past the last valid attr. (This equals color.ts
 * MAX_COLORS, which is the C's BASIC_COLORS value, not the C's MAX_COLORS.)
 */
export const BASIC_COLORS = 29;

/**
 * z-color.h MAX_COLORS (32). The flicker table is sized with this by
 * ui_visuals_module_init: visuals_flicker_new(MAX_COLORS, 3). Kept distinct
 * from BASIC_COLORS so the selection-attr bound check matches the C exactly.
 */
export const VISUALS_MAX_COLORS = 32;

/** ui-visuals.c VISUALS_STEPS_MAX (L35): max colors per color cycle. */
export const VISUALS_STEPS_MAX = 32;

/** ui-visuals.c VISUALS_INVALID_COLOR (L38): unused-step marker. */
export const VISUALS_INVALID_COLOR = 0xff;

/** ui_visuals_module_init: colors_per_cycle for the legacy flicker table. */
const FLICKER_COLORS_PER_CYCLE = 3;

/* ----- Fancy Color Cycling ----- */

/**
 * struct visuals_color_cycle (ui-visuals.c L45): an ordered set of color
 * attrs to rotate through, plus the padding capacity and invalid marker.
 */
export class VisualsColorCycle {
  readonly cycleName: string;
  readonly invalidColor: number;
  /** The steps array (length maxSteps), invalidColor for unused slots. */
  private readonly stepValues: number[];

  private constructor(name: string, stepCount: number, invalidColor: number) {
    this.cycleName = name;
    this.invalidColor = invalidColor;
    this.stepValues = new Array<number>(stepCount).fill(invalidColor);
  }

  /** visuals_color_cycle_new (L62): NULL (here null) when stepCount is 0. */
  static create(
    name: string,
    stepCount: number,
    invalidColor: number,
  ): VisualsColorCycle | null {
    if (stepCount === 0) return null;
    return new VisualsColorCycle(name, stepCount, invalidColor);
  }

  get maxSteps(): number {
    return this.stepValues.length;
  }

  /** The step attrs, including any invalid padding. */
  get steps(): readonly number[] {
    return this.stepValues;
  }

  /** Set the attr at a step (no-op if out of range, like the raw array). */
  setStep(index: number, attr: number): void {
    if (index >= 0 && index < this.stepValues.length) {
      this.stepValues[index] = attr;
    }
  }

  /**
   * visuals_color_cycle_copy (L126): a new cycle holding only the valid
   * colors of this one, in order. Returns null if there are no valid colors
   * (matching visuals_color_cycle_new(0) -> NULL).
   */
  copy(): VisualsColorCycle | null {
    const valid = this.stepValues.filter((s) => s !== this.invalidColor);
    const copy = VisualsColorCycle.create(
      this.cycleName,
      valid.length,
      this.invalidColor,
    );
    if (copy === null) return null;
    for (let i = 0; i < valid.length; i++) copy.setStep(i, valid[i]!);
    return copy;
  }

  /**
   * visuals_color_cycle_attr_for_frame (L169): the color for a frame, i.e.
   * steps[frame % max_steps]. On a compressed (copied) cycle this wraps over
   * the true color count.
   */
  attrForFrame(frame: number): number {
    const step = frame % this.stepValues.length;
    return this.stepValues[step]!;
  }
}

/**
 * struct visuals_cycle_group (L186): named group of color cycles. Modeled as
 * an insertion-ordered map of cycle-name -> cycle (the C uses parallel arrays
 * but only ever looks cycles up by name).
 */
class VisualsCycleGroup {
  readonly groupName: string;
  readonly cycles: Map<string, VisualsColorCycle>;

  constructor(name: string) {
    this.groupName = name;
    this.cycles = new Map();
  }

  /** visuals_cycler_cycle_by_name inner loop (L363): find a cycle by name. */
  cycleByName(name: string): VisualsColorCycle | null {
    return this.cycles.get(name) ?? null;
  }
}

/**
 * struct visuals_cycler (L261): the whole color-cycling table, groups of
 * color cycles. Built from the compiled visuals.txt `cycle` records.
 */
export class VisualsCycler {
  private readonly groups: Map<string, VisualsCycleGroup>;

  constructor() {
    this.groups = new Map();
  }

  /** Internal: fetch-or-create a group, preserving first-seen order. */
  private group(name: string): VisualsCycleGroup {
    let g = this.groups.get(name);
    if (g === undefined) {
      g = new VisualsCycleGroup(name);
      this.groups.set(name, g);
    }
    return g;
  }

  /**
   * Add (or replace) a cycle in a group. Replicates visuals_parse_cycle's
   * "if a cycle with a matching name is found, the parsed cycle replaces it"
   * (L968-987) via Map.set. The stored cycle is the compressed copy, matching
   * visuals_parse_context_convert (L807-813).
   */
  addCycle(groupName: string, cycle: VisualsColorCycle): void {
    const compressed = cycle.copy();
    if (compressed === null) return;
    this.group(groupName).cycles.set(cycle.cycleName, compressed);
  }

  /** visuals_cycler_cycle_by_name (L336): find a cycle by group + name. */
  cycleByName(groupName: string, cycleName: string): VisualsColorCycle | null {
    if (!groupName || !cycleName) return null;
    return this.groups.get(groupName)?.cycleByName(cycleName) ?? null;
  }

  /**
   * visuals_cycler_get_attr_for_frame (L384): attr for a group/cycle at a
   * frame, or BASIC_COLORS when the cycle is not found.
   */
  getAttrForFrame(groupName: string, cycleName: string, frame: number): number {
    const cycle = this.cycleByName(groupName, cycleName);
    if (cycle === null) return BASIC_COLORS;
    return cycle.attrForFrame(frame);
  }

  /** Number of groups (introspection for wiring/tests). */
  get groupCount(): number {
    return this.groups.size;
  }
}

/**
 * struct visuals_flicker (L496): the legacy flicker table, a fixed grid of
 * maxCycles * colorsPerCycle attrs indexed by [selection attr][step].
 */
export class VisualsFlicker {
  readonly maxCycles: number;
  readonly colorsPerCycle: number;
  private readonly cells: number[];

  private constructor(maxCycles: number, colorsPerCycle: number) {
    this.maxCycles = maxCycles;
    this.colorsPerCycle = colorsPerCycle;
    this.cells = new Array<number>(maxCycles * colorsPerCycle).fill(0);
  }

  /**
   * visuals_flicker_new (L515): null unless maxCycles >= BASIC_COLORS and
   * colorsPerCycle > 0, so the table can at least hold the basic colors.
   */
  static create(
    maxCycles: number,
    colorsPerCycle: number,
  ): VisualsFlicker | null {
    if (maxCycles < BASIC_COLORS || colorsPerCycle === 0) return null;
    return new VisualsFlicker(maxCycles, colorsPerCycle);
  }

  /** visuals_flicker_set_color (L574): set [cycle][color], ignore if OOB. */
  setColor(cycleIndex: number, colorIndex: number, attr: number): void {
    if (cycleIndex >= this.maxCycles) return;
    if (colorIndex >= this.colorsPerCycle) return;
    this.cells[cycleIndex * this.colorsPerCycle + colorIndex] = attr;
  }

  /** visuals_flicker_get_color (L603): [cycle][color], 0 if out of range. */
  getColor(cycleIndex: number, colorIndex: number): number {
    if (cycleIndex >= this.maxCycles) return 0;
    if (colorIndex >= this.colorsPerCycle) return 0;
    return this.cells[cycleIndex * this.colorsPerCycle + colorIndex]!;
  }

  /**
   * visuals_flicker_get_attr_for_frame (L633): the flicker color for a base
   * selection attr at a frame, or BASIC_COLORS if the attr is out of range.
   */
  getAttrForFrame(selectionAttr: number, frame: number): number {
    if (selectionAttr >= this.maxCycles) return BASIC_COLORS;
    const colorIndex = frame % this.colorsPerCycle;
    return this.getColor(selectionAttr, colorIndex);
  }
}

/* ----- Compiled-record builders ----- */

/** One `flicker` entry from the compiled visuals.txt record. */
export interface FlickerRecord {
  /** The selection color code (single char), e.g. "d". */
  color: string;
  /** Descriptive name (unused by the engine, kept for parity). */
  name?: string;
  /** The step color codes, in order. */
  "flicker-color"?: string[];
}

/** One `cycle` entry from the compiled visuals.txt record. */
export interface CycleRecord {
  group: string;
  name: string;
  "cycle-color"?: string[];
}

/** The single compiled visuals.txt record. */
export interface VisualsRecord {
  flicker?: FlickerRecord[];
  cycle?: CycleRecord[];
}

/**
 * Build the legacy flicker table from the compiled `flicker` records.
 * Faithful to visuals_parse_flicker (L828) + visuals_parse_flicker_color
 * (L863): each flicker entry selects a table row by its color's attr and
 * resets the step index; each following flicker-color fills the next step.
 * Duplicate selection attrs overwrite the same row (last wins). Invalid
 * color codes are skipped defensively (the C aborts parsing; the shipped
 * data is valid, so this is unreachable for pack zero).
 */
export function buildVisualsFlicker(
  records: readonly FlickerRecord[],
): VisualsFlicker {
  const table = VisualsFlicker.create(VISUALS_MAX_COLORS, FLICKER_COLORS_PER_CYCLE);
  /* create() only returns null for an impossible (too-small) config. */
  if (table === null) throw new Error("visuals: could not allocate flicker table");

  for (const rec of records) {
    const selection = colorCharToAttr(rec.color?.[0] ?? "");
    if (selection < 0) continue;
    const steps = rec["flicker-color"] ?? [];
    let colorIndex = 0;
    for (const code of steps) {
      const attr = colorCharToAttr(code[0] ?? "");
      if (attr < 0) continue;
      table.setColor(selection, colorIndex, attr);
      colorIndex++;
    }
  }
  return table;
}

/**
 * Build the color-cycle table from the compiled `cycle` records. Faithful to
 * visuals_parse_cycle (L900) + visuals_parse_cycle_color (L1001) followed by
 * visuals_parse_context_convert (L768): each cycle is created with
 * VISUALS_STEPS_MAX capacity, filled with its color attrs (capped at
 * capacity, matching PARSE_ERROR_TOO_MANY_ENTRIES), then compressed into its
 * group. Later group+name duplicates replace earlier ones.
 */
export function buildVisualsCycler(
  records: readonly CycleRecord[],
): VisualsCycler {
  const cycler = new VisualsCycler();
  for (const rec of records) {
    if (!rec.group || !rec.name) continue;
    const cycle = VisualsColorCycle.create(
      rec.name,
      VISUALS_STEPS_MAX,
      VISUALS_INVALID_COLOR,
    );
    /* VISUALS_STEPS_MAX is nonzero, so create never returns null here. */
    if (cycle === null) continue;
    const steps = rec["cycle-color"] ?? [];
    let stepIndex = 0;
    for (const code of steps) {
      if (stepIndex >= cycle.maxSteps) break; // PARSE_ERROR_TOO_MANY_ENTRIES
      const attr = colorCharToAttr(code[0] ?? "");
      if (attr < 0) continue;
      cycle.setStep(stepIndex, attr);
      stepIndex++;
    }
    cycler.addCycle(rec.group, cycle);
  }
  return cycler;
}

/* ----- Race binding + the animator ----- */

/**
 * The instantiable visuals animator: owns the flicker table, the color
 * cycler, and the race->cycle lookup (the three ui-visuals.c module globals),
 * and exposes the per-frame attr selection do_animation uses. Build one with
 * createVisualsAnimator from the compiled visuals.txt record.
 */
export class VisualsAnimator {
  readonly flicker: VisualsFlicker;
  readonly cycler: VisualsCycler;
  /** visuals_color_cycles_by_race: ridx -> cycle (sparse). */
  private readonly raceCycles: Array<VisualsColorCycle | null>;

  constructor(flicker: VisualsFlicker, cycler: VisualsCycler) {
    this.flicker = flicker;
    this.cycler = cycler;
    this.raceCycles = [];
  }

  /**
   * visuals_cycler_set_cycle_for_race (L420): map a race (by ridx) to a
   * cycle. A missing group/cycle leaves the race un-cycled (no entry).
   */
  setCycleForRace(ridx: number, groupName: string, cycleName: string): void {
    if (ridx < 0 || !groupName || !cycleName) return;
    const cycle = this.cycler.cycleByName(groupName, cycleName);
    if (cycle === null) return;
    this.raceCycles[ridx] = cycle;
  }

  /**
   * visuals_cycler_get_attr_for_race (L468): the cycled attr for a race at a
   * frame, or BASIC_COLORS when the race has no cycle.
   */
  getAttrForRace(ridx: number, frame: number): number {
    if (ridx < 0 || ridx >= this.raceCycles.length) return BASIC_COLORS;
    const cycle = this.raceCycles[ridx];
    if (!cycle) return BASIC_COLORS;
    return cycle.attrForFrame(frame);
  }
}

/**
 * Assemble a VisualsAnimator from the compiled visuals.txt record
 * (records[0] of pack visuals.json). Mirrors ui_visuals_module_init: create
 * the flicker table and parse the cycler.
 */
export function createVisualsAnimator(record: VisualsRecord): VisualsAnimator {
  const flicker = buildVisualsFlicker(record.flicker ?? []);
  const cycler = buildVisualsCycler(record.cycle ?? []);
  return new VisualsAnimator(flicker, cycler);
}

/** The animation inputs do_animation reads for one monster. */
export interface AnimateMonsterOptions {
  /** race->ridx, for the race->cycle lookup. */
  ridx: number;
  /** The base (static) attr, monster_x_attr[ridx] (i.e. race dAttr). */
  baseAttr: number;
  /** rf_has(race->flags, RF_ATTR_MULTI). */
  attrMulti: boolean;
  /** rf_has(race->flags, RF_ATTR_FLICKER). */
  attrFlicker: boolean;
  /** The module flicker frame counter. */
  frame: number;
  /**
   * randint1(n) yields 1..n. do_animation uses the game RNG; a display timer
   * should inject a display-only RNG so animation does not perturb the
   * deterministic game RNG (see the ledger's animation-frame seam).
   */
  randint1: (n: number) => number;
}

/**
 * do_animation's per-monster attr selection (ui-display.c L1445-1464). Returns
 * the animated attr, or null when the monster is not animated (upstream
 * `continue`, leaving mon->attr untouched at its static value).
 *
 *  - RF_ATTR_MULTI: randint1(BASIC_COLORS - 1), a shimmering random color.
 *  - RF_ATTR_FLICKER: the race's color cycle, else the legacy flicker cycle
 *    for the base attr, else the static base attr.
 *  - neither flag: null (static).
 */
export function animateMonsterAttr(
  animator: VisualsAnimator,
  opts: AnimateMonsterOptions,
): number | null {
  if (opts.attrMulti) {
    return opts.randint1(BASIC_COLORS - 1);
  }
  if (opts.attrFlicker) {
    let attr = animator.getAttrForRace(opts.ridx, opts.frame);
    if (attr === BASIC_COLORS) {
      attr = animator.flicker.getAttrForFrame(opts.baseAttr, opts.frame);
    }
    if (attr === BASIC_COLORS) {
      attr = opts.baseAttr;
    }
    return attr;
  }
  return null;
}
