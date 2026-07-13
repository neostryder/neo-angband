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
 * this collects the identity choices and records the roller method - the
 * shell draws NO RNG. Point-buy allocation UI is a later refinement (the
 * primitives exist in player/birth); both roller choices currently roll
 * engine-side.
 *
 * Returns the choice, or null if the player backed all the way out (in which
 * case the caller keeps the default Human Warrior).
 */

import { selectFromMenu, promptText } from "./overlay";
import type { MenuItem, ScreenLine } from "./overlay";
import type { GlyphTerm } from "./term";

export interface BirthChoice {
  raceName: string;
  className: string;
  name: string;
  /** BR_POINTBASED ("point") / BR_NORMAL ("roller"), ui-birth.c L86-91.
   * Recorded and persisted; the engine's roll currently ignores it. */
  roller: "point" | "roller";
}

interface Named {
  name: string;
  /** r_adj/c_adj when available, for the per-row stat summary. */
  statAdj?: readonly number[];
}

export interface BirthOpts {
  /** BIRTH_QUICKSTART: the previous character's choices, offered as stage 0
   * only when a prior character exists (quickstart_allowed). */
  quickstart?: { raceName: string; className: string } | null;
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

type Stage = "quickstart" | "race" | "class" | "roller" | "name" | "confirm";

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

  const raceDetail = adjDetail(races);
  const classDetail = adjDetail(classes);

  for (;;) {
    // (cast: stage is reassigned inside advance/goBack closures, which TS's
    // flow analysis does not track, so it over-narrows the switch operand)
    switch (stage as Stage) {
      case "quickstart": {
        const q = quick as NonNullable<typeof quick>;
        const items: MenuItem[] = [
          {
            label: "Quick-start with the previous character",
            hint: `${q.raceName} ${q.className} - skip straight to naming`,
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
          return {
            raceName,
            className,
            name: finalName,
            roller: rollerIdx === 0 ? "point" : "roller",
          };
        }
        if (!goBack()) return null;
        break;
      }
    }
  }
}
