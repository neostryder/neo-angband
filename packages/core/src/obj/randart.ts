/**
 * Random artifact generation: the top-level design loop and entry point,
 * ported from reference/src/obj-randart.c (Angband 4.2.6) lines 2672-3219.
 * This module ports copy_artifact (L2676), artifact_gen_name (L2713),
 * design_artifact (L2751), create_artifact_set (L2954), artifact_set_data_new
 * (via artifactSetDataNew in randart-data.ts) and do_randart (L3154). It drives
 * the measurement half (collectArtifactData, artifactPower in randart-data.ts)
 * and the building primitives (getBaseItem, artifactPrep, buildFreqTable,
 * trySupercharge, addAbility, removeContradictory, makeBad in randart-build.ts).
 *
 * do_randart is pure with respect to its seed: the same seed always yields the
 * same (Artifact|null)[] set. It measures the registry's standard artifact set
 * to build the generation frequencies, then designs a fresh copy of every
 * artifact into a new array, leaving ObjRegistry.artifacts untouched.
 *
 * Faithful notes / deferrals / approximations:
 * - RNG mode: upstream do_randart sets Rand_quick = true and seeds Rand_value
 *   with randart_seed, i.e. it draws from the "quick" LCRNG, not the WELL
 *   stream. This port creates its Rng in quick mode to match the draw stream
 *   (new Rng(seed, { quick: true })).
 * - artifact_gen_name / wordlist (FAITHFUL when the TOLKIEN corpus is supplied):
 *   upstream builds a Markov-chain name from the RANDNAME_TOLKIEN word list in
 *   the names datafile (randname.c randname_make + name_sections). randname_make
 *   and build_prob are ported faithfully in randname.ts, and the corpus ships in
 *   the content pack as names.json section 1 (loaded into
 *   CoreRegistries.nameSections at boot). doRandart now accepts that word list
 *   (tolkienWords); artifactGenName then calls randnameMake(RANDNAME_TOLKIEN,
 *   MIN_NAME_LEN, MAX_NAME_LEN) exactly like upstream artifact_gen_name
 *   (obj-randart.c L2713), so the name draws consume the same RNG values in the
 *   same order and the generated names match upstream. This is verified against
 *   an independent Python oracle in randart.test.ts.
 *
 *   SEAM (game path not yet faithful): the in-game caller
 *   session/game.ts swapRandartSet() calls doRandart(reg.objects, seed) and does
 *   NOT thread the corpus, because reg.objects is an ObjRegistry which does not
 *   carry nameSections (that map lives on CoreRegistries). Wiring the corpus at
 *   that call site (or onto ObjRegistry) requires editing files outside this
 *   module's ownership (session/game.ts or obj/bind.ts). Until that one-line
 *   change lands, doRandart falls back to a local syllable table (randNameFallback
 *   below) so the game path never breaks and never infinite-loops on an empty
 *   corpus - but its name draw count then differs from upstream. To close the
 *   gap fully, game.ts should call
 *   doRandart(reg.objects, seed, reg.nameSections.get(RANDNAME_TOLKIEN)).
 * - Spoiler file (DEFERRED): upstream do_randart optionally writes randart.txt
 *   (create_file / write_randart_entry, obj-randart.c L3057-L3215) and always
 *   writes randart.log. Both are spoiler/log dumps that never affect any
 *   artifact field or RNG draw; they are dropped. do_randart therefore takes
 *   no create_file argument and returns the artifact array directly. Noted as
 *   a deferral. The second measurement pass upstream runs after generation
 *   (store_base_power/parse_frequencies on the finished set, L3184-L3187) exists
 *   only to populate the log and consumes no RNG, so it is dropped too.
 * - copy_artifact activation/alt_msg quirk (FAITHFUL): upstream copy_artifact
 *   memcpy's the whole struct and then explicitly nulls a_dst->activation and
 *   a_dst->alt_msg (obj-randart.c L2689-L2690). copyArtifact reproduces this:
 *   the destination always loses its activation (set null) and alt_msg (set "")
 *   even though every other field is copied. This means a rollback in the
 *   design loop can drop an activation that add_activation had added. Faithful.
 * - design_artifact stale-kind quirk (FAITHFUL): upstream looks up `kind` once
 *   before the fixed-artifact skip loop and never refreshes it inside the loop
 *   (obj-randart.c L2754, L2778). The QUEST_ART test therefore keeps reading
 *   the initial artifact's kind while the name test tracks the advancing
 *   artifact. In the standard set the quest artifacts are last and contiguous,
 *   so this is unobservable, but it is reproduced exactly. Noted.
 */

import { KF, TV } from "../generated";
import { Rng } from "../rng";
import type { ObjRegistry } from "./bind";
import { tvalFindName } from "./bind";
import { buildProb, randnameMake, type NameProbs } from "./randname";
import {
  addAbility,
  getBaseItem,
  artifactPrep,
  buildFreqTable,
  makeBad,
  removeContradictory,
  trySupercharge,
} from "./randart-build";
import type { ArtifactSetData } from "./randart-data";
import {
  artifactPower,
  collectArtifactData,
  getBaseItemTval,
} from "./randart-data";
import type { Artifact } from "./types";
import { TV_MAX } from "./types";

/* Re-export makeBad so consumers can reach it from the top-level module. */
export { makeBad };

/* ------------------------------------------------------------------ */
/* Constants (obj-randart.h)                                           */
/* ------------------------------------------------------------------ */

/** MAX_TRIES (obj-randart.h L28). */
const MAX_TRIES = 200;

/** MIN_NAME_LEN / MAX_NAME_LEN (obj-randart.h L31-L32). */
const MIN_NAME_LEN = 5;
const MAX_NAME_LEN = 9;

/**
 * RANDNAME_TOLKIEN (randname.h L26): the names.txt section index whose word list
 * feeds artifact_gen_name (obj-randart.c L2717). Section 1 in names.json.
 */
export const RANDNAME_TOLKIEN = 1;

/* ------------------------------------------------------------------ */
/* copy_artifact (obj-randart.c L2676)                                 */
/* ------------------------------------------------------------------ */

/**
 * copy_artifact (obj-randart.c L2676): copy every artifact field from src to
 * dst in place. Faithful to the upstream memcpy-then-null: the destination's
 * activation is always cleared to null and its alt_msg to "" (obj-randart.c
 * L2689-L2690), even though all other fields (name, text, combat, flags,
 * modifiers, element info, deep copies of slays/brands/curses, time) are
 * copied. dst keeps its own identity so array references stay valid.
 */
export function copyArtifact(src: Artifact, dst: Artifact): void {
  dst.name = src.name;
  dst.text = src.text;
  dst.aidx = src.aidx;
  dst.tval = src.tval;
  dst.sval = src.sval;
  dst.toH = src.toH;
  dst.toD = src.toD;
  dst.toA = src.toA;
  dst.ac = src.ac;
  dst.dd = src.dd;
  dst.ds = src.ds;
  dst.weight = src.weight;
  dst.cost = src.cost;
  dst.flags = src.flags.clone();
  dst.modifiers = src.modifiers.slice();
  dst.elInfo = src.elInfo.map((e) => ({ resLevel: e.resLevel, flags: e.flags }));
  dst.brands = src.brands ? src.brands.slice() : null;
  dst.slays = src.slays ? src.slays.slice() : null;
  dst.curses = src.curses ? src.curses.slice() : null;
  dst.level = src.level;
  dst.allocProb = src.allocProb;
  dst.allocMin = src.allocMin;
  dst.allocMax = src.allocMax;
  dst.time = { ...src.time };

  /* Upstream nulls these after the memcpy (obj-randart.c L2689-L2690). */
  dst.activation = null;
  dst.altMsg = "";
}

/**
 * A full deep copy of an artifact, preserving activation and alt_msg. Used to
 * snapshot the registry's standard artifacts into a mutable working set so
 * do_randart never mutates ObjRegistry.artifacts. This is NOT copy_artifact
 * (which deliberately drops activation/alt_msg); it is the honest clone the
 * working array needs.
 */
function cloneArtifact(src: Artifact): Artifact {
  return {
    name: src.name,
    text: src.text,
    aidx: src.aidx,
    tval: src.tval,
    sval: src.sval,
    toH: src.toH,
    toD: src.toD,
    toA: src.toA,
    ac: src.ac,
    dd: src.dd,
    ds: src.ds,
    weight: src.weight,
    cost: src.cost,
    flags: src.flags.clone(),
    modifiers: src.modifiers.slice(),
    elInfo: src.elInfo.map((e) => ({ resLevel: e.resLevel, flags: e.flags })),
    brands: src.brands ? src.brands.slice() : null,
    slays: src.slays ? src.slays.slice() : null,
    curses: src.curses ? src.curses.slice() : null,
    level: src.level,
    allocProb: src.allocProb,
    allocMin: src.allocMin,
    allocMax: src.allocMax,
    activation: src.activation,
    altMsg: src.altMsg,
    time: { ...src.time },
  };
}

/* ------------------------------------------------------------------ */
/* artifact_gen_name (obj-randart.c L2713)                             */
/* ------------------------------------------------------------------ */

/**
 * my_strcap (z-util.c L529): capitalize only the first character, leaving the
 * rest untouched. randnameMake returns an all-lowercase word, so this matches
 * upstream exactly.
 */
function myStrcap(word: string): string {
  if (word.length === 0) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Tolkien-flavoured syllable fragments used ONLY as the seam fallback when no
 * RANDNAME_TOLKIEN corpus is supplied to doRandart (see module SEAM note). This
 * is NOT the upstream algorithm; it keeps the game path deterministic and
 * crash-free until game.ts threads the real corpus.
 */
const NAME_SYLLABLES: readonly string[] = [
  "an", "ar", "el", "en", "or", "ith", "gal", "dor", "mir", "las",
  "thal", "rond", "wen", "dil", "beth", "ath", "ien", "ael", "uin", "gorn",
  "iel", "und", "ost", "loth", "mor", "fin", "hir", "eth", "ond", "aur",
];

/**
 * Seam fallback (non-faithful): assemble a plausible name from the syllable
 * table. Fragments are drawn until the length reaches MIN_NAME_LEN, then clamped
 * to MAX_NAME_LEN. Deterministic and bounded; used only when doRandart has no
 * corpus.
 */
function randNameFallback(rng: Rng): string {
  let word = "";
  while (word.length < MIN_NAME_LEN) {
    word += NAME_SYLLABLES[rng.randint0(NAME_SYLLABLES.length)]!;
  }
  if (word.length > MAX_NAME_LEN) word = word.slice(0, MAX_NAME_LEN);
  return word;
}

/**
 * artifact_gen_name (obj-randart.c L2713): generate a random artifact name.
 * Faithful to upstream: draw a Markov word from the RANDNAME_TOLKIEN corpus via
 * randnameMake(MIN_NAME_LEN, MAX_NAME_LEN) (obj-randart.c L2717), my_strcap the
 * first letter (L2719), then one_in_(3) selects the "'Name'" form over
 * "of Name" (L2721-L2724). The upstream `struct artifact *a` argument is unused.
 *
 * `probs` is the precomputed transition table (build_prob over the corpus). When
 * null (seam fallback, no corpus), the syllable table is used instead - this is
 * NOT upstream-faithful and consumes a different number of RNG draws.
 */
export function artifactGenName(rng: Rng, probs: NameProbs | null): string {
  const word =
    probs !== null
      ? randnameMake(rng, MIN_NAME_LEN, MAX_NAME_LEN, probs)
      : randNameFallback(rng);
  const capped = myStrcap(word);
  if (rng.oneIn(3)) return `'${capped}'`;
  return `of ${capped}`;
}

/* ------------------------------------------------------------------ */
/* describe_artifact (obj-randart.c L2731)                             */
/* ------------------------------------------------------------------ */

/**
 * describe_artifact (obj-randart.c L2731): give the artifact a boring
 * "Random <type> of power <n>" description. Consumes no RNG.
 */
function describeArtifact(art: Artifact, power: number): void {
  art.text = `Random ${tvalFindName(art.tval)} of power ${power}`;
}

/* ------------------------------------------------------------------ */
/* design_artifact (obj-randart.c L2751)                               */
/* ------------------------------------------------------------------ */

/**
 * design_artifact (obj-randart.c L2751): design a random artifact into
 * arts[aidx], possibly skipping forward past fixed artifacts. Returns the
 * (possibly advanced) working index, matching upstream's *aidx after return;
 * the caller then increments it. `tv` is TV_NULL to pick a tval from the
 * learned frequencies, or a specific tval to force.
 *
 * The artifact is assigned a target power from the range of powers for its
 * tval, given a suitable base item, optionally supercharged, then has abilities
 * (or, for a cursed artifact, curses) added until its power lands between 19/20
 * and 23/20 of the target.
 */
export function designArtifact(
  reg: ObjRegistry,
  arts: (Artifact | null)[],
  data: ArtifactSetData,
  tv: number,
  aidx: number,
  rng: Rng,
  nameProbs: NameProbs | null,
): number {
  /* Defensive guard (upstream relies on aidx staying in range). */
  if (aidx < 1 || aidx >= arts.length) return aidx;

  let art = arts[aidx] as Artifact;
  /* Upstream captures kind once and never refreshes it in the skip loop. */
  let kind = reg.lookupKind(art.tval, art.sval);
  const kindAtEntry = kind;
  let artLevel = art.level;

  /* Set tval if necessary. */
  let tval = tv === TV.NULL ? getBaseItemTval(data, rng) : tv;

  /* Choose a power for the artifact. */
  let power = rng.randSample(
    data.avgTvPower[tval]!,
    data.maxTvPower[tval]!,
    data.minTvPower[tval]!,
    20,
    20,
  );

  /* Choose a name. */
  const newName = artifactGenName(rng, nameProbs);

  /* Skip fixed artifacts (stale-kind quirk preserved: kindAtEntry). */
  while (
    art.name.includes("The One Ring") ||
    (kindAtEntry !== null && kindAtEntry.kindFlags.has(KF.QUEST_ART))
  ) {
    aidx++;
    if (aidx >= arts.length) return aidx;
    art = arts[aidx] as Artifact;
    artLevel = art.level;
  }

  /* Apply the new name. */
  art.name = newName;

  /* Flip the sign on power if it's negative (unlikely) and damage. */
  let hurtMe = false;
  if (power < 0) {
    hurtMe = true;
    power = -power;
  }

  /* Structure to hold the old artifact for rollbacks. */
  const aOld = cloneArtifact(art);

  let tries: number;
  let ap = 0;

  /* Choose a base item not too powerful, so we'll have to add to it. */
  for (tries = 0; tries < MAX_TRIES; tries++) {
    if (tval === TV.NULL) tval = getBaseItemTval(data, rng);
    kind = getBaseItem(reg, tval, rng);
    artifactPrep(reg, art, kind, data, rng);

    /* Get the kind again in case it's changed. */
    kind = reg.lookupKind(art.tval, art.sval);

    const basePower = artifactPower(reg, art);

    /* New base item power too close to target artifact power. */
    if (basePower > Math.trunc((power * 6) / 10) + 1 && power - basePower < 20) {
      continue;
    }

    /* Acceptable. */
    break;
  }

  /* Generate the cumulative frequency table for this base item type. */
  const artFreq = buildFreqTable(art, data);

  /* Copy artifact info temporarily. */
  copyArtifact(art, aOld);

  /* Give this artifact a shot at being supercharged. */
  trySupercharge(reg, art, power, data, rng);
  ap = artifactPower(reg, art);
  if (ap > Math.trunc((power * 23) / 20) + 1) {
    /* Too powerful -- put it back. */
    copyArtifact(aOld, art);
  }

  /* Give this artifact a chance to be cursed - note it retains its power. */
  if (rng.oneIn(Math.trunc(arts.length / Math.max(2, data.negPowerTotal)))) {
    hurtMe = true;
  }

  /* Do the actual artifact design. */
  for (tries = 0; tries < MAX_TRIES; tries++) {
    /* Copy artifact info temporarily. */
    copyArtifact(art, aOld);

    /* Add an ability. */
    addAbility(reg, art, power, artFreq, data, rng);
    removeContradictory(reg, art);

    /* Check the power, handle negative power. */
    ap = artifactPower(reg, art);
    if (ap < 0) {
      ap = -ap;
      break;
    }

    /* Curse the designated artifacts. */
    if (hurtMe) {
      makeBad(reg, art, artLevel, rng);
      if (rng.oneIn(3)) {
        hurtMe = false;
      }
    }

    /* Check power. */
    if (ap > Math.trunc((power * 23) / 20) + 1) {
      /* Too powerful -- put it back. */
      copyArtifact(aOld, art);
      continue;
    } else if (ap >= Math.trunc((power * 19) / 20)) {
      /* Just right. */
      break;
    }
  }

  /* Set rarity based on power. kind is the final base item kind. */
  const baseKind = kind as NonNullable<typeof kind>;
  let allocNew = Math.trunc(4000000 / (ap * ap));
  allocNew = Math.trunc(allocNew / (baseKind.allocProb ? baseKind.allocProb : 20));
  if (allocNew > 99) allocNew = 99;
  if (allocNew < 1) allocNew = 1;
  art.allocProb = allocNew;

  /* Set depth according to power. */
  art.allocMax = Math.min(127, Math.trunc((ap * 3) / 5));
  art.allocMin = Math.min(100, Math.trunc(((ap + 100) * 100) / data.maxPower));

  /* Have a chance to be less rare or deep, more likely the less power. */
  if (rng.oneIn(5 + Math.trunc(power / 20))) {
    art.allocProb += rng.randint1(20);
    if (art.allocProb > 99) art.allocProb = 99;
  } else if (rng.oneIn(5 + Math.trunc(power / 20))) {
    art.allocMin = Math.trunc(art.allocMin / 2);
    if (art.allocMin < 1) art.allocMin = 1;
  }

  /* Sanity check. */
  art.allocMax = Math.max(art.allocMax, Math.min(art.allocMin * 2, 127));

  /*
   * If there is no activation or effect from the kind, level currently does
   * nothing. Set it to alloc_min in case changes elsewhere start using level.
   */
  if (!art.activation && !baseKind.activation && !baseKind.effect) {
    art.level = art.allocMin;
  }

  /* Describe it. */
  describeArtifact(art, ap);

  return aidx;
}

/* ------------------------------------------------------------------ */
/* create_artifact_set (obj-randart.c L2954)                           */
/* ------------------------------------------------------------------ */

/**
 * create_artifact_set (obj-randart.c L2954): design a full set of random
 * artifacts into `arts`. The resulting set has at least 80% as many artifacts
 * of any given tval as the original set (tvals with fewer than 5 original
 * artifacts get equal or more). Remaining slots are filled with random-tval
 * artifacts. The final slot (index arts.length - 1) is left as the original,
 * matching the upstream `aidx < z_info->a_max - 1` bound.
 */
export function createArtifactSet(
  reg: ObjRegistry,
  arts: (Artifact | null)[],
  data: ArtifactSetData,
  rng: Rng,
  nameProbs: NameProbs | null,
): void {
  let aidx = 1;
  const tvalTotal = new Array<number>(TV_MAX).fill(0);
  let notDone = true;

  /* Get min tval frequencies for the new artifacts (at least 80% each). */
  for (let i = 0; i < TV_MAX; i++) {
    tvalTotal[i] = Math.trunc((4 * (data.tvNum[i]! + 1)) / 5);
  }

  /* Allocate a minimal set of artifacts to the tvals. */
  while (notDone) {
    notDone = false;

    /* Multiple passes through tvals until all have enough artifacts. */
    for (let i = 0; i < TV_MAX; i++) {
      if (tvalTotal[i]! > 0) {
        aidx = designArtifact(reg, arts, data, i, aidx, rng, nameProbs);
        tvalTotal[i]!--;
        aidx++;
        notDone = true;
      }
    }
  }

  /* Allocate remaining artifacts at random. */
  while (aidx < arts.length - 1) {
    aidx = designArtifact(reg, arts, data, TV.NULL, aidx, rng, nameProbs);
    aidx++;
  }
}

/* ------------------------------------------------------------------ */
/* do_randart (obj-randart.c L3154)                                    */
/* ------------------------------------------------------------------ */

/**
 * do_randart (obj-randart.c L3154): generate a full random artifact set from a
 * seed and return it as a fresh (Artifact|null)[] array (index 0 null),
 * leaving ObjRegistry.artifacts untouched. Pure with respect to the seed.
 *
 * Upstream seeds the "quick" LCRNG (Rand_value = seed, Rand_quick = true), so
 * this port creates its Rng in quick mode and draws in upstream order:
 * measure the standard set (store_base_power + parse_frequencies via
 * collectArtifactData), then design every artifact (create_artifact_set). The
 * upstream log file, the post-generation measurement pass, and the optional
 * spoiler file (create_file / write_randart_entry) are all dropped as they
 * never affect an artifact field or an RNG draw (see module note).
 */
export function doRandart(
  reg: ObjRegistry,
  randartSeed: number,
  tolkienWords?: readonly string[],
): (Artifact | null)[] {
  /* Prepare to use the Angband "simple" (quick LCRNG) RNG. */
  const rng = new Rng(randartSeed, { quick: true });

  /*
   * Build the RANDNAME_TOLKIEN transition table once (build_prob is cached
   * per-type upstream, randname.c L94-L103; here we build it once per run).
   * When no corpus is supplied (the current game-path seam), fall back to the
   * non-faithful syllable generator (see module SEAM note). An empty word list
   * is treated as "no corpus" because build_prob/randname_make would otherwise
   * loop forever on an empty table.
   */
  const nameProbs: NameProbs | null =
    tolkienWords && tolkienWords.length > 0 ? buildProb(tolkienWords) : null;

  /* Store the original power ratings and determine generation probabilities. */
  const data = collectArtifactData(reg, rng);

  /* Work on a fresh copy so the registry's standard artifacts are preserved. */
  const arts: (Artifact | null)[] = reg.artifacts.map((a) =>
    a ? cloneArtifact(a) : null,
  );

  /* Generate the random artifacts. */
  createArtifactSet(reg, arts, data, rng, nameProbs);

  return arts;
}
