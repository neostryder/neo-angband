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
 *  - The free-text quick attribute filter (q/!, prompt_for_easy_filter) and
 *    the dump-to-file command (d) are UI conveniences over this same model;
 *    they are not implemented here (see the web equip-cmp screen for which
 *    keys are wired). The source-cycle (c), reverse (r), and reset (R)
 *    behaviours ARE implemented, faithfully.
 *
 * No RNG: every value here is a deterministic function of already-computed
 * object/player state (curses, runes, equipment) - this is a pure display
 * model, like the rest of the ui-entry backend it is built on.
 */

import type { GameObject } from "../obj/object";
import type { Player } from "../player/player";
import type { GameState } from "./context";
import { gearGet } from "./gear";
import { floorPile } from "./floor";
import { wieldSlot } from "./gear";
import { ignoreLevelOf, IGNORE } from "../obj/ignore";
import { tvalIsWearable } from "../obj/object";
import { describeObject } from "./describe";
import { ODESC } from "../obj/desc";
import { colorCharToAttr } from "../color";
import { FEAT } from "../generated";
import {
  buildUiEntryConfig,
  equipCmpCategories,
  equipCmpColumnLabel,
  combineEntryValues,
  computeObjectValues,
  computePlayerValues,
  applyRenderer,
  resolveUiDeps,
  isUiEntryForKnownRune,
} from "./ui-entry";
import type { UiEntryConfig, UiEntryDeps, UiEntryCell } from "./ui-entry";
import { playerFlags } from "../player/calcs";

export type EquipCmpSource = "worn" | "pack" | "floor" | "home" | "store";
export type EquipCmpQuality = "artifact" | "ego" | "good" | "average" | "bad";

/** equip_cmp's four source-cycle states (ACT_CTX_EQUIPCMP_CYCLE_SOURCES). */
export type StoreInclusion = "no-store" | "only-store" | "yes-store" | "only-carried";

const SOURCE_ORDER: readonly EquipCmpSource[] = ["worn", "pack", "floor", "home", "store"];
const QUALITY_ORDER: readonly EquipCmpQuality[] = ["artifact", "ego", "good", "average", "bad"];

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
function quality(obj: GameObject): EquipCmpQuality {
  switch (ignoreLevelOf(obj)) {
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
      columns.push({ key: entry.name, label: equipCmpColumnLabel(entry), category: cat.key });
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

  const combinedCells: UiEntryCell[] = flatEntries.map((entry) => {
    const playerVal = computePlayerValues(entry, player, rd, untimedCache);
    const vals = [playerVal.val];
    const auxs = [playerVal.auxval];
    for (const obj of equipped) {
      const ov = computeObjectValues(entry, obj, player);
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
    const cells: UiEntryCell[] = flatEntries.map((entry) => {
      const ov = computeObjectValues(entry, obj, player);
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
      shortName: shortName(state, obj),
      src,
      quality: quality(obj),
      slot: wieldSlot(player.body, obj.tval, player.equipment),
      equippyCh: obj.kind.dChar,
      equippyAttr: colorCharToAttr(obj.kind.dAttr),
      cells,
    };
  });

  items = items.sort(compareItems);
  if (opts.reverse) items = items.slice().reverse();

  return { columns, combinedCells, items, stores: source };
}
