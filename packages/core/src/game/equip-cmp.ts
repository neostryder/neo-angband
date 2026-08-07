/**
 * The equipment-comparison grid's data model, ported from
 * reference/src/ui-equip-cmp.c (initialize_summary, filter_items,
 * sort_items, compute_player_and_equipment_values, set_short_name).
 *
 * Upstream builds one big screen: property columns (resistances / abilities
 * / hindrances / modifiers / stat_modifiers, each scoped to category
 * "EQUIPCMP_SCREEN") across every wearable item the player has seen - worn,
 * carried, on the floor underfoot, at home, or in the (non-home) stores -
 * plus a combined "@" row showing what the player + current equipment adds
 * up to. This module reuses the same ui-entry compute/render backend the
 * character screen uses (game/ui-entry.ts); it does not re-derive any
 * combat/resist arithmetic.
 *
 * Deliberately simplified vs. the C, per the port's shell-adaptation plan:
 *  - The intricate terminal-width-driven 2/3-"view" column repartition
 *    (reconfigure_for_term_if_necessary) is reduced to a fixed 2-view split
 *    (all categories, then stat_modifiers alone) plus an optional 3-view
 *    split that also breaks out "modifiers" - correct data, simpler paging,
 *    as the port's shell-adaptation notes explicitly allow.
 *  - The dump-to-file command (d) writes a text file and rides the port's
 *    host-io layer with the other dumps.
 *
 * The quick attribute filter (q / !, prompt_for_easy_filter) IS here:
 * matchEquipCmpFilter does its label lookup and equipCmpFilterKeeps its six
 * selector functions, applied through EquipCmpOptions.filter. It was called a
 * "UI convenience" and skipped, which was wrong - it is a default part of the
 * screen on every platform. The source-cycle (c), reverse (r), and reset (R)
 * behaviours are faithful.
 *
 * No RNG: every value here is a deterministic function of already-computed
 * object/player state (curses, runes, equipment) - this is a pure display
 * model, like the rest of the ui-entry backend it is built on.
 */

import type { GameObject } from "../obj/object.js";
import type { Player } from "../player/player.js";
import type { GameState } from "./context.js";
import { gearGet } from "./gear.js";
import { floorPile } from "./floor.js";
import { wieldSlot } from "./gear.js";
import { ignoreLevelOf, IGNORE } from "../obj/ignore.js";
import { objectFullyKnown, objectKnownShadow } from "../obj/known-object.js";
import { tvalIsWearable } from "../obj/object.js";
import { describeObject, knownDescOf, objectKnownView } from "./describe.js";
import { ODESC } from "../obj/desc.js";
import { objectAttrChar } from "./display.js";
import { FEAT } from "../generated/index.js";
import {
  buildUiEntryConfig,
  equipCmpCategories,
  equipCmpColumnLabel,
  equipCmpFilterLabel3,
  combineEntryValues,
  computeObjectValues,
  computePlayerValues,
  applyRenderer,
  resolveUiDeps,
  isUiEntryForKnownRune,
} from "./ui-entry.js";
import type { UiEntryConfig, UiEntryDeps, UiEntryCell } from "./ui-entry.js";
import { playerFlags } from "../player/calcs.js";

export type EquipCmpSource = "worn" | "pack" | "floor" | "home" | "store";
export type EquipCmpQuality = "artifact" | "ego" | "good" | "average" | "bad";

/** equip_cmp's four source-cycle states (ACT_CTX_EQUIPCMP_CYCLE_SOURCES). */
export type StoreInclusion = "no-store" | "only-store" | "yes-store" | "only-carried";

/* eslint-disable @typescript-eslint/no-unused-vars -- ui-equip-cmp.c's two cycle
 * orders. The cycles below are written out longhand to mirror the C's switch, so
 * these read as documentation of the order those cases must follow. */
const SOURCE_ORDER: readonly EquipCmpSource[] = ["worn", "pack", "floor", "home", "store"];
const QUALITY_ORDER: readonly EquipCmpQuality[] = ["artifact", "ego", "good", "average", "bad"];
/* eslint-enable @typescript-eslint/no-unused-vars */

/** cycle_sources (ui-equip-cmp.c L687-758): NO_STORE -> ONLY_STORE -> YES_STORE -> ONLY_CARRIED -> NO_STORE. */
export function cycleStoreInclusion(cur: StoreInclusion): StoreInclusion {
  switch (cur) {
    case "no-store":
      return "only-store";
    case "only-store":
      return "yes-store";
    case "yes-store":
      return "only-carried";
    default:
      return "no-store";
  }
}

export interface EquipCmpColumn {
  /** The ui_entry name (e.g. "resist_ui_compact_0<ACID>"); stable per column. */
  key: string;
  /** get_ui_entry_label(entry, 3, true): the 2-char header. */
  label: string;
  /** get_ui_entry_label(entry, 4, false): what a 3-char filter code matches. */
  label3: string;
  category: string;
}

export interface EquipCmpItem {
  obj: GameObject;
  /** set_short_name: artifact/ego name tail, else the terse combat name. */
  shortName: string;
  src: EquipCmpSource;
  quality: EquipCmpQuality;
  slot: number;
  equippyCh: string;
  equippyAttr: number;
  /** One cell per column, in the same order as EquipCmpModel.columns. */
  cells: UiEntryCell[];
  /**
   * equippable.vals[]: the raw per-property value behind each cell, before the
   * renderer turned it into a symbol. The easy filter's six selector functions
   * (ui-equip-cmp.c:1643-1682) all test exactly this number.
   */
  vals: number[];
}

export interface EquipCmpModel {
  columns: EquipCmpColumn[];
  /** The "@" combined player+equipment row, one cell per column. */
  combinedCells: UiEntryCell[];
  /** Filtered and sorted (cmp_by_slot/location/quality/short_name). */
  items: EquipCmpItem[];
  stores: StoreInclusion;
}

export interface EquipCmpOptions {
  /** Default "no-store" (easy_filt's initial state, L2480-2486). */
  source?: StoreInclusion;
  /** ACT_CTX_EQUIPCMP_REVERSE: reverse the sorted order. */
  reverse?: boolean;
  /** UiEntryDeps passthrough (timed flags / element effects / playerHas). */
  entryDeps?: UiEntryDeps;
  /** The 'q' / '!' quick filter, from matchEquipCmpFilter. Absent: no filter. */
  filter?: EquipCmpEasyFilter | null;
}

/**
 * One configured quick ("easy") filter: the property column it tests and
 * whether the sense is inverted, which is all `easy_filt` carries beyond the
 * store selector the port models separately (passesSourceFilter).
 */
export interface EquipCmpEasyFilter {
  /** Index into EquipCmpModel.columns. */
  column: number;
  /** '!' rather than 'q' (apply_not). */
  not: boolean;
}

/** get_string's prompt for the quick filter (ui-equip-cmp.c:1237). */
export const EQUIP_CMP_FILTER_PROMPT =
  "Enter 2 or 3 (for stat) character code and return or return to clear ";

/** The failure message, shown in the dialogue line (ui-equip-cmp.c:1231). */
export const EQUIP_CMP_FILTER_NO_MATCH =
  "Did not find attribute with that name; filter unchanged";

/**
 * The four capitalisation attempts prompt_for_easy_filter makes before giving up
 * (ui-equip-cmp.c:1273-1330), in order. A 3-character code only gets the first
 * three: the fourth attempt writes a 2-character string, and the loop's
 * `threec && itry >= 3` guard stops before it.
 */
function filterCodeAttempts(code: string): string[] {
  const up = (s: string): string => s.toUpperCase();
  const lo = (s: string): string => s.toLowerCase();
  const head = code.slice(0, 1);
  const tail = code.slice(1);
  const attempts = [
    up(head) + lo(tail),
    up(head) + up(tail),
    lo(head) + lo(tail),
  ];
  /* itry 3 only ever produces two characters (ctry[2] = '\0'). */
  if (code.length <= 2) attempts.push(lo(head) + up(tail));
  return attempts;
}

/**
 * prompt_for_easy_filter's label lookup (ui-equip-cmp.c:1258-1360): find the
 * property column whose label matches the typed code under any of upstream's
 * capitalisation attempts. A 3-character code is matched against the 3-char
 * label (all three characters, pad included); anything else against the first
 * two characters of the 2-char column header, which is how a 1-character code
 * fails to match anything.
 *
 * Returns null for upstream's "Did not find attribute with that name".
 */
export function matchEquipCmpFilter(
  columns: readonly EquipCmpColumn[],
  code: string,
  not: boolean,
): EquipCmpEasyFilter | null {
  const threec = code.length >= 3;
  const typed = code.slice(0, 3);
  for (const attempt of filterCodeAttempts(typed)) {
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]!;
      const label = threec ? col.label3 : col.label;
      const hit = threec
        ? label.slice(0, 3) === attempt.slice(0, 3)
        : label.slice(0, 2) === attempt.slice(0, 2);
      if (hit) return { column: i, not };
    }
  }
  return null;
}

/**
 * The selector prompt_for_easy_filter installs, chosen by the property's
 * category (its `switch (j)`, ui-equip-cmp.c:1372-1425) and applied to the raw
 * value (the six sel_* functions, L1643-1682):
 *
 * - resistances:    val >= 1        (sel_at_least_resists)
 * - abilities:      val != 0        (sel_has_flag - a flag where on is wanted)
 * - hindrances:     val == 0        (sel_does_not_have_flag - INVERTED, because
 *                                   for a hindrance the desirable state is off)
 * - modifiers,
 *   stat_modifiers: val > 0         (sel_has_pos_mod)
 *
 * `not` swaps each for its complement.
 */
export function equipCmpFilterKeeps(
  columns: readonly EquipCmpColumn[],
  filter: EquipCmpEasyFilter,
  vals: readonly number[],
): boolean {
  const col = columns[filter.column];
  if (!col) return true;
  const val = vals[filter.column] ?? 0;
  let keep: boolean;
  switch (col.category) {
    case "resistances":
      keep = val >= 1;
      break;
    case "abilities":
      keep = val !== 0;
      break;
    case "hindrances":
      keep = val === 0;
      break;
    default:
      keep = val > 0;
      break;
  }
  return filter.not ? !keep : keep;
}

let cachedConfig: UiEntryConfig | null = null;
let cachedConfigKey: unknown = null;

/** Memoise buildUiEntryConfig per pack (it is pure and pack-shaped, not per-call). */
function uiEntryConfigFor(packs: Parameters<typeof buildUiEntryConfig>[0]): UiEntryConfig {
  if (cachedConfig && cachedConfigKey === packs) return cachedConfig;
  cachedConfig = buildUiEntryConfig(packs);
  cachedConfigKey = packs;
  return cachedConfig;
}

/** set_short_name (ui-equip-cmp.c L1601), truncated to 20 chars (nshortnm cap). */
function shortName(state: GameState, obj: GameObject): string {
  const cap = 20;
  if (obj.artifact) {
    const n = obj.artifact.name;
    return n.length <= cap ? n : n.slice(n.length - cap);
  }
  if (obj.ego) {
    const n = obj.ego.name;
    return n.length <= cap ? n : n.slice(n.length - cap);
  }
  const n = describeObject(state, obj, ODESC.COMBAT | ODESC.SINGULAR | ODESC.TERSE);
  return n.length <= cap ? n : n.slice(0, cap);
}

/** equippable_quality (add_obj_to_summary L2080-2104). */
function quality(state: GameState, obj: GameObject): EquipCmpQuality {
  switch (ignoreLevelOf(obj, objectKnownView(state, obj))) {
    case IGNORE.GOOD:
      return "good";
    case IGNORE.AVERAGE:
      return "average";
    case IGNORE.BAD:
      return "bad";
    default:
      if (obj.artifact) return "artifact";
      if (obj.ego) return "ego";
      return "average";
  }
}

interface GatheredItem {
  obj: GameObject;
  src: EquipCmpSource;
}

/** initialize_summary's five visitors (L2386 body): worn / pack / floor / home / store. */
function gatherItems(state: GameState): GatheredItem[] {
  const out: GatheredItem[] = [];
  const player = state.actor.player;

  // WORN: apply_visitor_to_equipped (select_any).
  for (let i = 0; i < player.body.count; i++) {
    const handle = player.equipment[i] ?? 0;
    const obj = handle ? gearGet(state.gear, handle) : null;
    if (obj) out.push({ obj, src: "worn" });
  }

  // PACK: select_nonequipped_wearable over p->gear (the pack list already
  // excludes equipped handles - see game/gear.ts Gear.pack).
  for (const handle of state.gear.pack) {
    const obj = gearGet(state.gear, handle);
    if (obj && tvalIsWearable(obj.tval)) out.push({ obj, src: "pack" });
  }

  // FLOOR: select_seen_wearable over square_object(cave, player->grid).
  for (const obj of floorPile(state, state.actor.grid)) {
    if (tvalIsWearable(obj.tval)) out.push({ obj, src: "floor" });
  }

  // HOME / STORE: guarded - the web shell may have no live stores/home stock.
  for (const store of state.stores ?? []) {
    const src: EquipCmpSource = store.feat === FEAT.HOME ? "home" : "store";
    for (const obj of store.stock) {
      if (tvalIsWearable(obj.tval)) out.push({ obj, src });
    }
  }

  return out;
}

/** sel_exclude_src / sel_only_src (L1701-1712) for the easy_filt source cycle. */
function passesSourceFilter(src: EquipCmpSource, mode: StoreInclusion): boolean {
  switch (mode) {
    case "no-store":
      return src !== "store";
    case "only-store":
      return src === "store";
    case "yes-store":
      return true;
    case "only-carried":
      return src === "worn" || src === "pack";
  }
}

const SRC_RANK: Record<EquipCmpSource, number> = {
  worn: 0,
  pack: 1,
  floor: 2,
  home: 3,
  store: 4,
};
const QUAL_RANK: Record<EquipCmpQuality, number> = {
  artifact: 0,
  ego: 1,
  good: 2,
  average: 3,
  bad: 4,
};

/** cmp_by_slot -> cmp_by_location -> cmp_by_quality -> cmp_by_short_name (L1900-1919, default_sort). */
function compareItems(a: EquipCmpItem, b: EquipCmpItem): number {
  if (a.slot !== b.slot) return a.slot - b.slot;
  const sa = SRC_RANK[a.src];
  const sb = SRC_RANK[b.src];
  if (sa !== sb) return sa - sb;
  const qa = QUAL_RANK[a.quality];
  const qb = QUAL_RANK[b.quality];
  if (qa !== qb) return qa - qb;
  return a.shortName < b.shortName ? -1 : a.shortName > b.shortName ? 1 : 0;
}

/**
 * equipCmpSummary: the equip-cmp grid model - columns (with faithful 2-char
 * labels), the "@" combined row, and the filtered/sorted item rows. Reuses
 * computeObjectValues / computePlayerValues / combineEntryValues / applyRenderer
 * (ui-entry.ts) so no combat/resist value is re-derived here.
 */
export function equipCmpSummary(
  state: GameState,
  packs: Parameters<typeof buildUiEntryConfig>[0],
  opts: EquipCmpOptions = {},
): EquipCmpModel {
  const config = uiEntryConfigFor(packs);
  const player: Player = state.actor.player;
  const source = opts.source ?? "no-store";
  const rd = resolveUiDeps(player, opts.entryDeps ?? {});
  const untimedCache = { untimed: playerFlags(player) };

  const cats = equipCmpCategories(config);
  const columns: EquipCmpColumn[] = [];
  for (const cat of cats) {
    for (const entry of cat.entries) {
      columns.push({
        key: entry.name,
        label: equipCmpColumnLabel(entry),
        label3: equipCmpFilterLabel3(entry),
        category: cat.key,
      });
    }
  }
  const flatEntries = cats.flatMap((c) => c.entries);

  // Equipped objects (for the "@" combined row): compute_player_and_equipment_values.
  const equipped: GameObject[] = [];
  for (let i = 0; i < player.body.count; i++) {
    const handle = player.equipment[i] ?? 0;
    const obj = handle ? gearGet(state.gear, handle) : null;
    if (obj) equipped.push(obj);
  }

  /* obj->known, synthesised once per object: object_flag_is_known and
   * object_element_is_known both take object_fully_known as their first route
   * out (obj-knowledge.c:777, 799), and mundane gear carries no runes at all, so
   * it IS fully known and must print '.' down every column. Reading p->obj_k
   * alone printed '?' for a plain torch or soft leather armour - the same defect
   * the character sheet's resist grid had (its fix is ui-entry.ts:1857), which
   * this screen never got. */
  const knownDesc = knownDescOf(state);
  const fullyKnown = (obj: GameObject): boolean =>
    objectFullyKnown(obj, objectKnownShadow(obj, player, state.runeEnv, knownDesc), player, state.runeEnv);

  const combinedCells: UiEntryCell[] = flatEntries.map((entry) => {
    const playerVal = computePlayerValues(entry, player, rd, untimedCache);
    const vals = [playerVal.val];
    const auxs = [playerVal.auxval];
    for (const obj of equipped) {
      const ov = computeObjectValues(entry, obj, player, fullyKnown(obj));
      vals.push(ov.val);
      auxs.push(ov.auxval);
    }
    const { accum, accumAux } = combineEntryValues(entry, vals, auxs);
    const renderer = config.renderers[entry.rendererIndex - 1];
    if (!renderer) return { symbol: " ", color: 1 };
    const rendered = applyRenderer(renderer, [accum], [accumAux], {
      knownRune: isUiEntryForKnownRune(entry, player),
      alternateColorFirst: false,
    });
    return rendered.cells[0] ?? { symbol: " ", color: 1 };
  });

  const gathered = gatherItems(state).filter((g) => passesSourceFilter(g.src, source));
  let items: EquipCmpItem[] = gathered.map(({ obj, src }) => {
    const vals: number[] = [];
    const known = fullyKnown(obj);
    const cells: UiEntryCell[] = flatEntries.map((entry) => {
      const ov = computeObjectValues(entry, obj, player, known);
      vals.push(ov.val);
      const renderer = config.renderers[entry.rendererIndex - 1];
      if (!renderer) return { symbol: " ", color: 1 };
      const rendered = applyRenderer(renderer, [ov.val], [ov.auxval], {
        knownRune: isUiEntryForKnownRune(entry, player),
        alternateColorFirst: false,
      });
      return rendered.cells[0] ?? { symbol: " ", color: 1 };
    });
    return {
      obj,
      vals,
      shortName: shortName(state, obj),
      src,
      quality: quality(state, obj),
      slot: wieldSlot(player.body, obj.tval, player.equipment),
      /* object_char / object_attr (ui-equip-cmp.c:2107-2108), not the kind
       * record: an unidentified ring listed here drew dark like everywhere
       * else the flavour rule was skipped. */
      equippyCh: objectAttrChar(state, obj).char,
      equippyAttr: objectAttrChar(state, obj).attr,
      cells,
    };
  });

  /* filter_items then sort_items (prompt_for_easy_filter L1428-1429): the quick
   * filter narrows the gathered set before the ordering is applied. */
  const filter = opts.filter ?? null;
  if (filter) items = items.filter((it) => equipCmpFilterKeeps(columns, filter, it.vals));

  items = items.sort(compareItems);
  if (opts.reverse) items = items.slice().reverse();

  return { columns, combinedCells, items, stores: source };
}
