/**
 * Character birth (player-birth.c / ui-birth.c): the staged creation flow.
 * Faithful stage order (birth_stage enum, ui-birth.c L60-74): QUICKSTART (only
 * when a prior character exists) -> RACE_CHOICE -> CLASS_CHOICE ->
 * ROLLER_CHOICE -> NAME_CHOICE -> FINAL_CONFIRM. There is NO sex/gender stage
 * in Angband 4.2.6; the port's earlier Female/Male prompt was a divergence and
 * is removed. HISTORY_CHOICE (edit the background paragraph) depends on the
 * unported get_history generator and is skipped for now.
 *
 * ESC steps BACK one stage (BIRTH_BACK), re-entering the previous menu with
 * its prior cursor; only stage-0 ESC abandons the flow (the caller keeps the
 * default character). Each menu shows the upstream stage hint (setup_menus,
 * ui-birth.c L565/578/586) as its subtitle and, for race/class, a per-row
 * stat-adjustment line (a compact race_help/class_help).
 *
 * The classic stat roll runs inside the engine's generatePlayer (startGame);
 * this collects the identity choices and the roller method - the shell draws
 * NO RNG. When "Point-based" is chosen, an interactive allocation screen
 * (pointBuyStats, faithful to ui-birth.c's point_based_command: up/down to
 * move, left/right or -/+ to buy/sell, 'r' to reset) spends the birth points
 * via the buy_stat/sell_stat primitives; the resulting stat array is returned
 * on the BirthChoice and threaded to startGame (birthStats), which applies it
 * and skips the classic roller. The standard roller still rolls engine-side.
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
  birthGold,
  buyStat,
  cnvStat,
  modifyStatValue,
  resetStats,
  sellStat,
} from "@neo-angband/core";

export interface BirthChoice {
  raceName: string;
  className: string;
  name: string;
  /** BR_POINTBASED ("point") / BR_NORMAL ("roller"), ui-birth.c L86-91.
   * Threaded to startGame: "point" births with `stats`; "roller" rolls. */
  roller: "point" | "roller";
  /** The point-based allocated base stats (STAT_MAX values), present only when
   * roller === "point". Passed to startGame as birthStats so the engine skips
   * the classic roller and draws no stat RNG. */
  stats?: number[];
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

type Stage =
  | "quickstart"
  | "race"
  | "class"
  | "roller"
  | "points"
  | "name"
  | "confirm";

export async function runBirth(
  term: GlyphTerm,
  races: readonly Named[],
  classes: readonly Named[],
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

  const raceDetail = adjDetail(races);
  const classDetail = adjDetail(classes);

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
        const pick = await selectFromMenu(
          term,
          "Create a character  -  choose a race",
          races.map((x) => ({ label: x.name })),
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
        raceIdx = pick;
        raceName = races[pick]?.name ?? "Human";
        advance("class");
        break;
      }

      case "class": {
        const pick = await selectFromMenu(
          term,
          `Race: ${raceName}  -  choose a class`,
          classes.map((x) => ({ label: x.name })),
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
        // roller (row 1) rolls engine-side and jumps straight to naming.
        advance(pick === 0 ? "points" : "name");
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

      case "name": {
        const entered = await promptText(
          term,
          "Enter your character's name",
          name,
          15,
          "[ type a name, Enter to accept, ESC to go back ]",
        );
        if (entered === null) {
          if (!goBack()) return null;
          break;
        }
        name = entered.trim();
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
          };
        }
        if (!goBack()) return null;
        break;
      }
    }
  }
}
