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
  CharSheetDeps,
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
  ScoreRow,
} from "@rpgm-tools/neo-angband-core";
import type { ScreenLine, MenuItem } from "./overlay";
/* TYPE-ONLY, and deliberately: `updateScreen` and `reportScreen` read two fields
 * off these views to decide which actions the page offers, and a runtime import
 * would drag the updater and the log into every module that draws a screen. */
import type { UpdateView } from "./update-ui";
import { REPORT_TRACKER_ACTION_IDS } from "./report";
import type { ReportDestination, ReportView } from "./report";
import {
  freezeView,
  screenBlockLines,
  screenBodyLines,
  SCREEN_FOOTER,
  UNMODELLED_SCREEN,
  type ScreenAction,
  type ScreenArtField,
  type ScreenBlock,
  type ScreenCell,
  type ScreenColumn,
  type ScreenRow,
  type ScreenTableBlock,
  type ScreenTextBlock,
  type ScreenView,
} from "./screen-view";
import type { PromptExtent } from "./prompt-view";
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
 * name via format(), giving "On right hand", "Around neck", "On head", ... That
 * substitution is reproduced here. The heavy_wield/heavy_shoot branch (which
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
 *
 * `trimLeading` drops the empty paragraphs object_info emits before its first
 * real line. The knowledge browser's fake recalls have always dropped them (the
 * overlay already puts the body under a title) and step 5b-v moved those pages
 * onto this builder rather than rewriting what they show, so the option exists to
 * PRESERVE that rather than to introduce it.
 */
export function proseBlock(tb: Textblock, trimLeading = false): ScreenTextBlock {
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
  if (trimLeading) while (paragraphs.length > 1 && paragraphs[0]!.length === 0) paragraphs.shift();
  return { kind: "text", color: FG, paragraphs };
}

/**
 * Plain unstyled prose as a `text` block - one entry per PARAGRAPH, unwrapped.
 *
 * The knowledge browser's rune / feature / trap / shape recalls all have this
 * shape: upstream builds a textblock of whole paragraphs and lets
 * textui_textblock_show wrap it, so the paragraph is the datum and the wrap is
 * the rendering. Empty entries are dropped rather than becoming blank
 * paragraphs, because upstream's textblock has no line to emit for them.
 */
export function textParagraphs(paragraphs: readonly string[]): ScreenTextBlock {
  return {
    kind: "text",
    color: FG,
    paragraphs: paragraphs.filter((p) => p !== "").map((text) => [{ text }]),
  };
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

/**
 * The player-history block (display_player_xtra_info, ui-player.c L858):
 * player->history wrapped (upstream text_out_wrap = 72) and indented one
 * column, in COLOUR_WHITE. The background paragraph is generated at birth
 * (get_history / generateHistory, wired through generatePlayer); empty history
 * still renders nothing so a headless / pre-birth character degrades cleanly.
 */
export function historyBlockLines(state: GameState, cols = 80): ScreenLine[] {
  const block = historyTextBlock(state);
  return block === null ? [] : screenBlockLines(block, cols);
}

/**
 * The same history as PROSE rather than as rows: one paragraph, unwrapped, with
 * the indent and the 72-column wrap published beside it.
 *
 * `null` for a character with no history, so a headless or pre-birth character
 * contributes no block at all rather than an empty one.
 *
 * This is the ONE modelled page upstream does not lay out with a textblock:
 * display_player_xtra_info (ui-player.c L862-871) parks the cursor at column 1
 * and pushes the history through `text_out_to_screen` with `text_out_wrap = 72`
 * and `text_out_indent = 1`. Hence `flow`. Saying only `wrap: 72` left the page
 * two columns wide of 4.2.6 - `text_out_to_screen` writes a non-space only
 * while `x < wrap - 1`, so its rightmost glyph is at column 70 - and re-flowed
 * the paragraph, which a player can see.
 */
function historyTextBlock(state: GameState): ScreenTextBlock | null {
  const history = state.actor.player.history.trim();
  if (!history) return null;
  return {
    kind: "text",
    paragraphs: [[{ text: history }]],
    indent: 1,
    wrap: 72,
    flow: "text-out",
    color: colorToCss(COLOUR_WHITE),
  };
}

/**
 * One stat row of display_player_stat_info (ui-player.c L469-507) as a
 * per-run-coloured line on the exact upstream column stops: the stat name at
 * col 0 (with '!' REPLACING the colon at index 3 for a natural-max stat, per
 * L480-481), Self at col 5 (cnv_stat, always 6 wide, L_GREEN), RB/CB/EB at
 * cols 12/16/20 ("%+3d", L_BLUE), Best at col 24 (L_GREEN), and - only when
 * drained - the current value at col 31 in YELLOW. No Cur column otherwise.
 */
export function statRowLine(row: StatSheetRow): ScreenLine {
  /* Index 1: the header the block always emits, then the one row. */
  return screenBlockLines(statTableBlock([row]))[1]!;
}

/** One `statTable` row, as both of the sheet's layouts take it. */
export interface StatSheetRow {
  label: string;
  natural: string;
  raceBonus: string;
  classBonus: string;
  equipBonus: string;
  best: string;
  reduced: string | null;
  naturalMax: boolean;
  drained: boolean;
}

/** The stat-table header, on the same column stops as statRowLine (the
 * upstream header strings "  Self" / " RB" / " CB" / " EB" / "  Best" at
 * col+5/+12/+16/+20/+24 - both width-6 headers padded like the data, fixing
 * the classic 5-wide header misalignment; there is no Cur header). */
export function statHeaderLine(): ScreenLine {
  return screenBlockLines(statTableBlock([]))[0]!;
}

/**
 * The stat table's columns on the exact upstream stops (display_player_stat_info,
 * ui-player.c L460-507): the stat name at col 0, Self at col 5 with NO gap before
 * it, the three bonus fields and Best single-spaced after.
 *
 * `cur` carries no label because upstream prints no Cur header, and it renders as
 * nothing at all on a stat that is not drained - the table's trailing-space cut,
 * not a special case here.
 */
const STAT_COLUMNS: readonly ScreenColumn[] = [
  { key: "stat", label: "", width: 5 },
  { key: "self", label: "Self", width: 6, align: "right", gap: 0 },
  { key: "rb", label: "RB", width: 3, align: "right" },
  { key: "cb", label: "CB", width: 3, align: "right" },
  { key: "eb", label: "EB", width: 3, align: "right" },
  { key: "best", label: "Best", width: 6, align: "right" },
  { key: "cur", label: "", width: 6, align: "right" },
];

/** A bonus field ("+1", "-1", "+0") with the number it was formatted from. */
function bonusCell(text: string): ScreenCell {
  const n = Number(text.trim());
  return {
    text,
    color: colorToCss(COLOUR_L_BLUE),
    ...(Number.isFinite(n) ? { values: { bonus: n } } : {}),
  };
}

function statScreenRow(row: StatSheetRow): ScreenRow {
  /* '!' REPLACES the colon on a stat at its natural maximum (L480-481). */
  const label = row.naturalMax ? `${row.label.slice(0, 3)}!${row.label.slice(4)}` : row.label;
  const green = colorToCss(COLOUR_L_GREEN);
  const drained = row.drained && row.reduced !== null;
  return {
    id: row.label.replace(/[^A-Za-z]/gu, "").toLowerCase(),
    color: FG,
    cells: {
      stat: { text: label, color: colorToCss(COLOUR_WHITE) },
      self: { text: row.natural, color: green },
      rb: bonusCell(row.raceBonus),
      cb: bonusCell(row.classBonus),
      eb: bonusCell(row.equipBonus),
      best: { text: row.best, color: green },
      /* An undrained stat's Cur cell is EMPTY and uncoloured rather than absent,
       * so the column exists on every row - the `tagged` lesson, one field over. */
      cur: drained
        ? { text: row.reduced ?? "", color: colorToCss(COLOUR_YELLOW) }
        : { text: "" },
    },
  };
}

function statTableBlock(rows: readonly StatSheetRow[], gapAfter = 0): ScreenTableBlock {
  return {
    kind: "table",
    key: "stats",
    tagged: false,
    columns: STAT_COLUMNS,
    headerColor: LABEL,
    rows: rows.map(statScreenRow),
    ...(gapAfter === 0 ? {} : { gapAfter }),
  };
}

/** One `characterPanels` line, as core publishes it. */
interface PanelLine {
  label: string;
  value: string;
  color: number;
}

function panelScreenRow(line: PanelLine): ScreenRow {
  if (!line.label && !line.value) return { cells: {} };
  /* Some model labels already carry a trailing colon; normalise so a row never
   * renders "Turns used::". A label-only line is a section header and shows bare. */
  const label = line.label.replace(/:\s*$/u, "");
  const id = label
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
  if (!line.value) {
    return {
      ...(id === "" ? {} : { id }),
      color: colorToCss(line.color),
      cells: { label: { text: label } },
    };
  }
  /* The number BEHIND the text, and only where the whole field is one: "18/100"
   * and "+3, +5" are not quantities and publishing a half-parse of them would be
   * worse than publishing nothing. */
  const n = Number(line.value.replace(/,/gu, ""));
  return {
    ...(id === "" ? {} : { id }),
    color: colorToCss(line.color),
    cells: {
      label: { text: `${label}:` },
      value: {
        text: line.value,
        ...(Number.isFinite(n) ? { values: { value: n } } : {}),
      },
    },
  };
}

/**
 * One `characterPanels` panel as a label/value table: neither column is padded,
 * because the phone list writes "Level: 12" and never lines the values up.
 */
function panelBlock(panel: { key: string; lines: readonly PanelLine[] }): ScreenTableBlock {
  return {
    kind: "table",
    key: panel.key,
    tagged: false,
    columns: [
      { key: "label", pad: false },
      { key: "value", pad: false },
    ],
    rows: panel.lines.map(panelScreenRow),
    gapAfter: 1,
  };
}

/**
 * `do_cmd_change_name`'s commands (ui-player.c L1219-1289) as data, so a
 * presenter that takes the sheet can still offer them.
 *
 * Both page keys are published even though the footer names only 'h': 'l' cycles
 * BACKWARD (L1285-1288) and is as real a command as the other three.
 */
export const CHARACTER_ACTIONS: readonly ScreenAction[] = [
  { id: "page-next", key: "h", label: "change mode" },
  { id: "page-prev", key: "l", label: "change mode" },
  { id: "rename", key: "c", label: "change name" },
  { id: "file", key: "f", label: "to file" },
];

/** do_cmd_change_name's prompt (ui-player.c:1229), verbatim. */
export const CHARACTER_FOOTER =
  "['c' to change name, 'f' to file, 'h' to change mode, or ESC]";

/** display_player's own heading: who this is, at what level. */
export function characterTitle(state: GameState, name?: string): string {
  const p = state.actor.player;
  return `Character  -  ${name || "(unnamed)"} the ${p.race.name} ${p.cls.name}, Level ${p.lev}`;
}

/**
 * The character sheet's first page (display_player mode 0): the six-stat table,
 * the five panels (name/class, misc, level/exp, combat, skills) and the history.
 *
 * A TABLE per panel rather than a page of rows, because a panel is label/value
 * pairs and a presenter wants the pairs: `row.id` is a slug of the label (`hp`,
 * `turns-used`) and `cells.value.values.value` is the number where the whole
 * field is one, so a card can print the level without finding the colon.
 */
export function characterScreen(
  state: GameState,
  name?: string,
  deps: CharSheetDeps = {},
): ScreenView {
  const d = { ...charSheetDeps(state, name), ...deps };
  const history = historyTextBlock(state);
  return freezeView({
    id: "core:character",
    title: characterTitle(state, name),
    footer: CHARACTER_FOOTER,
    actions: CHARACTER_ACTIONS,
    blocks: [
      statTableBlock(statTable(state, d), 1),
      ...characterPanels(state, d).map(panelBlock),
      ...(history === null ? [] : [history]),
    ],
  });
}

/**
 * The character-sheet lines (C): the faithful terminal's rows for
 * `characterScreen`, laid out as a scrollable single column so it reads at any
 * width (the narrow / phone layout).
 */
export function characterSheetLines(
  state: GameState,
  name?: string,
  cols = 80,
): ScreenLine[] {
  return screenBodyLines(characterScreen(state, name), cols);
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
 * do_cmd_knowledge_monsters (ui-knowledge.c L1309): the two-pane thematic
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
 * The repeat count is BOTH in the text (upstream's "you hit it. <3x>") and in the
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
        columns: [{ key: "message", wrap: true }],
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
  { key: "note", label: "Note", gap: 2, wrap: true },
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

/** The header `showMonsterList` paints, spelled once so the view cannot disagree. */
export const MONSTER_LIST_TITLE = "Visible monsters";

/**
 * The one thing this screen can DO besides close: 'x' flips the sort between
 * depth and experience (monster_list_show_interactive, ui-mon-list.c L410,456).
 *
 * Published as an action rather than left in the footer prose for the reason the
 * character sheet's three are: a presenter that took the screen without being
 * able to reach it would quietly take the command away from the player.
 */
export const MONSTER_LIST_ACTIONS: readonly ScreenAction[] = [
  { id: "sort-exp", key: "x", label: "sort by exp" },
];

/** The key legend, which names the state the toggle is IN, as upstream's does. */
export function monsterListFooter(sortExp: boolean): string {
  const toggle = sortExp
    ? "Press 'x' to turn OFF 'sort by exp'"
    : "Press 'x' to turn ON 'sort by exp'";
  return `[ ${toggle}  ESC: back ]`;
}

/** The " dy N/S dx E/W" offset upstream prints for a LONE monster, else "". */
function monsterListLocation(
  entry: ReturnType<typeof monsterListCollect>["entries"][number],
  section: number,
): string {
  if ((entry.count[section] ?? 0) !== 1) return "";
  const dy = entry.dy[section] ?? 0;
  const dx = entry.dx[section] ?? 0;
  return ` ${Math.abs(dy)} ${dy <= 0 ? "N" : "S"} ${Math.abs(dx)} ${dx <= 0 ? "W" : "E"}`;
}

/**
 * monster_list_format_section (ui-mon-list.c L57-190) as a table.
 *
 * `prefix` is "You can see" / "You are aware of"; `others` inserts "other " into
 * the ESP caption when the LOS section had monsters. A row is the race glyph in
 * its own colour, the "N race(s)" name with its "(asleep)" tag, and - for a lone
 * monster - the offset.
 *
 * WHY THE LOCATION IS A RIGHT-ALIGNED COLUMN rather than text appended to a
 * padded name. The C pads the name with `"%-*s%s"` at a width computed per row
 * (`full_width = max_width - 2 - len(location) - 1`), which LOOKS per-row but is
 * not: the total is `max_width - 1` on every row, because the width shrinks by
 * exactly what the location adds. Upstream's own comment says so - "the
 * left-aligned and padded monster name which will align the location to the
 * right" (L156). So a fixed name width plus a right-aligned location is the same
 * layout said the way the model can express it, and the name arrives UNPADDED,
 * which is the whole point of a cell.
 *
 * The one place the two part is clipping: the C clips a name at that row's own
 * `full_width`, which is more generous on a row whose location is shorter than
 * the section's longest. `monster-list.test.ts` measures the gap - no name the
 * pack ships comes within 30 columns of it at 80 - and a narrower re-render
 * clips a column class earlier than the C would. A column fact that changed with
 * the row's data would not be a column fact.
 */
function monsterListSectionBlock(
  list: ReturnType<typeof monsterListCollect>,
  section: number,
  key: string,
  prefix: string,
  others: boolean,
  maxWidth: number,
  playerDepth: number,
  gapAfter: number,
): ScreenTableBlock {
  const total = list.totalMonsters[section] ?? 0;
  const entries = list.entries.filter((e) => (e.count[section] ?? 0) > 0);
  const locWidth = Math.max(0, ...entries.map((e) => monsterListLocation(e, section).length));
  /* 2 for the glyph and its space, then the C's own trailing "-1 for some
   * reason?" (L123). The floor keeps a name column at a silly terminal width. */
  const nameWidth = Math.max(1, maxWidth - 3 - locWidth);

  const row = (entry: (typeof entries)[number]): ScreenRow => {
    const count = entry.count[section] ?? 0;
    const location = monsterListLocation(entry, section);
    const fullWidth = Math.max(1, maxWidth - 2 - location.length - 1);
    const asleepN = entry.asleep[section] ?? 0;
    const asleep =
      asleepN > 0 && count > 1
        ? ` (${asleepN} asleep)`
        : asleepN === 1 && count === 1
          ? " (asleep)"
          : "";
    const name = getMonName(entry.race, count);
    return {
      /* `ref` is the race, which is what a presenter matches a sprite on. The
       * label rides along because get_mon_name is the game's pluralisation
       * ("3 kobolds", "[U] Grip") and a mod should not reimplement English to
       * caption a card - only the "%3d " right-justification goes, since that is
       * the terminal's column and not part of the name. */
      semantic: { kind: "monster", ref: entry.race.name, data: { name: name.trim() } },
      color: colorToCss(monsterListEntryLineColor(entry, playerDepth)),
      /* The offset as numbers: a map marker cannot be drawn from "3 N 2 W", and
       * "(2 asleep)" is a sentence where a presenter wants a count. */
      values: {
        count,
        asleep: asleepN,
        ...(count === 1 ? { dy: entry.dy[section] ?? 0, dx: entry.dx[section] ?? 0 } : {}),
      },
      cells: {
        glyph: {
          text: entry.race.dChar,
          color: colorToCss(entry.attr || entry.race.dAttr),
        },
        name: { text: clipTo(name, Math.max(0, fullWidth - asleep.length)) + asleep },
        location: { text: location },
      },
    };
  };

  const plural = total === 1 ? "" : "s";
  return {
    kind: "table",
    key,
    tagged: false,
    ...(total === 0
      ? {}
      : {
          caption: {
            text: `${prefix} ${total} ${others ? "other " : ""}monster${plural}:`,
            color: FG,
          },
        }),
    columns: [
      { key: "glyph", width: 1 },
      { key: "name", width: nameWidth },
      /* No gap: the C's location string carries its own leading space. */
      { key: "location", width: locWidth, align: "right", gap: 0 },
    ],
    rows: total === 0 ? [] : entries.map(row),
    empty: { text: `${prefix} no monsters.`, color: FG },
    ...(gapAfter === 0 ? {} : { gapAfter }),
  };
}

/**
 * monster_list_format_textblock (ui-mon-list.c L249-312) as a screen: the LOS
 * section always, the ESP section when any monster is known only by telepathy.
 * Hallucination replaces the list wholesale (monster_list_format_special L209-
 * 228). Sort is by depth, or by experience when `sortExp` (the 'x' toggle, L410).
 *
 * WHY THIS ONE TAKES `cols` when no other screen builder does: upstream's does
 * too. `max_width` is a parameter of `monster_list_format_section`, and the name
 * field is whatever is left of the terminal after the glyph and the offset - so
 * a view built for 80 columns states 80 columns' worth of column widths. A
 * presenter reads the cells and the values and ignores the widths, which is why
 * this is honest rather than a leak: the only width-dependent DATUM is where a
 * very long name is clipped, and at 80 columns nothing the pack ships reaches it.
 */
export function monsterListScreen(
  state: GameState,
  cols = 80,
  sortExp = false,
): ScreenView {
  const p = state.actor.player;
  const view = (blocks: ScreenBlock[]): ScreenView =>
    freezeView({
      id: "core:monster-list",
      title: MONSTER_LIST_TITLE,
      footer: monsterListFooter(sortExp),
      blocks,
      actions: MONSTER_LIST_ACTIONS,
    });

  if ((p.timed[TMD.IMAGE] ?? 0) > 0) {
    /* A textblock upstream too (`textblock_append_c`, L222), so it wraps by the
     * same rule as any other prose and a `text` block is not an approximation. */
    return view([
      {
        kind: "text",
        paragraphs: [[{ text: "Your hallucinations are too wild to see things clearly." }]],
        color: colorToCss(COLOUR_ORANGE),
      },
    ]);
  }

  const list = monsterListCollect(state);
  monsterListSort(
    list,
    sortExp ? monsterListCompareExp(p.lev) : monsterListStandardCompare,
  );

  const maxWidth = Math.max(20, cols - 1);
  const depth = state.chunk.depth;
  const hasEsp = (list.totalEntries[MONSTER_LIST_SECTION_ESP] ?? 0) > 0;
  const blocks: ScreenBlock[] = [
    monsterListSectionBlock(
      list,
      MONSTER_LIST_SECTION_LOS,
      "in-view",
      "You can see",
      false,
      maxWidth,
      depth,
      hasEsp ? 1 : 0,
    ),
  ];

  if (hasEsp) {
    blocks.push(
      monsterListSectionBlock(
        list,
        MONSTER_LIST_SECTION_ESP,
        "detected",
        "You are aware of",
        (list.totalMonsters[MONSTER_LIST_SECTION_LOS] ?? 0) > 0,
        maxWidth,
        depth,
        0,
      ),
    );
  }
  return view(blocks);
}

/** The faithful terminal's rows for `monsterListScreen`. */
export function monsterListScreenLines(
  state: GameState,
  cols = 80,
  sortExp = false,
): ScreenLine[] {
  return screenBodyLines(monsterListScreen(state, cols, sortExp), cols);
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

/* ------------------------------------------------------------------ */
/* The Hall of Fame, and a store's stock in the knowledge menu          */
/* ------------------------------------------------------------------ */

/** VERSION_NAME (ui-score.c L148), which the Hall of Fame's heading is built on. */
const HALL_OF_FAME_NAME = "Neo Angband";

/**
 * display_scores_aux's heading (ui-score.c L146): the plain banner, or the
 * "(from position N)" form once the player has paged in.
 *
 * Spelled here rather than in `score.ts` so the view's title and the string the
 * faithful terminal centres cannot part - the same reason `MONSTER_LIST_TITLE`
 * lives beside its model.
 */
export function hallOfFameTitle(from = 0): string {
  return from > 0
    ? `${HALL_OF_FAME_NAME} Hall of Fame (from position ${from + 1})`
    : `${HALL_OF_FAME_NAME} Hall of Fame`;
}

/** The prompt display_scores_aux prints at the foot (ui-score.c L155-160). */
export function hallOfFameFooter(allowScrolling: boolean): string {
  return allowScrolling
    ? "[Press ESC to exit, up for prior page, any other key for next page.]"
    : "[Press ESC to exit, any other key to page forward till done.]";
}

/**
 * The Hall of Fame's columns - the CONTRACT, exported for the same reason
 * `INVENTORY_COLUMNS` is: a presenter reads `row.cells.points`, so renaming that
 * key breaks every mod that draws a leaderboard, and would break it silently.
 *
 * `rank` and `points` carry upstream's own printf field widths ("%3d" and "%9s",
 * display_score_page L66); the rest are as wide as their widest cell, because
 * upstream never lines them up - they are words inside a sentence there.
 */
export const HALL_OF_FAME_COLUMNS: readonly ScreenColumn[] = [
  { key: "rank", width: 3, align: "right" },
  { key: "points", width: 9, align: "right" },
  { key: "who" },
  { key: "race" },
  { key: "class" },
  { key: "level", align: "right" },
  { key: "depth", align: "right" },
  { key: "how" },
  { key: "date" },
  { key: "gold", align: "right" },
  { key: "turns", align: "right" },
  { key: "uid", align: "right" },
];

/**
 * The Hall of Fame (ui-score.c display_scores_aux) as a screen: one ROW PER
 * RECORD, every field addressed by a stable key and every number published.
 *
 * A LEADERBOARD IS THE THING A MOD REBUILDS FIRST, and until now it could not:
 * `scoreRow` joins the record into three prose-shaped strings, so a presenter got
 * `"  1.   123456  Frodo the Half-Troll Warrior, level 20"` as one opaque string
 * and could not sort by score, colour by rank or draw a class glyph without
 * parsing a layout that a long name or a translation moves. The strings and these
 * cells now come from ONE extraction - `ScoreRow.fields`, built in core - so the
 * model cannot drift from the lines the terminal draws.
 *
 * EVERY RECORD IS PUBLISHED, not the five the terminal has room for. Paging is
 * the faithful terminal's answer to fitting three-line records onto 24 rows; a
 * presenter that has taken the screen scrolls its own way, and a leaderboard it
 * can only see five rows of at a time is not a leaderboard. That is also why this
 * screen carries no `actions`: there is no command here, only a listing that is
 * dismissed, exactly like the inventory.
 *
 * THIS TABLE IS NOT WHAT THE TERMINAL DRAWS, and that is deliberate rather than
 * an oversight. display_score_page writes THREE lines and a blank per record at
 * absolute rows (n*4+2, n*4+3, n*4+4, the last two indented to column 15), which
 * `screenBodyLines` - one line per row - cannot express; a table shaped to
 * reproduce it would need three rows per record and would hand a mod back the
 * parsing problem this exists to remove. The character sheet's wide layout is the
 * precedent: it too is painted at upstream's own anchors rather than stacked. So
 * `score.ts` keeps display_score_page's positioned paint, and both it and this
 * model read the same `ScoreRow`.
 */
export function hallOfFameScreen(
  rows: readonly ScoreRow[],
  opts: { from?: number; allowScrolling?: boolean } = {},
): ScreenView {
  return freezeView({
    id: "core:hall-of-fame",
    title: hallOfFameTitle(opts.from ?? 0),
    footer: hallOfFameFooter(opts.allowScrolling ?? true),
    blocks: [
      {
        kind: "table",
        key: "scores",
        tagged: false,
        columns: HALL_OF_FAME_COLUMNS,
        rows: rows.map(hallOfFameRow),
        empty: { text: "(no scores yet)", color: DIM },
      },
    ],
  });
}

/** One record as a table row; see `hallOfFameScreen`. */
function hallOfFameRow(row: ScoreRow): ScreenRow {
  const f = row.fields;
  return {
    id: `core:score:${f.rank}`,
    /* The rank is the record's only stable handle - the port stores a compact
     * list with no per-record id, exactly as score.c's fixed-size records have
     * none. */
    semantic: { kind: "score", ref: f.rank, data: { who: f.who, how: f.how } },
    color: colorToCss(row.color),
    /* `highlighted` is the "this row is you" fact predict_score exists to show.
     * Published as a number rather than left to the L_GREEN colour, because a
     * presenter reading a colour to find itself is parsing a rendering. */
    values: {
      rank: f.rank,
      points: f.points,
      gold: f.gold,
      turns: f.turns,
      uid: f.uid,
      highlighted: row.highlighted ? 1 : 0,
    },
    cells: {
      rank: { text: f.rankText, values: { rank: f.rank } },
      points: { text: f.pointsText, values: { points: f.points } },
      who: { text: f.who },
      race: { text: f.race },
      class: { text: f.cls },
      /* `current` + `max` together mean a proportion under the HUD's convention,
       * which is exactly what "level 20 (Max 21)" is. */
      level: { text: String(f.level), values: { current: f.level, max: f.maxLevel } },
      depth: { text: String(f.depth), values: { current: f.depth, max: f.maxDepth } },
      how: { text: f.how },
      date: { text: f.date },
      gold: { text: String(f.gold), values: { gold: f.gold } },
      turns: { text: String(f.turns), values: { turns: f.turns } },
      uid: { text: String(f.uid), values: { uid: f.uid } },
    },
  };
}

/**
 * The stock columns of the knowledge menu's store view.
 *
 * The weight is 8 and the price is upstream's own "%9ld" (store_display_entry,
 * ui-store.c L315) with two columns of gap, which is where the shop screen puts
 * it too - neither of those changes with terminal width, so a declared width is
 * faithful for them.
 *
 * The NAME width is not a free choice: it is the gap this screen must leave, at
 * `tagged`'s 3-column prefix plus the columns' own 1-column default gap, for the
 * weight column to land where `store_display_recalc` (ui-store.c L208-233) puts
 * it. That function reads the LIVE terminal (`Term_get_size`), which this
 * screen's fixed-width table cannot reproduce (see the function-level comment
 * below) - so 52 is that formula evaluated at the one width this whole
 * screen-model family already commits to elsewhere (`screenBodyLines`'s default
 * `cols = 80`, and every existing test here renders at 80): at wid=80,
 * `scr_places_x[LOC_WEIGHT]` is `wid - 14 - 10` = 56 for a store (L226, L229,
 * L232-233 - the -10 makes room for the price column), so the name column must
 * end 4 short of that (3-column prefix + 1-column gap) - 52. Task #264: this
 * was 46 before, which put every column after it 6 short of where the shop
 * screen (shop.ts's `geom()`) draws them, because 46 was chosen only to match
 * what the pre-model code had always drawn, never checked against upstream's
 * own arithmetic.
 */
const STORE_NAME_WIDTH = 52;
export const STORE_STOCK_COLUMNS: readonly ScreenColumn[] = [
  { key: "name", width: STORE_NAME_WIDTH },
  { key: "weight", width: 8, align: "right" },
  { key: "price", width: 9, align: "right", gap: 2 },
];
/**
 * The home's columns: the same shape WITHOUT a price, but NOT the same name
 * width.
 *
 * `store_display_recalc` gives the home a wider name field than a store's, on
 * purpose: `scr_places_x[LOC_WEIGHT]` only gets the `-10` that reserves room
 * for a price column `if (store->feat != FEAT_HOME)` (ui-store.c L232-233), so
 * a home's weight sits at plain `wid - 14` = 66 at wid=80, ten columns right of
 * a store's 56 - there being no price column crowding it. Same subtraction as
 * the store's comment above (3-column prefix + 1-column gap): 66 - 4 = 62.
 *
 * Before task #264 this reused `STORE_STOCK_COLUMNS`' name width (then 46, a
 * store-shaped number applied to a screen with no price column at all), which
 * put the home's weight header 16 columns left of where 4.2.6 draws it - a
 * second, undiscovered instance of the same mistake, fixed alongside the
 * store's because it is the identical derivation in the identical function.
 *
 * The price omission itself is unchanged and is its own real conditional,
 * because store_display_entry skips the price entirely for FEAT_HOME
 * (ui-store.c L303) - nothing there is for sale, and a presenter handed a
 * `price` cell full of blanks would have to guess whether that meant free or
 * unknown.
 */
const HOME_NAME_WIDTH = 62;
export const HOME_STOCK_COLUMNS: readonly ScreenColumn[] = [
  { key: "name", width: HOME_NAME_WIDTH },
  { key: "weight", width: 8, align: "right" },
];

/** What `storeKnowledgeScreen` needs that a GameState cannot answer on its own. */
export interface StoreKnowledgeDeps {
  /** f_info[store->feat].name - the screen's heading. */
  readonly title: string;
  /** The proprietor's name; ignored for the home, which says "Your Home". */
  readonly owner: string;
  /** store->feat == FEAT_HOME: no owner, no prices. */
  readonly isHome: boolean;
  /** price_item(store, obj, false, 1); absent for the home. */
  readonly price?: (obj: GameObject) => number;
}

/**
 * do_cmd_knowledge_store (ui-knowledge.c L3412 -> textui_store_knowledge,
 * ui-store.c L1217) as a screen: the owner line, the column header, then one row
 * per stocked item with its weight and per-item buy price.
 *
 * Same shape as `core:inventory` and `core:objects-in-view`, and modelled the
 * same way - a lettered table whose cells are addressed by key, so a mod that
 * draws sprites for a pack listing already knows how to draw a shop's shelves.
 *
 * THE HEADER LINE IS STILL A LINE, and it is the one row a table cannot
 * reproduce. A table's header sits on the DATA's column grid: the renderer
 * indents it by the tag's three columns and pads each label to its own column,
 * which would put "Store Inventory" at column 3 (it is at 0) and "Price" at 70
 * (it is there now - see below). Both would be movements on the player's
 * screen, and byte identity outranks tidiness here - so the header travels as
 * prose the game already laid out and the column KEYS carry the contract
 * instead. Moving the header onto the data grid is a real fix, but it is a
 * SEPARATE one from the column below and is not done here (task #257): it
 * would move "Store Inventory" too, and needs a `tagged` table's header to sit
 * off the data grid, which `screen-view.ts` does not offer today.
 *
 * "Price" WAS at column 62, two columns left of upstream's own
 * `scr_places_x[LOC_PRICE] + 4` (ui-store.c L368) - "Price".padStart(9) over
 * the price field, which the shop screen (shop.ts:564, `gm.priceX + 4`) always
 * got right. Column 64 was where task #257 moved it to, on 2026-08-14 - lined
 * up with this screen's OWN data rows, whose price cell then started two
 * columns after an 8-wide, space-led weight field ending at column 57.
 *
 * That fix was real but incomplete, and #257's own writeup said so: the two
 * store screens still disagreed on Price, "for a different reason" (filed as
 * #264), because column 64 was only self-consistent - the data row it matched
 * was never checked against upstream's own arithmetic, only against the
 * literal 46/8/9 column widths this screen had always used. Those widths are
 * fixed (`screen-view.ts`'s table renderer does not read the terminal's live
 * width for a declared column - see `STORE_NAME_WIDTH`'s comment above), where
 * `store_display_recalc` (ui-store.c L208-233) computes `scr_places_x` from
 * the LIVE terminal every repaint, same as the shop screen's `geom()` does.
 * At the one width this whole screen family already renders at (80, see
 * `STORE_NAME_WIDTH`'s comment), that live computation puts the price field at
 * column 66, six columns right of where this screen's old 46-wide name column
 * put it (60) - the "six columns" of #264. Column 70 is `scr_places_x[LOC_PRICE]
 * + 4` at wid=80, and the price field it labels now really does end there,
 * matching the shop screen exactly rather than only matching itself. Fixed
 * 2026-08-14 (task #264).
 */
export function storeKnowledgeScreen(
  state: GameState,
  stock: readonly GameObject[],
  deps: StoreKnowledgeDeps,
): ScreenView {
  const { isHome } = deps;
  const heading: ScreenLine[] = [
    { text: isHome ? "Your Home" : deps.owner },
    { text: "" },
    {
      // padEnd amounts derived in STORE_NAME_WIDTH / HOME_NAME_WIDTH's own
      // comments above: they put "Weight" and "Price" where store_display_recalc
      // (ui-store.c L208-233) puts them at wid=80, matching the data rows below.
      text: isHome
        ? `${"Home Inventory".padEnd(68)}Weight`
        : `${"Store Inventory".padEnd(58)}${"Weight".padEnd(12)}Price`,
    },
  ];
  /* A blank row between the header and the empty notice, and ONLY when the
   * shelves are bare. A layout that changes with the data is normally the bug
   * `ScreenTableBlock.tagged` exists to prevent; this one is what the screen has
   * always drawn, so it is kept as a wart rather than quietly regularised. */
  if (stock.length === 0) heading.push({ text: "" });

  const rows: ScreenRow[] = stock.map((obj, i) => {
    const w = obj.weight;
    const price = deps.price?.(obj) ?? 0;
    return {
      id: `core:store-stock:${i}`,
      semantic: {
        kind: "item",
        ref: obj.kind.name,
        data: { source: isHome ? "home" : "store", slot: i },
      },
      /* all_letters is what this screen has always lettered with, and it wraps at
       * 26 rather than running out - a home can hold more than 26 items. */
      tag: String.fromCharCode(97 + (i % 26)),
      values: { number: obj.number, weight: w, ...(isHome ? {} : { price }) },
      cells: {
        name: { text: describeObject(state, obj) },
        /* "%3d.%d lb" without the leading pad, which the column's width supplies
         * (store_display_entry, ui-store.c L299-301). `each` is one item's
         * weight, as upstream's object_weight_one is. */
        weight: { text: `${Math.trunc(w / 10)}.${w % 10} lb`, values: { each: w } },
        ...(isHome ? {} : { price: { text: String(price), values: { price } } }),
      },
    };
  });

  return freezeView({
    id: "core:store-knowledge",
    title: deps.title,
    footer: SCREEN_FOOTER,
    blocks: [
      { kind: "lines", lines: heading },
      {
        kind: "table",
        key: "stock",
        tagged: true,
        columns: isHome ? HOME_STOCK_COLUMNS : STORE_STOCK_COLUMNS,
        rows,
        empty: { text: isHome ? "  (Your home is empty.)" : "  (The shelves are bare.)" },
      },
    ],
  });
}

/** The knowledge store view's rows; see `inventoryLines` on why this is a one-liner. */
export function storeKnowledgeLines(
  state: GameState,
  stock: readonly GameObject[],
  deps: StoreKnowledgeDeps,
): ScreenLine[] {
  return screenBodyLines(storeKnowledgeScreen(state, stock, deps));
}

/* ------------------------------------------------------------------ */
/* The two shell pages that keep a command: (U)pdate and report        */
/* ------------------------------------------------------------------ */

/**
 * The update page and the report page as screens.
 *
 * WHAT THESE TWO HAVE THAT NO OTHER PROSE PAGE HAS. Their CONTENT is prose the
 * game already laid out, so it is finished at `lines` - there is no table here
 * and modelling one would be inventing structure the page has not got. What they
 * do have is a COMMAND: ENTER starts an update, or writes a report file, and
 * `showTextScreen` treats ESC, ENTER and SPACE alike as dismissal. That is why
 * they were painted directly, and why they were invisible to a presenter - the
 * whole page, not just its command. `ScreenAction` / `ScreenHost` is exactly the
 * answer to that, and the character sheet was already using it.
 *
 * TAKEN AS TYPES, NOT AS MODULES. Both builders read only the fields the action
 * list depends on, through a type-only import, and are handed the prose and the
 * footer their callers have already computed. So `screens.ts` gains no runtime
 * dependency on the updater or the log, and both are testable from a two-field
 * object literal rather than from a live shell.
 */

/** The heading the update page draws, spelled once so the view cannot disagree. */
export const UPDATE_TITLE = "Update";

/**
 * Which key each of the update page's actions is, so `ScreenHost.invoke` and the
 * terminal's own loop run the same code rather than two copies of it.
 *
 * The keys are the faithful terminal's, and a fact about the GAME rather than an
 * instruction: a presenter with a mouse draws a button and never reads them.
 */
export const UPDATE_ACTION_KEYS: Readonly<Record<string, string>> = {
  confirm: "Enter",
  channel: "c",
  mods: "m",
};

/**
 * The update page as a screen: its prose, its footer, and the keys it names.
 *
 * ACTIONS ARE OFFERED ONLY WHERE THEY WOULD DO SOMETHING, on the same conditions
 * `updateFooter` names them - a button a presenter draws that does nothing when
 * clicked is how a player learns to distrust the interface, which is the
 * reasoning the footer itself already carries.
 */
export function updateScreen(
  view: Pick<UpdateView, "phase" | "how">,
  lines: readonly ScreenLine[],
  footer: string,
  modCount: number,
): ScreenView {
  const actions: ScreenAction[] = [];
  const confirm = updateConfirmLabel(view);
  if (confirm !== null) actions.push({ id: "confirm", key: "ENTER", label: confirm });
  if (view.how !== "web" && view.phase !== "downloading") {
    actions.push({ id: "channel", key: "C", label: "change channel" });
  }
  if (modCount > 0 && view.phase !== "downloading") {
    actions.push({ id: "mods", key: "M", label: "mod updates" });
  }
  return freezeView({
    id: "core:update",
    title: UPDATE_TITLE,
    footer,
    ...(actions.length === 0 ? {} : { actions }),
    blocks: [{ kind: "lines", lines }],
  });
}

/**
 * What ENTER does on the update page right now, or null where it does nothing.
 *
 * The phase/how ladder here is `updateFooter`'s (update-ui.ts L415-426) read a
 * SECOND TIME, which is a transcription and should not stay one: the fix is an
 * `updateConfirm(view)` in update-ui.ts that both the footer and this read from.
 * It is not made here because this stream does not own that file; the symptom if
 * they part is a button whose label disagrees with the footer beside it, which
 * `screens.test.ts` pins for every phase.
 */
function updateConfirmLabel(view: Pick<UpdateView, "phase" | "how">): string | null {
  if (view.phase === "downloading" || view.phase === "installing") return null;
  if (view.phase === "failed") return "try again";
  if (view.phase === "unchecked") return "check again";
  if (view.phase === "uptodate") return null;
  if (view.how === "swap") return "update and restart";
  if (view.how === "web") return "reload onto the new version";
  return "open the releases page";
}

/** The heading the report page draws, spelled once so the view cannot disagree. */
export const REPORT_TITLE = "Report a problem";

/** Which key each report action is; see `UPDATE_ACTION_KEYS`. */
export const REPORT_ACTION_KEYS: Readonly<Record<string, string>> = {
  describe: "d",
  "log-level": "l",
  confirm: "Enter",
};

/**
 * The report page as a screen: its prose, its footer, and the keys it names.
 *
 * The actions are exactly the ones `reportFooter` offers, on the same conditions
 * - a saved report has nothing left but the way out, and a failed one offers the
 * retry and nothing else.
 */
export function reportScreen(
  view: Pick<ReportView, "phase">,
  lines: readonly ScreenLine[],
  footer: string,
  destinations: readonly ReportDestination[] = [],
): ScreenView {
  const actions: ScreenAction[] =
    view.phase === "saved"
      ? /* A row the player cannot act on is not published as an action. A mod
         * without a resolvable repository has no `url`, so there is nothing for
         * `invoke` to do and an action offering to do it would be a button that
         * lies. The LINE naming that mod is still drawn; only the action is
         * withheld. */
        destinations
          .filter((d) => d.url !== null && d.key !== "")
          .map((d) => ({ id: d.id, key: d.key, label: d.label }))
      : view.phase === "failed"
        ? [{ id: "confirm", key: "ENTER", label: "try again" }]
        : [
            { id: "describe", key: "D", label: "describe" },
            { id: "log-level", key: "L", label: "logging level" },
            { id: "confirm", key: "ENTER", label: "write it" },
          ];
  return freezeView({
    id: "core:report",
    title: REPORT_TITLE,
    footer,
    ...(actions.length === 0 ? {} : { actions }),
    blocks: [{ kind: "lines", lines }],
  });
}

/* ------------------------------------------------------------------ */
/* WHICH ACTIONS PROMPT: the census                                    */
/* ------------------------------------------------------------------ */

/**
 * THIS TABLE IS THE ARTEFACT WHOSE ABSENCE CAUSED THE DEFECT.
 *
 * `ScreenHost.invoke(id)` runs the GAME's code for an action while a mod's
 * presenter is drawing that screen. Some of those actions put a question on the
 * faithful terminal and wait for an answer - underneath the presenter's overlay.
 * The player is asked something they cannot see, and the worst of them
 * (`charsheet:rename`) reaches `persistSave()`, so a character can be renamed
 * and the save written with nothing at all visible.
 *
 * Nothing in this tree enumerated "which actions prompt". That is why two of
 * them shipped broken and two more were added afterwards without anybody
 * noticing they were the same shape. The fix is not a rule against prompting -
 * that would make the actions a mod can offer a strict subset of the game's -
 * it is the game ANNOUNCING the prompt so a presenter can stand aside. This
 * table is what it announces FROM, and its totality test (`screens.test.ts`) is
 * what turns a fifth site into a build failure instead of a bug report.
 *
 * HERE, BESIDE `CHARACTER_ACTIONS` / `UPDATE_ACTION_KEYS` / `REPORT_ACTION_KEYS`,
 * because that is already where an action's facts live: its key, its label, and
 * now whether running it takes the terminal. A census in the runtime that drives
 * the prompt would be a second place to update and the one that goes stale.
 */

/** What `withTerminal` announces for one action: its stable id and its shape. */
export interface ScreenPromptFact {
  /** Stable prompt identity, `<host>:<action>` - `charsheet:rename`. */
  readonly promptId: string;
  readonly extent: PromptExtent;
}

/**
 * View id -> action id -> the prompt running it opens. VERIFIED BY FOLLOWING
 * EACH HOST'S `invoke` INTO WHAT IT CALLS, not by reading the footers. Named by
 * symbol rather than by line, because these three files move under each other:
 *
 * - `core:character` / `core:character-flags` `rename`: `showCharacterSheet`'s
 *   host -> `doRename` -> `promptText` (overlay.ts), which calls `term.clear()`
 *   and draws a title, a field and a footer, so the whole screen. Its answer
 *   runs `opts.onRename` -> main.ts's `renamePlayer` -> `persistSave()`. This is
 *   the worst of the four: a character renamed and the save written with nothing
 *   visible on the screen at all.
 * - the same two, `file`: the same host -> `doFileDump` -> `getFile`
 *   (overlay.ts), which is `get_string` at row 0 and then up to two more row-0
 *   prompts (`get_check`, `getKeyInline`): a line each, so `line`.
 * - `core:report` `describe`: `showReportPage`'s `act` -> `getString`, up to
 *   `REPORT_DESCRIPTION_LINES` times, each of them `prt(prompt, 0, 0)` and a
 *   line edit on row 0.
 * - `core:update` `mods`: `showUpdatePage`'s `act` -> `showModUpgrades`
 *   (mod-browse.ts), a whole nested screen with its own loop - and the site that
 *   needs the re-entrancy guard, because today it re-enters the SAME presenter
 *   while that presenter is still holding `core:update`.
 */
export const SCREEN_PROMPTS: Readonly<
  Record<string, Readonly<Record<string, ScreenPromptFact>>>
> = {
  "core:character": {
    rename: { promptId: "charsheet:rename", extent: "screen" },
    file: { promptId: "charsheet:file", extent: "line" },
  },
  "core:character-flags": {
    rename: { promptId: "charsheet:rename", extent: "screen" },
    file: { promptId: "charsheet:file", extent: "line" },
  },
  "core:report": {
    describe: { promptId: "report:describe", extent: "line" },
  },
  "core:update": {
    mods: { promptId: "update:mods", extent: "screen" },
  },
};

/**
 * The actions PROVEN not to reach the terminal, screen by screen.
 *
 * A LIST OF WHAT IS SAFE rather than "everything not above", because the pair of
 * tables is what makes the totality test possible: an action in neither is a new
 * action nobody has looked at, and an action in both is a contradiction. Silence
 * is exactly what let four prompting sites accumulate unnoticed, so silence is
 * the one answer this pair does not accept.
 *
 * What each of them does, followed the same way:
 *
 * - `page-next` / `page-prev` set `mode` and return the other page's view
 *   (`showCharacterSheet`'s host). No terminal.
 * - `sort-exp` flips a boolean and rebuilds the view (`showMonsterList`'s host).
 *   It is the CONTROL for this whole design: an action that goes through
 *   `invoke`, does real work, and never touches the terminal.
 * - `confirm` / `channel` on `core:update` do call `paint()`, but `paint()`
 *   returns immediately while `owned` is true - which is precisely the case a
 *   presenter is holding the page in. What is left is the network and the
 *   updater bridge.
 * - `log-level` cycles the logging level and logs it; `confirm` on `core:report`
 *   writes the file or offers a download. Neither asks the player anything.
 * - the `tracker-*` actions on `core:report`: `showReportPage`'s `act` ->
 *   `openExternalUrl` (external-link.ts) -> `window.open`. Nothing is drawn and
 *   nothing is read, which is the whole reason they are safe to run underneath a
 *   presenter that is holding the page.
 */
export const SCREEN_NO_PROMPT: Readonly<Record<string, readonly string[]>> = {
  "core:character": ["page-next", "page-prev"],
  "core:character-flags": ["page-next", "page-prev"],
  "core:monster-list": ["sort-exp"],
  "core:update": ["confirm", "channel"],
  "core:report": ["log-level", "confirm", ...REPORT_TRACKER_ACTION_IDS],
};

/**
 * The prompt one action opens, or undefined where it opens none.
 *
 * The one reader of `SCREEN_PROMPTS`, so a host asks a question rather than
 * indexing a table of tables and getting the nesting wrong in the one branch
 * nobody exercises.
 */
export function screenPromptFor(
  viewId: string,
  actionId: string,
): ScreenPromptFact | undefined {
  return SCREEN_PROMPTS[viewId]?.[actionId];
}
