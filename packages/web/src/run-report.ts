/**
 * The run journal and the end-of-run report, for a mod that draws its own
 * timeline, post-mortem or graveyard.
 *
 * `characterHistory` is Angband's own player history (player-history.c), the
 * same entries the character history screen and the character dump show, with
 * each entry's kind spelled out. It records birth, each new character level,
 * artifacts, unique kills and the player's notes. Upstream keeps no record of
 * new dungeon depths, and neither does this: a mod that wants depth milestones
 * records them itself from the level-change events, keyed by
 * `ctx.character.key()`.
 *
 * `buildRunReport` runs once, when a character dies or retires, after the
 * death knowledge has revealed every item and after the score table has been
 * written. It copies what a post-mortem needs into one frozen value, because
 * the save is gone by the time a mod draws it.
 */

import {
  HIST,
  histHas,
  historyGetList,
  totalPoints,
  type AgentView,
  type GameState,
  type HistoryInfo,
} from "@rpgm-tools/neo-angband-core";
import type { CharacterSheetData } from "./charsheet";
import type { LoggedMessage } from "./messages";
import { historyEntryNote } from "./screens";

export type HistoryKind =
  | "birth"
  | "level"
  | "unique"
  | "artifact"
  | "artifact-unknown"
  | "note"
  | "import"
  | "other";

export interface CharacterHistoryEntry {
  readonly kind: HistoryKind;
  /** The text the character history screen shows, without its "(LOST)" suffix. */
  readonly text: string;
  readonly turn: number;
  /** Dungeon level when recorded; feet are this times 50. */
  readonly depth: number;
  /** Character level when recorded. */
  readonly level: number;
  /** An artifact entry for an artifact the character has since lost. */
  readonly lost: boolean;
}

export type RunOutcome = "death" | "winner" | "retired";

export interface RunBelonging {
  readonly name: string;
  readonly color: string;
  readonly location: "equipment" | "pack" | "quiver" | "home";
  readonly quantity: number;
  /** The item's inspect text, as `ctx.inspect.inspectItem` returns it. */
  readonly recall: { readonly title: string; readonly text: string } | null;
}

export interface RunReport {
  readonly outcome: RunOutcome;
  /** The killer's name, "Ripe Old Age" for a winner, or "Retiring". */
  readonly cause: string;
  /** `ctx.character.key()` for the character, or null when it had no save slot. */
  readonly key: string | null;
  readonly name: string;
  readonly race: string;
  readonly cls: string;
  readonly level: number;
  readonly maxLevel: number;
  /** The deepest dungeon level reached; feet are this times 50. */
  readonly maxDepth: number;
  /** The dungeon level the run ended on. */
  readonly depth: number;
  readonly gold: number;
  /** The game turn the run ended on. */
  readonly turn: number;
  /** total_points: maximum experience plus 100 per level of maximum depth. */
  readonly score: number;
  /** Whether the score table accepted the entry. */
  readonly scored: boolean;
  /** Epoch milliseconds. */
  readonly endedAt: number;
  readonly history: readonly CharacterHistoryEntry[];
  /** The last messages, oldest first, with repeats folded into `count`. */
  readonly messages: readonly { readonly text: string; readonly count: number; readonly color?: string }[];
  readonly belongings: readonly RunBelonging[];
  readonly sheet: CharacterSheetData | null;
  /** The character's birth choices, for `ctx.saves.create({ like: report.birth })`. */
  readonly birth: { readonly race: string; readonly cls: string; readonly name: string; readonly stats: readonly number[] };
}

/** How many of the final messages a report keeps. */
export const RUN_REPORT_MESSAGES = 40;

function kindOf(e: HistoryInfo): HistoryKind {
  if (histHas(e.type, HIST.PLAYER_BIRTH)) return "birth";
  if (histHas(e.type, HIST.GAIN_LEVEL)) return "level";
  if (histHas(e.type, HIST.SLAY_UNIQUE)) return "unique";
  if (histHas(e.type, HIST.ARTIFACT_UNKNOWN)) return "artifact-unknown";
  if (histHas(e.type, HIST.ARTIFACT_KNOWN)) return "artifact";
  if (histHas(e.type, HIST.USER_INPUT)) return "note";
  if (histHas(e.type, HIST.SAVEFILE_IMPORT)) return "import";
  return "other";
}

/** The character's history as data, oldest first. */
export function characterHistory(state: GameState): readonly CharacterHistoryEntry[] {
  return deepFreeze(
    historyGetList(state.actor.player).map((e) => ({
      kind: kindOf(e),
      text: historyEntryNote(state, e),
      turn: e.turn,
      depth: e.dlev,
      level: e.clev,
      lost: histHas(e.type, HIST.ARTIFACT_LOST),
    })),
  );
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function recallOf(view: AgentView, ref: Parameters<NonNullable<AgentView["inspectItem"]>>[0]): RunBelonging["recall"] {
  const r = view.inspectItem?.(ref);
  return r ? { title: r.title, text: r.text } : null;
}

export interface RunReportInput {
  readonly state: GameState;
  /** An agent view with every domain granted, built after the death knowledge ran. */
  readonly view: AgentView;
  readonly messages: readonly LoggedMessage[];
  readonly key: string | null;
  readonly sheet: CharacterSheetData | null;
  readonly scored: boolean;
  readonly endedAt: number;
}

export function buildRunReport(input: RunReportInput): RunReport {
  const { state, view } = input;
  const p = state.actor.player;
  const cause = p.diedFrom || "the dungeon";
  const outcome: RunOutcome = cause === "Retiring" ? "retired" : p.totalWinner ? "winner" : "death";

  const belongings: RunBelonging[] = [];
  const seen = new Set<number>();
  const carried = (location: RunBelonging["location"], items: readonly ({ handle: number; label: string; nameColor: string; number: number } | null)[]): void => {
    for (const item of items) {
      if (!item || seen.has(item.handle)) continue;
      seen.add(item.handle);
      belongings.push({ name: item.label, color: item.nameColor, location, quantity: item.number, recall: recallOf(view, item.handle) });
    }
  };
  carried("equipment", view.equipment());
  carried("quiver", view.quiver?.() ?? []);
  carried("pack", view.inventory());
  view.stores().forEach((store, storeIndex) => {
    if (!store.isHome) return;
    store.stock.forEach((item, index) => {
      belongings.push({
        name: item.label,
        color: item.nameColor,
        location: "home",
        quantity: item.number,
        recall: recallOf(view, { store: storeIndex, index }),
      });
    });
  });

  return deepFreeze({
    outcome,
    cause,
    key: input.key,
    name: p.fullName,
    race: p.race.name,
    cls: p.cls.name,
    level: p.lev,
    maxLevel: p.maxLev,
    maxDepth: p.maxDepth,
    depth: state.chunk.depth,
    gold: p.au,
    turn: state.turn,
    score: totalPoints(p),
    scored: input.scored,
    endedAt: input.endedAt,
    history: characterHistory(state),
    messages: input.messages.slice(-RUN_REPORT_MESSAGES).map((m) => ({
      text: m.text,
      count: m.count,
      ...(m.color === undefined ? {} : { color: m.color }),
    })),
    belongings,
    sheet: input.sheet,
    birth: { race: p.race.name, cls: p.cls.name, name: p.fullName, stats: p.statBirth.slice(0, 5) },
  });
}

/**
 * The session's latest run report and its listeners. A mod that loads after a
 * run ended still reads it with `last()`. It lasts until the page reloads, which
 * starting a new character does, so a mod that keeps a graveyard stores the
 * report itself when `onEnd` fires.
 */
export function createRunReports() {
  let latest: RunReport | null = null;
  const listeners = new Set<(report: RunReport) => void>();
  return {
    publish(report: RunReport): void {
      latest = report;
      for (const listener of [...listeners]) {
        try {
          listener(report);
        } catch (error) {
          console.error("run report listener failed", error);
        }
      }
    },
    last: (): RunReport | null => latest,
    onEnd(listener: (report: RunReport) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type RunReports = ReturnType<typeof createRunReports>;
