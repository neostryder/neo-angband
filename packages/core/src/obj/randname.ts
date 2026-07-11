/**
 * Random name generation, ported from reference/src/randname.c (Angband
 * 4.2.6): W. Sheldon Simms' Markov-chain word generator. build_prob learns a
 * letter-transition frequency table from a corpus of lowercase words;
 * randnameMake walks that table to emit a fresh word of a bounded length.
 *
 * Used by flavor_init for scroll titles (RANDNAME_SCROLL). The generator is a
 * pure function of the supplied Rng, so it is deterministic given a seed - the
 * flavour system re-derives identical scroll titles across a save/reload from
 * the persisted seed_flavor (session/game.ts).
 *
 * Faithful details kept: the S_WORD/E_WORD/TOTAL markers, the "10 tries" and
 * "min length + must-contain-a-vowel" acceptance conditions, and the exact
 * weighted-pick loop (so the RNG draw sequence matches upstream for a corpus).
 */

import type { Rng } from "../rng";

/* Markers for the start and end of words (randname.c L23-25). E_WORD aliases
 * S_WORD; TOTAL is the running-sum slot appended after the 27 letter/end
 * columns. */
const S_WORD = 26;
const E_WORD = S_WORD;
const TOTAL = 27;

/* Table dimensions: probs[c_prev][c_cur][c_next] with c_prev,c_cur in
 * 0..S_WORD (27 rows) and c_next in 0..TOTAL (28 columns). */
const DIM1 = S_WORD + 1; // 27
const DIM2 = TOTAL + 1; // 28

/** A built probability table (name_probs), flattened row-major. */
export type NameProbs = Uint16Array;

function idx(cPrev: number, cCur: number, cNext: number): number {
  return (cPrev * DIM1 + cCur) * DIM2 + cNext;
}

/** is_a_vowel (z-util.c): the five basic English vowels. */
function isAVowel(ch: string): boolean {
  return (
    ch === "a" || ch === "e" || ch === "i" || ch === "o" || ch === "u"
  );
}

/**
 * build_prob (randname.c L41): accumulate the raw letter-transition
 * frequencies from a list of purely alphabetical lowercase words. Any
 * non a-z character is skipped defensively (the corpus is clean a-z, so this
 * never triggers on the shipped names data).
 */
export function buildProb(words: readonly string[]): NameProbs {
  const probs = new Uint16Array(DIM1 * DIM1 * DIM2);
  const bump = (i: number): void => {
    probs[i] = (probs[i] ?? 0) + 1;
  };
  for (const raw of words) {
    let cPrev = S_WORD;
    let cCur = S_WORD;
    const word = raw.toLowerCase();
    for (let k = 0; k < word.length; k++) {
      const cNext = word.charCodeAt(k) - 97; // A2I
      if (cNext < 0 || cNext >= S_WORD) continue;
      bump(idx(cPrev, cCur, cNext));
      bump(idx(cPrev, cCur, TOTAL));
      cPrev = cCur;
      cCur = cNext;
    }
    bump(idx(cPrev, cCur, E_WORD));
    bump(idx(cPrev, cCur, TOTAL));
  }
  return probs;
}

/**
 * randname_make (randname.c L77): generate one word of length in [min, max]
 * that contains at least one vowel, using the probability table. Faithful to
 * the upstream loop, including the "start over after 10 failed tries or on
 * overflow" behaviour, so the RNG draws line up with the C generator.
 */
export function randnameMake(
  rng: Rng,
  min: number,
  max: number,
  probs: NameProbs,
): string {
  let out = "";
  let foundWord = false;
  while (!foundWord) {
    out = "";
    let cPrev = S_WORD;
    let cCur = S_WORD;
    let tries = 0;
    let containsVowel = false;
    let lnum = 0;
    while (tries < 10 && lnum <= max && !foundWord) {
      const total = probs[idx(cPrev, cCur, TOTAL)] as number;
      let cNext = 0;
      if (total === 0) {
        /* Defensive: a state with no learned transitions cannot occur with
         * the shipped a-z corpus; treat it as a word end rather than run
         * off the table. */
        cNext = E_WORD;
      } else {
        let r = rng.randint0(total);
        while (r >= (probs[idx(cPrev, cCur, cNext)] as number)) {
          r -= probs[idx(cPrev, cCur, cNext)] as number;
          cNext++;
        }
      }
      if (cNext === E_WORD) {
        /* At a word end: accept if long enough and voweled, else retry. */
        if (lnum >= min && containsVowel) {
          foundWord = true;
        } else {
          tries++;
        }
      } else {
        const ch = String.fromCharCode(97 + cNext); // I2A
        out += ch;
        if (isAVowel(ch)) containsVowel = true;
        lnum++;
        cPrev = cCur;
        cCur = cNext;
      }
    }
  }
  return out;
}
