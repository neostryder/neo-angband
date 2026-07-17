/**
 * Character birth (player-birth.c / ui-birth.c): the staged creation flow.
 * Faithful stage order (birth_stage enum, ui-birth.c L60-74): QUICKSTART (only
 * when a prior character exists) -> RACE_CHOICE -> CLASS_CHOICE ->
 * ROLLER_CHOICE -> {POINTBASED | ROLLER} -> NAME_CHOICE -> HISTORY_CHOICE ->
 * FINAL_CONFIRM. There is NO sex/gender stage in Angband 4.2.6; the port's
 * earlier Female/Male prompt was a divergence and is removed.
 *
 * ESC steps BACK one stage (BIRTH_BACK), re-entering the previous menu with
 * its prior cursor; only stage-0 ESC abandons the flow (the caller keeps the
 * default character). Each menu shows the upstream stage hint (setup_menus,
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
 * previous-roll ('p') and accept (Enter). Rolling is the only place the shell
 * draws RNG (from a throwaway per-birth Rng); the accepted natural stats ride
 * the BirthChoice as `rolledStats` and are applied by generatePlayer's
 * `rolledStats` option (see WIRING-NEEDED - bootGame must NOT feed them through
 * the point-buy path).
 *
 * History (BIRTH_HISTORY_CHOICE): when the shell supplies get_history via
 * BirthOpts.historyFor, the name stage is followed by an accept/edit-background
 * prompt (get_history_command, ui-birth.c:1498-1540); the result rides the
 * BirthChoice as `history` (applied via generatePlayer's `historyOverride`).
 *
 * Returns the choice, or null if the player backed all the way out (in which
 * case the caller keeps the default Human Warrior).
 */

import { selectFromMenu, promptText } from "./overlay";
import type { MenuItem, ScreenLine } from "./overlay";
import type { GlyphTerm } from "./term";
import {
  BIRTH_STAT_BASE,
  MAX_BIRTH_POINTS,
  STAT_MAX,
  Rng,
  birthGold,
  buyStat,
  cnvStat,
  generateStats,
  modifyStatValue,
  resetStats,
  rollStats,
  sellStat,
} from "@neo-angband/core";
import type { PlayerClass, PlayerRace } from "@neo-angband/core";

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
}

interface Named {
  name: string;
  /** r_adj/c_adj when available, for the per-row stat summary. */
  statAdj?: readonly number[];
}

export interface BirthOpts {
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
   * get_history for a chosen race (player-birth.c get_history), supplied by the
   * shell because the history graph lives in the core registry the birth screen
   * does not otherwise hold. When present it enables the history-edit stage
   * (BIRTH_HISTORY_CHOICE): the returned text is shown for accept/edit and the
   * result rides the BirthChoice as `history`. Absent (the current wiring) the
   * stage is skipped and history is generated engine-side as before.
   */
  historyFor?: (raceName: string) => string;
}

/* setup_menus' stage hints (ui-birth.c L565/578/586), verbatim. */
const RACE_HINT =
  "Race affects stats and skills, and may confer resistances and abilities.";
const CLASS_HINT = "Class affects stats, skills, and other character traits.";
const ROLLER_HINT =
  "Choose how to generate your intrinsic stats. Point-based is recommended.";

const FOOTER = "[ a-z to choose, tap a row, ESC to go back ]";
const FOOTER_FIRST = "[ a-z to choose, tap a row, ESC to keep the default ]";

const STAT_ABBR = ["STR", "INT", "WIS", "DEX", "CON"] as const;

/** A compact race_help/class_help: the row's stat adjustments on one line. */
function adjDetail(list: readonly Named[]): ((i: number) => ScreenLine[]) | undefined {
  if (!list.some((x) => x.statAdj && x.statAdj.length > 0)) return undefined;
  return (i: number): ScreenLine[] => {
    const adj = list[i]?.statAdj;
    if (!adj || adj.length === 0) return [];
    const parts = STAT_ABBR.map((n, s) => {
      const v = adj[s] ?? 0;
      return `${n} ${v >= 0 ? "+" : ""}${v}`;
    });
    return [{ text: parts.join("   "), color: "#8a8a94" }];
  };
}

/* Overlay palette (shared with overlay.ts's screen primitives). */
const PB_TITLE = "#e8e8f0";
const PB_FG = "#c8c8d4";
const PB_DIM = "#8a8a94";
const PB_HI = "#e0c040";

/** "%+d"-style signed adjustment (empty adj slot reads as +0). */
function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
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
  term: GlyphTerm,
  race: Named,
  cls: Named,
  initial?: readonly number[],
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
      term.print(0, 0, `${race.name} ${cls.name}  -  allocate your stats`.slice(0, cols - 1), PB_TITLE);
      term.print(0, 1, "Point-based: spend the pool to raise your intrinsic stats.".slice(0, cols - 1), PB_DIM);
      // Column header, aligned with the rows below.
      term.print(0, 3, "     Self   RB   CB     Best   Cost".slice(0, cols - 1), PB_DIM);
      for (let i = 0; i < STAT_MAX; i++) {
        const self = buy.stats[i] ?? BIRTH_STAT_BASE;
        const rb = raceAdj[i] ?? 0;
        const cb = clsAdj[i] ?? 0;
        const best = modifyStatValue(self, rb + cb);
        const mark = i === cursor ? ">" : " ";
        const abbr = STAT_ABBR[i] ?? "???";
        const row =
          `${mark} ${abbr} ${cnvStat(self)} ` +
          `${signed(rb).padStart(4)} ${signed(cb).padStart(4)} ` +
          `${cnvStat(best)} ${String(buy.pointsSpent[i] ?? 0).padStart(4)}`;
        term.print(0, 4 + i, row.slice(0, cols - 1), i === cursor ? PB_HI : PB_FG);
      }
      const y = 4 + STAT_MAX + 1;
      term.print(0, y, `Points left: ${buy.pointsLeft} / ${MAX_BIRTH_POINTS}`.slice(0, cols - 1), PB_FG);
      term.print(0, y + 1, `Starting gold: ${birthGold(buy.pointsLeft)}`.slice(0, cols - 1), PB_FG);
      term.print(
        0,
        rows - 1,
        "[ up/down move, left/right or -/+ adjust, r reset, Enter accept, ESC back ]".slice(0, cols - 1),
        PB_DIM,
      );
    };
    const finish = (value: number[] | null): void => {
      window.removeEventListener("keydown", onKey, true);
      term.onCellTap?.(null);
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      switch (ev.key) {
        case "Escape":
          finish(null);
          return;
        case "Enter":
          finish([...buy.stats]);
          return;
        case "ArrowUp":
          cursor = (cursor + STAT_MAX - 1) % STAT_MAX;
          break;
        case "ArrowDown":
          cursor = (cursor + 1) % STAT_MAX;
          break;
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
    window.addEventListener("keydown", onKey, true);
    // Touch: tap a stat row to move the cursor there; tap the footer to accept.
    term.onCellTap?.((cell) => {
      const { rows } = term.size();
      if (cell.row === rows - 1) {
        finish([...buy.stats]);
        return;
      }
      const i = cell.row - 4;
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
  term: GlyphTerm,
  race: Named,
  cls: Named,
  rng: Rng,
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
      term.print(0, 0, `${race.name} ${cls.name}  -  standard roller`.slice(0, cols - 1), PB_TITLE);
      term.print(0, 1, "Roll for your intrinsic stats, or reroll for a new set.".slice(0, cols - 1), PB_DIM);
      term.print(0, 3, "     Self   RB   CB     Best".slice(0, cols - 1), PB_DIM);
      for (let i = 0; i < STAT_MAX; i++) {
        const self = current[i] ?? 0;
        const rb = raceAdj[i] ?? 0;
        const cb = clsAdj[i] ?? 0;
        const best = modifyStatValue(self, rb + cb);
        const abbr = STAT_ABBR[i] ?? "???";
        const row =
          `  ${abbr} ${cnvStat(self)} ` +
          `${signed(rb).padStart(4)} ${signed(cb).padStart(4)} ${cnvStat(best)}`;
        term.print(0, 4 + i, row.slice(0, cols - 1), PB_FG);
      }
      // The prompt mirrors roller_command's assembled string (L900-903): the
      // previous-roll clause only appears once a reroll has happened.
      const prompt = prevRoll
        ? "[ 'r'/space reroll, 'p' previous roll, Enter accept, ESC back ]"
        : "[ 'r'/space reroll, Enter accept, ESC back ]";
      term.print(0, rows - 1, prompt.slice(0, cols - 1), PB_DIM);
    };
    const finish = (value: number[] | null): void => {
      window.removeEventListener("keydown", onKey, true);
      term.onCellTap?.(null);
      resolve(value);
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
    window.addEventListener("keydown", onKey, true);
    // Touch: a tap on the footer accepts the current roll.
    term.onCellTap?.((cell) => {
      const { rows } = term.size();
      if (cell.row === rows - 1) finish([...current]);
    });
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
  term: GlyphTerm,
  name: string,
  historyText: string,
): Promise<string | null> {
  let current = historyText;
  for (;;) {
    const wrapped = wrapHistory(current);
    const pick = await selectFromMenu(
      term,
      `${name}  -  background`,
      [
        { label: "Accept this background", hint: "Keep the generated history." },
        { label: "Edit background", hint: "Write your own background." },
      ],
      "[ a-z to choose, tap a row, ESC to go back ]",
      { subtitle: "Accept character history?", detail: () => wrapped },
    );
    if (pick === null) return null;
    if (pick === 0) return current;
    const edited = await promptText(
      term,
      "Edit your character's background",
      current,
      240,
      "[ edit text, Enter to accept, ESC to cancel ]",
    );
    if (edited !== null) current = edited;
    // A cancelled edit falls back to the accept/edit choice (no change).
  }
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
  term: GlyphTerm,
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

  // Cursor memory per stage, so stepping back re-enters at the prior row.
  let raceIdx = 0;
  let classIdx = 0;
  let rollerIdx = 0;
  let raceName = "";
  let className = "";
  let name = "";
  // The point-based allocation, once chosen; reused if the player steps back
  // into the screen so their work is not lost (ui-birth.c keeps it too).
  let pointStats: number[] | null = null;
  // The accepted standard-roller stats (BR_NORMAL), once accepted.
  let rolledStats: number[] | null = null;
  // The edited background (BIRTH_HISTORY_CHOICE), once the history stage runs.
  let historyText: string | null = null;

  // The birth shell's one RNG source: the standard roller and the '*'/'@'
  // random choices. Seeded nondeterministically since these are interactive,
  // player-driven picks; the game seed (dungeon, drops) is unaffected because
  // the accepted stats ride the choice explicitly.
  const rollRng = new Rng(((Date.now() >>> 0) ^ 0x9e3779b9) >>> 0);

  const raceDetail = adjDetail(races);
  const classDetail = adjDetail(classes);

  // menu_question '*' (random pick) and '@' (finish with random choices),
  // ui-birth.c:841/851: appended to the race/class menus as tagged rows.
  const RANDOM_ROW: MenuItem = {
    label: "Random",
    tag: "*",
    hint: "Pick this at random ( * ).",
  };
  const FINISH_ROW: MenuItem = {
    label: "Finish randomly",
    tag: "@",
    hint: "Complete the rest of the character with random choices ( @ ).",
  };

  // finish_with_random_choices (ui-birth.c:660-777): fill every remaining
  // choice from `fromStage` onward at random and jump to the final confirm. A
  // default point-buy (generate_stats) supplies the stats, matching upstream.
  // The name is left for the confirm default (the shell has no random-name
  // generator; see WIRING-NEEDED).
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
    advance("confirm");
  };

  for (;;) {
    // (cast: stage is reassigned inside advance/goBack closures, which TS's
    // flow analysis does not track, so it over-narrows the switch operand)
    switch (stage as Stage) {
      case "quickstart": {
        const q = quick as NonNullable<typeof quick>;
        const hasStats = !!q.stats && q.stats.length === STAT_MAX;
        const items: MenuItem[] = [
          {
            label: "Quick-start with the previous character",
            hint: `${q.raceName} ${q.className} - ${hasStats ? "same stats, " : ""}skip straight to naming`,
          },
          { label: "Choose everything from scratch" },
        ];
        const pick = await selectFromMenu(
          term,
          "Create a character",
          items,
          FOOTER_FIRST,
          { subtitle: "Quick-start uses your previous choices." },
        );
        if (pick === null) return null; // stage 0: keep the default character
        if (pick === 0) {
          raceName = q.raceName;
          className = q.className;
          // load_roller_data: restore the prior stats (applied via the fixed
          // point-based path, drawing no RNG). Without a saved array, fall back
          // to a fresh classic roll.
          if (hasStats && q.stats) {
            pointStats = [...q.stats];
            rollerIdx = 0;
          } else {
            rollerIdx = 1;
          }
          advance("name");
        } else {
          advance("race");
        }
        break;
      }

      case "race": {
        // menu_question (ui-birth.c:437-441): the race menu carries '*'
        // (select at random) and '@' (finish with random choices) as the two
        // trailing rows, appended after the real races.
        const raceItems: MenuItem[] = [
          ...races.map((x) => ({ label: x.name })),
          RANDOM_ROW,
          FINISH_ROW,
        ];
        const pick = await selectFromMenu(
          term,
          "Create a character  -  choose a race",
          raceItems,
          backStack.length === 0 ? FOOTER_FIRST : FOOTER,
          {
            subtitle: RACE_HINT,
            initialCursor: raceIdx,
            ...(raceDetail ? { detail: raceDetail } : {}),
          },
        );
        if (pick === null) {
          if (!goBack()) return null;
          break;
        }
        if (pick === races.length) {
          // '*' random pick, then advance to class (menu_question:841-847).
          raceIdx = rollRng.randint0(races.length);
          raceName = races[raceIdx]?.name ?? "Human";
          advance("class");
          break;
        }
        if (pick === races.length + 1) {
          // '@' finish the rest of the character at random (menu_question:851).
          finishRandom("race");
          break;
        }
        raceIdx = pick;
        raceName = races[pick]?.name ?? "Human";
        advance("class");
        break;
      }

      case "class": {
        const classItems: MenuItem[] = [
          ...classes.map((x) => ({ label: x.name })),
          RANDOM_ROW,
          FINISH_ROW,
        ];
        const pick = await selectFromMenu(
          term,
          `Race: ${raceName}  -  choose a class`,
          classItems,
          FOOTER,
          {
            subtitle: CLASS_HINT,
            initialCursor: classIdx,
            ...(classDetail ? { detail: classDetail } : {}),
          },
        );
        if (pick === null) {
          if (!goBack()) return null;
          break;
        }
        if (pick === classes.length) {
          // '*' random class, then advance to the roller (menu_question:841-847).
          classIdx = rollRng.randint0(classes.length);
          className = classes[classIdx]?.name ?? "Warrior";
          advance("roller");
          break;
        }
        if (pick === classes.length + 1) {
          finishRandom("class");
          break;
        }
        classIdx = pick;
        className = classes[pick]?.name ?? "Warrior";
        advance("roller");
        break;
      }

      case "roller": {
        const pick = await selectFromMenu(
          term,
          `${raceName} ${className}  -  choose a stat roller`,
          [{ label: "Point-based" }, { label: "Standard roller" }],
          FOOTER,
          { subtitle: ROLLER_HINT, initialCursor: rollerIdx },
        );
        if (pick === null) {
          if (!goBack()) return null;
          break;
        }
        rollerIdx = pick;
        // BR_POINTBASED (row 0) opens the allocation screen; the standard
        // roller (row 1) opens the interactive roll screen (menu_question
        // ui-birth.c:813-817: cursor -> CMD_ROLL_STATS then BIRTH_ROLLER).
        advance(pick === 0 ? "points" : "roll");
        break;
      }

      case "points": {
        const race = races[raceIdx] ?? { name: raceName };
        const cls = classes[classIdx] ?? { name: className };
        const result = await pointBuyStats(
          term,
          race,
          cls,
          pointStats ?? undefined,
        );
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
        const result = await standardRoller(term, race, cls, rollRng);
        if (result === null) {
          if (!goBack()) return null;
          break;
        }
        rolledStats = result;
        advance("name");
        break;
      }

      case "name": {
        const entered = await promptText(
          term,
          "Enter your character's name",
          name,
          // PLAYER_NAME_LEN (option.h:23 = 32) allows 31 usable characters.
          31,
          "[ type a name, Enter to accept, ESC to go back ]",
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
        // get_history_command (ui-birth.c:1498-1540): show the generated
        // background for accept/edit; ESC (-1 from edit_text) steps back.
        const text = historyText ?? historyFor(raceName);
        const result = await historyStage(term, name || "Adventurer", text);
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
        const pick = await selectFromMenu(
          term,
          `${finalName} the ${raceName} ${className}`,
          [
            { label: "Begin the adventure", hint: "Accept this character and play." },
            { label: "Go back", hint: "Step back and change something." },
          ],
          "[ a-z to choose, tap a row, ESC to go back ]",
          { subtitle: "Please confirm your character." },
        );
        if (pick === 0) {
          const point = rollerIdx === 0;
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
          };
        }
        if (!goBack()) return null;
        break;
      }
    }
  }
}
