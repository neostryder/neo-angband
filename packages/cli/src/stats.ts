/**
 * Monte-Carlo statistics harness - the port's answer to upstream's
 * main-stats.c (reference/src/main-stats.c).
 *
 * main-stats births one wizard-mode character per run and descends level by
 * level 1..100 (descend_dungeon, main-stats.c L665-698), accumulating per-level
 * metrics across many runs: monsters by race (kill_all_monsters L533-550, the
 * `level_data[level].monsters[ridx]++` at L543), the level's object/monster
 * FEELINGs (L688-692), gold by origin (log_all_objects L624-626) and the item
 * allocation by origin (artifacts / wearables / consumables, L628-657). It then
 * writes the aggregate to a SQLite database.
 *
 * This port mirrors the metrics but not the transport: it drives the port's
 * REAL generation + allocation code (generateLevel, the same call bootLevel and
 * the live game's changeLevel make) headlessly and emits a plain-JSON aggregate
 * instead of SQLite. Two deliberate, documented deviations from main-stats:
 *
 *  - This reads the freshly generated level directly (g.monsters, g.objects,
 *    g.c.feeling) instead of birthing a player and killing every monster; the
 *    generation + allocation RNG is identical, so the distributions are the
 *    port's true generator output. Monster-held objects are still swept, as
 *    log_all_objects does (L604-609).
 *  - Each (run, depth) cell draws from a seed derived from the base seed
 *    (deriveSeed below) rather than one continuous descending stream. This is
 *    the decision-22 guarantee ("the engine is a function of the seed") applied
 *    for CI stability: the whole batch is reproducible to the exact integer,
 *    and a single flaky cell cannot shift every deeper level.
 *
 * Determinism: NO wall-clock, NO Math.random. Every draw traces to baseSeed.
 *
 * Relationship to wiz-stats.c (the in-game statistics collector behind the
 * do_cmd_wiz_collect_* commands): main-stats.c and wiz-stats.c are two
 * implementations of the same Monte-Carlo concept - main-stats.c is the
 * standalone headless tool (SQLite output), wiz-stats.c is the in-game version
 * (text log). This module tracks main-stats.c, the natural oracle for a
 * headless TS harness. The wiz-stats.c-only surfaces (the diving / clearing
 * object+monster collector, pit_stats, disconnect_stats) are ported alongside
 * it in wiz-stats.ts, reusing this module's collectLevel / DepthMetrics so the
 * object+monster tallies stay defined in exactly one place.
 */

import {
  ArtifactState,
  ENGINE_VERSION,
  ORIGIN,
  ORIGIN_ENTRIES,
  PARITY_BASELINE,
  RANDNAME_TOLKIEN,
  RF,
  Rng,
  TV,
  TVAL_ENTRIES,
  bindCore,
  bindPlayer,
  doRandart,
  generateLevel,
  genDeps,
  registerBookKinds,
} from "@rpgm-tools/neo-angband-core";
import type { CoreRegistries, GameObject, GamePack } from "@rpgm-tools/neo-angband-core";

/** Parameters for a stats batch. Sane defaults let `runStatsBatch(pack)` work. */
export interface StatsParams {
  /** Number of full descents to aggregate (main-stats -n). Default 5. */
  runs: number;
  /** Shallowest depth to generate (inclusive). Default 1. */
  depthMin: number;
  /** Deepest depth to generate (inclusive). Default 10. */
  depthMax: number;
  /** Base seed every per-cell seed is derived from. Default 1. */
  baseSeed: number;
  /*
   * There is deliberately no race/class parameter. There used to be, defaulted
   * to "Human"/"Warrior" and carried straight into the report - and both were
   * wrong AND inert: main-stats' player is whatever heads the parsed lists
   * (a Blackguard in 4.2.6, see bindForGeneration), and nothing here consumed
   * the strings anyway. The report now stamps what the binding actually is.
   */
  /** OPT(player, birth_randarts): swap in a random artifact set per run. */
  randarts: boolean;
}

/** Per-depth aggregate, accumulated across every run that reached this depth. */
export interface DepthMetrics {
  /** How many generated levels contributed (== runs, unless a depth failed). */
  levels: number;
  /** Total monsters placed across all contributing levels. */
  monsterTotal: number;
  /** Monster count keyed by race index (ridx); mirrors L543. */
  monsters: Record<string, number>;
  /**
   * Monster count keyed by monster BASE name - the species GROUP, the unit the
   * species-mix parity gate tests on. Upstream has 56 bases against 624 races,
   * and a base is what a pit or a nest is themed by (`pit.txt` names bases and
   * flags, not races), so it is the level at which the mix is both meaningful
   * and testable: 624 categories against a few hundred sampled levels is more
   * categories than the effective sample can carry.
   *
   * A C-imported report leaves this EMPTY - the C `main-stats` database records
   * `monsters(level, count, k_idx)` by race index only - so the comparison maps
   * the C's per-race counts through the pack's race -> base table instead. Same
   * grouping, applied on the far side of the import.
   */
  speciesGroups: Record<string, number>;
  /**
   * Sum over contributing levels of the SQUARED per-level count of each species
   * group, and of that count times the level's monster total. With
   * `monsterTotalSq` these are the sufficient statistics for the cluster
   * (level-level) variance of each group's share, which is what the species gate
   * needs and what a per-monster count cannot supply: monsters arrive in
   * correlated batches, so the number of independent observations is the number
   * of LEVELS. See `clusteredDistributionTest` in stat-test.ts.
   *
   * Absent from a C-imported report for the same reason `monsterTotalSq` is:
   * the C schema stores per-depth aggregates, not per-run samples.
   */
  speciesGroupsSq: Record<string, number>;
  /** Sum over levels of (this group's count) x (the level's monster total). */
  speciesGroupsXn: Record<string, number>;
  /**
   * Sum of squared per-level monster counts, so a consumer can recover the
   * per-level standard deviation and test a mean difference for significance
   * rather than against an invented tolerance (see stat-test.ts). Only a report
   * generated by the port carries this: the C `main-stats` database stores
   * per-level totals, not per-run samples, so a C-imported report leaves it 0
   * and the comparison estimates the shared variance from the port side.
   */
  monsterTotalSq: number;
  /** Sum of squared per-level gold totals; same purpose as monsterTotalSq. */
  goldSq: number;
  /** Sum of squared per-level object counts; same purpose as monsterTotalSq. */
  objectTotalSq: number;
  /**
   * Total object entries swept (floor + monster-held), EXCLUDING money. The C's
   * log_all_objects does not skip money -- its gold capture is additive and the
   * object then falls through into the `consumables` bucket (main-stats.c:624-656)
   * -- so the C importer subtracts the money kinds to match this.
   */
  objectTotal: number;
  /** Object-entry count keyed by tval. */
  objectsByTval: Record<string, number>;
  /** Object-entry count keyed by kind index (kidx) - cheap and high-signal. */
  objectsByKind: Record<string, number>;
  /** Artifact object entries (obj.artifact set); mirrors L628-630. */
  artifacts: number;
  /**
   * Ego object entries (obj.ego set). The C records these per kind and ego in
   * `wearables_egos` (main-stats.c:644-645), reached only for objects where
   * tval_has_variable_power holds, which is exactly the set that can carry an
   * ego. Summed, that table gives the per-level ego count this mirrors.
   */
  egos: number;
  /** Sum of squared per-level ego counts; same purpose as monsterTotalSq. */
  egosSq: number;
  /** Sum of squared per-level artifact counts; same purpose. */
  artifactsSq: number;
  /** Total gold (sum of gold-object pval); mirrors L624-626. */
  gold: number;
  /** Gold total keyed by origin. */
  goldByOrigin: Record<string, number>;
  /** Object-feeling digit histogram (feeling/10), 0..10; mirrors L689/L691. */
  objFeeling: Record<string, number>;
  /** Monster-feeling digit histogram (feeling%10), 0..9; mirrors L690/L692. */
  monFeeling: Record<string, number>;
}

/** A full stats report: reproducible metric -> depth -> aggregate. */
export interface StatsReport {
  meta: {
    engineVersion: string;
    parityBaseline: string;
    /**
     * "port" == generated by this TS harness (a self-consistency / regression
     * baseline). A future cross-implementation baseline produced by the C
     * main-stats tool would carry "c-main-stats"; the comparator keys off
     * nothing here, so either can be diffed against the other.
     */
    generatedBy: "port" | "c-main-stats";
    runs: number;
    depthMin: number;
    depthMax: number;
    baseSeed: number;
    race: string;
    class: string;
    randarts: boolean;
    note: string;
  };
  depths: Record<string, DepthMetrics>;
}

/** The default batch: small enough to run in CI, wide enough to have signal. */
export const DEFAULT_STATS_PARAMS: StatsParams = {
  runs: 5,
  depthMin: 1,
  depthMax: 10,
  baseSeed: 1,
  randarts: false,
};

/**
 * The pinned parameters the committed baseline is captured with and the parity
 * test re-runs. Kept small so the vitest guard stays fast (24 level builds) but
 * spanning several depths for real signal. Changing these REQUIRES regenerating
 * the baseline (pnpm --filter @rpgm-tools/neo-angband-cli stats:baseline).
 */
export const BASELINE_PARAMS: StatsParams = {
  runs: 3,
  depthMin: 1,
  depthMax: 8,
  baseSeed: 1337,
  randarts: false,
};

/** Honest one-liner stamped into every port-generated report. */
const PORT_BASELINE_NOTE =
  "Generated by the TS port itself: a self-consistency/regression guard, " +
  "NOT a C-vs-TS distribution diff. See packages/cli/baseline/README for how " +
  "to produce a C main-stats baseline and upgrade this to a true parity check.";

/**
 * Derive a reproducible uint32 seed for one (run, depth) cell from the base
 * seed. A splitmix/murmur-style finalizing mix over the three inputs so
 * adjacent cells (run+1, depth+1) land far apart in the stream. Pure integer
 * math in C uint32 semantics (Math.imul + >>> 0); no wall-clock, no global RNG.
 */
export function deriveSeed(baseSeed: number, run: number, depth: number): number {
  let h = baseSeed >>> 0;
  h = Math.imul(h ^ ((run + 0x9e3779b9) >>> 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ ((depth + 0x165667b1) >>> 0), 0xc2b2ae35) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** A distinct salt so the per-run randart seed never collides with a level. */
function deriveRandartSeed(baseSeed: number, run: number): number {
  return deriveSeed(baseSeed ^ 0x5a5a5a5a, run, 0x7fffffff) % 0x10000000;
}

function bump(rec: Record<string, number>, key: number, by = 1): void {
  const k = String(key);
  rec[k] = (rec[k] ?? 0) + by;
}

/** `bump` for a record already keyed by a string (species-group names). */
function bumpKey(rec: Record<string, number>, key: string, by = 1): void {
  rec[key] = (rec[key] ?? 0) + by;
}

/** Fresh, all-zero per-depth aggregate. */
export function emptyDepth(): DepthMetrics {
  return {
    levels: 0,
    monsterTotal: 0,
    monsters: {},
    speciesGroups: {},
    speciesGroupsSq: {},
    speciesGroupsXn: {},
    monsterTotalSq: 0,
    goldSq: 0,
    objectTotalSq: 0,
    objectTotal: 0,
    objectsByTval: {},
    objectsByKind: {},
    artifacts: 0,
    egos: 0,
    egosSq: 0,
    artifactsSq: 0,
    gold: 0,
    goldByOrigin: {},
    objFeeling: {},
    monFeeling: {},
  };
}

/**
 * swap_randart_set (game.ts): replace the registry's artifact set with a
 * random one drawn from `seed`, threading the Tolkien name corpus so the RNG
 * draw count matches upstream. Kept local (the core helper is not exported).
 */
function applyRandarts(reg: CoreRegistries, seed: number): void {
  const set = doRandart(
    reg.objects,
    reg.constants,
    seed,
    false,
    reg.nameSections.get(RANDNAME_TOLKIEN),
  );
  reg.objects.artifacts.length = 0;
  reg.objects.artifacts.push(...set);
}

/**
 * Fold one generated level into its depth aggregate. Mirrors the collection
 * pass in main-stats' descend_dungeon (feelings) + log_all_objects (objects)
 * + kill_all_monsters (monsters). Objects with origin >= ORIGIN_STATS are
 * skipped exactly as log_all_objects L619 skips them (they are never naturally
 * generated - stores, birth kit, cheat).
 */
export function collectLevel(
  m: DepthMetrics,
  g: ReturnType<typeof generateLevel>,
): void {
  m.levels += 1;

  /* Level feelings (main-stats L688-692): feeling = objDigit*10 + monDigit. */
  const feeling = g.c.feeling;
  const objF = Math.trunc(feeling / 10);
  const monF = feeling - 10 * objF;
  bump(m.objFeeling, Math.min(objF, 10));
  bump(m.monFeeling, Math.min(monF, 9));

  /* Monsters by race (kill_all_monsters L543). */
  const monstersBefore = m.monsterTotal;
  const goldBefore = m.gold;
  const objectsBefore = m.objectTotal;
  const egosBefore = m.egos;
  const artifactsBefore = m.artifacts;
  /* This level's per-species-group tally, kept locally so the per-level squares
   * below can be accumulated. It is the LEVEL that is the independent
   * observation here, not the monster: a pit or a nest drops 20-60 monsters of
   * one theme onto one level all at once. */
  const groupsHere = new Map<string, number>();
  for (const pm of g.monsters) {
    bump(m.monsters, pm.mon.race.ridx);
    /* The same race the count above uses, so the groups sum to monsterTotal. */
    const group = pm.mon.race.base.name;
    groupsHere.set(group, (groupsHere.get(group) ?? 0) + 1);
    m.monsterTotal += 1;
  }

  /* Floor objects + monster-held objects (log_all_objects L587-660). */
  const sweep = (objs: readonly GameObject[]): void => {
    for (const obj of objs) {
      if (obj.origin >= ORIGIN.STATS) continue; // L619
      if (obj.tval === TV.GOLD) {
        /* tval_is_money: accumulate the amount by origin (L624-626). */
        m.gold += obj.pval;
        bump(m.goldByOrigin, obj.origin, obj.pval);
        continue;
      }
      m.objectTotal += 1;
      bump(m.objectsByTval, obj.tval);
      bump(m.objectsByKind, obj.kind.kidx);
      if (obj.artifact) m.artifacts += 1; // L628-630
      if (obj.ego) m.egos += 1; // L644-645 (wearables_egos)
    }
  };
  sweep(g.objects.map((po) => po.obj));
  for (const pm of g.monsters) sweep(pm.mon.heldObj);

  /* Per-level squares, for the variance the significance tests need. */
  const monstersHere = m.monsterTotal - monstersBefore;
  const goldHere = m.gold - goldBefore;
  const objectsHere = m.objectTotal - objectsBefore;
  const egosHere = m.egos - egosBefore;
  const artifactsHere = m.artifacts - artifactsBefore;
  m.monsterTotalSq += monstersHere * monstersHere;

  /* Per-level species-group sufficient statistics. `Sq` and `Xn` are exactly
   * what the linearized cluster variance of a group's SHARE needs:
   *   var(share_k) = L / ((L-1) N^2) * SUM_i (y_ik - share_k * n_i)^2
   * expands to Sq_k - 2*share_k*Xn_k + share_k^2 * monsterTotalSq, so nothing
   * per-level has to be retained. */
  for (const [group, count] of groupsHere) {
    bumpKey(m.speciesGroups, group, count);
    bumpKey(m.speciesGroupsSq, group, count * count);
    bumpKey(m.speciesGroupsXn, group, count * monstersHere);
  }
  m.goldSq += goldHere * goldHere;
  m.objectTotalSq += objectsHere * objectsHere;
  m.egosSq += egosHere * egosHere;
  m.artifactsSq += artifactsHere * artifactsHere;
}

/**
 * Per-level standard deviation of a metric, recovered from its total and the sum
 * of its per-level squares (the sample standard deviation, Bessel-corrected).
 * Returns 0 for a C-imported report, which carries no squares.
 */
export function perLevelSd(
  m: DepthMetrics,
  metric: "monsterTotal" | "gold" | "objectTotal" | "egos" | "artifacts",
): number {
  const sq =
    metric === "monsterTotal"
      ? m.monsterTotalSq
      : metric === "gold"
        ? m.goldSq
        : metric === "objectTotal"
          ? m.objectTotalSq
          : metric === "egos"
            ? m.egosSq
            : m.artifactsSq;
  const n = m.levels;
  if (n < 2 || sq <= 0) return 0;
  const mean = m[metric] / n;
  const variance = (sq - n * mean * mean) / (n - 1);
  return variance > 0 ? Math.sqrt(variance) : 0;
}

/** A registry bound for headless generation, with its player-dependent foils. */
export interface GenerationBinding {
  /** Fresh registries, with the class-book kinds registered. */
  reg: CoreRegistries;
  /** The make_object foils main-stats' player implies. */
  foils: { canBrowseBook: (kind: { tval: number; sval: number }) => boolean };
  /**
   * The race and class that player actually IS, read off the binding rather
   * than asserted. Stamped into the report so a reader never has to trust a
   * label - which is the mistake #242 cost a week to.
   */
  head: { race: string; class: string };
}

/**
 * The ONE door every headless generation harness in this package binds through.
 *
 * It exists because `bindCore` alone does not produce the kind table the game
 * generates from. Spellbooks are not in object.txt: write_book_kind (init.c
 * L208) synthesises one object kind per class.txt `book:` record and gives it
 * the allocation on the following `book-properties:cost:common:min to max`
 * line. startGame and loadGame call registerBookKinds for exactly that reason;
 * the stats harnesses never did, so their allocation tables held NO BOOKS and
 * they generated zero spellbooks at every depth while the C oracle generated
 * 0.92 per level. That was the whole of the pooled object-count deficit chased
 * through parity/OBJCOUNT_NULL.md -- the instrument, not the engine.
 *
 * Four call sites needed the same two lines and all four were missing them, so
 * the fix is a door rather than four patches: a fifth harness that forgets to
 * call registerBookKinds is the same bug again.
 *
 * The foils mirror main-stats.c L435-436, which sets `player->race = races;
 * player->class = classes` -- the head of each list. The only generation foil a
 * fresh player makes non-trivial is obj_kind_can_browse (obj-make.c L1185-1195):
 * make_object rejects a book the class cannot read, re-rolls up to three times
 * and loses the object entirely if all three fail. Only the one-in-five escape
 * gets an unreadable book onto the floor, which is why the C's book count is
 * about a fifth of what the allocation table alone would predict.
 *
 * WHICH class is the head is the whole of it, and main-stats.c's own comment on
 * those two lines -- `/ * Human * /` and `/ * Warrior * /` -- is WRONG.
 * parse_class_name (init.c L3356-3362) builds the list by PREPENDING
 * (`c->next = h`), so `classes` is the LAST class in class.txt, not the first.
 * finish_parse_class (L4128-4139) then numbers the list head-first from num-1
 * down, so the head carries the HIGHEST cidx: in 4.2.6 that is cidx 8,
 * Blackguard, whose three books are shadow books. A Blackguard reads
 * [Into the Shadows], [Fear and Torment] and [Deadly Powers], so those three
 * kinds skip the rejection gauntlet entirely while every magic, prayer and
 * nature book runs it.
 *
 * That is exactly the asymmetry #242 measured. Against the 4.2.6 oracle over
 * 20 000 levels, with the harness reading classes[0] (Warrior, reads nothing):
 *
 *     tval 30 magic  C 0.242  port 0.240      tval 32 nature C 0.111  port 0.113
 *     tval 31 prayer C 0.195  port 0.193      tval 33 shadow C 0.370  port 0.109
 *
 * Three tvals matched because all four allocation profiles are identical
 * (40/40/20/15/10 at levels 1/10/30/40/60) and all four were being suppressed;
 * shadow was 3.4x short because in the C it is not suppressed. At depth 1, where
 * exactly one book per tval is in the table, the C's per-kind counts over 1000
 * levels are magic 95, nature 99, prayer 99, shadow 469 -- and 97/469 = 0.207,
 * which is one_in_(5) reading back off the data.
 *
 * So take the LAST class, and take it by position rather than by name: the port
 * indexes classes by cidx, so classes[length - 1] is upstream's list head under
 * any reordering of class.txt. A mod that appends a class changes which class
 * this is -- correctly, because it changes it in the C too.
 *
 * The other two foils stay absent, as before: append_object_curse's TIMED_INC
 * foil is a no-op against a fresh player's all-zero timed table, and
 * birth_no_selling is off. Gold matched the oracle to +0.19% with both absent.
 */
export function bindForGeneration(pack: GamePack): GenerationBinding {
  const reg = bindCore(pack);
  const players = bindPlayer(pack.player);
  /* Must run before genDeps, which builds ObjAllocState from reg.objects. */
  registerBookKinds(reg.objects, players.classes);
  /* Read AFTER registerBookKinds, which stamps the numeric tval/sval onto each
   * ClassBook. The LAST class, not the first - see the note above on upstream's
   * prepended list and its comment that says otherwise. */
  const cls = players.classes[players.classes.length - 1];
  const race = players.races[players.races.length - 1];
  const readable = new Set(
    (cls?.magic.books ?? []).map((b) => `${b.tvalIdx},${b.sval}`),
  );
  return {
    reg,
    foils: {
      canBrowseBook: (kind): boolean =>
        readable.has(`${kind.tval},${kind.sval}`),
    },
    head: { race: race?.name ?? "?", class: cls?.name ?? "?" },
  };
}

/**
 * Run a full Monte-Carlo batch and return the aggregate report.
 *
 * Per run: rebind the registries fresh (a fresh character's world - resets
 * unique max_num and the created-artifact marks, mirroring main-stats'
 * unkill_uniques + reset_artifacts at L790-791), optionally swap in a randart
 * set, then generate every depth in range sharing that run's registries and
 * ArtifactState so an artifact found shallow is not re-found deep within the
 * same descent (main-stats does not reset between levels of a run).
 */
export function runStatsBatch(
  pack: GamePack,
  params: Partial<StatsParams> = {},
): StatsReport {
  const p: StatsParams = { ...DEFAULT_STATS_PARAMS, ...params };
  if (p.depthMax < p.depthMin) {
    throw new RangeError(`depthMax (${p.depthMax}) < depthMin (${p.depthMin})`);
  }

  const depths: Record<string, DepthMetrics> = {};
  for (let d = p.depthMin; d <= p.depthMax; d++) depths[String(d)] = emptyDepth();

  /* Every run rebinds the same pack, so the head is the same each time; capture
   * it once so the report states the player it actually generated against. */
  let headNames = { race: "?", class: "?" };

  for (let run = 0; run < p.runs; run++) {
    const { reg, foils, head } = bindForGeneration(pack);
    headNames = head;
    if (p.randarts) applyRandarts(reg, deriveRandartSeed(p.baseSeed, run));
    const artifacts = new ArtifactState(reg.objects.artifacts.length);

    for (let d = p.depthMin; d <= p.depthMax; d++) {
      const rng = new Rng(deriveSeed(p.baseSeed, run, d));
      const deps = genDeps(reg, true, foils, artifacts, false);
      const g = generateLevel(rng, d, deps, { daytime: true });
      collectLevel(depths[String(d)]!, g);
      /* kill_all_monsters (main-stats.c L557-560): every monster on the level is
       * killed once counted, and a killed UNIQUE has its max_num zeroed -- so a
       * unique generated at any depth is retired for the rest of that descent and
       * get_mon_num will never offer it again. Without this the harness lets
       * uniques recur at every depth of a run, which inflates their share of the
       * species histogram and makes a C-vs-port species comparison meaningless
       * (measured: Fang at depth 4, port 63 per 200 levels against the C's 13).
       * unkill_uniques (L790) is mirrored by rebinding the registries per run. */
      for (const pm of g.monsters) {
        const race = pm.mon.originalRace ?? pm.mon.race;
        if (race.flags.has(RF.UNIQUE)) race.maxNum = 0;
      }
    }
  }

  return {
    meta: {
      engineVersion: ENGINE_VERSION,
      parityBaseline: PARITY_BASELINE,
      generatedBy: "port",
      runs: p.runs,
      depthMin: p.depthMin,
      depthMax: p.depthMax,
      baseSeed: p.baseSeed,
      race: headNames.race,
      class: headNames.class,
      randarts: p.randarts,
      note: PORT_BASELINE_NOTE,
    },
    depths,
  };
}

/**
 * Serialize a report with sorted keys at every level so a committed baseline
 * (and any diff against it) is byte-stable regardless of insertion order.
 */
export function serializeReport(report: StatsReport): string {
  return JSON.stringify(report, sortedReplacer, 2) + "\n";
}

/** JSON.stringify replacer that emits object keys in a stable sorted order. */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort(numericAwareCompare)) out[k] = src[k];
    return out;
  }
  return value;
}

/** Sort numeric-looking keys numerically ("2" before "10"), else lexically. */
function numericAwareCompare(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Human-readable one-line-per-depth summary for the terminal. */
export function summarizeReport(report: StatsReport): string {
  const lines: string[] = [];
  const { meta } = report;
  lines.push(
    `stats: engine ${meta.engineVersion} (parity ${meta.parityBaseline}) ` +
      `runs=${meta.runs} depths=${meta.depthMin}..${meta.depthMax} ` +
      `seed=${meta.baseSeed} randarts=${meta.randarts}`,
  );
  lines.push(
    "depth  levels  mons  objs  arts  gold      objFeel  monFeel",
  );
  for (const key of Object.keys(report.depths).sort(numericAwareCompare)) {
    const d = report.depths[key]!;
    const objF = topKey(d.objFeeling);
    const monF = topKey(d.monFeeling);
    lines.push(
      `${key.padStart(5)}  ${String(d.levels).padStart(6)}  ` +
        `${String(d.monsterTotal).padStart(4)}  ${String(d.objectTotal).padStart(4)}  ` +
        `${String(d.artifacts).padStart(4)}  ${String(d.gold).padStart(8)}  ` +
        `${objF.padStart(7)}  ${monF.padStart(7)}`,
    );
  }
  return lines.join("\n");
}

/** The most common key in a histogram (for the summary table), or "-". */
function topKey(rec: Record<string, number>): string {
  let best: string | null = null;
  let bestN = -1;
  for (const [k, n] of Object.entries(rec)) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best ?? "-";
}

/** Origin-index -> name, for anyone inspecting goldByOrigin keys. */
export function originName(origin: number): string {
  return ORIGIN_ENTRIES[origin]?.name ?? String(origin);
}

/** tval -> name, for anyone inspecting objectsByTval keys. */
export function tvalName(tval: number): string {
  return TVAL_ENTRIES[tval]?.name ?? String(tval);
}
