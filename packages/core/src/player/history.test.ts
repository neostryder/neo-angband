import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HIST } from "../generated";
import { bindPlayer } from "./bind";
import { blankPlayer } from "./player";
import type { Player } from "./player";
import {
  histHas,
  historyAdd,
  historyAddFull,
  historyClear,
  historyFindArtifact,
  historyGetList,
  historyIsArtifactKnown,
  historyLoseArtifact,
  historyUnmaskUnknown,
} from "./history";

function loadRecords<T>(name: string): T[] {
  return (
    JSON.parse(
      readFileSync(
        new URL(`../../../content/pack/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as { records: T[] }
  ).records;
}

const players = bindPlayer({
  races: loadRecords("p_race"),
  classes: loadRecords("class"),
  properties: loadRecords("player_property"),
  timed: loadRecords("player_timed"),
  shapes: loadRecords("shape"),
  bodies: loadRecords("body"),
  history: loadRecords("history"),
  realms: loadRecords("realm"),
});

function human(): Player {
  const race = players.raceByName("Human")!;
  const cls = players.classByName("Warrior")!;
  return blankPlayer(race, cls, players.bodies[race.body]!);
}

describe("historyAddFull / historyAdd (player-history.c history_add_full/history_add)", () => {
  it("appends an entry with the exact fields given, oldest-first", () => {
    const p = human();
    historyAddFull(p, 1 << HIST.GENERIC, 0, 3, 5, 700, "A generic note");
    expect(historyGetList(p)).toEqual([
      { type: 1 << HIST.GENERIC, dlev: 3, clev: 5, aIdx: 0, turn: 700, event: "A generic note" },
    ]);
  });

  it("truncates event text to 79 characters (my_strcpy into event[80])", () => {
    const p = human();
    const long = "x".repeat(100);
    historyAddFull(p, 1 << HIST.GENERIC, 0, 0, 1, 0, long);
    expect(p.hist[0]!.event).toBe("x".repeat(79));
    expect(p.hist[0]!.event.length).toBe(79);
  });

  it("historyAdd sets exactly one bit and defaults aIdx to 0", () => {
    const p = human();
    historyAdd(p, "Reached level 2", HIST.GAIN_LEVEL, 1, 2, 50);
    const e = p.hist[0]!;
    expect(e.type).toBe(1 << HIST.GAIN_LEVEL);
    expect(histHas(e.type, HIST.GAIN_LEVEL)).toBe(true);
    expect(histHas(e.type, HIST.ARTIFACT_KNOWN)).toBe(false);
    expect(e.aIdx).toBe(0);
  });

  it("historyClear empties the log", () => {
    const p = human();
    historyAdd(p, "note", HIST.GENERIC, 0, 1, 0);
    historyClear(p);
    expect(historyGetList(p)).toEqual([]);
  });
});

describe("historyFindArtifact / historyLoseArtifact (player-history.c L223-266)", () => {
  const art = { aidx: 7 };
  const nameFn = (a: { aidx: number }): string => `Artifact#${a.aidx}`;

  it("logs one 'Found <name>' KNOWN entry on first discovery", () => {
    const p = human();
    historyFindArtifact(p, art, 5, 10, 1000, nameFn);
    expect(historyGetList(p)).toHaveLength(1);
    const e = p.hist[0]!;
    expect(e.event).toBe("Found Artifact#7");
    expect(histHas(e.type, HIST.ARTIFACT_KNOWN)).toBe(true);
    expect(e.aIdx).toBe(7);
    expect(historyIsArtifactKnown(p, art)).toBe(true);
  });

  it("a second find for the same aidx marks known instead of adding a row", () => {
    const p = human();
    historyFindArtifact(p, art, 5, 10, 1000, nameFn);
    historyFindArtifact(p, art, 6, 11, 1001, nameFn);
    expect(historyGetList(p)).toHaveLength(1); // no new row
  });

  it("historyLoseArtifact on an unknown artifact adds a single UNKNOWN|LOST 'Missed' entry", () => {
    const p = human();
    historyLoseArtifact(p, art, 5, 10, 1000, nameFn);
    expect(historyGetList(p)).toHaveLength(1);
    const e = p.hist[0]!;
    expect(e.event).toBe("Missed Artifact#7");
    expect(histHas(e.type, HIST.ARTIFACT_UNKNOWN)).toBe(true);
    expect(histHas(e.type, HIST.ARTIFACT_LOST)).toBe(true);
  });

  it("historyLoseArtifact on an already-known artifact only sets LOST (no new row)", () => {
    const p = human();
    historyFindArtifact(p, art, 1, 1, 1, nameFn);
    historyLoseArtifact(p, art, 2, 2, 2, nameFn);
    expect(historyGetList(p)).toHaveLength(1);
    const e = p.hist[0]!;
    expect(e.event).toBe("Found Artifact#7"); // unchanged text
    expect(histHas(e.type, HIST.ARTIFACT_KNOWN)).toBe(true);
    expect(histHas(e.type, HIST.ARTIFACT_LOST)).toBe(true);
  });
});

describe("historyUnmaskUnknown (player-history.c L272-283, death_knowledge)", () => {
  it("flips every ARTIFACT_UNKNOWN entry to ARTIFACT_KNOWN and leaves others untouched", () => {
    const p = human();
    const lostArt = { aidx: 3 };
    historyLoseArtifact(p, lostArt, 1, 1, 1, () => "Lost Thing"); // UNKNOWN|LOST
    historyAdd(p, "Killed Grip", HIST.SLAY_UNIQUE, 1, 1, 1); // untouched type
    historyUnmaskUnknown(p);
    expect(histHas(p.hist[0]!.type, HIST.ARTIFACT_UNKNOWN)).toBe(false);
    expect(histHas(p.hist[0]!.type, HIST.ARTIFACT_KNOWN)).toBe(true);
    expect(histHas(p.hist[0]!.type, HIST.ARTIFACT_LOST)).toBe(true); // untouched
    expect(p.hist[1]!.type).toBe(1 << HIST.SLAY_UNIQUE); // unrelated entry untouched
  });
});
