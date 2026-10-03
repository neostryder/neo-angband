/**
 * history.txt phrases through the content-patch path: a history record's ref is
 * `<pack>:<chart>--<roll>` (mod-sdk record-key.ts), so a mod corrects one phrase
 * without shipping the whole file, and the bound chart is otherwise untouched.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeContentPacks } from "@rpgm-tools/neo-angband-mod-sdk";
import type { LoadedPack, PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { Rng } from "../rng.js";
import { bindPlayer } from "./bind.js";
import type { HistoryRecordJson, PlayerPackRecords } from "./bind.js";
import { generateHistory } from "./birth.js";

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as { records: T[] };
  return parsed.records;
}

function manifest(id: string, deps?: Record<string, string>): PackManifest {
  const m: PackManifest = { id, name: id, version: "1.0.0", shape: "content" };
  if (deps) m.dependencies = deps;
  return m;
}

function playerPack(history: HistoryRecordJson[]): PlayerPackRecords {
  return {
    races: packJson("p_race"),
    classes: packJson("class"),
    properties: packJson("player_property"),
    timed: packJson("player_timed"),
    shapes: packJson("shape"),
    bodies: packJson("body"),
    history,
    realms: packJson("realm"),
  };
}

const core = (): LoadedPack => ({
  manifest: manifest("core"),
  files: { history: { records: packJson("history") } },
});

function composedHistory(...mods: LoadedPack[]): HistoryRecordJson[] {
  const composed = composeContentPacks([core(), ...mods]);
  expect(composed.problems).toEqual([]);
  return composed.records["history"] as HistoryRecordJson[];
}

/** Every race's background for a spread of seeds, as one comparable list. */
function backgrounds(history: HistoryRecordJson[]): string[] {
  const reg = bindPlayer(playerPack(history));
  const out: string[] = [];
  for (const race of reg.races) {
    for (let seed = 1; seed <= 40; seed++) {
      out.push(generateHistory(reg.historyChart(race), new Rng(seed * 7919)));
    }
  }
  return out;
}

describe("history phrases by record key", () => {
  it("generates byte-identical backgrounds when no mod patches history", () => {
    const raw = backgrounds(packJson("history"));
    expect(backgrounds(composedHistory())).toEqual(raw);
    expect(raw.some((text) => text.includes("You have blue-gray eyes, "))).toBe(true);
  });

  it("lets a mod correct one phrase, here history.txt:269", () => {
    const fix: LoadedPack = {
      manifest: manifest("bug-fixes", { core: "*" }),
      files: {
        history: { patches: { "core:50--100": { phrase: ["You have blue-grey eyes, "] } } },
      },
    };
    const patched = composedHistory(fix);
    const chart = bindPlayer(playerPack(patched)).histories.get(50);
    expect(chart?.entries.map((e) => e.text)).toEqual(
      bindPlayer(playerPack(packJson("history")))
        .histories.get(50)
        ?.entries.map((e) => (e.roll === 100 ? "You have blue-grey eyes, " : e.text)),
    );

    /* The rolls are untouched, so every seed picks the same entries: the only
     * difference in any background is the corrected phrase. */
    const before = backgrounds(packJson("history"));
    const after = backgrounds(patched);
    expect(after).toEqual(
      before.map((text) => text.replace("You have blue-gray eyes, ", "You have blue-grey eyes, ")),
    );
    expect(after).not.toEqual(before);
  });

  it("lets a mod replace one record whole, keeping its place in the chart", () => {
    const original = packJson<HistoryRecordJson>("history").find(
      (r) => r.chart.chart === 50 && r.chart.roll === 100,
    )!;
    const fix: LoadedPack = {
      manifest: manifest("bug-fixes", { core: "*" }),
      files: {
        history: {
          replaces: { "core:50--100": { chart: original.chart, phrase: ["You have blue-grey eyes, "] } },
        },
      },
    };
    const before = backgrounds(packJson("history"));
    const after = backgrounds(composedHistory(fix));
    expect(after).toEqual(
      before.map((text) => text.replace("You have blue-gray eyes, ", "You have blue-grey eyes, ")),
    );
    expect(after).not.toEqual(before);
  });

  it("lets a mod remove one record, and its chart still gives every background", () => {
    /* Chart 4's roll-15 entry. Rolls are cumulative thresholds, so with it gone
     * rolls 1 to 15 reach the chart's next entry instead, and every chart still
     * has an entry for every roll. */
    const gone = "Your mother was of the Avari. ";
    const history = packJson<HistoryRecordJson>("history");
    expect(history.filter((r) => (r.phrase ?? []).join("") === gone)).toHaveLength(1);
    const cut: LoadedPack = {
      manifest: manifest("lore", { core: "*" }),
      files: { history: { removes: ["core:4--15"] } },
    };
    const removed = composedHistory(cut);
    expect(removed).toHaveLength(history.length - 1);

    const before = backgrounds(history);
    const after = backgrounds(removed);
    expect(before.some((text) => text.includes(gone))).toBe(true);
    for (const [i, text] of after.entries()) {
      const was = before[i] ?? "";
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain(gone);
      /* A background that never rolled the removed entry draws the same dice
       * and so comes out the same. */
      if (!was.includes(gone)) expect(text).toBe(was);
    }
  });
});
