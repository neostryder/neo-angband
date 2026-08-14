/**
 * Character birth (player-birth.c / ui-birth.c): the staged creation flow.
 * Faithful stage order (birth_stage enum, ui-birth.c L60-74): QUICKSTART (only
 * when a prior character exists) -> RACE_CHOICE -> CLASS_CHOICE ->
 * ROLLER_CHOICE -> {POINTBASED | ROLLER} -> NAME_CHOICE -> HISTORY_CHOICE ->
 * FINAL_CONFIRM. There is NO sex/gender stage in Angband 4.2.6; the port's
 * earlier Female/Male prompt was a divergence and is removed.
 *
 * ESC steps BACK one stage (BIRTH_BACK), re-entering the previous menu with its
 * prior cursor. Stepping back off the FIRST stage returns null, which means
 * BIRTH_RESET, NOT "abandon": upstream maps that BIRTH_BACK to the stage before,
 * which is BIRTH_QUICKSTART, and then remaps that to BIRTH_RESET, starting
 * creation over (ui-birth.c:1661-1666) - there is no ESC exit from birth at all
 * (only KTRL('X'), which quits the program). So the caller must run birth AGAIN
 * on null, never keep whatever character it had rolled; main.ts's maybeBirth
 * loops for exactly this reason. Each menu shows the upstream stage hint (setup_menus,
 * ui-birth.c L565/578/586) as its subtitle and, for race/class, a per-row
 * stat-adjustment line (a compact race_help/class_help). The race and class
 * menus also carry '*' (random pick, menu_question ui-birth.c L841) and '@'
 * (finish the rest of the character with random choices, L851) as tagged rows.
 *
 * Point-based (BR_POINTBASED): an interactive allocation screen (pointBuyStats,
 * faithful to ui-birth.c point_based_command: up/down move, left/right or -/+
 * buy/sell, 'r' reset) spends the birth points via the buy_stat/sell_stat
 * primitives; it opens seeded with the engine's generate_stats recommended
 * per-class spread (player-birth.c:1101,1112). The chosen stat array rides the
 * BirthChoice as `stats` and is threaded to startGame (birthStats), which
 * applies it and draws no stat RNG.
 *
 * Standard roller (BR_NORMAL): the standardRoller screen (roller_command,
 * ui-birth.c:872-999) rolls stats for display and supports reroll ('r'/space),
 * previous-roll ('p') and accept (Enter). Rolling draws from the shared game
 * stream (opts.rng); the accepted natural stats ride the BirthChoice as
 * `rolledStats` and are applied by generatePlayer's `rolledStats` option
 * (bootGame must NOT feed them through the point-buy path).
 *
 * History (BIRTH_HISTORY_CHOICE): when the shell supplies get_history via
 * BirthOpts.historyFor, the name stage is followed by an accept/edit-background
 * prompt (get_history_command, ui-birth.c:1498-1540); the result rides the
 * BirthChoice as `history` (applied via generatePlayer's `historyOverride`).
 *
 * Returns the choice, or null for BIRTH_RESET - the player stepped back off the
 * first stage and creation must start over (see above). Null is never a licence
 * to play on with an unchosen character.
 */

import { inputEvents } from "./input-door";
import {
  getKeyInline,
  menuNav,
  promptText,
  promptTextInline,
  selectFromMenu,
} from "./overlay";
import type { ScreenLine } from "./overlay";
import { customPageDefaults, runBirthOptionsEditor } from "./options";
import { runHelp } from "./help";
import { log } from "./logging";
import { argForceName, argName } from "./launch";
import {
  charSheetDeps,
  historyBlockLines,
  statHeaderLine,
  statRowLine,
} from "./screens";
import { drawPlayerXtraInfo } from "./charsheet";
import { setActiveCellTap, type GridPointerInput, type GridSurface } from "./term";
import { UI_TEXT, UI_DIM } from "./ui-colors";
import {
  BIRTH_STAT_BASE,
  MAX_BIRTH_POINTS,
  STAT_MAX,
  SKILL,
  Rng,
  birthGold,
  buyStat,
  calcBonuses,
  characterPanels,
  classMagicRealms,
  cnvStat,
  colorToCss,
  COLOUR_L_BLUE,
  COLOUR_L_GREEN,
  COLOUR_WHITE,
  COLOUR_YELLOW,
  generatePlayer,
  generateStats,
  incrementNameSuffix,
  makeRuneEnv,
  modifyStatValue,
  playerAbilities,
  resetStats,
  rollStats,
  sellStat,
  statTable,
  toCombatState,
} from "@rpgm-tools/neo-angband-core";
import type {
  Chunk,
  GameState,
  HistoryChart,
  Player,
  PlayerActor,
  PlayerBody,
  PlayerClass,
  PlayerProperty,
  PlayerRace,
  PlayerState,
} from "@rpgm-tools/neo-angband-core";

export interface BirthChoice {
  raceName: string;
  className: string;
  name: string;
  /** BR_POINTBASED ("point") / BR_NORMAL ("roller"), ui-birth.c L86-91.
   * Threaded to startGame: "point" births with `stats`; "roller" births with
   * `rolledStats` (the accepted standard-roller result). */
  roller: "point" | "roller";
  /** The point-based allocated base stats (STAT_MAX values), present only when
   * roller === "point". Passed to startGame as birthStats so the engine skips
   * the classic roller and draws no stat RNG. */
  stats?: number[];
  /** The accepted standard-roller stats (STAT_MAX natural values), present only
   * when roller === "roller". These must be applied via generatePlayer's
   * `rolledStats` option (NOT the point-buy `birthStats` path, which would
   * clamp them to [10,18]); see the WIRING-NEEDED note for bootGame. */
  rolledStats?: number[];
  /** An edited character background (do_cmd_choose_history). Present only when
   * the history-edit stage ran (gated on BirthOpts.historyFor). Applied via
   * generatePlayer's `historyOverride`; see the WIRING-NEEDED note. */
  history?: string;
  /** birth_* options set via '=' during birth (do_cmd_options_birth). Applied
   * as startGame optionOverrides so they are frozen into the new character at
   * construction. Absent/empty means every birth option keeps its default. */
  birthOptions?: Record<string, boolean>;
}

interface Named {
  name: string;
  /** r_adj/c_adj when available, for the per-row stat summary. */
  statAdj?: readonly number[];
}

/**
 * Registry-backed data the birth screen needs to draw the informational panels
 * the original shows (race_help / class_help / display_player(0), ui-birth.c)
 * but that the bare race/class records do not carry. Supplied by the shell
 * (main.ts), which holds the bound player registry; when absent the birth
 * screens degrade to the compact race/class-only detail. Mirrors the
 * BirthOpts.historyFor pattern (the shell owns the registry the birth flow
 * does not).
 */
export interface BirthDeps {
  /** registry.bodies[race.body] for a race (generatePlayer's equipment body). */
  bodyFor(raceName: string): PlayerBody | null;
  /** registry.historyChart(race): the race's starting background chart. */
  historyChartFor(raceName: string): HistoryChart | null;
  /** players.properties: the raw player_property records (race_help / class_help
   * ability scan, via core playerAbilities). */
  properties: readonly PlayerProperty[];
  /** projections[i].name for element index i (the element ability expansion). */
  elementNames: readonly string[];
}

export interface BirthOpts {
  /**
   * Shared game RNG for random birth choices (ui-birth.c randint0 at L465/678/
   * 696/842) and the standard roller. Required: omitting it throws so a missing
   * stream cannot silently desync Decision 6.2. Tests inject `new Rng(1)`.
   */
  rng?: Rng;
  /** BIRTH_QUICKSTART: the previous character's choices, offered as stage 0
   * only when a prior character exists (quickstart_allowed). `stats` is the
   * prior character's birth stats (save_roller_data); when present, quick-start
   * restores them (load_roller_data) instead of rolling fresh. */
  quickstart?: {
    raceName: string;
    className: string;
    stats?: readonly number[];
  } | null;
  /**
   * player->full_name as the PREVIOUS character left it, present only when one
   * exists (upstream's `player->ht_birth` gate). player_birth bumps its roman
   * suffix and the name prompt then defaults to that, which is how the dynastic
   * "Aragorn II -> Aragorn III" naming happens at all.
   */
  previousName?: string;
  /** msg(): needed for player_birth's "Sorry, could not deal with suffix". */
  msg?: (text: string) => void;
  /**
   * get_history for a chosen race (player-birth.c get_history), supplied by the
   * shell because the history graph lives in the core registry the birth screen
   * does not otherwise hold. When present it enables the history-edit stage
   * (BIRTH_HISTORY_CHOICE): the returned text is shown for accept/edit and the
   * result rides the BirthChoice as `history`. Absent (the current wiring) the
   * stage is skipped and history is generated engine-side as before.
   */
  historyFor?: (raceName: string) => string;
  /**
   * Registry data for the informational panels (race/class help blocks and the
   * full display_player(0) character sheet). Absent, those panels degrade to the
   * compact stat-only detail; the menus and control flow are unaffected.
   */
  deps?: BirthDeps;
  /** birth_* options carried over from the previous character, used to seed the
   * '=' birth-options editor so a New Game defaults to the last choices. */
  birthOptions?: Record<string, boolean>;
  /**
   * player_random_name (player.c L375), supplied by the shell because the
   * RANDNAME_TOLKIEN corpus lives in the core registry the birth screen does
   * not otherwise hold. Drives both upstream uses: the name field's '*' key
   * (ui-input.c L1038) and the name that finish_with_random_choices fills in
   * (ui-birth.c L725). Absent, the name stays as it was.
   */
  randomName?: () => string;
}

/* setup_menus' stage hints (ui-birth.c L565/578/586), verbatim. */
const RACE_HINT =
  "Race affects stats and skills, and may confer resistances and abilities.";
const CLASS_HINT = "Class affects stats, skills, and other character traits.";
const ROLLER_HINT =
  "Choose how to generate your intrinsic stats. Point-based is recommended.";

const STAT_ABBR = ["STR", "INT", "WIS", "DEX", "CON"] as const;

/**
 * all_letters_nohjkl (ui-menu.c:41): the birth menus tag rows from this set,
 * which skips h/j/k/l so those keys stay free as movement keys. So an 11-race
 * list is tagged a,b,c,d,e,f,g,i,m,n,o and a 9-class list a,b,c,d,e,f,g,i,m.
 */
const ALL_LETTERS_NOHJKL =
  "abcdefgimnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/* Birth screen layout constants (ui-birth.c L154-173). */
const HEADER_ROW = 1;
const QUESTION_ROW = 7;
const TABLE_ROW = 9;
const QUESTION_COL = 2;
const RACE_COL = 2;
const RACE_AUX_COL = 19;
const CLASS_COL = 19;
const CLASS_AUX_COL = 36;
const ROLLER_COL = 36;

/* Overlay palette (shared with overlay.ts's screen primitives). */
const PB_FG = UI_TEXT;
const PB_DIM = UI_DIM;

/* The core palette colours the upstream birth menus use, as CSS. */
const CSS_L_BLUE = colorToCss(COLOUR_L_BLUE);
const CSS_L_GREEN = colorToCss(COLOUR_L_GREEN);
const CSS_YELLOW = colorToCss(COLOUR_YELLOW);
const CSS_WHITE = colorToCss(COLOUR_WHITE);

/**
 * BIRTH_MENU_HELPTEXT (ui-birth.c L623-630): the second header line, split into
 * colour runs so the listed keys draw Light Green and the rest White. The
 * word-wrapper (wrapColored) keeps each run's colour as it packs words.
 */
const HELP_TITLE = "Please select your character traits from the menus below:";
const HELP_PARTS: readonly { text: string; green: boolean }[] = [
  { text: "Use the ", green: false },
  { text: "movement keys", green: true },
  { text: " to scroll the menu, ", green: false },
  { text: "Enter", green: true },
  { text: " to select the current menu item, '", green: false },
  { text: "*", green: true },
  { text: "' for a random menu item, '", green: false },
  { text: "@", green: true },
  { text: "' to finish the character with random selections, '", green: false },
  { text: "ESC", green: true },
  { text: "' to step back through the birth process, '", green: false },
  { text: "=", green: true },
  { text: "' for the birth options, '", green: false },
  { text: "?", green: true },
  { text: "' for help, or '", green: false },
  { text: "Ctrl-X", green: true },
  { text: "' to quit.", green: false },
];

/**
 * Word-wrap a run-coloured sentence to `width`, preserving each run's colour.
 * Words break only on spaces; a word carries its (possibly multi-colour) runs
 * intact. Returns at most `maxLines` ScreenLines with per-run colour.
 */
function wrapColored(
  parts: readonly { text: string; green: boolean }[],
  width: number,
  maxLines: number,
): ScreenLine[] {
  type Run = { text: string; color: string };
  const words: { runs: Run[]; len: number }[] = [];
  let cur: Run[] = [];
  let curLen = 0;
  const flushWord = (): void => {
    if (curLen > 0) {
      words.push({ runs: cur, len: curLen });
      cur = [];
      curLen = 0;
    }
  };
  for (const p of parts) {
    const color = p.green ? CSS_L_GREEN : CSS_WHITE;
    let seg = "";
    for (const ch of p.text) {
      if (ch === " ") {
        if (seg) {
          cur.push({ text: seg, color });
          curLen += seg.length;
          seg = "";
        }
        flushWord();
      } else {
        seg += ch;
      }
    }
    if (seg) {
      cur.push({ text: seg, color });
      curLen += seg.length;
    }
  }
  flushWord();

  const lines: ScreenLine[] = [];
  let lineRuns: Run[] = [];
  let lineLen = 0;
  const pushLine = (): void => {
    lines.push({
      text: lineRuns.map((r) => r.text).join(""),
      runs: lineRuns,
    });
    lineRuns = [];
    lineLen = 0;
  };
  for (const w of words) {
    const sep = lineLen > 0 ? 1 : 0;
    if (lineLen > 0 && lineLen + sep + w.len > width) pushLine();
    if (lineLen > 0) {
      lineRuns.push({ text: " ", color: CSS_WHITE });
      lineLen += 1;
    }
    lineRuns.push(...w.runs);
    lineLen += w.len;
  }
  if (lineLen > 0) pushLine();
  return lines.slice(0, maxLines);
}

/** "%+d"-style signed adjustment (empty adj slot reads as +0). */
function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
}

/** "%+3d": signed, right-justified to at least three columns (skill_help). */
function pf3(n: number): string {
  return signed(n).padStart(3);
}

/** stat_names_reduced[STAT_MAX] (ui-display.c L107), used by race/class help. */
const STAT_NAMES_REDUCED = ["Str: ", "Int: ", "Wis: ", "Dex: ", "Con: "] as const;

/**
 * The stat-adjustment block of race_help / class_help (ui-birth.c L260-273):
 * two stats per row - "%s%+3d" for the first half's stat, then "  %s%+3d" for
 * its paired second-half stat (Str/Dex, Int/Con, then Wis alone for STAT_MAX 5).
 */
function statAdjLines(adj: readonly number[]): string[] {
  const len = Math.ceil(STAT_MAX / 2);
  const out: string[] = [];
  for (let j = 0; j < len; j++) {
    let s = `${STAT_NAMES_REDUCED[j] ?? ""}${pf3(adj[j] ?? 0)}`;
    if (j * 2 + 1 < STAT_MAX) {
      s += `  ${STAT_NAMES_REDUCED[j + len] ?? ""}${pf3(adj[j + len] ?? 0)}`;
    }
    out.push(s);
  }
  return out;
}

/**
 * skill_help (ui-birth.c L218-239): the race (and optionally class) skill
 * summary - Hit/Shoot/Throw, Hit die + XP mod, Disarm phys/magic + Devices,
 * Save + Stealth, Infravision (only when `infra` >= 0; the class panel passes
 * -1 to suppress it), Digging and Search. `cSkills` null gives the race-only
 * block; supplying it sums race + class exactly as class_help does.
 */
function skillHelpLines(
  rSkills: readonly number[],
  cSkills: readonly number[] | null,
  mhp: number,
  exp: number,
  infra: number,
): string[] {
  const rs = rSkills ?? [];
  const cs = cSkills ?? null;
  const s = (i: number): number => (rs[i] ?? 0) + (cs ? cs[i] ?? 0 : 0);
  const out = [
    `Hit/Shoot/Throw: ${signed(s(SKILL.TO_HIT_MELEE))}/${signed(s(SKILL.TO_HIT_BOW))}/${signed(s(SKILL.TO_HIT_THROW))}`,
    `Hit die: ${String(mhp).padStart(2)}   XP mod: ${exp}%`,
    `Disarm: ${pf3(s(SKILL.DISARM_PHYS))}/${pf3(s(SKILL.DISARM_MAGIC))}   Devices: ${pf3(s(SKILL.DEVICE))}`,
    `Save:   ${pf3(s(SKILL.SAVE))}   Stealth: ${pf3(s(SKILL.STEALTH))}`,
  ];
  if (infra >= 0) out.push(`Infravision:  ${infra * 10} ft`);
  out.push(`Digging:      ${signed(s(SKILL.DIGGING))}`);
  out.push(`Search:       ${signed(s(SKILL.SEARCH))}`);
  return out;
}

/** class_magic_realms name join (ui-birth.c L349-366): "A", "A and B",
 * "A, B and C". */
function joinRealms(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Plain strings -> dim ScreenLines (a help/detail block). */
function dimLines(strs: readonly string[]): ScreenLine[] {
  return strs.map((text) => ({ text, color: PB_DIM }));
}

/** Draw one ScreenLine (run-aware) at (x, y), clipped to the terminal width. */
function drawScreenLine(term: GridSurface & GridPointerInput, x: number, y: number, line: ScreenLine): void {
  const { cols } = term.size();
  if (line.runs) {
    let cx = x;
    for (const run of line.runs) {
      if (cx >= cols - 1) break;
      const chunk = run.text.slice(0, cols - 1 - cx);
      term.print(cx, y, chunk, run.color);
      cx += chunk.length;
    }
  } else {
    term.print(x, y, line.text.slice(0, cols - 1 - x), line.color ?? PB_FG);
  }
}

/**
 * The exact GameState fields a birth preview supplies, mirrored from the real
 * interfaces (GameState / PlayerActor / Chunk) via `Pick` rather than retyped
 * by hand, so that renaming or dropping any one of them - upstream's job, not
 * this file's - is a COMPILE ERROR at this declaration.
 *
 * `Required<...>` strips whatever optionality the source interface happens to
 * carry on these keys (GameState.playerState is `?`, for the worldless
 * harness). previewState always supplies a concrete value for every field
 * named here regardless, so this deliberately does NOT let the object literal
 * below quietly omit one just because upstream would tolerate `undefined` -
 * that is the specific trap a plain `Pick` misses: an optional field on both
 * sides passes a same-shape check while the two have actually parted, because
 * "optional" on the mirror type would silently permit the omission too. See
 * PreviewGameState's use as the `state` declaration's type below.
 */
type PreviewActor = Required<
  Pick<
    PlayerActor,
    "player" | "combat" | "knownCombat" | "speed" | "totalEnergy" | "weapon"
  >
>;
type PreviewChunk = Required<Pick<Chunk, "depth">>;
type PreviewGameState = Required<Pick<GameState, "turn" | "playerState" | "runeEnv">> & {
  chunk: PreviewChunk;
  actor: PreviewActor;
};

/**
 * A minimal GameState wrapping a derived preview character. The birth flow has
 * no live GameState yet, so this feeds statTable / characterPanels /
 * characterSheetLines the same real, calc_bonuses-derived values a played
 * character would show. A preview needs none of the rest of the world - no
 * rng, gear, monsters, floor, traps, known map, target, ignore settings, lore,
 * brands/slays or curse tables - so it can never be a REAL GameState; some
 * cast to the full interface is unavoidable.
 *
 * THE CAST WAS THE HAZARD, and it has already cost a shipped release. This used
 * to build the object below and go straight to `as unknown as GameState`,
 * which claimed "carries exactly the fields the character-sheet renderers
 * read" without anything checking that claim - a promise about OTHER code that
 * `unknown` let this file break for free. On 2026-08-06, 0b2c72530 gave core
 * the known-state twin: char-sheet.ts started reading `state.actor.knownCombat`
 * and `state.runeEnv`, this object was not updated, and the double cast
 * silenced both. (N)ew game threw "Cannot read properties of undefined" and
 * died at the crash reporter for five days, on the green suite, because no
 * test supplied `deps` and buildPreview returns null without them - so the
 * whole path was never executed.
 *
 * Declaring `state: PreviewGameState` is what changed: every field below is
 * checked against the REAL GameState/PlayerActor/Chunk shapes by name (via the
 * Pick types above), so a rename or removal fails HERE, at compile time,
 * rather than through the `unknown` hole. What it does NOT do: catch a field
 * the real GameState gains ELSEWHERE (one PreviewGameState never names) that a sheet
 * renderer starts reading - the exact 0b2c72530 shape. Nothing at this
 * declaration can know a field it has never heard of exists, so that class of
 * regression is still the runtime test's job (the "sheet preview builds a
 * usable GameState" describe block in birth.test.ts) - this is narrower than
 * that test, not a replacement for it.
 */
function previewState(player: Player, ps: PlayerState): GameState {
  const combat = toCombatState(ps);
  /* The declared `: PreviewGameState` annotation (not `satisfies`) is load-
   * bearing: `satisfies` checks the literal against PreviewGameState but
   * leaves `state`'s own type as the anonymous literal, and casting FROM that
   * anonymous literal straight to GameState fails ("neither type sufficiently
   * overlaps with the other") even though the two are perfectly compatible -
   * measured against this file's own tsconfig (see the note below). Declaring
   * the NAMED alias as the variable's type gets the identical field-by-field
   * check (missing/excess property, wrong type) and leaves `state` typed AS
   * PreviewGameState, which the single-step cast below accepts. */
  const state: PreviewGameState = {
    turn: 0,
    chunk: { depth: 0 },
    actor: {
      player,
      combat,
      /* p->known_state, seeded with the real state exactly as session/game.ts
       * does it. A birth character carries no equipment, so there is nothing
       * unknown to derive and the seed IS the final value. */
      knownCombat: combat,
      speed: ps.speed,
      totalEnergy: 0,
      weapon: null,
    },
    playerState: ps,
    /* A birth character has no equipment, so every body slot is empty and
     * nothing varies: the same placeholder env session/game.ts installs before
     * wireGame swaps in the registry-backed one. */
    runeEnv: makeRuneEnv(
      () => null,
      () => false,
    ),
  };
  /* The one cast this file cannot avoid (see the doc above): PreviewGameState
   * is a genuine, checked narrowing of GameState, so this needs no `unknown`
   * intermediate to get there - a rename/removal in the source already failed
   * above, at the `state: PreviewGameState` declaration, before this line
   * runs. */
  return state as GameState;
}

/**
 * A fixed seed for the preview character's non-stat rolls (hit points at levels
 * 2+, age/height/weight, the background walk). Deterministic so the preview
 * sheet does not flicker between repaints; the accepted stats are always applied
 * explicitly (no stat RNG), and the real character's ahw/history are rolled from
 * the game seed at startGame - the preview only illustrates them.
 */
const PREVIEW_SEED = 0x50524556; // "PREV"

/**
 * Birth roller / point-buy layout (ui-birth.c point_based_start L1074-1086,
 * roller_command): display_player_xtra_info draws the character panels on the
 * LEFT (from col 0) and display_player_stat_info draws the stat table on the
 * RIGHT at col 42 (ui-player.c:460). The cost column sits at COSTS_COL (42+32)
 * and the "Total Cost" line at TOTAL_COL (42+19), ui-birth.c:1008-1009.
 */
const STAT_TABLE_COL = 42;
const STAT_HEADER_ROW = 1;
const STAT_ROW0 = 2; // COSTS_ROW / display_player_stat_info row.
const COST_OFFSET = 32; // COSTS_COL - 42.
const TOTAL_OFFSET = 19; // TOTAL_COL - 42.
/** Minimum terminal width for the faithful two-column layout (stat table at
 * col 42): point-buy needs the cost column at cols 74-77, the roller only the
 * Best column at cols 66-71. Below these, the table falls back to col 0 with no
 * side panels (the phone layout). */
const POINTBUY_WIDE_MIN = 78;
const ROLLER_WIDE_MIN = 72;

/**
 * The in-progress character as display_player(0) sees it: the stat-table rows
 * (display_player_stat_info), the five panels and the wrapped history
 * (display_player_xtra_info).
 *
 * Every birth screen from the roller onward is drawn ON one of these, because
 * that is what the C does: the roller calls display_player(0) (ui-birth.c L894),
 * the point-based screen calls display_player_xtra_info + display_player_stat_info
 * (L1082-1083), and the name, history and final-confirm stages each call
 * display_player(0) before their prompt (L1707/L1721/L1733). Nothing else is on
 * those screens - no title line, no menu, no summary list.
 */
interface PreviewSheet {
  /** display_player_stat_info's STAT_MAX rows, header excluded. */
  statRows: ScreenLine[];
  /** display_player_xtra_info's five panels, keyed as the C's panels[] table. */
  panels: { key: string; lines: readonly { label: string; value: string; color: number }[] }[];
  /** player->history wrapped to the screen (text_out_wrap = 72, indent 1). */
  history: ScreenLine[];
}

/**
 * display_player_xtra_info: the five panels at their upstream anchors plus the
 * history block, shared verbatim with the character screen (charsheet.ts).
 */
function drawBirthPanels(term: GridSurface & GridPointerInput, sheet: PreviewSheet | null): void {
  if (!sheet) return;
  drawPlayerXtraInfo(term, sheet.panels, sheet.history);
}

/** What textui_birth_quickstart's key loop resolves to. */
type QuickstartAction = "accept" | "redo" | "name" | "options" | "quit";

/**
 * textui_birth_quickstart (ui-birth.c:103-136), the screen offered when a
 * previous character is on file.
 *
 * Four keys, and the reason this is a raw key prompt rather than a menu is that
 * upstream's four are not four rows of one list: 'Y' finishes birth outright,
 * 'N' throws the character away, 'C' keeps it and renames, '=' edits options and
 * comes back. The port previously offered two menu rows ("Quick-start with the
 * previous character" / "Choose everything from scratch") under a paraphrased
 * subtitle, which dropped 'Y' entirely - so the one thing quick-start exists for,
 * replaying a character AS IS without retyping its name, could not be done. The
 * paraphrase is what hid it: no census can see a prompt that has been replaced
 * by a different prompt, because the slot is full.
 *
 * `sheet` is called per repaint so an option changed through '=' is reflected.
 */
async function runQuickstart(
  term: GridSurface & GridPointerInput,
  sheet: () => PreviewSheet | null,
): Promise<QuickstartAction> {
  const PROMPT =
    "['Y': use as is; 'N': redo; 'C': change name/history; '=': set birth options]";
  drawBirthSheet(term, sheet());
  const { cols, rows } = term.size();
  /* prt("New character based on previous one:", 0, 0) - row 0, the prompt row. */
  term.prt(0, 0, "New character based on previous one:".slice(0, cols - 1), UI_TEXT);
  /* prt(prompt, Term->hgt - 1, Term->wid / 2 - strlen(prompt) / 2): centred on
   * the bottom row, by C integer division on both halves. */
  const col = Math.max(0, Math.trunc(cols / 2) - Math.trunc(PROMPT.length / 2));
  term.prt(col, rows - 1, PROMPT.slice(0, Math.max(0, cols - col)), UI_TEXT);

  return new Promise<QuickstartAction>((resolve) => {
    const finish = (action: QuickstartAction): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      resolve(action);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Shift" || ev.key === "Control" || ev.key === "Alt" || ev.key === "Meta") {
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      /* The order below is upstream's, and it matters: the arg_force_name gate
       * sits on the 'C' arm only, so with a pinned name 'C' falls through to
       * nothing and the loop simply keeps waiting - it does NOT become a
       * different action. */
      if (ev.key === "N" || ev.key === "n") return finish("redo");
      /* KTRL('X'), and ESCAPE only while terms are disconnecting - a condition
       * this front end has no equivalent of (there is one term and it does not
       * disconnect), so plain ESCAPE is inert here exactly as it is upstream. */
      if (ev.key === "x" && ev.ctrlKey) return finish("quit");
      if (!argForceName() && (ev.key === "C" || ev.key === "c")) return finish("name");
      if (ev.key === "=") return finish("options");
      if (ev.key === "Y" || ev.key === "y") return finish("accept");
      /* Anything else: `while (next == BIRTH_QUICKSTART)` goes round again with
       * the screen untouched. */
    };
    inputEvents.addEventListener("keydown", onKey, true);
  });
}

/**
 * display_player(0) (ui-player.c L890-919): clear, then the stat table at col 42
 * and the panels/history. No title row - row 0 is the message/prompt line, which
 * is exactly where the name and history prompts go.
 */
function drawBirthSheet(term: GridSurface & GridPointerInput, sheet: PreviewSheet | null): void {
  term.clear();
  if (!sheet) return;
  drawScreenLine(term, STAT_TABLE_COL, STAT_HEADER_ROW, statHeaderLine());
  sheet.statRows.forEach((line, i) => {
    drawScreenLine(term, STAT_TABLE_COL, STAT_ROW0 + i, line);
  });
  drawBirthPanels(term, sheet);
}


/**
 * One display_player_stat_info row (ui-player.c L469-507) built from raw birth
 * values, rendered through the shared statRowLine so the Self/RB/CB/EB/Best
 * columns and colours match the character sheet exactly. Birth stats are never
 * drained or at the 18/100 natural cap, so reduced/naturalMax are always off.
 */
function birthStatRow(
  i: number,
  self: number,
  rb: number,
  cb: number,
  eb: number,
  best: number,
): ScreenLine {
  return statRowLine({
    label: `${STAT_ABBR[i] ?? "???"}: `,
    natural: cnvStat(self).trim(),
    raceBonus: signed(rb),
    classBonus: signed(cb),
    equipBonus: signed(eb),
    best: cnvStat(best).trim(),
    reduced: null,
    naturalMax: false,
    drained: false,
  });
}

/**
 * The point-based stat-allocation screen (ui-birth.c point_based_start /
 * point_based_command). Starts every stat at BIRTH_STAT_BASE with the full
 * MAX_BIRTH_POINTS pool and lets the player buy/sell through the ported
 * buy_stat/sell_stat primitives: up/down move the cursor, left/'-' sells,
 * right/'+' buys, 'r'/'R' resets, Enter accepts, ESC steps back. The panel
 * shows each stat's Self value, the race/class adjustments, the resulting Best
 * value (cnv_stat), the per-stat cost, the points remaining, and the live
 * starting gold (recalculate_stats: start_gold + 50 * points_left). Resolves
 * the chosen base-stat array (STAT_MAX values) or null if the player backed
 * out. Draws NO RNG - the allocation is deterministic.
 */
function pointBuyStats(
  term: GridSurface & GridPointerInput,
  race: Named,
  cls: Named,
  initial?: readonly number[],
  sheet?: (stats: readonly number[]) => PreviewSheet | null,
): Promise<number[] | null> {
  return new Promise<number[] | null>((resolve) => {
    const buy = resetStats();
    // Re-enter with the previous allocation (ESC back then forward) by replaying
    // it through buy_stat, so the pool and per-stat costs stay consistent.
    if (initial) {
      for (let i = 0; i < STAT_MAX; i++) {
        const target = initial[i] ?? BIRTH_STAT_BASE;
        while ((buy.stats[i] ?? 0) < target && buyStat(buy, i)) {
          /* raise one point at a time */
        }
      }
    }
    let cursor = 0;
    const raceAdj = race.statAdj ?? [];
    const clsAdj = cls.statAdj ?? [];

    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      // Faithful two-column layout when wide enough: character panels on the
      // left, stat table on the right at col 42 (ui-birth.c point_based_start).
      // Narrower falls back to the table at col 0 with no side panels.
      const wide = cols >= POINTBUY_WIDE_MIN;
      const tableCol = wide ? STAT_TABLE_COL : 0;
      // display_player_xtra_info (ui-birth.c:1082): the five panels at their
      // own anchors plus the history, repainted with the live stats.
      const infoLines = wide && sheet ? sheet(buy.stats) : null;
      drawBirthPanels(term, infoLines);
      // display_player_stat_info (ui-player.c L449-509): Self, RB, CB, EB, Best
      // via the shared renderer, then the birth Cost column at COSTS_COL. EB is
      // +0 at birth (no equipment) but is a real column, not omitted.
      drawScreenLine(term, tableCol, STAT_HEADER_ROW, statHeaderLine());
      term.print(tableCol + COST_OFFSET, STAT_HEADER_ROW, "Cost", CSS_WHITE);
      for (let i = 0; i < STAT_MAX; i++) {
        const self = buy.stats[i] ?? BIRTH_STAT_BASE;
        const rb = raceAdj[i] ?? 0;
        const cb = clsAdj[i] ?? 0;
        const eb = 0; // player->state.stat_add[i]: no equipment at birth.
        const best = modifyStatValue(self, rb + cb + eb);
        drawScreenLine(term, tableCol, STAT_ROW0 + i, birthStatRow(i, self, rb, cb, eb, best));
        // Cost ("%4d", ui-birth.c:1066), plain white for every row.
        term.print(
          tableCol + COST_OFFSET,
          STAT_ROW0 + i,
          String(buy.pointsSpent[i] ?? 0).padStart(4),
          CSS_WHITE,
        );
      }
      // "Total Cost: NN/NN" (ui-birth.c:1070) at TOTAL_COL, row COSTS_ROW+STAT_MAX.
      const spent = MAX_BIRTH_POINTS - buy.pointsLeft;
      term.print(
        tableCol + TOTAL_OFFSET,
        STAT_ROW0 + STAT_MAX,
        `Total Cost: ${String(spent).padStart(2)}/${String(MAX_BIRTH_POINTS).padStart(2)}`,
        CSS_WHITE,
      );
      // Starting gold: shown in the left panels when they render
      // (display_player_xtra_info gold row); drawn inline whenever the panels are
      // absent (the compact fallback, or no registry deps) so it is never lost.
      if (!infoLines) {
        term.print(
          tableCol + TOTAL_OFFSET,
          STAT_ROW0 + STAT_MAX + 1,
          `Starting gold: ${birthGold(buy.pointsLeft)}`.slice(0, cols - 1),
          PB_FG,
        );
      }
      // point_based_start prompt (ui-birth.c:1076), centered horizontally.
      const prompt =
        "[up/down to move, left/right to modify, 'r' to reset, 'Enter' to accept]";
      term.print(
        Math.max(0, Math.floor(cols / 2 - prompt.length / 2)),
        rows - 1,
        prompt.slice(0, cols - 1),
        PB_DIM,
      );
    };
    const finish = (value: number[] | null): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      setActiveCellTap(term, null);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      // Vertical cursor moves go through the shared menuNav so the numpad
      // (7/8/9 up, 1/2/3 down) drives the list regardless of NumLock, matching
      // every other menu widget; only up/down are meaningful on this column.
      const nav = menuNav(ev);
      if (nav === "up" || nav === "pageup" || nav === "home") {
        cursor = (cursor + STAT_MAX - 1) % STAT_MAX;
        paint();
        return;
      }
      if (nav === "down" || nav === "pagedown" || nav === "end") {
        cursor = (cursor + 1) % STAT_MAX;
        paint();
        return;
      }
      switch (ev.key) {
        case "Escape":
          finish(null);
          return;
        case "Enter":
          finish([...buy.stats]);
          return;
        case "ArrowLeft":
        case "-":
          sellStat(buy, cursor);
          break;
        case "ArrowRight":
        case "+":
          buyStat(buy, cursor);
          break;
        case "r":
        case "R": {
          const fresh = resetStats();
          buy.stats = fresh.stats;
          buy.pointsSpent = fresh.pointsSpent;
          buy.pointsLeft = fresh.pointsLeft;
          break;
        }
        default:
          return;
      }
      paint();
    };
    inputEvents.addEventListener("keydown", onKey, true);
    // Touch: tap a stat row to move the cursor there; tap the footer to accept.
    setActiveCellTap(term, (cell) => {
      const { rows } = term.size();
      if (cell.row === rows - 1) {
        finish([...buy.stats]);
        return;
      }
      const i = cell.row - 2;
      if (i >= 0 && i < STAT_MAX) {
        cursor = i;
        paint();
      }
    });
    paint();
  });
}

/**
 * The standard-roller screen (roller_command, ui-birth.c:872-999). Rolls the
 * character's intrinsic stats with the classic get_stats roller (drawing from
 * `rng`), shows them, and lets the player reroll ('r' or space), retrieve the
 * previous roll ('p', available once a reroll has happened), accept them
 * (Enter), or step back (ESC). This is the only place the birth shell draws
 * RNG; the accepted array is a natural stat set (values 8..17) applied verbatim
 * by generatePlayer's rolledStats option. Resolves the accepted stats or null.
 */
function standardRoller(
  term: GridSurface & GridPointerInput,
  race: Named,
  cls: Named,
  rng: Rng,
  sheet?: (roll: readonly number[]) => PreviewSheet | null,
): Promise<number[] | null> {
  return new Promise<number[] | null>((resolve) => {
    let current = rollStats(rng);
    let previous: number[] | null = null;
    // roller_command's static prev_roll: whether a reroll has ever happened, so
    // the 'p' (previous) option only appears once there is a roll to go back to.
    let prevRoll = false;
    const raceAdj = race.statAdj ?? [];
    const clsAdj = cls.statAdj ?? [];

    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      // Faithful two-column layout when wide enough: character panels on the
      // left, stat table on the right at col 42 (roller_command). Narrower falls
      // back to the table at col 0 with no side panels.
      const wide = cols >= ROLLER_WIDE_MIN;
      const tableCol = wide ? STAT_TABLE_COL : 0;
      // display_player(0) (ui-birth.c:894): the panels and history, repainted
      // on every reroll, with the stat table below drawn from the live roll.
      if (wide) drawBirthPanels(term, sheet ? sheet(current) : null);
      // display_player_stat_info (ui-player.c L449-509): Self, RB, CB, EB, Best
      // via the shared renderer. EB is +0 at birth but is a real column.
      drawScreenLine(term, tableCol, STAT_HEADER_ROW, statHeaderLine());
      for (let i = 0; i < STAT_MAX; i++) {
        const self = current[i] ?? 0;
        const rb = raceAdj[i] ?? 0;
        const cb = clsAdj[i] ?? 0;
        const eb = 0; // player->state.stat_add[i]: no equipment at birth.
        const best = modifyStatValue(self, rb + cb + eb);
        drawScreenLine(term, tableCol, STAT_ROW0 + i, birthStatRow(i, self, rb, cb, eb, best));
      }
      // roller_command's assembled prompt (ui-birth.c:900-903): the previous-roll
      // clause only appears once a reroll has happened. Centered horizontally.
      const prompt = prevRoll
        ? "['r' to reroll, 'p' for previous roll or 'Enter' to accept]"
        : "['r' to reroll or 'Enter' to accept]";
      term.print(
        Math.max(0, Math.floor(cols / 2 - prompt.length / 2)),
        rows - 1,
        prompt.slice(0, cols - 1),
        PB_DIM,
      );
    };
    const finish = (value: number[] | null): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      setActiveCellTap(term, null);
      resolve(value);
    };
    /** Touch: a tap on the footer accepts the current roll. Named because '?'
     * suspends the stage and has to put it back (see openBirthHelp). */
    const installTap = (): void => {
      setActiveCellTap(term, (cell) => {
        const { rows } = term.size();
        if (cell.row === rows - 1) finish([...current]);
      });
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      switch (ev.key) {
        case "Escape":
          finish(null);
          return;
        case "Enter":
          finish([...current]);
          return;
        case "?":
          // '?' opens help and comes back to the SAME roll - it is not a
          // reroll and not a stage change (roller_command, ui-birth.c:925-926
          // -> ACT_CTX_BIRTH_ROLL_HELP, :993-994).
          openBirthHelp(term, onKey, () => {
            inputEvents.addEventListener("keydown", onKey, true);
            installTap();
            paint();
          });
          return;
        case "r":
        case "R":
        case " ":
          // do_cmd_roll_stats: save the current roll as 'prev', then reroll.
          previous = current;
          current = rollStats(rng);
          prevRoll = true;
          break;
        case "p":
        case "P": {
          // do_cmd_prev_stats: swap in the stored previous roll (and keep the
          // displaced one so a second 'p' toggles back).
          if (!prevRoll || !previous) return;
          const swap = current;
          current = previous;
          previous = swap;
          break;
        }
        default:
          return;
      }
      paint();
    };
    inputEvents.addEventListener("keydown", onKey, true);
    installTap();
    paint();
  });
}

/** One selectable birth-menu row: its tag letter and its display name. */
interface BirthRow {
  tag: string;
  name: string;
}

/** A prior, already-chosen menu kept visible in its column (ui-birth.c keeps
 * the race column up while choosing the class, etc.), the chosen row highlighted. */
interface FrozenColumn {
  col: number;
  rows: readonly BirthRow[];
  selected: number;
}

/** The active menu column: the one with the moving cursor and the aux panel. */
interface ActiveColumn {
  col: number;
  auxCol?: number;
  rows: readonly BirthRow[];
  initialCursor: number;
  detail?: (index: number) => ScreenLine[];
  /** Whether '@' (finish with random choices) applies at this stage. */
  allowFinish: boolean;
}

/** The outcome of a birth menu (see menu_question, ui-birth.c:784): a concrete
 * pick, '*' random, '@' finish-with-random, or ESC / left-arrow step-back. */
type BirthMenuResult =
  | { kind: "pick"; index: number }
  | { kind: "random" }
  | { kind: "finish" }
  | { kind: "back" }
  /** '=' opened the birth-options screen (do_cmd_options_birth, ui-birth.c:848);
   * the caller re-shows the same stage afterwards (next = current). */
  | { kind: "options" };

/**
 * '?' during birth opens the general help browser (do_cmd_help). Upstream calls
 * it from INSIDE the stage's own input loop and does not change stage
 * (menu_question, ui-birth.c:859-861; roller_command, :925-926 -> :993-994), so
 * the screen the player comes back to is the one they left, cursor and current
 * roll intact. That rules out the treatment '=' gets - resolve the stage and let
 * the caller re-enter it - because re-entry rebuilds the stage from its initial
 * cursor, and on the roller it would throw the displayed roll away.
 *
 * So the stage's input is SUSPENDED for the duration instead. It has to be:
 * the stage's keydown listener is registered first and calls
 * stopImmediatePropagation, so leaving it attached would eat every key the help
 * browser needs. `restore` is the stage's job and must re-register its tap
 * handler as well as its listener - the overlay nulls term.onCellTap on the way
 * out - and repaint, since help has cleared the screen.
 */
function openBirthHelp(
  term: GridSurface & GridPointerInput,
  onKey: (ev: KeyboardEvent) => void,
  restore: () => void,
): void {
  inputEvents.removeEventListener("keydown", onKey, true);
  /* Nulling the tap is belt-and-braces and mutation-verified as such: runHelp's
   * first act is selectFromMenu, which installs its own handler synchronously,
   * so there is no instant at which a tap could still reach the stage behind
   * the modal. It stays because that is a property of the help browser, not of
   * this call, and a help screen that opened without a tap handler would
   * otherwise let a stray tap pick a race nobody could see. */
  setActiveCellTap(term, null);
  void runHelp(term)
    .catch((err: unknown) => {
      log.error("birth", "the help browser failed", err);
    })
    /* Not `.then(restore, restore)`: the catch above already absorbs the
     * rejection, and a stage left with no listener is an unrecoverable birth
     * screen - the player would have no key that does anything. */
    .then(restore);
}

/**
 * The faithful multi-column birth menu (ui-birth.c menu_question +
 * birthmenu_display + print_menu_instructions): draws the two-line instruction
 * header (rows 1-6), the yellow stage hint (QUESTION_ROW=7), any already-chosen
 * prior columns with their selection highlighted, the active column with a
 * cursor, and the aux info panel for the highlighted active row. Handles up/down
 * (numpad via menuNav), Enter / tag-letter to select, '*' random, '@' finish
 * (when allowed), '=' (birth options, via the caller) and '?' (help, in place),
 * ESC / left-arrow to step back,
 * and tap-to-select. Resolves a BirthMenuResult.
 */
function birthMenu(
  term: GridSurface & GridPointerInput,
  hint: string,
  frozen: readonly FrozenColumn[],
  active: ActiveColumn,
): Promise<BirthMenuResult> {
  return new Promise<BirthMenuResult>((resolve) => {
    const count = active.rows.length;
    let cursor = Math.min(Math.max(active.initialCursor, 0), Math.max(0, count - 1));

    const drawColumn = (
      col: number,
      rows: readonly BirthRow[],
      selected: number,
    ): void => {
      const { rows: termRows } = term.size();
      for (let i = 0; i < rows.length && TABLE_ROW + i < termRows; i++) {
        const r = rows[i];
        if (!r) continue;
        // birthmenu_display (ui-birth.c L207-208) draws each row with
        // c_put_str(curs_attrs[CURS_KNOWN][0 != cursor], ...). curs_attrs
        // (ui-menu.c L29-32) is { COLOUR_WHITE, COLOUR_L_BLUE } for a known
        // row, so the cursor row is L_BLUE and every other row is WHITE.
        term.print(
          col,
          TABLE_ROW + i,
          `${r.tag}) ${r.name}`,
          i === selected ? CSS_L_BLUE : CSS_WHITE,
        );
      }
    };

    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      // print_menu_instructions (ui-birth.c L635): the light-blue title line at
      // (QUESTION_COL, HEADER_ROW), a blank line, then the wrapped key legend.
      term.print(
        QUESTION_COL,
        HEADER_ROW,
        HELP_TITLE.slice(0, cols - 1 - QUESTION_COL),
        CSS_L_BLUE,
      );
      const wrapped = wrapColored(
        HELP_PARTS,
        Math.max(10, cols - QUESTION_COL - 1),
        QUESTION_ROW - (HEADER_ROW + 2),
      );
      for (let i = 0; i < wrapped.length; i++) {
        const line = wrapped[i];
        if (line) drawScreenLine(term, QUESTION_COL, HEADER_ROW + 2 + i, line);
      }
      // The stage hint in yellow at (QUESTION_COL, QUESTION_ROW) (ui-birth.c:795).
      term.print(
        QUESTION_COL,
        QUESTION_ROW,
        hint.slice(0, cols - 1 - QUESTION_COL),
        CSS_YELLOW,
      );
      // The prior chosen columns, then the active column with its cursor.
      for (const f of frozen) drawColumn(f.col, f.rows, f.selected);
      drawColumn(active.col, active.rows, cursor);
      // The aux info panel for the highlighted active row (race_help/class_help).
      if (active.auxCol != null && active.detail) {
        const lines = active.detail(cursor);
        for (let i = 0; i < lines.length && TABLE_ROW + i < rows; i++) {
          const line = lines[i];
          if (line) drawScreenLine(term, active.auxCol, TABLE_ROW + i, line);
        }
      }
    };

    const finish = (res: BirthMenuResult): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      setActiveCellTap(term, null);
      resolve(res);
    };

    /** Touch: tap a row in the active column to select it. Named because '?'
     * suspends the stage and has to put it back (see openBirthHelp). */
    const installTap = (): void => {
      setActiveCellTap(term, (cell) => {
        const i = cell.row - TABLE_ROW;
        if (i >= 0 && i < count) finish({ kind: "pick", index: i });
      });
    };

    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const nav = menuNav(ev);
      if (nav === "up" || nav === "pageup" || nav === "home") {
        cursor = (cursor + count - 1) % count;
        paint();
        return;
      }
      if (nav === "down" || nav === "pagedown" || nav === "end") {
        cursor = (cursor + 1) % count;
        paint();
        return;
      }
      switch (ev.key) {
        case "Escape":
        case "ArrowLeft":
          // ESC or left-arrow = BIRTH_BACK (menu_question L804-811).
          finish({ kind: "back" });
          return;
        case "Enter":
          finish({ kind: "pick", index: cursor });
          return;
        case "*":
          finish({ kind: "random" });
          return;
        case "@":
          if (active.allowFinish) finish({ kind: "finish" });
          return;
        case "=":
          // '=' opens the birth-options screen (ui-birth.c:848-850,
          // do_cmd_options_birth); the runBirth loop shows it and re-enters
          // this same stage (next = current).
          finish({ kind: "options" });
          return;
        case "?":
          // '?' opens help and returns to THIS menu, cursor untouched
          // (menu_question, ui-birth.c:859-861). The instruction header has
          // been advertising this key since print_menu_instructions was ported.
          openBirthHelp(term, onKey, () => {
            inputEvents.addEventListener("keydown", onKey, true);
            installTap();
            paint();
          });
          return;
        default:
          break;
      }
      // Tag-letter selection (all_letters_nohjkl), case-insensitive.
      if (ev.key.length === 1) {
        const lower = ev.key.toLowerCase();
        const idx = active.rows.findIndex((r) => r.tag.toLowerCase() === lower);
        if (idx >= 0) finish({ kind: "pick", index: idx });
      }
    };
    inputEvents.addEventListener("keydown", onKey, true);
    installTap();
    paint();
  });
}

/** Word-wrap a background paragraph into fixed-width lines for display. */
function wrapHistory(text: string, width = 60): ScreenLine[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: ScreenLine[] = [];
  let line = "";
  for (const w of words) {
    if (line.length + (line ? 1 : 0) + w.length > width) {
      if (line) lines.push({ text: line, color: PB_FG });
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push({ text: line, color: PB_FG });
  if (lines.length === 0) lines.push({ text: "(no background)", color: PB_DIM });
  return lines;
}

/**
 * The history-editing stage (get_history_command, ui-birth.c:1498-1540): show
 * the generated background and prompt "Accept character history?" - accept it
 * as-is, or edit it (a single-line web adaptation of edit_text via promptText).
 * Resolves the final background text, or null to step back (ESC / BIRTH_BACK).
 */
async function historyStage(
  term: GridSurface & GridPointerInput,
  historyText: string,
  drawSheet: (history: string) => boolean,
): Promise<string | null> {
  let current = historyText;
  for (;;) {
    // The sheet carries the history itself (display_player_xtra_info wraps
    // player->history from row 19), so the prompt is just the question. Without
    // registry deps there is no sheet to draw, so the background is wrapped in
    // on its own - never ask someone to accept a history they cannot read.
    if (!drawSheet(current)) {
      let y = 2;
      for (const line of wrapHistory(current, term.size().cols - 2)) {
        drawScreenLine(term, 1, y++, line);
      }
    }
    const key = await getKeyInline(term, "Accept character history? [y/n]");
    if (key === "Escape") return null;
    if (key !== "n" && key !== "N") return current;
    // 'n' -> edit_text (ui-birth.c:1523): edit the history in place. A cancelled
    // edit leaves it unchanged and re-asks, exactly as edit_text returning 1.
    const edited = await promptText(
      term,
      "Edit your character's background",
      current,
      240,
      "[ edit text, Enter to accept, ESC to cancel ]",
    );
    if (edited !== null) current = edited;
  }
}

/**
 * The final-confirm screen (ui-birth.c L1733/1546): display_player(0) - the full
 * character sheet - then the accept/back prompt. Renders the derived preview
 * sheet (statTable + panels + history, characterSheetLines) scrollable, with a
 * begin/back footer. Resolves true to begin the adventure, false to step back.
 * `sheetLines` null (no registry deps) falls back to the plain accept/back menu.
 */
/**
 * get_confirm_command (ui-birth.c L1546-1572): "begin" accepts the character,
 * "back" steps back one stage (ESC), "restart" is 'S' -> BIRTH_RESET (start the
 * whole character over). The port keeps the scrollable sheet + touch menu but
 * layers the faithful 'S' start-over key on top.
 */
type ConfirmResult = "begin" | "back" | "restart";

function confirmCharacter(
  term: GridSurface & GridPointerInput,
  sheet: PreviewSheet | null,
  fallbackTitle: string,
): Promise<ConfirmResult> {
  if (!sheet) {
    // No registry deps (tests / a stub pack): there is no sheet to confirm, so
    // fall back to a plain choice rather than an empty screen.
    return selectFromMenu(
      term,
      "core:birth-confirm",
      fallbackTitle,
      [
        { label: "Begin the adventure", hint: "Accept this character and play." },
        { label: "Go back", hint: "Step back and change something." },
        { label: "Start over", hint: "Discard everything and create a new character." },
      ],
      "[ a-z to choose, tap a row, ESC to go back ]",
      { subtitle: "Please confirm your character." },
    ).then((pick) => (pick === 0 ? "begin" : pick === 2 ? "restart" : "back"));
  }
  return new Promise<ConfirmResult>((resolve) => {
    const { cols, rows } = term.size();
    drawBirthSheet(term, sheet);
    // get_confirm_command (ui-birth.c:1548-1555): this exact prompt, centred on
    // the last row. No scrolling and no menu - the whole sheet is already on
    // screen, and any key that is not ESC or 'S' begins the game.
    const prompt =
      "['ESC' to step back, 'S' to start over, or any other key to continue]";
    term.print(
      Math.max(0, Math.floor(cols / 2 - prompt.length / 2)),
      rows - 1,
      prompt.slice(0, cols - 1),
      PB_FG,
    );
    const finish = (value: ConfirmResult): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      setActiveCellTap(term, null);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Shift" || ev.key === "Control" || ev.key === "Alt" || ev.key === "Meta") {
        return; // a modifier alone is not "any other key"
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      /* 'S'/'s' -> BIRTH_RESET (L1559-1560): start the character over. */
      if (ev.key === "S" || ev.key === "s") return finish("restart");
      if (ev.key === "Escape") return finish("back");
      finish("begin");
    };
    inputEvents.addEventListener("keydown", onKey, true);
    // Touch: tapping the prompt row is "any other key" (begin).
    setActiveCellTap(term, () => {
      finish("begin");
    });
  });
}

type Stage =
  | "quickstart"
  | "race"
  | "class"
  | "roller"
  | "points"
  | "roll"
  | "name"
  | "history"
  | "confirm";

export async function runBirth(
  term: GridSurface & GridPointerInput,
  races: readonly PlayerRace[],
  classes: readonly PlayerClass[],
  opts: BirthOpts = {},
): Promise<BirthChoice | null> {
  const quick = opts.quickstart ?? null;
  let stage: Stage = quick ? "quickstart" : "race";
  // The visited-stage stack: ESC (BIRTH_BACK) pops one entry, so a quickstart
  // jump straight to the name stage steps back to quickstart, not to menus
  // that were never shown.
  const backStack: Stage[] = [];
  const goBack = (): boolean => {
    const prev = backStack.pop();
    if (prev === undefined) return false;
    stage = prev;
    return true;
  };
  const advance = (next: Stage): void => {
    backStack.push(stage);
    stage = next;
  };

  // birth_* options chosen via '=' during birth (do_cmd_options_birth). Applied
  // as startGame optionOverrides after acceptance.
  //
  // SEEDED FROM THE PLAYER'S CUSTOMISED DEFAULTS FIRST (options_init_defaults'
  // OP_BIRTH restore, option.c:198, which runs in player_init BEFORE any birth
  // stage). Without this the '=' screen would open on the table defaults every
  // time and the 's' key on it would write a file nothing ever read - the
  // savefile cannot do this job, because at birth there is no savefile. A value
  // this session already chose still wins over the file.
  const birthOptions: Record<string, boolean> = {
    ...customPageDefaults("BIRTH"),
    ...(opts.birthOptions ?? {}),
  };
  // Wrap birthMenu so '=' opens the editable birth-options screen and then
  // re-shows the SAME stage (ui-birth.c:848-850, next = current), for every
  // menu_question stage without threading the option state into each.
  const askMenu = async (
    hint: string,
    frozen: readonly FrozenColumn[],
    active: ActiveColumn,
  ): Promise<BirthMenuResult> => {
    for (;;) {
      const res = await birthMenu(term, hint, frozen, active);
      if (res.kind === "options") {
        await runBirthOptionsEditor(term, birthOptions);
        continue;
      }
      return res;
    }
  };

  // Cursor memory per stage, so stepping back re-enters at the prior row.
  let raceIdx = 0;
  let classIdx = 0;
  let rollerIdx = 0;
  let raceName = "";
  let className = "";
  /**
   * player_birth's opening block (player-birth.c:1060-1073): with a previous
   * character on file, its name comes forward with any roman-numeral suffix
   * BUMPED, so the name prompt defaults to the next generation ("Aragorn II" ->
   * "Aragorn III"). A name with no suffix comes forward unchanged; upstream does
   * not blank it. An increment that will not fit reports
   * "Sorry, could not deal with suffix" and leaves the name alone.
   */
  let name = opts.previousName
    ? incrementNameSuffix(opts.previousName, 32, opts.msg)
    : "";
  // The point-based allocation, once chosen; reused if the player steps back
  // into the screen so their work is not lost (ui-birth.c keeps it too).
  let pointStats: number[] | null = null;
  // The accepted standard-roller stats (BR_NORMAL), once accepted.
  let rolledStats: number[] | null = null;
  // The edited background (BIRTH_HISTORY_CHOICE), once the history stage runs.
  let historyText: string | null = null;

  // The birth shell's RNG: standard roller and the '*'/'@' random choices.
  // Must be the shared game stream (Decision 6.2 / ui-birth.c L678), never a
  // Date.now-seeded generator or a silent Rng(1) fallback (that desyncs the
  // stream when the shell forgets to inject). Tests and the shell must pass rng.
  if (!opts.rng) {
    throw new Error(
      "runBirth: opts.rng is required (ui-birth.c advances the main game stream)",
    );
  }
  const rollRng = opts.rng;

  // Registry-backed info (race/class ability names + the full preview sheet).
  // Absent, the help blocks still show stat + skill data (computable from the
  // race/class records) and the full-sheet screens fall back to the compact
  // panel - the menus and control flow are unchanged.
  const deps = opts.deps;
  const raceAbilCache = new Map<string, readonly string[]>();
  const classAbilCache = new Map<string, readonly string[]>();
  // race_help / class_help ability scan (ui-birth.c L279-298 / L370-389), via
  // core playerAbilities on a throwaway preview character (the race group is
  // class-independent and vice versa, so a default partner is used).
  const abilityRows = (race: PlayerRace, cls: PlayerClass) => {
    if (!deps) return [];
    const body = deps.bodyFor(race.name);
    if (!body) return [];
    const { player } = generatePlayer(
      race,
      cls,
      { body, historyChart: deps.historyChartFor(race.name) },
      new Rng(PREVIEW_SEED),
    );
    const ps = calcBonuses(player);
    return playerAbilities(previewState(player, ps), {
      properties: deps.properties,
      elementNames: deps.elementNames,
    });
  };
  const raceAbilityNames = (race: PlayerRace): readonly string[] => {
    const hit = raceAbilCache.get(race.name);
    if (hit) return hit;
    const cls = classes[0];
    const names = cls
      ? abilityRows(race, cls).filter((r) => r.group === "race").map((r) => r.name)
      : [];
    raceAbilCache.set(race.name, names);
    return names;
  };
  const classAbilityNames = (cls: PlayerClass): readonly string[] => {
    const hit = classAbilCache.get(cls.name);
    if (hit) return hit;
    const race = races[0];
    const names = race
      ? abilityRows(race, cls).filter((r) => r.group === "class").map((r) => r.name)
      : [];
    classAbilCache.set(cls.name, names);
    return names;
  };

  // race_help (ui-birth.c L241-302): the stat-adjustment table, the race-only
  // skill_help block, then up to three racial ability / resist names.
  const raceDetail = (i: number): ScreenLine[] => {
    const race = races[i];
    if (!race) return [];
    const lines: string[] = [...statAdjLines(race.statAdj), ""];
    lines.push(
      ...skillHelpLines(
        race.skills,
        null,
        race.hitdie ?? 0,
        race.expFactor ?? 0,
        race.infravision ?? 0,
      ),
    );
    const abils = raceAbilityNames(race).slice(0, 3);
    if (abils.length > 0) lines.push("", ...abils);
    return dimLines(lines);
  };
  // class_help (ui-birth.c L304-393): the COMBINED race+class stat adjustments,
  // the combined skill_help, "Learns <realm> magic" for casters, then up to five
  // class ability names. Built per class row against the already-chosen race.
  const classDetailFor = (raceIndex: number) => (i: number): ScreenLine[] => {
    const cls = classes[i];
    const race = races[raceIndex];
    if (!cls || !race) return [];
    const combined = race.statAdj.map((v, k) => v + (cls.statAdj[k] ?? 0));
    const lines: string[] = [...statAdjLines(combined), ""];
    lines.push(
      ...skillHelpLines(
        race.skills,
        cls.skills,
        (race.hitdie ?? 0) + (cls.hitdie ?? 0),
        (race.expFactor ?? 0) + (cls.expFactor ?? 0),
        -1,
      ),
    );
    const realms = cls.magic ? classMagicRealms(cls) : [];
    if (realms.length > 0) {
      lines.push("", `Learns ${joinRealms(realms.map((r) => r.name))} magic`);
    }
    const abils = classAbilityNames(cls).slice(0, 5);
    if (abils.length > 0) lines.push("", ...abils);
    return dimLines(lines);
  };

  /**
   * display_player(0) (ui-birth.c L894 / L1074 / L1546 / L1631) as PARTS - a
   * derived preview character (generatePlayer + calc_bonuses) reduced to the stat
   * rows, the five panels and the wrapped history, so the birth screens can place
   * them exactly where ui-player.c does. Returns null without registry deps.
   */
  const buildPreview = (
    race: PlayerRace | undefined,
    cls: PlayerClass | undefined,
    o: {
      stats?: readonly number[];
      rolledStats?: readonly number[];
      historyOverride?: string | null;
      sheetName: string;
    },
    cols: number,
  ): PreviewSheet | null => {
    if (!deps || !race || !cls) return null;
    const body = deps.bodyFor(race.name);
    if (!body) return null;
    const { player } = generatePlayer(
      race,
      cls,
      {
        body,
        historyChart: deps.historyChartFor(race.name),
        ...(o.rolledStats
          ? { rolledStats: o.rolledStats }
          : o.stats
            ? { stats: o.stats }
            : {}),
        ...(o.historyOverride != null ? { historyOverride: o.historyOverride } : {}),
      },
      new Rng(PREVIEW_SEED),
    );
    const ps = calcBonuses(player);
    const state = previewState(player, ps);
    // The same deps the character screen resolves, so the birth sheet shows the
    // same derived values (weight_remaining included - it is what makes the
    // "Overweight" row read like upstream's rather than a flat 0.0 lb).
    const sheetDeps = { ...charSheetDeps(state, o.sheetName), fullName: o.sheetName };
    return {
      statRows: statTable(state, sheetDeps).map((row) => statRowLine(row)),
      panels: characterPanels(state, sheetDeps).map((panel) => ({
        key: panel.key,
        lines: panel.lines,
      })),
      history: historyBlockLines(state, cols),
    };
  };

  // The race/class menu rows, tagged from all_letters_nohjkl (ui-menu.c:41), so
  // the letters skip h/j/k/l (which stay free as movement keys). '*' random and
  // '@' finish are KEY COMMANDS (menu_question, ui-birth.c:841/851), not rows.
  const raceRows: BirthRow[] = races.map((r, i) => ({
    tag: ALL_LETTERS_NOHJKL[i] ?? "",
    name: r.name,
  }));
  const classRows: BirthRow[] = classes.map((c, i) => ({
    tag: ALL_LETTERS_NOHJKL[i] ?? "",
    name: c.name,
  }));

  // do_cmd_choose_race (player-birth.c:1092-1102) and do_cmd_choose_class
  // (L1105-1115) both end with reset_stats() + generate_stats() +
  // `rolled_stats = false`. Every trip through those menus issues the command
  // again (menu_question pushes CMD_CHOOSE_RACE / CMD_CHOOSE_CLASS on Enter and
  // on '*', unconditionally, even for the same row), so ANY re-pick DISCARDS a
  // manual point-buy allocation and any accepted standard roll: the allocation
  // screen must re-open at the new race/class's generate_stats spread, and the
  // point-buy lock rolled_stats imposes must be released. ESC (BIRTH_BACK) does
  // NOT reset - it issues no command - so stepping back from the name stage into
  // the same allocation still restores the work in progress.
  const discardStatWork = (): void => {
    pointStats = null;
    rolledStats = null;
  };

  // finish_with_random_choices (ui-birth.c:660-777): fill every remaining
  // choice from `fromStage` onward at random and jump to the final confirm. A
  // default point-buy (generate_stats) supplies the stats, matching upstream.
  // The name comes from player_random_name (ui-birth.c:725) via opts.randomName;
  // upstream's savefile-collision retry around it (L721-733) is filesystem
  // plumbing with no browser counterpart.
  const finishRandom = (fromStage: "race" | "class"): void => {
    if (fromStage === "race") {
      raceIdx = rollRng.randint0(races.length);
      raceName = races[raceIdx]?.name ?? "Human";
    }
    classIdx = rollRng.randint0(classes.length);
    className = classes[classIdx]?.name ?? "Warrior";
    const race = races[raceIdx];
    const cls = classes[classIdx];
    if (race && cls) {
      pointStats = [...generateStats(race, cls).stats];
      rollerIdx = 0;
      rolledStats = null;
    }
    /* ui-birth.c:706-743, the name arm, which has two shapes:
     *  - arg_force_name (L711-715): use arg_name if there is one, and generate
     *    NOTHING. Upstream's comment says it mimics get_name_command, and it
     *    must: a host that pinned the name did not ask for a random one.
     *  - otherwise (L716-741): player_random_name, retried until the name is not
     *    already a savefile (the retry needs the savefile directory, so it comes
     *    with Phase 5; the single draw is what the port does today). */
    if (argForceName()) {
      const pinned = argName();
      if (pinned !== "") name = pinned;
    } else {
      const rolledName = opts.randomName?.() ?? "";
      if (rolledName !== "") name = rolledName;
    }
    advance("confirm");
  };

  for (;;) {
    // (cast: stage is reassigned inside advance/goBack closures, which TS's
    // flow analysis does not track, so it over-narrows the switch operand)
    switch (stage as Stage) {
      case "quickstart": {
        const q = quick as NonNullable<typeof quick>;
        const hasStats = !!q.stats && q.stats.length === STAT_MAX;
        // load_roller_data: restore the prior stats (applied via the fixed
        // point-based path, drawing no RNG). Without a saved array, fall back
        // to a fresh classic roll. Applied for BOTH 'Y' and 'C', because
        // upstream's quick-start has already reloaded the character by the time
        // the prompt is drawn - the keys only choose how much of it to keep.
        const takePrevious = (): void => {
          raceName = q.raceName;
          className = q.className;
          if (hasStats && q.stats) {
            pointStats = [...q.stats];
            rollerIdx = 0;
          } else {
            rollerIdx = 1;
          }
        };
        const action = await runQuickstart(term, () =>
          // display_player(0) BEFORE the prompt (ui-birth.c:1631): the reloaded
          // character's own sheet fills the screen, and the prompt sits over it.
          // Rebuilt per repaint so a birth option changed via '=' is reflected.
          buildPreview(
            races.find((r) => r.name === q.raceName),
            classes.find((c) => c.name === q.className),
            { ...(q.stats ? { stats: q.stats } : {}), sheetName: name },
            term.size().cols,
          ),
        );
        switch (action) {
          case "options":
            // textui_birth_quickstart (ui-birth.c:127-128): '=' opens
            // do_cmd_options_birth and the loop re-shows this same screen.
            await runBirthOptionsEditor(term, birthOptions);
            break;
          case "accept":
            // 'Y': cmdq_push(CMD_ACCEPT_CHARACTER); BIRTH_COMPLETE
            // (ui-birth.c:129-131). No name stage, no final confirm - the
            // previous character's name (suffix already bumped) is the answer.
            takePrevious();
            return {
              raceName,
              className,
              name: name || "Adventurer",
              roller: rollerIdx === 0 ? "point" : "roller",
              ...(rollerIdx === 0 && pointStats ? { stats: pointStats } : {}),
              ...(Object.keys(birthOptions).length > 0 ? { birthOptions } : {}),
            };
          case "name":
            // 'C': BIRTH_NAME_CHOICE (ui-birth.c:124-125). Gated on
            // arg_force_name inside runQuickstart, which is where upstream gates
            // it too - a pinned name means the key does nothing at all.
            takePrevious();
            advance("name");
            break;
          case "redo":
            // 'N': cmdq_push(CMD_BIRTH_RESET); BIRTH_RACE_CHOICE.
            advance("race");
            break;
          case "quit":
            // KTRL('X') -> quit(NULL) (ui-birth.c:121-123).
            return null;
        }
        break;
      }

      case "race": {
        // The race menu: active column at RACE_COL, race_help aux at RACE_AUX_COL.
        const res = await askMenu(RACE_HINT, [], {
          col: RACE_COL,
          auxCol: RACE_AUX_COL,
          rows: raceRows,
          initialCursor: raceIdx,
          detail: raceDetail,
          allowFinish: true,
        });
        switch (res.kind) {
          case "back":
            if (!goBack()) return null;
            break;
          case "random":
            // '*' random pick, then advance to class (menu_question:841-847).
            raceIdx = rollRng.randint0(races.length);
            raceName = races[raceIdx]?.name ?? "Human";
            discardStatWork();
            advance("class");
            break;
          case "finish":
            // '@' finish the rest of the character at random (menu_question:851).
            finishRandom("race");
            break;
          case "pick":
            raceIdx = res.index;
            raceName = races[res.index]?.name ?? "Human";
            discardStatWork();
            advance("class");
            break;
        }
        break;
      }

      case "class": {
        // The class menu: the chosen race column stays at RACE_COL, the class
        // column is active at CLASS_COL, class_help aux at CLASS_AUX_COL.
        const res = await askMenu(
          CLASS_HINT,
          [{ col: RACE_COL, rows: raceRows, selected: raceIdx }],
          {
            col: CLASS_COL,
            auxCol: CLASS_AUX_COL,
            rows: classRows,
            initialCursor: classIdx,
            detail: classDetailFor(raceIdx),
            allowFinish: true,
          },
        );
        switch (res.kind) {
          case "back":
            if (!goBack()) return null;
            break;
          case "random":
            classIdx = rollRng.randint0(classes.length);
            className = classes[classIdx]?.name ?? "Warrior";
            discardStatWork();
            advance("roller");
            break;
          case "finish":
            finishRandom("class");
            break;
          case "pick":
            classIdx = res.index;
            className = classes[res.index]?.name ?? "Warrior";
            discardStatWork();
            advance("roller");
            break;
        }
        break;
      }

      case "roller": {
        // The roller menu: race and class columns stay visible, the roller
        // choice is active at ROLLER_COL. No '@' finish at this stage.
        const rollerRows: BirthRow[] = [
          { tag: ALL_LETTERS_NOHJKL[0] ?? "a", name: "Point-based" },
          { tag: ALL_LETTERS_NOHJKL[1] ?? "b", name: "Standard roller" },
        ];
        const res = await askMenu(
          ROLLER_HINT,
          [
            { col: RACE_COL, rows: raceRows, selected: raceIdx },
            { col: CLASS_COL, rows: classRows, selected: classIdx },
          ],
          {
            col: ROLLER_COL,
            rows: rollerRows,
            initialCursor: rollerIdx,
            allowFinish: false,
          },
        );
        switch (res.kind) {
          case "back":
            if (!goBack()) return null;
            break;
          case "finish":
            // '@' is disabled at the roller stage; ignore if it ever arrives.
            break;
          case "random":
            rollerIdx = rollRng.randint0(2);
            advance(rollerIdx === 0 ? "points" : "roll");
            break;
          case "pick":
            rollerIdx = res.index;
            // BR_POINTBASED (row 0) opens the allocation screen; the standard
            // roller (row 1) opens the interactive roll screen (menu_question
            // ui-birth.c:813-817: cursor -> CMD_ROLL_STATS then BIRTH_ROLLER).
            advance(res.index === 0 ? "points" : "roll");
            break;
        }
        break;
      }

      case "points": {
        const raceRec = races[raceIdx];
        const clsRec = classes[classIdx];
        const race = raceRec ?? { name: raceName };
        const cls = clsRec ?? { name: className };
        // The live derived sheet for the current allocation (repaints per edit).
        const sheet = (stats: readonly number[]): PreviewSheet | null =>
          buildPreview(
            races[raceIdx],
            classes[classIdx],
            { stats, sheetName: name },
            term.size().cols,
          );
        // do_cmd_choose_race/choose_class (player-birth.c:1100-1112) seed the
        // point-buy with generate_stats' recommended per-class spread, so the
        // screen opens with points already spent (Total Cost NN/NN), not at the
        // bare base. Re-entry (ESC then forward) restores the prior allocation.
        // Guarded: generate_stats reads the full race/class records, so a
        // minimal stub (tests) falls back to the base pool.
        let seed = pointStats ?? undefined;
        if (!seed && raceRec && clsRec) {
          try {
            seed = [...generateStats(raceRec, clsRec).stats];
          } catch {
            seed = undefined; // incomplete records: start at the base pool
          }
        }
        const result = await pointBuyStats(term, race, cls, seed, sheet);
        if (result === null) {
          if (!goBack()) return null;
          break;
        }
        pointStats = result;
        advance("name");
        break;
      }

      case "roll": {
        // The standard-roller screen (roller_command, ui-birth.c:872-999):
        // accept -> BIRTH_NAME_CHOICE (L986), ESC -> BIRTH_BACK (L970).
        const race = races[raceIdx] ?? { name: raceName };
        const cls = classes[classIdx] ?? { name: className };
        // The live derived sheet for the current roll (repaints per reroll).
        const sheet = (roll: readonly number[]): PreviewSheet | null =>
          buildPreview(
            races[raceIdx],
            classes[classIdx],
            { rolledStats: roll, sheetName: name },
            term.size().cols,
          );
        const result = await standardRoller(term, race, cls, rollRng, sheet);
        if (result === null) {
          if (!goBack()) return null;
          break;
        }
        rolledStats = result;
        advance("name");
        break;
      }

      case "name": {
        // get_name_command (ui-birth.c:1270-1300). Two things happen before the
        // prompt, and both come from the front end rather than the player:
        //   L1277-1279: a savefile name the host chose IS the character's name.
        //   L1287-1288: with the name forced, the stage is skipped outright -
        //               no prompt, straight on to the history.
        if (argName() !== "") name = argName();
        if (argForceName()) {
          advance(opts.historyFor ? "history" : "confirm");
          break;
        }
        // display_player(0), then get_character_name's prompt AT ROW 0 over that
        // sheet - the sheet stays on screen while you type (ui-input.c:1153).
        drawBirthSheet(
          term,
          buildPreview(
            races[raceIdx],
            classes[classIdx],
            {
              ...(rollerIdx === 0
                ? pointStats
                  ? { stats: pointStats }
                  : {}
                : rolledStats
                  ? { rolledStats }
                  : {}),
              sheetName: name,
            },
            term.size().cols,
          ),
        );
        const entered = await promptTextInline(
          term,
          "Enter a name for your character (* for a random name): ",
          name,
          // PLAYER_NAME_LEN (option.h:23 = 32) allows 31 usable characters.
          31,
          /* get_name_keypress' '*' -> player_random_name (ui-input.c L1038). */
          opts.randomName,
        );
        if (entered === null) {
          if (!goBack()) return null;
          break;
        }
        name = entered.trim();
        // BIRTH_HISTORY_CHOICE follows naming (ui-birth.c:1723) when the shell
        // supplies get_history; otherwise history is generated engine-side and
        // we go straight to the final confirm.
        advance(opts.historyFor ? "history" : "confirm");
        break;
      }

      case "history": {
        const historyFor = opts.historyFor;
        if (!historyFor) {
          advance("confirm");
          break;
        }
        // BIRTH_HISTORY_CHOICE (ui-birth.c:1718-1728): display_player(0) - so
        // the generated background is read IN the sheet's history block - then
        // get_history_command's row-0 prompt. 'n' opens the editor, ESC steps
        // back, anything else accepts.
        const text = historyText ?? historyFor(raceName);
        const result = await historyStage(
          term,
          text,
          (history: string) => {
            const preview = buildPreview(
                races[raceIdx],
                classes[classIdx],
                {
                  ...(rollerIdx === 0
                    ? pointStats
                      ? { stats: pointStats }
                      : {}
                    : rolledStats
                      ? { rolledStats }
                      : {}),
                  historyOverride: history,
                  sheetName: name || "Adventurer",
              },
              term.size().cols,
            );
            drawBirthSheet(term, preview);
            return preview !== null;
          },
        );
        if (result === null) {
          if (!goBack()) return null;
          break;
        }
        historyText = result;
        advance("confirm");
        break;
      }

      case "confirm": {
        const finalName = name || "Adventurer";
        const point = rollerIdx === 0;
        // BIRTH_FINAL_CONFIRM (ui-birth.c:1730-1741): display_player(0) for the
        // completed character - the accepted stats and any edited background -
        // then get_confirm_command's centred prompt.
        const sheet = buildPreview(
          races[raceIdx],
          classes[classIdx],
          {
            ...(point
              ? pointStats
                ? { stats: pointStats }
                : {}
              : rolledStats
                ? { rolledStats }
                : {}),
            historyOverride: historyText,
            sheetName: finalName,
          },
          term.size().cols,
        );
        const result = await confirmCharacter(
          term,
          sheet,
          `${finalName} the ${raceName} ${className}`,
        );
        if (result === "restart") {
          /* BIRTH_RESET (ui-birth.c L1560-1561): discard every choice and start
           * character creation over from the race screen (or quickstart when a
           * previous character seeded one). Clear the accumulated picks so the
           * new run is genuinely fresh, not the old stats re-shown. */
          backStack.length = 0;
          name = "";
          historyText = null;
          pointStats = null;
          rolledStats = null;
          stage = quick ? "quickstart" : "race";
          break;
        }
        if (result === "begin") {
          return {
            raceName,
            className,
            name: finalName,
            roller: point ? "point" : "roller",
            ...(point && pointStats ? { stats: pointStats } : {}),
            // The accepted standard-roller stats ride as `rolledStats` (applied
            // via generatePlayer's rolledStats path, NOT point-buy).
            ...(!point && rolledStats ? { rolledStats } : {}),
            // The edited background (do_cmd_choose_history), when the history
            // stage ran; applied via generatePlayer's historyOverride.
            ...(historyText !== null ? { history: historyText } : {}),
            // birth_* options set via '=' (do_cmd_options_birth), applied as
            // startGame optionOverrides. Omitted when none were changed.
            ...(Object.keys(birthOptions).length > 0 ? { birthOptions } : {}),
          };
        }
        if (!goBack()) return null;
        break;
      }
    }
  }
}
