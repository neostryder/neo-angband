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
 *   Game path: session/game.ts swapRandartSet() threads the corpus -
 *   doRandart(reg.objects, seed, reg.nameSections.get(RANDNAME_TOLKIEN))
 *   (game.ts:2511-2514) - so the in-game randart names draw faithfully too.
 *   randNameFallback (a local syllable table) is retained only as a defensive
 *   guard for callers that pass no corpus (it never runs on the wired paths).
 * - randart.log (PORT_TODO 5.5): PORTED bar one line. do_randart opens and
 *   closes it through the host; the maintainer's disposition on 2026-08-04 was
 *   pursue parity, so the "it never affects an artifact field" argument the old
 *   note made here was never a reason to omit it. What is and is not written is
 *   MEASURED by obj/randart-log.census.test.ts rather than claimed in prose,
 *   including the one site the census's span filter cannot see. See
 *   randart-log.ts for the sink and the reason it is a module-level static.
 * - randart.txt: PORTED. obj/randart-file.ts, gated by do_randart's create_file
 *   (obj-randart.c L3195-L3215), which is a required parameter here.
 * - The second measurement pass upstream runs after generation
 *   (store_base_power/parse_frequencies on the finished set, L3181-L3186):
 *   PORTED. It exists only to populate the log's closing statistics, and the
 *   set it measures is a parameter here because this port does not overwrite
 *   the a_info global the way upstream does.
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

import { FileMode, FileType, HostDir, host } from "../host/io.js";
import type { HostIo } from "../host/io.js";
import { RANDART_TXT, writeRandartFile } from "./randart-file.js";
import { randartLog, randartLogf, setRandartLog } from "./randart-log.js";
import { KF, TV } from "../generated/index.js";
import { Rng } from "../rng.js";
import type { ObjRegistry } from "./bind.js";
import { tvalFindName } from "./bind.js";
import { buildProb, randnameMake, type NameProbs } from "./randname.js";
import {
  addAbility,
  getBaseItem,
  artifactPrep,
  buildFreqTable,
  makeBad,
  removeContradictory,
  trySupercharge,
} from "./randart-build.js";
import type { ArtifactSetData } from "./randart-data.js";
import {
  artifactPower,
  collectArtifactData,
  getBaseItemTval,
} from "./randart-data.js";
import type { Artifact } from "./types.js";
import { TV_MAX } from "./types.js";

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

  randartLog(">>>>>>>>>>>>>>>>>>>>>>>>>> CREATING NEW ARTIFACT\n");
  randartLogf(
    () => `Artifact ${String(aidx)}: power = ${String(power)}\n`,
  );

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

    const basePower = artifactPower(reg, art, "for base item power", rng);
    randartLogf(() => `Base item power ${String(basePower)}\n`);

    /* New base item power too close to target artifact power. */
    if (basePower > Math.trunc((power * 6) / 10) + 1 && power - basePower < 20) {
      randartLog("Power too high!\n");
      continue;
    }

    /* Acceptable. */
    break;
  }

  /* Failed to get a good base item. */
  if (tries >= MAX_TRIES) {
    randartLog(
      "Warning! Couldn't get appropriate power level on base item.\n",
    );
  }

  /* Generate the cumulative frequency table for this base item type. */
  const artFreq = buildFreqTable(art, data);

  /* Copy artifact info temporarily. */
  copyArtifact(art, aOld);

  /* Give this artifact a shot at being supercharged. */
  trySupercharge(reg, art, power, data, rng);
  ap = artifactPower(reg, art, "result of supercharge", rng);
  if (ap > Math.trunc((power * 23) / 20) + 1) {
    /* Too powerful -- put it back. */
    copyArtifact(aOld, art);
    randartLog("--- Supercharge is too powerful! Rolling back.\n");
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
    removeContradictory(reg, art, data.timedFoil, data.activationSummarize);

    /* Check the power, handle negative power. */
    ap = artifactPower(reg, art, "artifact attempt", rng);
    if (ap < 0) {
      ap = -ap;
      break;
    }

    /* Curse the designated artifacts. */
    if (hurtMe) {
      makeBad(reg, art, artLevel, rng, data.timedFoil);
      if (rng.oneIn(3)) {
        hurtMe = false;
      }
    }

    /* Check power. */
    if (ap > Math.trunc((power * 23) / 20) + 1) {
      /* Too powerful -- put it back. */
      copyArtifact(aOld, art);
      randartLog("--- Too powerful!  Rolling back.\n");
      continue;
    } else if (ap >= Math.trunc((power * 19) / 20)) {
      /* Just right. */
      break;
    }
  }

  /* Couldn't generate an artifact with the number of permitted iterations. */
  if (tries >= MAX_TRIES) {
    randartLog(
      "Warning!  Couldn't get appropriate power level on artifact.\n",
    );
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

  randartLogf(
    () =>
      `New depths are min ${String(art.allocMin)}, max ${String(art.allocMax)}\n`,
  );
  randartLogf(
    () => `Power-based alloc_prob is ${String(art.allocProb)}\n`,
  );

  /* Success. */
  randartLog("<<<<<<<<<<<<<<<<<<<<<<<<<< ARTIFACT COMPLETED\n");
  randartLogf(
    () =>
      `Number of tries for artifact ${String(aidx)} was: ${String(tries)}\n`,
  );

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
 * collectArtifactData), design every artifact (create_artifact_set), then
 * measure the finished set the same way. The log file (randart.log), the
 * post-generation measurement pass and the optional spoiler file (create_file /
 * write_randart_entry) are all ported (PORT_TODO 5.5); none of them affects an
 * artifact field or an RNG draw.
 */
/** path_build(ANGBAND_DIR_USER, "randart.log") (obj-randart.c L3165). */
export const RANDART_LOG = "randart.log";

export function doRandart(
  reg: ObjRegistry,
  randartSeed: number,
  /**
   * do_randart's `create_file` (obj-randart.c:3154). True writes randart.txt
   * beside randart.log; upstream passes true from birth, from loading a save
   * and from the spoiler generator, and false from the statistics harnesses.
   *
   * REQUIRED, with no default: the two callers that want it differ from the
   * many that do not, and a default would silently pick one of them.
   */
  createFile: boolean,
  tolkienWords?: readonly string[],
  extras?: Pick<ArtifactSetData, "timedFoil" | "activationSummarize">,
  io: HostIo = host(),
  onLogError?: (message: string) => void,
): (Artifact | null)[] {
  /*
   * OPEN randart.log (obj-randart.c L3164-L3171).
   *
   * Upstream file_opens ANGBAND_DIR_USER/randart.log for writing before it
   * touches an artifact, and `exit(1)`s if it cannot. That exit is the one
   * thing the port cannot copy: a browser tab has no process to kill, and a
   * desktop player did not ask to lose a character over a log file. So the
   * failure goes through the host instead - the open is probed by truncating
   * the file to empty (which is what MODE_WRITE does), and if that fails the
   * sink stays closed, `onLogError` gets upstream's own message, and every
   * emitter downstream is the no-op it already is with no log running.
   * Generation continues, which is the deliberate divergence.
   *
   * BUFFERED, not appended line by line: HostIo.write is one whole-file call
   * (that is what a localStorage-backed adapter can express), and a run of the
   * standard set emits tens of thousands of lines.
   */
  /* Prepare to use the Angband "simple" (quick LCRNG) RNG. */
  const rng = new Rng(randartSeed, { quick: true });

  const lines: string[] = [];
  let generated: (Artifact | null)[] = [];
  let logging = false;
  if (io.write(HostDir.USER, RANDART_LOG, "", FileMode.WRITE, FileType.TEXT) === "ok") {
    logging = true;
    setRandartLog((text) => lines.push(text));
  } else {
    onLogError?.("Error - can't open randart.log for writing.");
  }

  try {
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

    /* Store the original power ratings and determine generation probabilities
     * for the STANDARD set (L3175-L3178). `extras` threads the curse TIMED_INC
     * foil tables (gap 3.3) and the activation redundancy summarizer (gap 3.8);
     * absent, both checks are skipped as before. */
    const data = collectArtifactData(reg, reg.artifacts, rng);
    if (extras?.timedFoil) data.timedFoil = extras.timedFoil;
    if (extras?.activationSummarize) {
      data.activationSummarize = extras.activationSummarize;
    }

    /* Work on a fresh copy so the registry's standard artifacts are preserved. */
    const arts: (Artifact | null)[] = reg.artifacts.map((a) =>
      a ? cloneArtifact(a) : null,
    );

    /* Generate the random artifacts. */
    createArtifactSet(reg, arts, data, rng, nameProbs);

    generated = arts;

    /*
     * LOOK AT THE FREQUENCIES ON THE FINISHED ITEMS (L3181-L3186).
     *
     * A whole second measurement pass over the set just generated, into a
     * throwaway ArtifactSetData that upstream frees on the next line. Nothing
     * reads it: its ONLY product is the text both passes write to the log, so
     * a reader can compare the set the game just made against the standard one
     * it was derived from. That is why it was invisible while the log was full
     * of holes, and why it can be added now without changing an artifact - it
     * runs after generation and draws no RNG (see collectArtifactData).
     *
     * `extras` is deliberately NOT applied here: upstream measures the finished
     * set with a plain artifact_set_data_new, and both extras are generation-
     * time checks that this pass never reaches.
     */
    collectArtifactData(reg, arts, rng);

    return arts;
  } finally {
    /* CLOSE (L3189-L3193). In a `finally` so a throw mid-generation cannot
     * leave the sink installed for the next caller - upstream's log_file is a
     * static, and a stale one would narrate the following run into this one. */
    setRandartLog(null);
    if (logging) {
      const outcome = io.write(
        HostDir.USER,
        RANDART_LOG,
        lines.join(""),
        FileMode.WRITE,
        FileType.TEXT,
      );
      if (outcome !== "ok") onLogError?.("Error - can't close randart.log file.");
    }

    /*
     * WRITE A DATA FILE IF REQUIRED (L3195-L3215), after the log is closed,
     * which is upstream's order - it reuses the same handle variable for both.
     *
     * Upstream `quit_fmt`s if this file cannot be closed. The port cannot: the
     * same reasoning as the randart.log open above applies, so the failure goes
     * to onLogError and the artifact set is returned regardless. Writing the
     * file is a courtesy; losing the character over it is not.
     */
    if (createFile) {
      const outcome = io.write(
        HostDir.USER,
        RANDART_TXT,
        writeRandartFile(reg, generated, randartSeed),
        FileMode.WRITE,
        FileType.TEXT,
      );
      if (outcome !== "ok") {
        onLogError?.(`Error - can't close ${RANDART_TXT}.`);
      }
    }
  }
}
