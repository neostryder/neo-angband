/**
 * Upstream unit tests from reference/src/tests/artifact/name.c
 *
 * Mapping:
 * - artifact_gen_name -> artifactGenName (obj/randart.ts)
 * Upstream passes a word list via `const char **p[]`; the port uses a
 * precomputed NameProbs Markov table (buildProb) over the same syllable
 * corpus style. Observable contract: generated names either contain a
 * single-quote form ('Name') with only one quote pair, or contain "of ".
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { Rng } from "../rng";
import { buildProb } from "./randname";
import { artifactGenName, RANDNAME_TOLKIEN } from "./randart";

function loadTolkienWords(): string[] {
  const names = JSON.parse(
    readFileSync(
      new URL("../../../content/pack/names.json", import.meta.url),
      "utf8",
    ),
  ) as { records: { section: number; word: string[] }[] };
  const sec = names.records.find((r) => r.section === RANDNAME_TOLKIEN);
  return sec ? sec.word : [];
}

describe("artifact/name (reference/src/tests/artifact/name.c)", () => {
  // upstream: test_names
  it("names", () => {
    const words = loadTolkienWords();
    expect(words.length).toBeGreaterThan(0);
    const probs = buildProb(words);
    const rng = new Rng(42);
    const NAMES_TRIES = 100;

    for (let i = 0; i < NAMES_TRIES; i++) {
      const n = artifactGenName(rng, probs);
      if (n.includes("'")) {
        // Single pair of quotes: first and last quote positions differ.
        const first = n.indexOf("'");
        const last = n.lastIndexOf("'");
        expect(first).not.toBe(last);
        // Exactly two quotes.
        expect(n.split("'").length - 1).toBe(2);
      } else {
        expect(n.includes("of ")).toBe(true);
      }
    }
  });
});
