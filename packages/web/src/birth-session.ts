/**
 * A mod's character creation: the birth flow as a draft a mod edits and then
 * accepts, for a mod that draws its own creation wizard (the `birth` owner seam,
 * `ui:birth.replace`).
 *
 * The rules are the game's own. Point-buy runs through core's reset_stats,
 * buy_stat and sell_stat, the suggested spread is generate_stats, a roll is
 * get_stats, the background is get_history and a random name is
 * player_random_name. Rolls, backgrounds and random names draw from the same
 * game stream the terminal birth screens draw from, and accepting the draft
 * hands the host the same `BirthChoice` those screens return. As in upstream,
 * choosing a race or a class again replaces the stats with that pair's
 * suggested spread.
 *
 * The preview is the terminal birth screen's own sheet: the stat rows and the
 * five character panels, built on a throwaway character. Its hit points,
 * background and physical details come from a fixed seed so the preview does
 * not change while the player edits; the real character rolls them when the
 * game starts.
 */

import {
  birthGold,
  calcBonuses,
  characterPanels,
  classMagicRealms,
  generateHistory,
  generatePlayer,
  generateStats,
  incrementNameSuffix,
  MAX_BIRTH_POINTS,
  OPTION_ENTRIES,
  playerAbilities,
  resetStats,
  rollStats,
  buyStat,
  sellStat,
  Rng,
  SKILL,
  STAT_MAX,
  statTable,
  type PlayerClass,
  type PlayerRace,
  type StatBuyState,
} from "@rpgm-tools/neo-angband-core";
import { PREVIEW_SEED, previewState, type BirthChoice, type BirthDeps } from "./birth";
import { charSheetDeps } from "./screens";
import type { BirthAbilityView, BirthPreview, BirthResult, ModBirthSession } from "@rpgm-tools/neo-angband-core";
export type { BirthAbilityView, BirthRaceView, BirthClassView, BirthOptionView, BirthCatalogue, BirthPreview, BirthDraftView, BirthResult, ModBirthSession } from "@rpgm-tools/neo-angband-core";

/** PLAYER_NAME_LEN (option.h:23 = 32) leaves 31 usable characters. */
export const BIRTH_NAME_MAX = 31;

const SKILL_KEYS = Object.keys(SKILL) as (keyof typeof SKILL)[];

export interface BirthSessionDeps {
  readonly races: readonly PlayerRace[];
  readonly classes: readonly PlayerClass[];
  readonly deps: BirthDeps;
  /** The game stream the terminal birth screens draw from. */
  readonly rng: Rng;
  readonly quickstart: { readonly raceName: string; readonly className: string; readonly stats?: readonly number[] } | null;
  readonly previousName?: string;
  /** The birth options the game would open with (customised defaults, then the last character's). */
  readonly birthOptions: Readonly<Record<string, boolean>>;
  readonly randomName: () => string;
  /** A name pinned by the host, or null. */
  readonly pinnedName: string | null;
  readonly msg?: (text: string) => void;
}

const ok: BirthResult = Object.freeze({ ok: true });
const refuse = (reason: string): BirthResult => Object.freeze({ ok: false, reason });

function skillRecord(skills: readonly number[]): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  SKILL_KEYS.forEach((key) => {
    out[key] = skills[SKILL[key]] ?? 0;
  });
  return Object.freeze(out);
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

/**
 * Build a session and the promise the host waits on: a `BirthChoice` when the
 * mod accepts, null when it cancels.
 */
export function createBirthSession(d: BirthSessionDeps): {
  session: ModBirthSession;
  outcome: Promise<BirthChoice | null>;
} {
  let settle!: (choice: BirthChoice | null) => void;
  const outcome = new Promise<BirthChoice | null>((resolve) => {
    settle = resolve;
  });
  let settled = false;
  const finish = (choice: BirthChoice | null): void => {
    if (settled) return;
    settled = true;
    settle(choice);
  };

  const birthOptionNames = OPTION_ENTRIES.filter((e) => e.type === "BIRTH");
  const options: Record<string, boolean> = {};
  for (const e of birthOptionNames) options[e.name] = d.birthOptions[e.name] ?? e.normal;

  let race: PlayerRace | null = null;
  let cls: PlayerClass | null = null;
  let method: "point" | "roller" = "point";
  let buy: StatBuyState = resetStats();
  let rolled: number[] | null = null;
  let previousRolled: number[] | null = null;
  let name = d.pinnedName ?? (d.previousName ? incrementNameSuffix(d.previousName, 32, d.msg) : "");
  let history = "";
  let historyEdited = false;

  /* The race and class help's ability lists, from a throwaway character (the
   * race group does not depend on the class and the class group does not
   * depend on the race), as the terminal birth screens build them. */
  const abilityCache = new Map<string, readonly BirthAbilityView[]>();
  const abilities = (group: "race" | "class", r: PlayerRace | undefined, c: PlayerClass | undefined): readonly BirthAbilityView[] => {
    if (!r || !c) return [];
    const key = `${group}:${group === "race" ? r.name : c.name}`;
    const hit = abilityCache.get(key);
    if (hit) return hit;
    const body = d.deps.bodyFor(r.name);
    let rows: readonly BirthAbilityView[] = [];
    if (body) {
      const { player } = generatePlayer(r, c, { body, historyChart: d.deps.historyChartFor(r.name) }, new Rng(PREVIEW_SEED));
      rows = playerAbilities(previewState(player, calcBonuses(player)), {
        properties: d.deps.properties,
        elementNames: d.deps.elementNames,
      })
        .filter((row) => row.group === group)
        .map((row) => Object.freeze({ name: row.name, description: row.desc }));
    }
    abilityCache.set(key, Object.freeze(rows));
    return rows;
  };

  const newHistory = (): void => {
    history = race ? generateHistory(d.deps.historyChartFor(race.name), d.rng) : "";
    historyEdited = false;
  };

  /* do_cmd_choose_race / do_cmd_choose_class end with reset_stats and
   * generate_stats, so a new pick replaces the stat work with that pair's
   * spread and drops any roll. */
  const resetStatWork = (): void => {
    method = "point";
    rolled = null;
    previousRolled = null;
    buy = race && cls ? generateStats(race, cls) : resetStats();
  };

  const stats = (): number[] => (method === "roller" && rolled ? [...rolled] : [...buy.stats]);

  const preview = (): BirthPreview | null => {
    if (!race || !cls) return null;
    const body = d.deps.bodyFor(race.name);
    if (!body) return null;
    const { player } = generatePlayer(
      race,
      cls,
      {
        body,
        historyChart: d.deps.historyChartFor(race.name),
        ...(method === "roller" && rolled ? { rolledStats: rolled } : { stats: buy.stats }),
        ...(history ? { historyOverride: history } : {}),
      },
      new Rng(PREVIEW_SEED),
    );
    const state = previewState(player, calcBonuses(player));
    const sheetDeps = { ...charSheetDeps(state, name), fullName: name };
    return {
      stats: statTable(state, sheetDeps).map((row) => ({
        key: row.key,
        label: row.label,
        natural: row.natural,
        raceBonus: row.raceBonus,
        classBonus: row.classBonus,
        best: row.best,
      })),
      panels: characterPanels(state, sheetDeps).map((panel) => ({
        key: panel.key,
        lines: panel.lines.map((line) => ({ label: line.label, value: line.value, color: line.color })),
      })),
      gold: birthGold(method === "point" ? buy.pointsLeft : 0),
    };
  };

  const needPair = (): BirthResult | null => (race && cls ? null : refuse("Choose a race and a class first."));
  const live = (): BirthResult | null => (settled ? refuse("Character creation has already finished.") : null);

  const session: ModBirthSession = {
    catalogue: () => {
      const firstClass = d.classes[0];
      const firstRace = d.races[0];
      return freezeDeep({
        races: d.races.map((r) => ({
          name: r.name,
          statAdj: [...r.statAdj],
          hitDie: r.hitdie ?? 0,
          expFactor: r.expFactor ?? 0,
          infravisionFeet: (r.infravision ?? 0) * 10,
          skills: skillRecord(r.skills),
          abilities: abilities("race", r, firstClass),
        })),
        classes: d.classes.map((c) => ({
          name: c.name,
          statAdj: [...c.statAdj],
          hitDie: c.hitdie ?? 0,
          expFactor: c.expFactor ?? 0,
          skills: skillRecord(c.skills),
          magic: c.magic ? classMagicRealms(c).map((realm) => realm.name) : [],
          abilities: abilities("class", firstRace, c),
        })),
        stats: ["STR", "INT", "WIS", "DEX", "CON"],
        pointBudget: MAX_BIRTH_POINTS,
        nameMax: BIRTH_NAME_MAX,
        previous: d.quickstart
          ? { race: d.quickstart.raceName, cls: d.quickstart.className, name: d.previousName ?? "" }
          : null,
        namePinned: d.pinnedName !== null,
      });
    },
    draft: () =>
      freezeDeep({
        race: race?.name ?? null,
        cls: cls?.name ?? null,
        method,
        stats: stats(),
        pointsLeft: method === "point" ? buy.pointsLeft : 0,
        pointsSpent: method === "point" ? [...buy.pointsSpent] : new Array<number>(STAT_MAX).fill(0),
        canPreviousRoll: method === "roller" && previousRolled !== null,
        name,
        history,
        historyEdited,
        options: birthOptionNames.map((e) => ({ name: e.name, description: e.description, value: options[e.name] ?? e.normal })),
        preview: preview(),
        ready: race !== null && cls !== null && name.trim() !== "",
      }),
    chooseRace: (raceName) => {
      const done = live();
      if (done) return done;
      const next = d.races.find((r) => r.name === raceName);
      if (!next) return refuse(`There is no race named "${raceName}".`);
      const changed = race !== next;
      race = next;
      resetStatWork();
      if (changed || !historyEdited) newHistory();
      return ok;
    },
    chooseClass: (className) => {
      const done = live();
      if (done) return done;
      const next = d.classes.find((c) => c.name === className);
      if (!next) return refuse(`There is no class named "${className}".`);
      cls = next;
      resetStatWork();
      return ok;
    },
    usePointBuy: () => live() ?? needPair() ?? (resetStatWork(), ok),
    buy: (stat) => {
      const bad = live() ?? needPair();
      if (bad) return bad;
      if (method !== "point") return refuse("Switch to point-buy first.");
      return buyStat(buy, stat) ? ok : refuse("That stat cannot go higher with the points left.");
    },
    sell: (stat) => {
      const bad = live() ?? needPair();
      if (bad) return bad;
      if (method !== "point") return refuse("Switch to point-buy first.");
      return sellStat(buy, stat) ? ok : refuse("That stat is already at its lowest.");
    },
    suggest: () => {
      const bad = live() ?? needPair();
      if (bad) return bad;
      method = "point";
      buy = generateStats(race!, cls!);
      return ok;
    },
    reset: () => {
      const bad = live() ?? needPair();
      if (bad) return bad;
      method = "point";
      buy = resetStats();
      return ok;
    },
    roll: () => {
      const bad = live() ?? needPair();
      if (bad) return bad;
      if (method === "roller" && rolled) previousRolled = rolled;
      method = "roller";
      rolled = rollStats(d.rng);
      return ok;
    },
    previousRoll: () => {
      const bad = live() ?? needPair();
      if (bad) return bad;
      if (method !== "roller" || !rolled || !previousRolled) return refuse("There is no earlier roll to go back to.");
      [rolled, previousRolled] = [previousRolled, rolled];
      return ok;
    },
    setName: (next) => {
      const done = live();
      if (done) return done;
      if (d.pinnedName !== null) return refuse("The name is set for this game and cannot be changed.");
      if (next.length > BIRTH_NAME_MAX) return refuse(`A name can be at most ${BIRTH_NAME_MAX} characters.`);
      name = next;
      return ok;
    },
    randomName: () => {
      const done = live();
      if (done) return done;
      if (d.pinnedName !== null) return refuse("The name is set for this game and cannot be changed.");
      name = d.randomName();
      return ok;
    },
    setHistory: (text) => {
      const done = live();
      if (done) return done;
      history = text;
      historyEdited = true;
      return ok;
    },
    regenerateHistory: () => {
      const bad = live() ?? (race ? null : refuse("Choose a race first."));
      if (bad) return bad;
      newHistory();
      return ok;
    },
    setOption: (optionName, value) => {
      const done = live();
      if (done) return done;
      if (!birthOptionNames.some((e) => e.name === optionName)) return refuse(`"${optionName}" is not a birth option.`);
      if (typeof value !== "boolean") return refuse(`"${optionName}" takes true or false.`);
      options[optionName] = value;
      return ok;
    },
    usePrevious: () => {
      const done = live();
      if (done) return done;
      const q = d.quickstart;
      if (!q) return refuse("There is no previous character to reuse.");
      const r = d.races.find((x) => x.name === q.raceName);
      const c = d.classes.find((x) => x.name === q.className);
      if (!r || !c) return refuse("The previous character's race or class is no longer in the game.");
      race = r;
      cls = c;
      rolled = null;
      previousRolled = null;
      /* load_roller_data: the previous stats go through the point-buy path,
       * which draws nothing; without them the quickstart rolls afresh. */
      if (q.stats && q.stats.length === STAT_MAX) {
        method = "point";
        buy = resetStats();
        q.stats.forEach((target, i) => {
          while ((buy.stats[i] ?? 0) < target && buyStat(buy, i)) {
            /* keep buying */
          }
        });
      } else {
        method = "roller";
        rolled = rollStats(d.rng);
      }
      newHistory();
      return ok;
    },
    accept: () => {
      const bad = live() ?? needPair();
      if (bad) return bad;
      if (name.trim() === "") return refuse("The character needs a name.");
      finish({
        raceName: race!.name,
        className: cls!.name,
        name,
        roller: method,
        ...(method === "point" ? { stats: [...buy.stats] } : { rolledStats: [...rolled!] }),
        ...(history ? { history } : {}),
        /* Every birth option, as the terminal birth screens hand them on. */
        ...(Object.keys(options).length > 0 ? { birthOptions: { ...options } } : {}),
      });
      return ok;
    },
    cancel: () => finish(null),
  };
  return { session: Object.freeze(session), outcome };
}
