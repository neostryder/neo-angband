/**
 * ELEMENT_PROJ_NAMES is a hand-written mirror of projection.txt, and a
 * hand-written mirror is right until the day it is not. Two things read it -
 * add_brand, which matches a brand's name against the four base elements to
 * decide which resist to add, and add_resist / add_immunity, which quote the
 * name into randart.log - so a wrong entry is either a missing resist on a
 * random artifact or a log line that names the wrong element.
 *
 * So derive the truth from the data file and compare. This test does NOT
 * re-declare the expected names: it reads them out of
 * reference/lib/gamedata/projection.txt, which is the same file upstream's
 * parser reads to build projections[].
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ELEMENT_PROJ_NAMES } from "./randart-build.js";

const TXT = new URL(
  "../../../../reference/lib/gamedata/projection.txt",
  import.meta.url,
);

/**
 * The `name:` of every `type:element` record, in file order - which is PROJ_
 * order, because the parser appends as it reads and project.h lists the
 * elements first.
 */
function elementNamesFromData(): string[] {
  const out: string[] = [];
  let name: string | null = null;
  for (const raw of readFileSync(TXT, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("name:")) name = line.slice(5);
    else if (line === "type:element" && name !== null) {
      out.push(name);
      name = null;
    }
  }
  return out;
}

describe("ELEMENT_PROJ_NAMES mirrors projection.txt", () => {
  const derived = elementNamesFromData();

  it("reads the data file at all", () => {
    /* Without this, a parser that matched nothing would make the comparison
     * below vacuously true for an empty port table - and the port table is not
     * empty, so it would fail loudly; but a parser that matched only SOME
     * records would silently shorten the expectation. Upstream's project.h
     * comment says the elements come first and there are 25 of them. */
    expect(derived.length).toBe(25);
    expect(derived[0]).toBe("acid");
  });

  it("matches the port's table exactly, entry for entry", () => {
    expect(ELEMENT_PROJ_NAMES).toEqual(derived);
  });

  it("carries the names that are NOT just the lowercased code", () => {
    /* The four that a copy-the-enum shortcut would get wrong. Named so the
     * equality above cannot be satisfied by a table generated from
     * list-elements.h instead of from projection.txt. */
    expect(ELEMENT_PROJ_NAMES[1]).toBe("lightning"); // ELEM_ELEC
    expect(ELEMENT_PROJ_NAMES[4]).toBe("poison"); // ELEM_POIS
    expect(ELEMENT_PROJ_NAMES[8]).toBe("shards"); // ELEM_SHARD
    expect(ELEMENT_PROJ_NAMES[12]).toBe("disenchantment"); // ELEM_DISEN
  });
});
