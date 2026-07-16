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
  ODESC,
  tvalIsBook,
  playerObjectToBook,
  spellCollectFromBook,
  spellByIndex,
  spellChance,
  spellOkayToCast,
  spellOkayToStudy,
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
  objectListEntryLineAttribute,
  OBJECT_LIST_SECTION_LOS,
  OBJECT_LIST_SECTION_NO_LOS,
  HIST,
  histHas,
  historyGetList,
  loreDescription,
} from "@neo-angband/core";
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
} from "@neo-angband/core";
import type { ScreenLine, MenuItem } from "./overlay";
import { menuLetter } from "./overlay";
import { MessageLog, format as formatMessage } from "./messages";

const FG = "#c8c8d4";
const DIM = "#8a8a94";
const LABEL = "#9aa0b4";

/** Coalesce a run of coloured chars into a ScreenLine with per-run colours. */
function charsToLine(chars: { ch: string; color: string }[]): ScreenLine {
  const runs: { text: string; color: string }[] = [];
  for (const c of chars) {
    const last = runs[runs.length - 1];
    if (last && last.color === c.color) last.text += c.ch;
    else runs.push({ text: c.ch, color: c.color });
  }
  const text = chars.map((c) => c.ch).join("");
  return runs.length > 0 ? { text, color: FG, runs } : { text: "", color: FG };
}

/**
 * Turn a core object-info Textblock (a run-stream with literal '\n' and
 * COLOUR_* attrs) into wrapped, per-run-coloured ScreenLine[] sized to the
 * terminal. Splits on '\n' into paragraphs, then greedily word-wraps each to
 * `cols - 1`, carrying run colours across the wrap boundary. The core emits
 * logical lines only (obj-info.c stays width-agnostic); this is where display
 * wrapping happens.
 */
export function wrapRuns(tb: Textblock, cols: number): ScreenLine[] {
  const width = Math.max(1, cols - 1);
  type C = { ch: string; color: string };
  const out: ScreenLine[] = [];

  /* Flatten to a coloured char stream split into paragraphs on '\n'. */
  const paragraphs: C[][] = [[]];
  for (const run of tb.runs) {
    const color = colorToCss(run.attr);
    for (const ch of run.text) {
      if (ch === "\n") paragraphs.push([]);
      else (paragraphs[paragraphs.length - 1] as C[]).push({ ch, color });
    }
  }

  for (const para of paragraphs) {
    if (para.length === 0) {
      out.push({ text: "", color: FG });
      continue;
    }
    let start = 0;
    while (start < para.length) {
      let end = Math.min(start + width, para.length);
      if (end < para.length) {
        let brk = -1;
        for (let i = end - 1; i > start; i--) {
          if ((para[i] as C).ch === " ") {
            brk = i;
            break;
          }
        }
        if (brk > start) end = brk;
      }
      out.push(charsToLine(para.slice(start, end)));
      start = end;
      /* Skip the single break space so the next line does not start with it. */
      if (start < para.length && (para[start] as C).ch === " ") start++;
    }
  }
  return out;
}

/** The display CSS color for an object (its kind's flavour/base attr). */
export function objectColor(obj: GameObject): string {
  return colorToCss(colorCharToAttr(obj.kind.dAttr));
}

/** knowledge-gated full name of a gear object, e.g. "a Potion of Cure Light Wounds". */
export function objectName(state: GameState, obj: GameObject): string {
  return describeObject(state, obj, ODESC.PREFIX | ODESC.FULL);
}

/** Pack handles in slot order (gear.pack is already the non-equipped order). */
export function packHandles(state: GameState): number[] {
  return [...state.gear.pack];
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
  for (const handle of state.gear.pack) {
    const obj = gearGet(state.gear, handle);
    if (!obj) continue;
    if (filter && !filter(obj)) continue;
    items.push({ label: objectName(state, obj), color: objectColor(obj) });
    handles.push(handle);
  }
  return { items, handles };
}

/** The inventory viewer lines (i): every pack item, lettered. */
export function inventoryLines(state: GameState): ScreenLine[] {
  const lines: ScreenLine[] = [];
  let i = 0;
  for (const handle of state.gear.pack) {
    const obj = gearGet(state.gear, handle);
    if (!obj) continue;
    lines.push({
      text: `${menuLetter(i)}) ${objectName(state, obj)}`,
      color: objectColor(obj),
    });
    i++;
  }
  if (lines.length === 0) lines.push({ text: "(nothing carried)", color: DIM });
  return lines;
}

/** The equipment viewer lines (e): one row per body slot, worn item or empty. */
export function equipmentLines(state: GameState): ScreenLine[] {
  const player = state.actor.player;
  const lines: ScreenLine[] = [];
  const slots = player.body.slots;
  for (let i = 0; i < player.body.count; i++) {
    const slot = slots[i];
    const handle = player.equipment[i] ?? 0;
    const obj = handle ? gearGet(state.gear, handle) : null;
    const label = (slot?.name ?? `slot ${i}`).padEnd(12);
    if (obj) {
      lines.push({
        text: `${menuLetter(i)}) ${label} ${objectName(state, obj)}`,
        color: objectColor(obj),
      });
    } else {
      lines.push({ text: `   ${label} (nothing)`, color: DIM });
    }
  }
  return lines;
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
      label: `${(slot?.name ?? "").padEnd(12)} ${objectName(state, obj)}`,
      color: objectColor(obj),
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
 * The spellbooks in the pack this class can actually use (its own realm's
 * books), as a selection menu. Empty for non-casters or a caster carrying no
 * usable book. Handles map the chosen index back to the book's gear handle.
 */
export function magicBooks(state: GameState): { items: MenuItem[]; handles: number[] } {
  const player = state.actor.player;
  const items: MenuItem[] = [];
  const handles: number[] = [];
  for (const handle of state.gear.pack) {
    const obj = gearGet(state.gear, handle);
    if (!obj || !tvalIsBook(obj.tval)) continue;
    if (!playerObjectToBook(player, obj)) continue;
    items.push({ label: objectName(state, obj), color: objectColor(obj) });
    handles.push(handle);
  }
  return { items, handles };
}

/**
 * The spell list of a book as a menu, faithful to the cast/study spell picker
 * (textui_book_browse columns: name, level, mana, fail%). `mode` decides which
 * spells are selectable: "cast" enables learned spells (low-mana ones stay
 * castable but are flagged, matching upstream's over-exert), "study" enables
 * only spells okay to study (right level, not yet known). Returns the parallel
 * class-wide sidx list so the caller dispatches cast/study by args.spell.
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
  for (const idx of spellCollectFromBook(player, bookObj)) {
    const spell = spellByIndex(player.cls, idx);
    if (!spell) continue;
    const name = spell.name.padEnd(20).slice(0, 20);
    const lv = String(spell.level).padStart(2);
    const mana = String(spell.mana).padStart(2);
    let disabled = false;
    let tail: string;
    if (mode === "cast") {
      if (!spellOkayToCast(player, idx)) {
        disabled = true;
        tail = "  (unknown)";
      } else {
        const fail = String(spellChance(player, statInd, idx)).padStart(2);
        const low = spell.mana > player.csp ? " low mana" : "";
        /*
         * spell_menu_display (ui-spell.c L88-92): once a learned spell has
         * been cast successfully at least once (WORKED), append its
         * get_spell_info() comment (" dam 3d4", " heal 15", ...).
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
        tail = ` ${fail}%${low}${info}`;
      }
    } else {
      disabled = !spellOkayToStudy(player, idx);
      const fail = String(spell.fail).padStart(2);
      tail = disabled ? "  (cannot learn)" : ` ${fail}%`;
    }
    items.push({
      label: `${name} Lv ${lv} Mana ${mana}${tail}`,
      disabled,
      color: DIM,
    });
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
export function monsterRecallLines(
  race: MonsterRace,
  lore: MonsterLore,
  deps: LoreDeps,
  cols: number,
): ScreenLine[] {
  return wrapRuns(loreTextToTextblock(loreDescription(race, lore, deps)), cols);
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
 * ordinal strcmp (L1258-1262). The thematic monster_group columns the
 * full-screen upstream browser draws over this set are a display grouping
 * only and are deferred (a larger follow-up alongside object/artifact
 * knowledge); this flat list is exactly the selectable membership those
 * columns partition.
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

/**
 * The monster-knowledge list as a selection menu (the '~' -> Monsters screen,
 * ui-knowledge.c). Each row is the capitalized race name plus its kill tally
 * (the browser's "Kills" column), coloured by the monster's display attr
 * (m_xattr); the parallel row list lets the caller open the picked race's
 * recall. Row order and membership come straight from knownMonsterEntries.
 */
export function monsterKnowledgeMenu(
  races: readonly MonsterRace[],
  store: LoreStore,
): { items: MenuItem[]; rows: KnownMonsterRow[] } {
  const rows = knownMonsterEntries(races, store);
  const items: MenuItem[] = rows.map(({ race, lore }) => {
    const kills = lore.pkills > 0 ? `  (${lore.pkills} killed)` : "";
    return { label: `${capRaceName(race)}${kills}`, color: colorToCss(race.dAttr) };
  });
  return { items, rows };
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
export function objectListLines(state: GameState): ScreenLine[] {
  const list = objectListCollect(state);
  objectListSort(list, objectListStandardCompare(state));

  const entryLine = (entry: (typeof list.entries)[number]): ScreenLine => {
    const glyph = entry.object ? entry.object.kind.dChar : "*";
    const name = objectListEntryName(entry, state);
    const dirY = entry.dy <= 0 ? "N" : "S";
    const dirX = entry.dx <= 0 ? "W" : "E";
    const loc = `${Math.abs(entry.dy)} ${dirY} ${Math.abs(entry.dx)} ${dirX}`;
    return {
      text: `${glyph} ${name}   ${loc}`,
      color: colorToCss(objectListEntryLineAttribute(entry, state)),
    };
  };

  const losTotal = list.totalEntries[OBJECT_LIST_SECTION_LOS]!;
  const noLosTotal = list.totalEntries[OBJECT_LIST_SECTION_NO_LOS]!;

  const lines: ScreenLine[] = [];

  /* "You can see" section (object_list_format_section, prefix "You can see",
   * show_others always false). */
  if (losTotal === 0) {
    lines.push({ text: "You can see no objects.", color: DIM });
  } else {
    lines.push({
      text: `You can see ${losTotal} object${losTotal === 1 ? "" : "s"}:`,
      color: LABEL,
    });
    for (const entry of list.entries) {
      if (entry.count[OBJECT_LIST_SECTION_LOS]! > 0) lines.push(entryLine(entry));
    }
  }

  /* "You are aware of" section: printed whenever any out-of-view entries
   * exist, regardless of whether the LOS section was empty (matches
   * object_list_format_textblock's unconditional second call). "other " is
   * inserted only when LOS objects also exist (show_others). */
  if (noLosTotal > 0) {
    const showOthers = list.totalObjects[OBJECT_LIST_SECTION_LOS]! > 0;
    const others = showOthers ? "other " : "";
    lines.push({ text: "", color: FG });
    lines.push({
      text: `You are aware of ${noLosTotal} ${others}object${noLosTotal === 1 ? "" : "s"}:`,
      color: LABEL,
    });
    for (const entry of list.entries) {
      if (entry.count[OBJECT_LIST_SECTION_NO_LOS]! > 0) lines.push(entryLine(entry));
    }
  }

  return lines;
}

/** The message-history lines (Ctrl-P): whole log, newest last. */
export function messageHistoryLines(log: MessageLog): ScreenLine[] {
  const all = log.all();
  if (all.length === 0) return [{ text: "(no messages yet)", color: DIM }];
  return all.map((m) => ({ text: formatMessage(m), color: m.color ?? FG }));
}

/** ARTIFACT_KNOWN entries get a gold highlight (a web-native enhancement). */
const HIST_KNOWN_GOLD = "#e0c040";

/**
 * The character auto-history lines (history_display, ui-history.c L38-73):
 * the column header, then one row per entry oldest-first - "%10ld%7d'  %s"
 * (turn right-justified 10, depth-in-feet right-justified 7 + apostrophe,
 * two spaces, event text) with " (LOST)" appended for ARTIFACT_LOST entries.
 * showTextScreen supplies scrolling/ESC and the "[Player history]" title, so
 * this only needs to build the header + entry lines.
 */
export function historyLines(state: GameState): ScreenLine[] {
  const list = historyGetList(state.actor.player);
  const lines: ScreenLine[] = [
    { text: "      Turn   Depth  Note", color: LABEL },
  ];
  if (list.length === 0) {
    lines.push({ text: "(no history yet)", color: DIM });
    return lines;
  }
  for (const e of list) {
    const lost = histHas(e.type, HIST.ARTIFACT_LOST);
    const known = histHas(e.type, HIST.ARTIFACT_KNOWN);
    const text = `${String(e.turn).padStart(10)}${String(e.dlev * 50).padStart(7)}'  ${e.event}${lost ? " (LOST)" : ""}`;
    lines.push({ text, color: lost ? DIM : known ? HIST_KNOWN_GOLD : FG });
  }
  return lines;
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
 * SIMPLIFICATION: upstream also requires `ego->everseen` (only egos the
 * player has met appear in the list). The port tracks no per-ego "seen"
 * flag (obj/ignore.ts's KNOWLEDGE note already runs quality/ego ignoring
 * "fully known"), so every ego with a valid ignore type is listed
 * regardless of whether it has been encountered - this can reveal ego
 * existence early. Ledgered as a follow-up (a lightweight seen-ego set)
 * rather than blocking this gap.
 */
export function egoIgnoreMenu(
  egos: readonly EgoItem[],
  kinds: readonly ObjectKind[],
  settings: IgnoreSettings,
): { items: MenuItem[]; choices: EgoIgnoreChoice[] } {
  interface Row {
    eidx: number;
    itype: number;
    shortName: string;
    prefix: string;
  }
  const rows: Row[] = [];
  for (const ego of egos) {
    if (!ego.name) continue;
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
 * SIMPLIFICATION: upstream also gates the aware row on `kind->everseen`
 * (only kinds the player has laid eyes on get one). The port tracks no
 * per-kind "seen" flag independent of flavour awareness, so - as with the
 * ego menu - every ordinary kind of the tval gets an aware row.
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
    if (!insta || tvalIsMoney(kind.tval)) {
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
