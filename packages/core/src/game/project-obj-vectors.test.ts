/**
 * project_o's object handlers, replayed against outcomes recorded BEFORE the
 * 11-case switch became PROJECT_OBJ_HANDLERS.
 *
 * EXHAUSTIVE, NOT SAMPLED, and that is worth stating because the terrain
 * vectors next door are the opposite. project_object_handler is pure - (typ,
 * obj) in, {doKill, ignore, noteKill} out, no rng - so "every projection
 * against every element/flag combination" is a finite table: 56 codes x 208
 * objects = 11,648 rows, covering all four HATES/IGNORE settings on each of the
 * 25 elements at stack sizes 1 and 2, plus objects that carry the setting on
 * every element at once (which is what separates the two-element arms).
 *
 * Recorded by scripts/gen-project-obj-vectors.mjs against the switch, then
 * committed. If the registry disagrees with the switch anywhere at all, it
 * fails here.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ELEM, PROJ } from "../generated/index.js";
import { EL_INFO_HATES, EL_INFO_IGNORE } from "../obj/types.js";
import type { GameObject } from "../obj/object.js";
import { PROJECT_OBJ_HANDLERS, runObjectHandler } from "./project-obj.js";

interface Vector {
  code: string;
  subject: string;
  doKill: boolean;
  ignore: boolean;
  noteKill: string | null;
}

const vectors = JSON.parse(
  readFileSync(new URL("./project-obj-vectors.json", import.meta.url), "utf8"),
) as Vector[];

const FLAG_BY_LABEL: Record<string, number> = {
  none: 0,
  hates: EL_INFO_HATES,
  "hates+ignore": EL_INFO_HATES | EL_INFO_IGNORE,
  ignore: EL_INFO_IGNORE,
};

const ELEMENT_NAMES = Object.keys(ELEM);

/** Rebuild the recorded subject: "<ELEM|ALL>/<flag label>/n=<number>". */
function subjectObject(subject: string): GameObject {
  const [elem, label, n] = subject.split("/");
  const flags = FLAG_BY_LABEL[label as string];
  if (flags === undefined) throw new Error(`unknown flag label ${String(label)}`);
  const number = Number((n as string).slice(2));
  const elInfo = ELEMENT_NAMES.map(() => ({ flags: 0, res_level: 0 }));
  if (elem === "ALL") {
    for (const e of elInfo) e.flags = flags;
  } else {
    const at = (ELEM as Record<string, number>)[elem as string];
    if (at === undefined) throw new Error(`unknown element ${String(elem)}`);
    elInfo[at] = { flags, res_level: 0 };
  }
  return { number, elInfo } as unknown as GameObject;
}

describe("project_o object handlers", () => {
  it("reproduces every recorded outcome", () => {
    /* Both directions in one comparison: a row that changed AND a row that was
     * dropped or added both show up as an array mismatch. */
    const replayed = vectors.map((v) => {
      const typ = (PROJ as Record<string, number>)[v.code];
      if (typ === undefined) throw new Error(`unknown code ${v.code}`);
      const out = runObjectHandler(typ, subjectObject(v.subject));
      return { code: v.code, subject: v.subject, ...out };
    });
    expect(replayed).toEqual(
      vectors.map((v) => ({
        code: v.code,
        subject: v.subject,
        doKill: v.doKill,
        ignore: v.ignore,
        noteKill: v.noteKill,
      })),
    );
  });

  it("is a table that could disagree: 296 of the 11,648 rows destroy something", () => {
    /* THE CONTROL FOR THE FILE ITSELF. A recording in which nothing ever
     * happens would replay green against any implementation at all, so the
     * shape of the recording is asserted too. */
    expect(vectors).toHaveLength(11648);
    const kills = vectors.filter((v) => v.doKill);
    expect(kills).toHaveLength(296);
    expect([...new Set(kills.map((v) => v.code))].sort()).toEqual([
      "ACID",
      "COLD",
      "ELEC",
      "FIRE",
      "FORCE",
      "ICE",
      "MANA",
      "METEOR",
      "PLASMA",
      "SHARD",
      "SOUND",
    ]);
    /* And every distinct note the handlers can produce appears somewhere. */
    expect([...new Set(kills.map((v) => v.noteKill))].sort()).toEqual([
      "are destroyed",
      "burn up",
      "burns up",
      "is destroyed",
      "melt",
      "melts",
      "shatter",
      "shatters",
    ]);
  });

  it("keeps PLASMA's and METEOR's two elements in order", () => {
    /* Load-bearing, and the easiest thing to lose in a switch->table rewrite:
     * the SECOND elemental() overwrites noteKill when it also hits, so an
     * object that hates both fire and electricity reports ELECTRICITY's note.
     *
     * Run through runObjectHandler, NOT read out of the vectors. The first
     * version of this test looked the rows up in the recorded JSON, which makes
     * it an assertion about the recording - it would have passed against any
     * implementation at all, including one with the two calls swapped. */
    const both = subjectObject("ALL/hates/n=1");
    expect(runObjectHandler(PROJ.PLASMA, both).noteKill).toBe("is destroyed");
    expect(runObjectHandler(PROJ.METEOR, both).noteKill).toBe("shatters");
    /* And the singles, so "always the second one" is not the rule either. */
    expect(
      runObjectHandler(PROJ.PLASMA, subjectObject("FIRE/hates/n=1")).noteKill,
    ).toBe("burns up");
    expect(
      runObjectHandler(PROJ.METEOR, subjectObject("FIRE/hates/n=2")).noteKill,
    ).toBe("burn up");
  });

  it("leaves KILL_TRAP out of the table, because projectObject handles it first", () => {
    /* The one exception, asserted rather than left implicit. KILL_TRAP unlocks
     * a chest - it mutates the object and messages instead of destroying it -
     * so it is handled ahead of this dispatch and correctly does nothing here. */
    expect(PROJECT_OBJ_HANDLERS.has("KILL_TRAP")).toBe(false);
    const out = runObjectHandler(PROJ.KILL_TRAP, subjectObject("ALL/hates/n=1"));
    expect(out).toEqual({ doKill: false, ignore: false, noteKill: null });
  });

  it("names only codes that exist", () => {
    /* A misspelled key is silent: the handler never runs and the projection
     * quietly stops affecting objects. */
    const real = new Set(Object.keys(PROJ));
    expect([...PROJECT_OBJ_HANDLERS.keys()].filter((c) => !real.has(c))).toEqual([]);
    expect(PROJECT_OBJ_HANDLERS.size).toBe(11);
  });
});
