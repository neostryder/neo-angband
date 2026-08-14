/**
 * Full-screen game views built from the core's UI data models: inventory,
 * equipment, character sheet, and message history. Each builder turns a core
 * model (gear list, char-sheet panels, stat table, message log) into styled
 * overlay lines the modal viewer renders; the object menus additionally return
 * the gear handles so a follow-up command (quaff/read/wield...) can reference
 * the picked item by `args.handle`.
 *
 * The core owns the data (describeObject gates names by knowledge/flavour;
 * characterPanels/statTable are the faithful ui-player.c port); this module is
 * pure presentation - no game mutation.
 */

import {
  describeObject,
  gearGet,
  characterPanels,
  statTable,
  colorToCss,
  colorCharToAttr,
  colorTextToAttr,
  ODESC,
  tvalIsBook,
  playerObjectToBook,
  spellCollectFromBook,
  spellByIndex,
  spellChance,
  makeSpellChanceEnv,
  spellOkayToCast,
  spellOkayToStudy,
  getUseDeviceChance,
  kindHasFlavor,
  tvalIsWearable,
  tvalCanHaveFailure,
  COLOUR_L_DARK,
  COLOUR_RED,
  targetGetMonsters,
  squareMonster,
  lookMonDesc,
  TARGET,
  buildObjectEffectChain,
  getSpellInfo,
  spellDamageSummary,
  PY_SPELL,
  COLOUR_WHITE,
  COLOUR_L_BLUE,
  COLOUR_YELLOW,
  TV,
  ITYPE,
  ITYPE_MAX,
  IGNORE,
  IGNORE_TYPE_ENTRIES,
  QUALITY_VALUE_NAMES,
  egoHasIgnoreType,
  KF,
  tvalIsMoney,
  COLOUR_L_RED,
  COLOUR_L_GREEN,
  objectListCollect,
  objectListSort,
  objectListStandardCompare,
  objectListEntryName,
  objectKindAttrChar,
  objectListEntryLineAttribute,
  OBJECT_LIST_SECTION_LOS,
  OBJECT_LIST_SECTION_NO_LOS,
  HIST,
  histHas,
  historyGetList,
  loreDescription,
  monsterListCollect,
  monsterListSort,
  monsterListStandardCompare,
  monsterListCompareExp,
  monsterListEntryLineColor,
  MONSTER_LIST_SECTION_LOS,
  MONSTER_LIST_SECTION_ESP,
  COLOUR_ORANGE,
  getMonName,
  TMD,
  EQUIP_SLOT_ENTRIES,
  monsterKnowledgeGroups,
  weightRemaining,
} from "@rpgm-tools/neo-angband-core";
import type {
  GameState,
  GameObject,
  Monster,
  EffectRecordJson,
  Textblock,
  TextRun,
  ProjectionInfo,
  IgnoreSettings,
  AutoinscriptionRegistry,
  EgoItem,
  ObjectKind,
  ObjRegistry,
  LoreDeps,
  LoreText,
  LoreStore,
  MonsterLore,
  MonsterRace,
  MonsterCategory,
} from "@rpgm-tools/neo-angband-core";
import type { ScreenLine, MenuItem } from "./overlay";
import {
  freezeView,
  screenBodyLines,
  SCREEN_FOOTER,
  UNMODELLED_SCREEN,
  type ScreenArtField,
  type ScreenBlock,
  type ScreenCell,
  type ScreenColumn,
  type ScreenRow,
  type ScreenTextBlock,
  type ScreenView,
} from "./screen-view";
import { MessageLog, format as formatMessage } from "./messages";
import { UI_TEXT, UI_DIM, UI_GOLD } from "./ui-colors";

const FG = UI_TEXT;
const DIM = UI_DIM;
const LABEL = UI_TEXT;

/**
 * all_letters_nohjkl (ui-menu.c L40-41): the object-list selection letters,
 * deliberately skipping the roguelike movement keys h,j,k,l. build_obj_list
 * (ui-object.c L292) and gear_to_label (obj-gear.c L446) label the
 * inventory/equipment/floor object lists with these; the quiver alone uses
 * digits (I2D). menuLetter (overlay.ts) is the full a..z run other menus need,
 * so object lists get this dedicated letter set instead.
 */
const ALL_LETTERS_NOHJKL = "abcdefgimnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The i-th object-list selection letter (all_letters_nohjkl[i]). */
export function objLetter(i: number): string {
  return ALL_LETTERS_NOHJKL[i] ?? "";
}

/**
 * equip_mention (obj-gear.c L301-313): the brief "how it is carried" string for
 * an equipment slot, from list-equip-slots.h's mention column - "Wielding",
 * "Shooting", "Light source", "On body"/"On back"/etc. For a name_in_desc slot
 * (ring/amulet/armour) the mention carries a %s that C fills with the slot's own
 * name via format(), giving "On right hand", "Around neck", "On head", ... We
 * reproduce that substitution here. The heavy_wield/heavy_shoot branch (which
 * swaps in heavy_describe) is a describe-path detail not surfaced by these
 * listings, so it is intentionally omitted.
 */
function equipMention(slot: { type: string; name: string }): string {
  const entry = EQUIP_SLOT_ENTRIES.find((e) => e.name === slot.type);
  if (!entry) return "";
  return entry.named ? entry.mention.replace("%s", slot.name) : entry.mention;
}

/**
 * A core Textblock as a `text` BLOCK: the run stream split into paragraphs on its
 * literal '\n', with each run's COLOUR_* attr resolved to css.
 *
 * The split is the whole point of the block. Core emits logical lines only
 * (obj-info.c stays width-agnostic) and the wrap is the RENDERING, so a presenter
 * with its own font gets the paragraphs and lays them out itself, while the
 * faithful terminal gets the same wrap it always had from `screenBodyLines`.
 */
function proseBlock(tb: Textblock): ScreenTextBlock {
  const paragraphs: { text: string; color: string }[][] = [[]];
  for (const run of tb.runs) {
    const color = colorToCss(run.attr);
    run.text.split("\n").forEach((piece, i) => {
      /* Every '\n' the core emitted is a paragraph break and nothing else is. */
      if (i > 0) paragraphs.push([]);
      if (piece === "") return;
      const para = paragraphs[paragraphs.length - 1]!;
      const last = para[para.length - 1];
      if (last && last.color === color) last.text += piece;
      else para.push({ text: piece, color });
    });
  }
  return { kind: "text", color: FG, paragraphs };
}

/**
 * Turn a core object-info Textblock into wrapped, per-run-coloured ScreenLine[]
 * sized to the terminal.
 *
 * Now the model's renderer rather than a second one: this is `screenBodyLines`
 * applied to a `text` block, exactly as `inventoryLines` is `screenBodyLines`
 * applied to `inventoryScreen`. Callers that show a whole page of prose should
 * build the SCREEN instead (`objectRecallScreen` and friends below) so a
 * presenter is offered the paragraphs; this stays for the places that genuinely
 * want lines - a menu's detail panel, which is not a screen.
 */
export function wrapRuns(tb: Textblock, cols: number): ScreenLine[] {
  return screenBodyLines(
    freezeView({
      id: UNMODELLED_SCREEN,
      title: "",
      footer: SCREEN_FOOTER,
      blocks: [proseBlock(tb)],
    }),
    cols,
  );
}

/**
 * The object recall page (object_info under an ODESC_CAPITAL header): the 'I'
 * inspect, the context menu's Inspect, the store's Examine, and one side of the
 * equipment comparison. One id for all four because they are the same page of
 * the same object seen from four places - a presenter that can draw an item's
 * mechanics can draw them wherever the player asked.
 */
export function objectRecallScreen(title: string, tb: Textblock): ScreenView {
  return freezeView({
    id: "core:object-recall",
    title,
    footer: SCREEN_FOOTER,
    blocks: [proseBlock(tb)],
  });
}

/**
 * display_object_comparison (ui-equip-cmp.c L1440): two items' object_info
 * textblocks back to back under their own headers.
 *
 * A separate id from `core:object-recall` because it is a COMPARISON - two
 * subjects, which is exactly the screen a presenter would want to draw as two
 * columns, and it could not tell that from the recall page if they shared an id.
 */
export function objectComparisonScreen(title: string, tb: Textblock): ScreenView {
  return freezeView({
    id: "core:object-comparison",
    title,
    footer: SCREEN_FOOTER,
    blocks: [proseBlock(tb)],
  });
}

/**
 * The display CSS colour for an object row in a list (inventory / equipment /
 * quiver / floor / store). Faithful to show_obj (ui-object.c L178-188) and
 * store_display_entry (ui-store.c L294): the row is coloured by the object
 * BASE's attr (kind->base->attr), NOT the kind d_attr or the flavour (those
 * drive the map glyph, a separate path). base.attr is a colour NAME
 * ("light umber") from object_base.txt, so it resolves by name.
 *
 * show_obj additionally slates an unreadable spellbook; store_display_entry
 * does not. That rule is therefore applied only when a caller passes `state`
 * (the inventory lists do; the store calls without it).
 */
export function objectColor(obj: GameObject, state?: GameState): string {
  if (
    state &&
    tvalIsBook(obj.tval) &&
    !playerObjectToBook(state.actor.player, obj)
  ) {
    return colorToCss(colorTextToAttr("slate"));
  }
  return colorToCss(colorTextToAttr(obj.kind.base.attr));
}

/** knowledge-gated full name of a gear object, e.g. "a Potion of Cure Light Wounds". */
export function objectName(state: GameState, obj: GameObject): string {
  return describeObject(state, obj, ODESC.PREFIX | ODESC.FULL);
}

/**
 * upkeep->inven[] in slot order - the ONE list every inventory view walks.
 *
 * build_obj_list is always handed `player->upkeep->inven` for the pack
 * (ui-object.c:504, :1547), never the master gear list. The two differ: gear.pack
 * is the port's p->gear-minus-equipment ordering and it still holds the handles
 * calc_inventory routed into the quiver (upstream keeps them on p->gear too), so
 * walking it listed quivered arrows and shots a second time under Inventory.
 * gear.inven is the computed, earlier_object-sorted view with the quiver removed.
 */
export function invenHandles(state: GameState): number[] {
  return [...(state.gear.inven ?? [])];
}

/**
 * Build an object-selection menu over the pack, optionally filtered (e.g. only
 * potions for quaff). Returns the menu items and the parallel gear handles so
 * the caller maps the chosen index to `args.handle`.
 */
export function packMenu(
  state: GameState,
  filter?: (obj: GameObject) => boolean,
): { items: MenuItem[]; handles: number[] } {
  const items: MenuItem[] = [];
  const handles: number[] = [];
  invenHandles(state).forEach((handle, slot) => {
    const obj = gearGet(state.gear, handle);
    if (!obj) return;
    if (filter && !filter(obj)) return;
    /* build_obj_list (ui-object.c:291-292): the label is
     * `all_letters_nohjkl[i]` where i is the object's own PACK SLOT - so a
     * filtered list (only potions, say) keeps each item's real inventory letter
     * instead of relettering from 'a'. `inscrip` carries obj->note for the
     * picker's @-tag quick-select (get_tag). */
    items.push({
      label: objectName(state, obj),
      color: objectColor(obj, state),
      tag: objLetter(slot),
      inscrip: obj.note,
      id: `core:gear:${handle}`,
      semantic: { kind: "item", ref: handle, data: { source: "inventory", slot } },
    });
    handles.push(handle);
  });
  return { items, handles };
}

/**
 * The Quiver source of a get_item picker (show_quiver, ui-object.c:531, which
 * hands build_obj_list `player->upkeep->quiver`). Rows are the FILLED slots and
 * each is labelled with its slot DIGIT - build_obj_list writes `I2D(i)` rather
 * than `all_letters_nohjkl[i]` when the list it was given is the quiver
 * (ui-object.c:291-292). Empty slots are skipped: only the OLIST_SEMPTY
 * subwindow listing shows them.
 */
export function quiverMenu(
  state: GameState,
  filter?: (obj: GameObject) => boolean,
): { items: MenuItem[]; handles: number[] } {
  const items: MenuItem[] = [];
  const handles: number[] = [];
  (state.gear.quiver ?? []).forEach((handle, slot) => {
    if (!handle) return;
    const obj = gearGet(state.gear, handle);
    if (!obj) return;
    if (filter && !filter(obj)) return;
    items.push({
      label: objectName(state, obj),
      color: objectColor(obj, state),
      tag: String(slot),
      inscrip: obj.note,
      id: `core:gear:${handle}`,
      semantic: { kind: "item", ref: handle, data: { source: "quiver", slot } },
    });
    handles.push(handle);
  });
  return { items, handles };
}

/**
 * The OLIST_WEIGHT column (ui-object.c L234-239): the total weight of a stack,
 * "%4d.%1d lb" where weight = number * object_weight_one (obj->weight, stored in
 * tenths of a pound). Right-hand column, appended after the item name.
 */
export function objectWeightColumn(obj: GameObject): string {
  const weight = obj.number * obj.weight;
  return `${String(Math.trunc(weight / 10)).padStart(4)}.${weight % 10} lb`;
}

/**
 * object_effect_is_known via the objectSetBaseKnown effect gate
 * (known-object.ts L188-201, from obj-knowledge.c L846-856): the player knows a
 * used object's effect when it is a flavoured kind they are aware of, an
 * unflavoured non-wearable, or a wearable whose kind carries a standard
 * activation they are aware of. Replicated inline (rather than synthesising the
 * whole known twin per menu row) so the device picker can gate its FAIL% column
 * exactly as OLIST_FAIL does.
 */
function deviceEffectKnown(obj: GameObject, isAware: (k: ObjectKind) => boolean): boolean {
  const flavored = kindHasFlavor(obj);
  const aware = isAware(obj.kind);
  if (aware && flavored) return true;
  if (!tvalIsWearable(obj.tval) && !flavored) return true;
  if (tvalIsWearable(obj.tval) && obj.kind.effect && aware) return true;
  return false;
}

/** obj_can_fail (obj-util.c L913): a device tval, or a wieldable (activation). */
function objCanFail(obj: GameObject): boolean {
  return tvalCanHaveFailure(obj.tval) || tvalIsWearable(obj.tval);
}

/**
 * The FAIL% column of a device/activation use picker (ui-object.c L212-221,
 * OLIST_FAIL): "%4d%% fail" where fail = (9 + get_use_device_chance(obj)) / 10,
 * or "    ? fail" when the object's effect is not yet known. Empty string for a
 * non-failing object (obj_can_fail false).
 */
export function deviceFailColumn(
  state: GameState,
  obj: GameObject,
  isAware: (k: ObjectKind) => boolean,
): string {
  if (!objCanFail(obj)) return "";
  if (!deviceEffectKnown(obj, isAware)) return "    ? fail";
  const fail = Math.trunc((9 + getUseDeviceChance(state, obj)) / 10);
  return `${String(fail).padStart(4)}% fail`;
}

/**
 * A device/activation use picker (aim-wand / zap-rod / use-staff / activate):
 * packMenu plus the OLIST_FAIL failure column, so the player sees each item's
 * device-fail chance before committing, exactly as the upstream item menu does.
 */
export function deviceMenu(
  state: GameState,
  filter: (obj: GameObject) => boolean,
  isAware: (k: ObjectKind) => boolean,
): { items: MenuItem[]; handles: number[] } {
  const items: MenuItem[] = [];
  const handles: number[] = [];
  invenHandles(state).forEach((handle, slot) => {
    const obj = gearGet(state.gear, handle);
    if (!obj) return;
    if (!filter(obj)) return;
    const fail = deviceFailColumn(state, obj, isAware);
    const name = objectName(state, obj);
    const label = fail ? `${name.padEnd(40).slice(0, 40)} ${fail}` : name;
    /* The object's own pack-slot letter, as build_obj_list writes it
     * (ui-object.c:291-292) - not its position in this filtered list. */
    items.push({ label, color: objectColor(obj, state), tag: objLetter(slot), inscrip: obj.note });
    handles.push(handle);
  });
  return { items, handles };
}

/**
 * The NAME column of an object listing: `OLIST_WEIGHT`'s `ex_offset` field width
 * (ui-object.c L234-239), which is what makes the weights line up down the list.
 *
 * Published on the column rather than baked into the text with `padEnd` - see
 * `ScreenColumn.width`. A presenter with a proportional font ignores it; the
 * faithful terminal needs it, because upstream's alignment is the layout.
 */
const OBJ_NAME_WIDTH = 45;
/** equip_mention's field width (build_obj_list "%s%*s", 14 - u8len; L304-318). */
const EQUIP_SLOT_WIDTH = 14;

/**
 * The columns of the two gear listings, exported because they are the CONTRACT.
 *
 * A presenter reads `row.cells.name`, so renaming that key breaks every mod that
 * draws an inventory - and would otherwise break them silently, since a cell
 * nobody asked for renders as nothing. Exporting the declaration lets
 * `sample-inventory.node.test.ts` build its fixture from the same keys the game
 * publishes, so the sample cannot go on passing against a vocabulary the game
 * stopped using.
 */
export const INVENTORY_COLUMNS: readonly ScreenColumn[] = [
  { key: "name", width: OBJ_NAME_WIDTH },
  { key: "weight" },
];
export const EQUIPMENT_COLUMNS: readonly ScreenColumn[] = [
  { key: "slot", width: EQUIP_SLOT_WIDTH },
  { key: "name", width: OBJ_NAME_WIDTH },
  { key: "weight" },
];

/** The weight column of a gear row, with the numbers it was formatted from. */
function weightCell(obj: GameObject): ScreenCell {
  return {
    text: objectWeightColumn(obj),
    /* Tenths of a pound, as the game stores them: `each` is one item's weight and
     * `total` is the stack's, so a presenter can show either without dividing by
     * a count it would have to find somewhere else. */
    values: { each: obj.weight, total: obj.number * obj.weight, number: obj.number },
  };
}

/**
 * The inventory (i) as a screen: every pack item, lettered, with weight.
 *
 * The rows carry the same identity a pack PICKER's choices do - `core:gear:<h>`
 * and `{ kind: "item", ref: handle }` - because an inventory listing and an
 * inventory picker are the same objects seen twice, and a mod drawing sprites for
 * one should not need a second vocabulary for the other.
 */
export function inventoryScreen(state: GameState, title = "Inventory"): ScreenView {
  const rows: ScreenRow[] = [];
  invenHandles(state).forEach((handle, slot) => {
    const obj = gearGet(state.gear, handle);
    if (!obj) return;
    rows.push({
      id: `core:gear:${handle}`,
      semantic: { kind: "item", ref: handle, data: { source: "inventory", slot } },
      /* all_letters_nohjkl display letter (ui-object.c L292). */
      tag: objLetter(rows.length),
      color: objectColor(obj, state),
      cells: { name: { text: objectName(state, obj) }, weight: weightCell(obj) },
    });
  });
  return freezeView({
    id: "core:inventory",
    title,
    footer: SCREEN_FOOTER,
    blocks: [
      {
        kind: "table",
        key: "pack",
        tagged: true,
        columns: INVENTORY_COLUMNS,
        rows,
        empty: { text: "(nothing carried)", color: DIM },
      },
    ],
  });
}

/**
 * The equipment (e) as a screen: one row per body slot, worn item or empty.
 *
 * An empty slot is a ROW rather than an absence, because the screen's subject is
 * the body and a missing shield is the thing the player came to look at. It is
 * marked `disabled` and carries no item semantic, so a presenter can draw the
 * silhouette without mistaking it for gear.
 */
export function equipmentScreen(state: GameState, title = "Equipment"): ScreenView {
  const player = state.actor.player;
  const rows: ScreenRow[] = [];
  for (let i = 0; i < player.body.count; i++) {
    const slot = player.body.slots[i];
    const handle = player.equipment[i] ?? 0;
    const obj = handle ? gearGet(state.gear, handle) : null;
    const mention = slot ? equipMention(slot) : `slot ${i}`;
    if (obj) {
      rows.push({
        id: `core:gear:${handle}`,
        semantic: { kind: "item", ref: handle, data: { source: "equipment", slot: i } },
        /* all_letters_nohjkl display letter for the slot index (obj-gear.c L446). */
        tag: objLetter(i),
        color: objectColor(obj, state),
        cells: {
          slot: { text: mention },
          name: { text: objectName(state, obj) },
          weight: weightCell(obj),
        },
      });
    } else {
      rows.push({
        id: `core:body-slot:${i}`,
        semantic: { kind: "slot", ref: i, data: { mention } },
        color: DIM,
        disabled: true,
        cells: { slot: { text: mention }, name: { text: "(nothing)" } },
      });
    }
  }
  return freezeView({
    id: "core:equipment",
    title,
    footer: SCREEN_FOOTER,
    blocks: [
      {
        kind: "table",
        key: "slots",
        tagged: true,
        columns: EQUIPMENT_COLUMNS,
        rows,
      },
    ],
  });
}

/**
 * The inventory viewer lines - now the ONE renderer applied to the ONE model.
 *
 * Kept because ~10 callers and a dozen tests read it, but it is no longer a
 * second drawing: if a column loses its width here it loses it on the player's
 * screen too. That is the lesson from the HUD, where a model beside a hand-laid
 * copy of the same rows was two transcriptions and the unwatched one rotted.
 */
export function inventoryLines(state: GameState): ScreenLine[] {
  return screenBodyLines(inventoryScreen(state));
}

/** The equipment viewer lines; see `inventoryLines` on why this is a one-liner. */
export function equipmentLines(state: GameState): ScreenLine[] {
  return screenBodyLines(equipmentScreen(state));
}

/**
 * The quiver (|) as a screen: the occupied slots, tagged by their digit.
 *
 * One column, because that is what the game draws. The weight is published as row
 * `values` rather than as a column, so a presenter can show it without the terminal
 * growing a field upstream does not have here - the rule the whole seam runs on is
 * that the model may carry MORE than the rendering, never less.
 */
/** The quiver's one field. Exported so a mod's fixture derives from it, not a copy. */
export const QUIVER_COLUMNS: readonly ScreenColumn[] = [{ key: "name" }];

export function quiverScreen(state: GameState, title = "Quiver"): ScreenView {
  const rows: ScreenRow[] = [];
  (state.gear.quiver ?? []).forEach((handle, slot) => {
    if (!handle) return;
    const obj = gearGet(state.gear, handle);
    if (!obj) return;
    rows.push({
      id: `core:gear:${handle}`,
      semantic: { kind: "item", ref: handle, data: { source: "quiver", slot } },
      /* The quiver's tags are its slot DIGITS, not letters (ui-object.c L340). */
      tag: String(slot),
      values: { each: obj.weight, total: obj.number * obj.weight, number: obj.number },
      cells: { name: { text: objectName(state, obj) } },
    });
  });
  return freezeView({
    id: "core:quiver",
    title,
    footer: SCREEN_FOOTER,
    blocks: [
      {
        kind: "table",
        key: "quiver",
        tagged: true,
        columns: QUIVER_COLUMNS,
        rows,
        empty: { text: "(quiver empty)", color: DIM },
      },
    ],
  });
}

/** The quiver viewer lines; see `inventoryLines` on why this is a one-liner. */
export function quiverLines(state: GameState): ScreenLine[] {
  return screenBodyLines(quiverScreen(state));
}

/** Equipment-slot menu for takeoff: the filled slots only, with body index. */
export function equipmentMenu(state: GameState): { items: MenuItem[]; handles: number[] } {
  const player = state.actor.player;
  const items: MenuItem[] = [];
  const handles: number[] = [];
  for (let i = 0; i < player.body.count; i++) {
    const handle = player.equipment[i] ?? 0;
    if (!handle) continue;
    const obj = gearGet(state.gear, handle);
    if (!obj) continue;
    const slot = player.body.slots[i];
    items.push({
      /* equip_mention padded to 14 (ui-object.c L304-318); slot-index letter,
       * skipping h,j,k,l, matching gear_to_label (obj-gear.c L446). */
      label: `${(slot ? equipMention(slot) : "").padEnd(14).slice(0, 14)} ${objectName(state, obj)}`,
      color: objectColor(obj, state),
      tag: objLetter(i),
      id: `core:gear:${handle}`,
      semantic: { kind: "item", ref: handle, data: { source: "equipment", slot: i } },
    });
    handles.push(handle);
  }
  return { items, handles };
}

/**
 * The CharSheetDeps the shell can actually supply: the name plus the live
 * computed player_state (calc_bonuses) where one exists. statAdd is the real
 * equipment stat_add the calc derives (rune-gated per decision 25, so an
 * as-yet-unidentified +STR ring reads +0 until its rune is learned, exactly as
 * upstream's known_state), and it feeds the EB column of the stat table.
 */
export function charSheetDeps(
  state: GameState,
  name?: string,
): {
  fullName?: string;
  statAdd?: readonly number[];
  statTop?: readonly number[];
  statUse?: readonly number[];
  seeInfra?: number;
  numShots?: number;
  weightRemaining?: number;
} {
  const ps = state.playerState;
  return {
    ...(name ? { fullName: name } : {}),
    ...(ps
      ? {
          statAdd: ps.statAdd,
          statTop: ps.statTop,
          statUse: ps.statUse,
          seeInfra: ps.seeInfra,
          numShots: ps.numShots,
          // weight_remaining (player-calcs.c:1752): without this the sheet's
          // "Overweight" row read 0.0 lb for every character, where upstream
          // shows the spare capacity as a negative figure.
          weightRemaining: weightRemaining(ps, state.actor.player.upkeep.totalWeight),
        }
      : {}),
  };
}

/** Greedy word-wrap of plain text to `width` columns (history paragraphs). */
function wrapPlain(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/u).filter((w) => w.length > 0)) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

/**
 * The player-history block (display_player_xtra_info, ui-player.c L858):
 * player->history wrapped (upstream text_out_wrap = 72) and indented one
 * column, in COLOUR_WHITE. The background paragraph is generated at birth
 * (get_history / generateHistory, wired through generatePlayer); empty history
 * still renders nothing so a headless / pre-birth character degrades cleanly.
 */
export function historyBlockLines(state: GameState, cols = 80): ScreenLine[] {
  const history = state.actor.player.history.trim();
  if (!history) return [];
  const width = Math.max(10, Math.min(72, cols - 2));
  return wrapPlain(history, width).map((text) => ({
    text: ` ${text}`,
    color: colorToCss(COLOUR_WHITE),
  }));
}

/**
 * One stat row of display_player_stat_info (ui-player.c L469-507) as a
 * per-run-coloured line on the exact upstream column stops: the stat name at
 * col 0 (with '!' REPLACING the colon at index 3 for a natural-max stat, per
 * L480-481), Self at col 5 (cnv_stat, always 6 wide, L_GREEN), RB/CB/EB at
 * cols 12/16/20 ("%+3d", L_BLUE), Best at col 24 (L_GREEN), and - only when
 * drained - the current value at col 31 in YELLOW. No Cur column otherwise.
 */
export function statRowLine(row: {
  label: string;
  natural: string;
  raceBonus: string;
  classBonus: string;
  equipBonus: string;
  best: string;
  reduced: string | null;
  naturalMax: boolean;
  drained: boolean;
}): ScreenLine {
  const label = row.naturalMax
    ? `${row.label.slice(0, 3)}!${row.label.slice(4)}`
    : row.label;
  const runs: { text: string; color: string }[] = [
    { text: label.padEnd(5).slice(0, 5), color: colorToCss(COLOUR_WHITE) },
    { text: row.natural.padStart(6), color: colorToCss(COLOUR_L_GREEN) },
    {
      text: ` ${row.raceBonus.padStart(3)} ${row.classBonus.padStart(3)} ${row.equipBonus.padStart(3)}`,
      color: colorToCss(COLOUR_L_BLUE),
    },
    { text: ` ${row.best.padStart(6)}`, color: colorToCss(COLOUR_L_GREEN) },
  ];
  if (row.drained && row.reduced !== null) {
    runs.push({ text: ` ${row.reduced.padStart(6)}`, color: colorToCss(COLOUR_YELLOW) });
  }
  return { text: runs.map((r) => r.text).join(""), color: FG, runs };
}

/** The stat-table header, on the same column stops as statRowLine (the
 * upstream header strings "  Self" / " RB" / " CB" / " EB" / "  Best" at
 * col+5/+12/+16/+20/+24 - both width-6 headers padded like the data, fixing
 * the classic 5-wide header misalignment; there is no Cur header). */
export function statHeaderLine(): ScreenLine {
  const text =
    `${" ".repeat(5)}${"Self".padStart(6)} ${"RB".padStart(3)} ` +
    `${"CB".padStart(3)} ${"EB".padStart(3)} ${"Best".padStart(6)}`;
  return { text, color: LABEL };
}

/**
 * The character-sheet lines (C): the six-stat table then the five panels
 * (name/class, misc, level/exp, combat, skills), faithful to characterPanels /
 * statTable, then the player-history block. Laid out as a scrollable single
 * column so it reads at any width (the narrow / phone layout).
 */
export function characterSheetLines(
  state: GameState,
  name?: string,
  cols = 80,
): ScreenLine[] {
  const deps = charSheetDeps(state, name);
  const lines: ScreenLine[] = [];
  // Stat block: same 6-wide Self/Best fields as the wide sheet, blank Cur
  // column unless drained (upstream shows nothing there otherwise).
  lines.push(statHeaderLine());
  for (const row of statTable(state, deps)) lines.push(statRowLine(row));
  lines.push({ text: "", color: FG });
  // Panels.
  for (const panel of characterPanels(state, deps)) {
    for (const line of panel.lines) {
      if (!line.label && !line.value) {
        lines.push({ text: "", color: FG });
        continue;
      }
      // Some model labels already carry a trailing colon; normalize so we never
      // render "Turns used::". Label-only lines (section headers) show bare.
      const label = line.label.replace(/:\s*$/u, "");
      lines.push({
        text: line.value ? `${label}: ${line.value}` : label,
        color: colorToCss(line.color),
      });
    }
    lines.push({ text: "", color: FG });
  }
  // History (display_player_xtra_info row 19): degrades to nothing when empty.
  lines.push(...historyBlockLines(state, cols));
  return lines;
}

/**
 * The spellbooks in the pack that pass `tester`, as a selection menu. Empty for
 * non-casters or a caster carrying no qualifying book. Handles map the chosen
 * index back to the book's gear handle.
 *
 * The tester is the caller's get_item item_tester and IS behaviour, not a
 * convenience: upstream uses a DIFFERENT one per verb - obj_can_cast_from for
 * cast (cmd-obj.c L1129), obj_can_study for study (L1187 / L1215), and only
 * browse uses the bare obj_can_browse (ui-spell.c L340). Filtering every verb
 * by obj_can_browse offered books with nothing castable/studiable in them and
 * shifted the letters of the books that did qualify. Defaults to obj_can_browse
 * so a caller that omits it gets the browse behaviour.
 */
export function magicBooks(
  state: GameState,
  tester: (obj: GameObject) => boolean = () => true,
): { items: MenuItem[]; handles: number[] } {
  const player = state.actor.player;
  const items: MenuItem[] = [];
  const handles: number[] = [];
  for (const handle of invenHandles(state)) {
    const obj = gearGet(state.gear, handle);
    if (!obj || !tvalIsBook(obj.tval)) continue;
    if (!playerObjectToBook(player, obj)) continue;
    if (!tester(obj)) continue;
    /* all_letters_nohjkl tag so the picker's letters skip h,j,k,l (ui-object.c L292).
     * `inscrip` carries obj->note for the picker's @-tag quick-select (get_tag). */
    items.push({ label: objectName(state, obj), color: objectColor(obj, state), tag: objLetter(items.length), inscrip: obj.note });
    handles.push(handle);
  }
  return { items, handles };
}

/**
 * spell_menu_display's per-state comment + colour (ui-spell.c L81-103). The
 * same six-way classification drives both the cast and the study/browse menus
 * (spell_menu_display is shared): (illegible) L_DARK, " forgotten" YELLOW, a
 * WORKED spell's damage info WHITE, " untried" L_GREEN, " unknown" L_BLUE,
 * " difficult" RED. `info` is the get_spell_info() comment appended only for a
 * cast-and-worked spell (the caller supplies it, since building the effect
 * chain needs the state).
 */
function spellStateDisplay(
  player: GameState["actor"]["player"],
  spell: { level: number },
  idx: number,
  info: string,
): { comment: string; attr: number; illegible: boolean } {
  const flags = player.spellFlags[idx] ?? 0;
  if (spell.level >= 99) return { comment: "", attr: COLOUR_L_DARK, illegible: true };
  if ((flags & PY_SPELL.FORGOTTEN) !== 0)
    return { comment: " forgotten", attr: COLOUR_YELLOW, illegible: false };
  if ((flags & PY_SPELL.LEARNED) !== 0) {
    if ((flags & PY_SPELL.WORKED) !== 0)
      return { comment: info, attr: COLOUR_WHITE, illegible: false };
    return { comment: " untried", attr: COLOUR_L_GREEN, illegible: false };
  }
  if (spell.level <= player.lev)
    return { comment: " unknown", attr: COLOUR_L_BLUE, illegible: false };
  return { comment: " difficult", attr: COLOUR_RED, illegible: false };
}

/**
 * The spell list of a book as a menu, faithful to spell_menu_display
 * (ui-spell.c L64-121): each row is "<name padded to 30><lvl:2> <mana:4>
 * <fail:3>%<comment>", coloured by the spell's state, or the bare "(illegible)"
 * for a level>=99 spell. `mode` decides which rows are SELECTABLE (is_valid):
 * "cast" enables spell_okay_to_cast (learned, not forgotten - low-mana spells
 * stay castable via over-exert), "study" enables spell_okay_to_study. Every row
 * is shown regardless (only selection is gated), matching the shared display.
 * Returns the parallel class-wide sidx list so the caller dispatches by
 * args.spell.
 */
export function bookSpellMenu(
  state: GameState,
  bookObj: GameObject,
  mode: "cast" | "study",
): { items: MenuItem[]; sidx: number[] } {
  const player = state.actor.player;
  const statInd = state.statInd ?? [];
  const items: MenuItem[] = [];
  const sidx: number[] = [];
  /* Same SpellChanceEnv the cast path uses, so the shown fail rate includes
     the OF_AFRAID and Necromancer PF_UNLIGHT penalties (ui-spell.c uses the
     same spell_chance for display and cast). */
  const chanceEnv = makeSpellChanceEnv(state);
  for (const idx of spellCollectFromBook(player, bookObj)) {
    const spell = spellByIndex(player.cls, idx);
    if (!spell) continue;
    /*
     * get_spell_info() comment (ui-spell.c L90): a WORKED spell's damage/heal
     * summary (" dam 3d4", " heal 15", ...). Built here since it needs the
     * effect chain + state; spellStateDisplay only appends it for cast+worked.
     */
    let info = "";
    if (((player.spellFlags[idx] ?? 0) & PY_SPELL.WORKED) !== 0) {
      const chain = buildObjectEffectChain(
        spell.effectsRaw as EffectRecordJson[],
        state,
      );
      info = getSpellInfo(chain, {
        playerLevel: player.lev,
        maxRange: state.z.maxRange,
      });
    }
    const { comment, attr, illegible } = spellStateDisplay(player, spell, idx, info);
    const disabled =
      mode === "cast" ? !spellOkayToCast(player, idx) : !spellOkayToStudy(player, idx);
    let label: string;
    if (illegible) {
      label = "(illegible)";
    } else {
      const name = spell.name.padEnd(30).slice(0, 30);
      const lv = String(spell.level).padStart(2);
      const mana = String(spell.mana).padStart(4);
      const fail = String(spellChance(player, statInd, idx, chanceEnv)).padStart(3);
      label = `${name}${lv} ${mana} ${fail}%${comment}`;
    }
    items.push({ label, disabled, color: colorToCss(attr) });
    sidx.push(idx);
  }
  return { items, sidx };
}

/**
 * Colour the digit runs of `text` COLOUR_L_GREEN, everything else COLOUR_WHITE
 * (spell_menu_browser's `text_out_c(COLOUR_L_GREEN, " %d", ...)` calls, which
 * highlight only the average-damage numbers - "fire"/"and"/"damage" stay
 * plain). A pure string->runs split; the digit-highlighting itself is a
 * rendering concern the core layer deliberately leaves to the UI (see the
 * module doc atop effect-info.ts).
 */
function highlightDigitRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /\d+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), attr: COLOUR_WHITE });
    runs.push({ text: m[0], attr: COLOUR_L_GREEN });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), attr: COLOUR_WHITE });
  return runs;
}

/**
 * spell_menu_browser's '?' description panel (ui-spell.c L147-208): the
 * spell's flavour text (spell->text), plus - once the spell has been cast
 * successfully at least once (PY_SPELL_WORKED) and not since forgotten
 * (PY_SPELL_FORGOTTEN) - the "Inflicts an average of ... damage." sentence
 * with its damage numbers in COLOUR_L_GREEN. A spell with no damaging
 * effects at all never gets a summary (spellDamageSummary returns null),
 * matching upstream's num_damaging > 0 guard.
 *
 * Reuses spellDamageSummary (effect-info.ts, gap #48) for the sentence
 * itself - no dice/grammar logic is reimplemented here - and wrapRuns for
 * the wrap + per-run colouring, exactly like the object-inspect viewer.
 * Pure and RNG-safe: nothing here (or in spellDamageSummary) reads the RNG.
 *
 * ADJUDICATED, step 5b-ii: this stays `ScreenLine[]` and is NOT a screen. It is
 * `selectFromMenu`'s `detail(i)` panel inside the cast/browse menu, so it belongs
 * to the MENU seam - modelling it as a `ScreenView` would publish an id no screen
 * presenter is ever offered. That a menu's detail panel is still pre-wrapped rows
 * is a real gap and it is the menu seam's; recorded in MOD_REACH.md row 21.
 */
export function spellBrowseLines(
  state: GameState,
  spellIndex: number,
  projections: readonly Pick<ProjectionInfo, "playerDesc">[],
  cols: number,
): ScreenLine[] {
  const player = state.actor.player;
  const spell = spellByIndex(player.cls, spellIndex);
  if (!spell) return [];

  const flags = player.spellFlags[spellIndex] ?? 0;
  const worked = (flags & PY_SPELL.WORKED) !== 0;
  const forgotten = (flags & PY_SPELL.FORGOTTEN) !== 0;

  const runs: TextRun[] = [{ text: spell.text, attr: COLOUR_WHITE }];
  if (worked && !forgotten) {
    const chain = buildObjectEffectChain(spell.effectsRaw as EffectRecordJson[], state);
    const summary = spellDamageSummary(chain, projections);
    if (summary) {
      runs.push({ text: "  ", attr: COLOUR_WHITE });
      runs.push(...highlightDigitRuns(summary));
    }
  }
  const tb: Textblock = { runs };
  return wrapRuns(tb, cols);
}

/**
 * strcmp: an ordinal (byte-order) string comparison, matching upstream's
 * qsort(ego_comp_func)/sort(cmp_ignore) exactly - JS's default
 * String.prototype.localeCompare is locale-aware and can reorder punctuation
 * (e.g. it would sort "*Slay Animal*" after "Holy Avenger" instead of before
 * it, since '*' < 'A' in a raw byte comparison but not under most locale
 * collations).
 */
function strcmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Capitalized race name ("small kobold" -> "Small kobold"). */
export function capRaceName(race: { name: string }): string {
  const n = race.name;
  return `${n.charAt(0).toUpperCase()}${n.slice(1)}`;
}

/** Capitalized monster name ("small kobold" -> "Small kobold"). */
export function capMonName(mon: Monster): string {
  return capRaceName(mon.race);
}

/**
 * loreDescription's flat run list ({text, color}, mon/lore-describe.ts) into
 * a Textblock ({runs: [{text, attr}]}) so it can go through the same
 * wrapRuns the object inspect viewer uses - same shape, different field
 * name; no text is rewritten here.
 */
function loreTextToTextblock(text: LoreText): Textblock {
  return { runs: text.map((r) => ({ text: r.text, attr: r.color })) };
}

/**
 * The monster recall screen (ui-mon-lore.c lore_description, reached via 'r'
 * in the look/target loop per ui-target.c's aux_monster recall toggle): the
 * full learned memory for one race. `lore` must be the race's REAL lore
 * record (getLore(state.lore, race)) - loreDescription itself gates every
 * section on what is actually known, so passing a fully-known override here
 * would leak unlearned information. `deps` is the caller's wired LoreDeps
 * (recallDeps, main.ts) - notably breathProjection, without which breath
 * damage renders as 0. loreDescription draws no RNG; this only wraps its
 * runs to the terminal width, exactly like objectInfoTextblock's callers.
 */
export function monsterRecallScreen(
  race: MonsterRace,
  lore: MonsterLore,
  deps: LoreDeps,
  title = capRaceName(race),
): ScreenView {
  return freezeView({
    id: "core:monster-recall",
    title,
    footer: SCREEN_FOOTER,
    blocks: [proseBlock(loreTextToTextblock(loreDescription(race, lore, deps)))],
  });
}

/** The faithful terminal's rows for `monsterRecallScreen`. */
export function monsterRecallLines(
  race: MonsterRace,
  lore: MonsterLore,
  deps: LoreDeps,
  cols: number,
): ScreenLine[] {
  return screenBodyLines(monsterRecallScreen(race, lore, deps), cols);
}

/** A race the player has memory of, paired with its live lore record. */
export interface KnownMonsterRow {
  race: MonsterRace;
  lore: MonsterLore;
}

/**
 * The monster-knowledge set (ui-knowledge.c do_cmd_knowledge_monsters,
 * L1397-1449): every race the player has ANY memory of - the
 * `l_list[i].all_known || l_list[i].sights` gate (L1402), skipping the
 * nameless r_info[0] blank (L1405). Sorted by what the group comparator
 * m_cmp_race falls back to within a group: level ascending, then name by
 * ordinal strcmp (L1258-1262). This is the flat membership; the thematic
 * ui_knowledge.txt columns the browser draws over it are a display grouping of
 * this same set, built by monsterKnowledgeGroupViews just below.
 *
 * Reads the lore store directly (store.get) rather than getLore so building
 * the list never creates blank lore records for unseen races as a side
 * effect - a race with no record has never been sighted and is excluded.
 */
export function knownMonsterEntries(
  races: readonly MonsterRace[],
  store: LoreStore,
): KnownMonsterRow[] {
  const rows: KnownMonsterRow[] = [];
  for (const race of races) {
    if (!race.name) continue; // r_info[0] blank
    const lore = store.get(race.ridx);
    if (!lore) continue; // never accessed -> never sighted
    if (!lore.allKnown && lore.sights <= 0) continue;
    rows.push({ race, lore });
  }
  rows.sort((a, b) => {
    const c = a.race.level - b.race.level;
    if (c) return c;
    return strcmp(a.race.name, b.race.name);
  });
  return rows;
}

/** A thematic monster-knowledge category with its ordered known members. */
export interface MonsterKnowledgeGroupView {
  name: string;
  rows: KnownMonsterRow[];
}

/**
 * do_cmd_knowledge_monsters (ui-knowledge.c L1382): the two-pane thematic
 * browser's data - the ui_knowledge.txt categories, each holding the known
 * races it matches (a race joins EVERY category it matches, per the C), in
 * m_cmp_race order, with empty categories dropped. Falls back to the flat
 * level/name list when the pack ships no categories.
 */
export function monsterKnowledgeGroupViews(
  races: readonly MonsterRace[],
  store: LoreStore,
  categories: readonly MonsterCategory[],
): MonsterKnowledgeGroupView[] {
  const flat = knownMonsterEntries(races, store);
  if (categories.length === 0) {
    return flat.length > 0 ? [{ name: "Monsters", rows: flat }] : [];
  }
  const known = flat.map((r) => ({ race: r.race, lore: r.lore, allKnown: r.lore.allKnown }));
  return monsterKnowledgeGroups(categories, known).map((g) => ({
    name: g.name,
    rows: g.members.map((m) => ({ race: m.race, lore: m.lore })),
  }));
}

/** An object kind base name, with the ~/& object_desc markers stripped. */
function kindBaseName(kind: ObjectKind): string {
  return kind.name.replace(/[~&]/g, " ").replace(/\s+/g, " ").trim();
}

/** An aware object kind paired with its current aware autoinscription note. */
export interface AutoinscribeRow {
  kind: ObjectKind;
  /** The kind's current aware note (get_autoinscription), "" when unset. */
  note: string;
}

/**
 * The per-kind autoinscription manager list (ui-knowledge.c's object-knowledge
 * browser + the `{` set-inscription action, get_autoinscription at L1898/2113):
 * every kind the player is aware of, each row showing the kind name and its
 * current aware autoinscription in braces. Picking a row lets the caller edit
 * that kind's aware note. Sorted by tval then ordinal name, matching the object
 * browser's within-group order; a parallel row list carries the kind so the
 * caller can set the note by kidx.
 *
 * Aware kinds only (the spec's "list aware kinds"): an unaware flavoured kind
 * has no true name to show, and upstream keys the `{` action off kind->aware.
 * The unaware-note slot the registry also supports is not exposed here.
 */
export function autoinscriptionMenu(
  kinds: readonly ObjectKind[],
  isAware: (kind: ObjectKind) => boolean,
  registry: AutoinscriptionRegistry,
): { items: MenuItem[]; rows: AutoinscribeRow[] } {
  const rows: AutoinscribeRow[] = [];
  for (const kind of kinds) {
    if (!kind.name) continue; // the k_info[0] blank
    if (!isAware(kind)) continue;
    rows.push({ kind, note: registry.get(kind.kidx, true) ?? "" });
  }
  rows.sort((a, b) => {
    const c = a.kind.tval - b.kind.tval;
    if (c) return c;
    return strcmp(kindBaseName(a.kind), kindBaseName(b.kind));
  });
  const items: MenuItem[] = rows.map(({ kind, note }) => {
    const name = kindBaseName(kind);
    return {
      label: note ? `${name}  {${note}}` : name,
      color: colorToCss(colorCharToAttr(kind.dAttr)),
    };
  });
  return { items, rows };
}

/**
 * The target-able monsters (target_get_monsters with TARGET_KILL), sorted by
 * distance, as a selection menu labelled "Name (health, status)". The parallel
 * monster list lets the caller set the chosen one as the target. Used by both
 * the target picker ('*') and the read-only look screen ('l').
 */
export function targetMenu(state: GameState): { items: MenuItem[]; mons: Monster[] } {
  const items: MenuItem[] = [];
  const mons: Monster[] = [];
  for (const grid of targetGetMonsters(state, TARGET.KILL)) {
    const mon = squareMonster(state, grid);
    if (!mon) continue;
    items.push({ label: `${capMonName(mon)}  (${lookMonDesc(mon)})` });
    mons.push(mon);
  }
  return { items, mons };
}

/** The look screen lines ('l'): every visible monster and its condition. */
export function lookLines(state: GameState): ScreenLine[] {
  const { items } = targetMenu(state);
  if (items.length === 0) return [{ text: "You see no monsters.", color: DIM }];
  return items.map((it) => ({ text: it.label, color: FG }));
}

/**
 * The floor object list (']', ui-obj-list.c object_list_show_interactive):
 * every object the player currently knows about on the level, split into a
 * line-of-sight section and an out-of-view ("aware of") section, each row
 * showing the glyph, knowledge-gated name and offset from the player.
 *
 * A pure read: objectListCollect/objectListSort/objectListEntryName draw no
 * RNG and cost no turn. Unlike the terminal's object_list_format_section this
 * never truncates or emits a "...and N others." line - the modal scrolls, so
 * every entry is shown; behaviour-preserving since all upstream information
 * still surfaces, just without the fixed-height cutoff.
 */
/**
 * The object list's three fields. NONE of them is padded, because upstream does not
 * line them up either: the location follows the name (`"%s %s   %s"`,
 * ui-obj-list.c L131-141) rather than sitting under a column stop, and padding the
 * names into a column would be the port adding something the game never had.
 */
const OBJECT_LIST_COLUMNS: readonly ScreenColumn[] = [
  { key: "glyph", pad: false },
  { key: "name", pad: false },
  { key: "location", pad: false, gap: 3 },
];

export function objectListScreen(state: GameState, title = "Objects in view"): ScreenView {
  const list = objectListCollect(state);
  objectListSort(list, objectListStandardCompare(state));

  const entryRow = (entry: (typeof list.entries)[number]): ScreenRow => {
    /* ui-obj-list.c:131-141: the glyph is object_kind_char in the KIND's own
     * colour, and an unknown entry is a RED asterisk - only the NAME takes the
     * line attribute. The port painted the glyph the line colour and read the
     * kind record directly, so a flavoured item showed the wrong symbol
     * colour and an unknown one was never red. */
    const g = entry.object ? objectKindAttrChar(state, entry.object.kind) : null;
    const glyph = g ? g.char : "*";
    const glyphColor = colorToCss(g ? g.attr : COLOUR_RED);
    const dirY = entry.dy <= 0 ? "N" : "S";
    const dirX = entry.dx <= 0 ? "W" : "E";
    return {
      ...(entry.object ? { semantic: { kind: "object-kind", ref: entry.object.kind.name } } : {}),
      color: colorToCss(objectListEntryLineAttribute(entry, state)),
      /* The offset is the thing a presenter most wants as numbers rather than as
       * "3 N 2 W": a map marker cannot be drawn from the compass string. */
      values: { dy: entry.dy, dx: entry.dx },
      cells: {
        glyph: { text: glyph, color: glyphColor },
        name: { text: objectListEntryName(entry, state) },
        location: { text: `${Math.abs(entry.dy)} ${dirY} ${Math.abs(entry.dx)} ${dirX}` },
      },
    };
  };

  const losTotal = list.totalEntries[OBJECT_LIST_SECTION_LOS]!;
  const noLosTotal = list.totalEntries[OBJECT_LIST_SECTION_NO_LOS]!;
  const blocks: ScreenBlock[] = [];

  /* "You can see" section (object_list_format_section, prefix "You can see",
   * show_others always false). */
  blocks.push({
    kind: "table",
    key: "in-view",
    tagged: false,
    ...(losTotal === 0
      ? {}
      : { caption: { text: `You can see ${losTotal} object${losTotal === 1 ? "" : "s"}:`, color: LABEL } }),
    columns: OBJECT_LIST_COLUMNS,
    rows:
      losTotal === 0
        ? []
        : list.entries.filter((e) => e.count[OBJECT_LIST_SECTION_LOS]! > 0).map(entryRow),
    empty: { text: "You can see no objects.", color: DIM },
  });

  /* "You are aware of" section: printed whenever any out-of-view entries
   * exist, regardless of whether the LOS section was empty (matches
   * object_list_format_textblock's unconditional second call). "other " is
   * inserted only when LOS objects also exist (show_others). */
  if (noLosTotal > 0) {
    const others = list.totalObjects[OBJECT_LIST_SECTION_LOS]! > 0 ? "other " : "";
    blocks.push({ kind: "lines", lines: [{ text: "", color: FG }] });
    blocks.push({
      kind: "table",
      key: "remembered",
      tagged: false,
      caption: {
        text: `You are aware of ${noLosTotal} ${others}object${noLosTotal === 1 ? "" : "s"}:`,
        color: LABEL,
      },
      columns: OBJECT_LIST_COLUMNS,
      rows: list.entries.filter((e) => e.count[OBJECT_LIST_SECTION_NO_LOS]! > 0).map(entryRow),
    });
  }

  return freezeView({ id: "core:objects-in-view", title, footer: SCREEN_FOOTER, blocks });
}

/** The object-list lines; see `inventoryLines` on why this is a one-liner. */
export function objectListLines(state: GameState): ScreenLine[] {
  return screenBodyLines(objectListScreen(state));
}

/**
 * The message history (Ctrl-P) as a screen: the whole log, oldest first.
 *
 * The repeat count is BOTH in the text (upstream's "you hit it. (x3)") and in the
 * row's `values`, because a presenter that wants to draw the count as a badge
 * should not have to parse it back out of a sentence.
 */
export function messageHistoryScreen(log: MessageLog, title = "Message history"): ScreenView {
  return freezeView({
    id: "core:messages",
    title,
    footer: SCREEN_FOOTER,
    blocks: [
      {
        kind: "table",
        key: "log",
        tagged: false,
        columns: [{ key: "message", pad: false }],
        rows: log.all().map((m) => ({
          ...(m.color === undefined ? {} : { color: m.color }),
          values: { count: m.count },
          cells: { message: { text: formatMessage(m) } },
        })),
        empty: { text: "(no messages yet)", color: DIM },
      },
    ],
  });
}

/** The message-history lines; see `inventoryLines` on why this is a one-liner. */
export function messageHistoryLines(log: MessageLog): ScreenLine[] {
  return screenBodyLines(messageHistoryScreen(log));
}

/** ARTIFACT_KNOWN entries get a gold highlight (a web-native enhancement). */
const HIST_KNOWN_GOLD = UI_GOLD;

/**
 * The character auto-history lines (history_display, ui-history.c L38-73):
 * the column header, then one row per entry oldest-first - "%10ld%7d'  %s"
 * (turn right-justified 10, depth-in-feet right-justified 7 + apostrophe,
 * two spaces, event text) with " (LOST)" appended for ARTIFACT_LOST entries.
 * showTextScreen supplies scrolling/ESC and the "[Player history]" title, so
 * this only needs to build the header + entry lines.
 */
/**
 * history_display's three fields (`"%10ld%7d'  %s"`, ui-history.c L38-73), as
 * columns: the turn right-justified to 10, the depth in feet right-justified with
 * its apostrophe, and the note two columns further on. No gap before the depth and
 * two before the note is exactly the layout `gap` exists to express.
 */
const PLAYER_HISTORY_COLUMNS: readonly ScreenColumn[] = [
  { key: "turn", label: "Turn", width: 10, align: "right" },
  { key: "depth", label: "Depth", width: 8, align: "right", gap: 0 },
  { key: "note", label: "Note", gap: 2, pad: false },
];

export function playerHistoryScreen(state: GameState, title = "Player history"): ScreenView {
  const list = historyGetList(state.actor.player);
  return freezeView({
    id: "core:player-history",
    title,
    footer: SCREEN_FOOTER,
    blocks: [
      {
        kind: "table",
        key: "history",
        tagged: false,
        columns: PLAYER_HISTORY_COLUMNS,
        rows: list.map((e) => {
          const lost = histHas(e.type, HIST.ARTIFACT_LOST);
          const known = histHas(e.type, HIST.ARTIFACT_KNOWN);
          return {
            color: lost ? DIM : known ? HIST_KNOWN_GOLD : FG,
            /* clev never reaches the terminal's three fields, and is exactly the
             * kind of thing a timeline drawn as a graph wants. */
            values: { turn: e.turn, depth: e.dlev * 50, dlev: e.dlev, clev: e.clev },
            cells: {
              turn: { text: String(e.turn) },
              depth: { text: `${e.dlev * 50}'` },
              note: { text: `${e.event}${lost ? " (LOST)" : ""}` },
            },
          };
        }),
        empty: { text: "(no history yet)", color: DIM },
      },
    ],
  });
}

/** The player-history lines; see `inventoryLines` on why this is a one-liner. */
export function historyLines(state: GameState): ScreenLine[] {
  return screenBodyLines(playerHistoryScreen(state));
}

/* ------------------------------------------------------------------ */
/* Ignore configuration menus (obj-ignore.c / ui-options.c)            */
/* ------------------------------------------------------------------ */

/**
 * object_kind_name (obj-desc.c L48): a kind's plain menu name - the flavour
 * text (e.g. "Smoky") when `easyKnow` is false and the flavour is not yet
 * identified, else the real name. `easyKnow` is the *row's* aware flag, not
 * necessarily the kind's live awareness: the sval menu's aware row always
 * shows the real name (upstream lets a player pre-set an aware-ignore
 * before ever identifying the flavour), while the unaware row shows the
 * flavour text if one is assigned and the kind is not yet aware.
 */
function objectKindName(state: GameState, kind: ObjectKind, easyKnow: boolean): string {
  const trueAware = state.isAware ? state.isAware(kind) : true;
  if (!easyKnow && !trueAware && (state.hasFlavor?.(kind) ?? false)) {
    return state.flavorText?.(kind) ?? "";
  }
  return kind.name;
}

/**
 * quality_menu / quality_display (ui-options.c L1630/L1539): one row per
 * ITYPE_* (1..26; ITYPE_NONE is skipped), "<type name padded to 30> :
 * <level name>". Returns the parallel itype list so the caller knows which
 * tier submenu to open for a picked row.
 */
export function qualityIgnoreMenu(
  settings: IgnoreSettings,
): { items: MenuItem[]; itypes: number[] } {
  const items: MenuItem[] = [];
  const itypes: number[] = [];
  for (let itype = 1; itype < ITYPE_MAX; itype++) {
    const name = IGNORE_TYPE_ENTRIES[itype]?.description ?? "";
    const level = settings.level[itype] ?? IGNORE.NONE;
    const levelName = QUALITY_VALUE_NAMES[level] ?? (QUALITY_VALUE_NAMES[0] as string);
    items.push({ label: `${name.padEnd(30)} : ${levelName}` });
    itypes.push(itype);
  }
  return { items, itypes };
}

/**
 * quality_action's tier submenu (ui-options.c L1584-1625): every quality
 * tier name, except ITYPE_RING/ITYPE_AMULET which cap at IGNORE_BAD+1 ("no
 * ignore"/"bad" only - jewelry is never rated "good" or better).
 */
export function qualityLevelItems(itype: number): MenuItem[] {
  const count =
    itype === ITYPE.RING || itype === ITYPE.AMULET ? IGNORE.BAD + 1 : IGNORE.MAX;
  const items: MenuItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push({ label: QUALITY_VALUE_NAMES[i] ?? "" });
  }
  return items;
}

/** One row of the ego ignore menu: which ego + ignore-type it toggles. */
export interface EgoIgnoreChoice {
  eidx: number;
  itype: number;
}

/**
 * ego_menu (ui-options.c L1405): every (ego, itype) pair the ego can be
 * meaningfully quality-ignored under, sorted by the ego's short name (its
 * name with a leading "of the "/"of " stripped - strip_ego_name L1288,
 * ego_comp_func L1349). Each label mirrors ego_item_name (L1301): "[ ] " +
 * the ignore type's name + " " + the stripped-prefix + short name, with a
 * leading '*' when already ignored (col+1, inside the brackets).
 *
 * `ego->everseen` (ui-options.c:1427) gates the list: only egos the player has
 * actually met appear, so the menu cannot reveal that an ego EXISTS before it
 * has been seen. `seen` is required rather than optional - an unsupplied
 * predicate would silently restore the leak this closes.
 */
export function egoIgnoreMenu(
  egos: readonly EgoItem[],
  kinds: readonly ObjectKind[],
  settings: IgnoreSettings,
  seen: (ego: EgoItem) => boolean,
): { items: MenuItem[]; choices: EgoIgnoreChoice[] } {
  interface Row {
    eidx: number;
    itype: number;
    shortName: string;
    prefix: string;
  }
  const rows: Row[] = [];
  for (const ego of egos) {
    /* `if (!ego->name || !ego->everseen) continue;` (ui-options.c:1427). */
    if (!ego.name || !seen(ego)) continue;
    for (let itype = 1; itype < ITYPE_MAX; itype++) {
      if (!egoHasIgnoreType(ego, itype, kinds)) continue;
      let prefixLen = 0;
      if (ego.name.startsWith("of the ")) prefixLen = 7;
      else if (ego.name.startsWith("of ")) prefixLen = 3;
      rows.push({
        eidx: ego.eidx,
        itype,
        shortName: ego.name.slice(prefixLen),
        prefix: ego.name.slice(0, prefixLen),
      });
    }
  }
  rows.sort((a, b) => strcmp(a.shortName, b.shortName));

  const items: MenuItem[] = [];
  const choices: EgoIgnoreChoice[] = [];
  for (const row of rows) {
    const ignored = settings.egoIsIgnored(row.eidx, row.itype);
    const typeName = IGNORE_TYPE_ENTRIES[row.itype]?.description ?? "";
    items.push({
      label: `[${ignored ? "*" : " "}] ${typeName} ${row.prefix}${row.shortName}`,
      color: colorToCss(ignored ? COLOUR_L_RED : COLOUR_L_GREEN),
    });
    choices.push({ eidx: row.eidx, itype: row.itype });
  }
  return { items, choices };
}

/** One row of the sval (kind) ignore menu: which kind + aware/unaware bit. */
export interface SvalIgnoreRow {
  kidx: number;
  aware: boolean;
}

/**
 * ignore_collect_kind + ignore_sval_menu_display (ui-options.c L1778/L1717):
 * every (kind, aware) row for a tval - an "unaware" row for every kind not
 * yet identified, and an "aware" row for every non-INSTA_ART kind (or any
 * money kind). Sorting matches cmp_ignore (aware rows first, then
 * alphabetical by the row's own name) except for the tvals upstream keeps
 * in sval (kind file) order.
 *
 * The aware row is gated on `kind->everseen` exactly as upstream is:
 * `(kind->everseen && !KF_INSTA_ART) || tval_is_money_k(kind)`
 * (ui-options.c:1801-1802). Without it the menu offers an "aware" toggle for
 * every kind in the game, which tells the player what exists before they have
 * met it. The UNAWARE row keeps upstream's rule and is NOT gated - "can unaware
 * ignore anything" (L1796).
 */
export function svalKindMenu(
  reg: ObjRegistry,
  tval: number,
  settings: IgnoreSettings,
  state: GameState,
): { items: MenuItem[]; rows: SvalIgnoreRow[] } {
  interface Row {
    kind: ObjectKind;
    aware: boolean;
    name: string;
  }
  const rows: Row[] = [];
  for (let i = 0; i < reg.ordinaryKindCount; i++) {
    const kind = reg.kinds[i];
    if (!kind || kind.tval !== tval) continue;
    const trueAware = state.isAware ? state.isAware(kind) : true;
    if (!trueAware) {
      rows.push({ kind, aware: false, name: objectKindName(state, kind, false) });
    }
    const insta = kind.kindFlags.has(KF.INSTA_ART);
    const everseen = state.everseen?.kindSeen(kind) ?? true;
    if ((everseen && !insta) || tvalIsMoney(kind.tval)) {
      rows.push({ kind, aware: true, name: objectKindName(state, kind, true) });
    }
  }

  /* cmp_ignore's sval-order exceptions (ui-options.c L1836-1852): these
   * categories stay in kind (sval) file order instead of being sorted. */
  const KEEP_SVAL_ORDER = new Set<number>([
    TV.LIGHT,
    TV.MAGIC_BOOK,
    TV.PRAYER_BOOK,
    TV.NATURE_BOOK,
    TV.SHADOW_BOOK,
    TV.OTHER_BOOK,
    TV.DRAG_ARMOR,
    TV.GOLD,
  ]);
  if (!KEEP_SVAL_ORDER.has(tval)) {
    rows.sort((a, b) => {
      if (a.aware !== b.aware) return a.aware ? -1 : 1;
      return strcmp(a.name, b.name);
    });
  }

  const items: MenuItem[] = [];
  const out: SvalIgnoreRow[] = [];
  for (const row of rows) {
    const ignored = row.aware
      ? settings.kindIsIgnoredAware(row.kind.kidx)
      : settings.kindIsIgnoredUnaware(row.kind.kidx);
    items.push({
      label: `[${ignored ? "*" : " "}] ${row.name}`,
      /* curs_attrs[aware][cursor] (ui-options.c L1726): unaware rows dim. */
      color: row.aware ? FG : DIM,
    });
    out.push({ kidx: row.kind.kidx, aware: row.aware });
  }
  return { items, rows: out };
}

/**
 * sval_dependent[] (ui-options.c L1674): the ignore-menu tval categories,
 * verbatim labels and order.
 */
export const SVAL_DEPENDENT: readonly { tval: number; desc: string }[] = [
  { tval: TV.STAFF, desc: "Staffs" },
  { tval: TV.WAND, desc: "Wands" },
  { tval: TV.ROD, desc: "Rods" },
  { tval: TV.SCROLL, desc: "Scrolls" },
  { tval: TV.POTION, desc: "Potions" },
  { tval: TV.RING, desc: "Rings" },
  { tval: TV.AMULET, desc: "Amulets" },
  { tval: TV.FOOD, desc: "Food" },
  { tval: TV.MUSHROOM, desc: "Mushrooms" },
  { tval: TV.MAGIC_BOOK, desc: "Magic books" },
  { tval: TV.PRAYER_BOOK, desc: "Prayer books" },
  { tval: TV.NATURE_BOOK, desc: "Nature books" },
  { tval: TV.SHADOW_BOOK, desc: "Shadow books" },
  { tval: TV.OTHER_BOOK, desc: "Mystery books" },
  { tval: TV.LIGHT, desc: "Lights" },
  { tval: TV.FLASK, desc: "Flasks of oil" },
  { tval: TV.GOLD, desc: "Money" },
];

/* ------------------------------------------------------------------ *
 * Death / tombstone screens (ui-death.c).
 * ------------------------------------------------------------------ */

/**
 * dead.txt (lib/screens): the ASCII tombstone drawn by display_exit_screen
 * (ui-death.c L74-84). The centred character fields overwrite the interior
 * (columns 8..38) at rows 7..18. Embedded verbatim rather than fetched at
 * runtime (the screens/ pack is not shipped to the web) - do not reflow.
 */
const DEAD_TOMB_ART: readonly string[] = [
  "",
  "                                                                              ",
  "            _______________________",
  "           /                       \\         ___",
  "          /                         \\ ___   /   \\",
  "         /            RIP            \\   \\  :   :",
  "        /                             \\  : _;,,,;_",
  "       /                               \\,;_",
  "      |                                 |   ___",
  "      |                                 |  /   \\",
  "      |                                 |  :   :",
  "      |                                 | _;,,,;_   ____",
  "      |                                 |          /    \\",
  "      |                                 |          :    :",
  "      |                                 |          :    :",
  "      |                                 |         _;,,,,;_",
  "      |                                 |",
  "      |                                 |",
  "      |                                 |",
  "     *|   *     *     *    *   *     *  | *",
  "_____)/\\\\_)_/___(\\/___(//_\\)/_\\//__\\\\(/_|_)__________________________",
];

/**
 * crown.txt (lib/screens): the winner crown drawn by display_winner
 * (ui-death.c L127-152). The first file line ("25") is the width hint and is
 * not embedded here; the remaining art lines follow.
 */
const CROWN_ART: readonly string[] = [
  "",
  "",
  "            #",
  "          #####",
  "            #",
  "      ,,,  $$$  ,,,",
  " ,,=$   \\\"$$$$$\\\"   $=,,",
  ",$$        $$$        $$,",
  "*>         <*>         <*",
  "$$         $$$         $$",
  '"$$        $$$        $$"',
  ' "$$       $$$       $$"',
  "  *#########*#########*",
  "  *#########*#########*",
  "",
  "",
  "    Veni, Vidi, Vici!",
  "I came, I saw, I conquered!",
  "",
];

/**
 * The footer both death screens carry. Upstream's death screens are
 * press-anything-to-continue rather than the browse keys `SCREEN_FOOTER` names.
 */
const DEATH_FOOTER = "[ Press ESC to continue ]";

/** The fields display_exit_screen centres over the tombstone. */
export interface TombstoneDeps {
  fullName: string;
  /** class->title[(lev-1)/5], or "Magnificent" when a winner. */
  title: string;
  className: string;
  level: number;
  exp: number;
  gold: number;
  depth: number;
  diedFrom: string;
  totalWinner: boolean;
  /** streq(died_from, "Retiring"): swaps the "Killed"/"by" lines for "Retired". */
  retired?: boolean;
  /** ctime(&death_time) truncated to 24 chars ("%-.24s", ui-death.c L112). */
  deathTime: string;
}

/**
 * ctime()-style stamp ("Www Mmm dd hh:mm:ss yyyy", 24 chars) from a Date, for
 * the tombstone's "on <date>" line (ui-death.c L112, %-.24s of ctime).
 */
export function ctimeStamp(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const p2 = (n: number): string => String(n).padStart(2, "0");
  const dow = days[d.getDay()];
  const mon = months[d.getMonth()];
  const day = String(d.getDate()).padStart(2, " ");
  const time = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  return `${dow} ${mon} ${day} ${time} ${d.getFullYear()}`;
}

/**
 * display_exit_screen (ui-death.c L63-113): the tombstone art with the centred
 * character epitaph. Fields sit in the band [8, 39] at the upstream rows
 * (name 7, "the" 8, title 9, class 11, Level 12, Exp 13, AU 14, killed 15/16,
 * date 18), each centred by put_str_centred.
 */
export function tombstoneScreen(deps: TombstoneDeps): ScreenView {
  /* The stone is the picture; the epitaph is DATA that upstream happens to write
   * onto the picture. Published apart, a mod can draw a real gravestone - or a
   * death card, or a run summary - with the player's own name on it, instead of
   * reading columns 8-39 of row 7 back out of ASCII. */
  const fields: ScreenArtField[] = [
    { key: "name", text: deps.fullName, row: 7, x1: 8, x2: 8 + 31 },
    { key: "the", text: "the", row: 8, x1: 8, x2: 8 + 31 },
    {
      key: "title",
      text: deps.totalWinner ? "Magnificent" : deps.title,
      row: 9,
      x1: 8,
      x2: 8 + 31,
    },
    { key: "class", text: deps.className, row: 11, x1: 8, x2: 8 + 31 },
    { key: "level", text: `Level: ${deps.level}`, values: { level: deps.level }, row: 12, x1: 8, x2: 8 + 31 },
    { key: "exp", text: `Exp: ${deps.exp}`, values: { exp: deps.exp }, row: 13, x1: 8, x2: 8 + 31 },
    { key: "gold", text: `AU: ${deps.gold}`, values: { gold: deps.gold }, row: 14, x1: 8, x2: 8 + 31 },
  ];
  if (deps.retired) {
    fields.push({
      key: "death",
      text: `Retired on Level ${deps.depth}`,
      values: { depth: deps.depth },
      row: 15, x1: 8, x2: 8 + 31,
    });
  } else {
    fields.push({
      key: "death",
      text: `Killed on Level ${deps.depth}`,
      values: { depth: deps.depth },
      row: 15, x1: 8, x2: 8 + 31,
    });
    fields.push({ key: "killer", text: `by ${deps.diedFrom}.`, row: 16, x1: 8, x2: 8 + 31 });
  }
  fields.push({ key: "date", text: `on ${deps.deathTime.slice(0, 24)}`, row: 18, x1: 8, x2: 8 + 31 });
  return freezeView({
    id: "core:tombstone",
    title: "",
    footer: DEATH_FOOTER,
    blocks: [{ kind: "art", key: "core:tomb", lines: DEAD_TOMB_ART, color: FG, fields }],
  });
}

/** The faithful terminal's rows for `tombstoneScreen`. */
export function tombstoneLines(deps: TombstoneDeps): ScreenLine[] {
  return screenBodyLines(tombstoneScreen(deps));
}

/**
 * display_winner (ui-death.c L119-156): the crown, centred, followed by the
 * "All Hail the Mighty Champion!" banner. Shown before the tombstone for a
 * total_winner.
 *
 * The banner is a FIELD with no band, which is `put_str_centred(i, 0, wid, ...)`
 * in the C - centred on the terminal rather than on the crown, and one row past
 * the picture. That is why an art field's band is optional.
 */
export function winnerScreen(): ScreenView {
  return freezeView({
    id: "core:winner",
    title: "",
    footer: DEATH_FOOTER,
    blocks: [
      {
        kind: "art",
        key: "core:crown",
        lines: CROWN_ART,
        color: FG,
        center: true,
        width: 25, // crown.txt's declared width hint (first file line)
        fields: [
          { key: "hail", text: "All Hail the Mighty Champion!", row: CROWN_ART.length },
        ],
      },
    ],
  });
}

/** The faithful terminal's rows for `winnerScreen`. */
export function winnerLines(cols = 80): ScreenLine[] {
  return screenBodyLines(winnerScreen(), cols);
}

/* ------------------------------------------------------------------ *
 * "List visible monsters" screen ([) - ui-mon-list.c.
 * ------------------------------------------------------------------ */

/** utf8_clipto-style clip to `n` visible chars (ASCII port). */
function clipTo(s: string, n: number): string {
  return n <= 0 ? "" : s.slice(0, n);
}

/**
 * monster_list_format_section (ui-mon-list.c L57-190): one section (LOS or ESP)
 * as a header line plus per-race rows. `prefix` is "You can see" / "You are
 * aware of"; `others` inserts "other " for the ESP header when the LOS section
 * had monsters. Rows show the race glyph, the "N race(s)" name, an (asleep) tag,
 * and - for a lone monster - the "dy N/S dx E/W" offset right-aligned.
 */
function monsterListSectionLines(
  list: ReturnType<typeof monsterListCollect>,
  section: number,
  prefix: string,
  others: boolean,
  maxWidth: number,
  playerDepth: number,
): ScreenLine[] {
  const out: ScreenLine[] = [];
  const total = list.totalMonsters[section] ?? 0;
  if (total === 0) {
    out.push({ text: `${prefix} no monsters.`, color: FG });
    return out;
  }
  const otherWord = others ? "other " : "";
  const plural = total === 1 ? "" : "s";
  out.push({
    text: `${prefix} ${total} ${otherWord}monster${plural}:`,
    color: FG,
  });

  for (const entry of list.entries) {
    const count = entry.count[section] ?? 0;
    if (count === 0) continue;

    let location = "";
    if (count === 1) {
      const dy = entry.dy[section] ?? 0;
      const dx = entry.dx[section] ?? 0;
      const d1 = dy <= 0 ? "N" : "S";
      const d2 = dx <= 0 ? "W" : "E";
      location = ` ${Math.abs(dy)} ${d1} ${Math.abs(dx)} ${d2}`;
    }

    /* full_width = max_width - 2 (glyph+space) - loc - 1 (upstream fudge). */
    const fullWidth = Math.max(1, maxWidth - 2 - location.length - 1);

    const asleepN = entry.asleep[section] ?? 0;
    let asleep = "";
    if (asleepN > 0 && count > 1) asleep = ` (${asleepN} asleep)`;
    else if (asleepN === 1 && count === 1) asleep = " (asleep)";

    let name = getMonName(entry.race, count);
    name = clipTo(name, Math.max(0, fullWidth - asleep.length)) + asleep;

    const lineColor = colorToCss(monsterListEntryLineColor(entry, playerDepth));
    const glyphColor = colorToCss(entry.attr || entry.race.dAttr);
    const paddedName = name.padEnd(fullWidth, " ");
    out.push({
      text: `${entry.race.dChar} ${paddedName}${location}`,
      color: lineColor,
      runs: [
        { text: entry.race.dChar, color: glyphColor },
        { text: " ", color: lineColor },
        { text: paddedName, color: lineColor },
        { text: location, color: lineColor },
      ],
    });
  }
  return out;
}

/**
 * monster_list_format_textblock (ui-mon-list.c L249-312): the whole visible-
 * monster list - the LOS section always, the ESP section when any monster is
 * known only by telepathy. Hallucination replaces the list wholesale
 * (monster_list_format_special L209-228). Sort is by depth, or by experience
 * when `sortExp` (the 'x' toggle, L410).
 */
export function monsterListScreenLines(
  state: GameState,
  cols = 80,
  sortExp = false,
): ScreenLine[] {
  const p = state.actor.player;
  if ((p.timed[TMD.IMAGE] ?? 0) > 0) {
    return [
      {
        text: "Your hallucinations are too wild to see things clearly.",
        color: colorToCss(COLOUR_ORANGE),
      },
    ];
  }

  const list = monsterListCollect(state);
  monsterListSort(
    list,
    sortExp ? monsterListCompareExp(p.lev) : monsterListStandardCompare,
  );

  const maxWidth = Math.max(20, cols - 1);
  const depth = state.chunk.depth;
  const lines = monsterListSectionLines(
    list,
    MONSTER_LIST_SECTION_LOS,
    "You can see",
    false,
    maxWidth,
    depth,
  );

  if ((list.totalEntries[MONSTER_LIST_SECTION_ESP] ?? 0) > 0) {
    const showOthers = (list.totalMonsters[MONSTER_LIST_SECTION_LOS] ?? 0) > 0;
    lines.push({ text: "", color: FG });
    lines.push(
      ...monsterListSectionLines(
        list,
        MONSTER_LIST_SECTION_ESP,
        "You are aware of",
        showOthers,
        maxWidth,
        depth,
      ),
    );
  }
  return lines;
}

/**
 * ignore_tval (ui-options.c L1699): the eligible categories - only tvals
 * whose object_base actually carries svals (kb_info[tval].num_svals > 0).
 */
export function svalCategoryItems(
  reg: ObjRegistry,
): { items: MenuItem[]; tvals: number[] } {
  const items: MenuItem[] = [];
  const tvals: number[] = [];
  for (const cat of SVAL_DEPENDENT) {
    if ((reg.bases[cat.tval]?.numSvals ?? 0) === 0) continue;
    items.push({ label: cat.desc, color: FG });
    tvals.push(cat.tval);
  }
  return { items, tvals };
}
