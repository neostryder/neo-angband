/**
 * Themed dungeon monster generation, ported from reference/src/gen-monster.c
 * (Angband 4.2.6): the monster-restriction and spread machinery shared by
 * pits, nests, vaults and chambers.
 *
 * PORTED (faithful RNG order and count, verified line-by-line against the C):
 * - mon_select (gen-monster.c L70): base-symbol + undead/invisible + unique
 *   filter; draws randint0(5) per candidate unique when uniques are allowed,
 *   exactly as upstream (this draw happens inside get_mon_num_prep's per-entry
 *   pass, so its count is the number of unique races reaching that branch).
 * - mon_pit_hook (gen-room.c L901): the pit/nest filter over a resolved pit
 *   profile (unique ban, flags-req subset, flags-ban intersect, spell-req
 *   subset, spell-ban intersect, innate-freq floor, mon-ban list, then base
 *   and color match). Pure, no RNG.
 * - set_pit_type (gen-room.c L968): the weighted pit selection. For each
 *   candidate profile draws Rand_normal(ave, 10); one_in_(rarity) is drawn
 *   only when the new distance beats the best so far (C && short-circuit).
 * - mon_restrict (gen-monster.c L115): NULL clears; "random" runs the 2500-try
 *   randint1(r_max - 1) loop; a pit name sets the pit type. Preps the alloc
 *   table with the matching hook.
 * - spread_monsters (gen-monster.c L199): the 50-try rand_spread placement
 *   loop with the 10-try in-bounds inner loop and the group rein.
 * - get_vault_monsters (gen-monster.c L277): per racial symbol, prep
 *   mon_select, one gate get_mon_num draw, then a monster on every rectangle
 *   grid whose (linear) vault data char equals the symbol.
 *
 * The allocation table (get_mon_num_prep / get_mon_num) lives in mon/make.ts
 * and is reused unchanged; a "hook" here is the (race) => boolean it preps.
 */

import { FlagSet } from "../bitflag";
import { ORIGIN, RF, RSF, SQUARE } from "../generated";
import { colorCharToAttr, colorTextToAttr } from "../color";
import type { Rng } from "../rng";
import type { MonsterBase, MonsterRace } from "../mon/types";
import { RF_SIZE, RSF_SIZE } from "../mon/types";
import type { MonsterRegistry } from "../mon/bind";
import type { MonAllocTable } from "../mon/make";
import type { Gen } from "./util";
import { generateMark, loc, pickAndPlaceMonster, squareIsEmpty } from "./util";

/* ------------------------------------------------------------------ *
 * Resolved pit profiles (pit_profile with names resolved to references).
 * ------------------------------------------------------------------ */

/**
 * A pit_profile with its string-keyed pit.json fields resolved to the
 * references mon_pit_hook and set_pit_type need: base templates, color
 * attrs, race/spell FlagSets and forbidden-monster races. `freqInnate`
 * is stored 100/pct like the C parser (parse_pit_innate_freq).
 */
export interface ResolvedPit {
  name: string;
  /** room_type: 1 = pit, 2 = nest, 3 = other. */
  roomType: number;
  /** alloc rarity (one_in_ this in set_pit_type). */
  rarity: number;
  /** average native level (pit->ave). */
  ave: number;
  /** obj_rarity: per-grid percent chance of an item. */
  objRarity: number;
  /** freq_innate stored as 100/pct (0 when unspecified). */
  freqInnate: number;
  bases: MonsterBase[];
  colors: number[];
  flags: FlagSet;
  forbiddenFlags: FlagSet;
  spellFlags: FlagSet;
  forbiddenSpellFlags: FlagSet;
  forbiddenMonsters: MonsterRace[];
}

/** Split a "A | B | C" pit flag line and OR each RF_ name into `flags`. */
function orRaceFlags(flags: FlagSet, lines: string[]): void {
  for (const line of lines) {
    for (const raw of line.split("|")) {
      const name = raw.trim();
      if (!name) continue;
      const value = (RF as Record<string, number>)[name];
      if (value === undefined || value === 0) {
        throw new Error(`gen-monster: bad pit race flag: ${name}`);
      }
      flags.on(value);
    }
  }
}

/** Split a pit spell-flag line and OR each RSF_ name into `flags`. */
function orSpellFlags(flags: FlagSet, lines: string[]): void {
  for (const line of lines) {
    for (const raw of line.split("|")) {
      const name = raw.trim();
      if (!name) continue;
      const value = (RSF as Record<string, number>)[name];
      if (value === undefined || value === 0) {
        throw new Error(`gen-monster: bad pit spell flag: ${name}`);
      }
      flags.on(value);
    }
  }
}

/**
 * Resolve the registry's bound pit profiles into ResolvedPit records for
 * generation. Preserves pit.json order (set_pit_type indexes it directly).
 */
export function resolvePits(reg: MonsterRegistry): ResolvedPit[] {
  return reg.pits.map((p) => {
    const flags = new FlagSet(RF_SIZE);
    orRaceFlags(flags, p.flagsReq);
    const forbiddenFlags = new FlagSet(RF_SIZE);
    orRaceFlags(forbiddenFlags, p.flagsBan);
    const spellFlags = new FlagSet(RSF_SIZE);
    orSpellFlags(spellFlags, p.spellReq);
    const forbiddenSpellFlags = new FlagSet(RSF_SIZE);
    orSpellFlags(forbiddenSpellFlags, p.spellBan);

    const bases: MonsterBase[] = [];
    for (const name of p.baseNames) {
      const base = reg.bases.get(name);
      if (!base) throw new Error(`gen-monster: pit ${p.name}: unknown base ${name}`);
      bases.push(base);
    }

    const colors: number[] = [];
    for (const code of p.colors) {
      const attr = code.length > 1 ? colorTextToAttr(code) : colorCharToAttr(code);
      if (attr < 0) throw new Error(`gen-monster: pit ${p.name}: bad color ${code}`);
      colors.push(attr);
    }

    const forbiddenMonsters: MonsterRace[] = [];
    for (const name of p.monBan) {
      const race = reg.raceByName(name);
      if (!race) throw new Error(`gen-monster: pit ${p.name}: unknown mon-ban ${name}`);
      forbiddenMonsters.push(race);
    }

    return {
      name: p.name,
      roomType: p.room,
      rarity: p.allocRarity,
      ave: p.allocLevel,
      objRarity: p.objRarity,
      /* parse_pit_innate_freq stores 100/pct; the bound value is the pct. */
      freqInnate: p.freqInnate > 0 ? Math.trunc(100 / p.freqInnate) : 0,
      bases,
      colors,
      flags,
      forbiddenFlags,
      spellFlags,
      forbiddenSpellFlags,
      forbiddenMonsters,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Selection hooks (mon_select, mon_pit_hook) and set_pit_type.
 * ------------------------------------------------------------------ */

/**
 * mon_select (gen-monster.c L70): accept a race by base symbol. Uniques are
 * usually declined; when allowed they still pass only 1 time in 5. The
 * randint0(5) draw happens here, i.e. once per candidate unique when the
 * table is prepped, exactly as upstream.
 *
 * `baseDChar` "" means "any symbol" (upstream base_d_char == 0).
 */
export function monSelect(
  rng: Rng,
  baseDChar: string,
  currentLevel: number,
  allowUnique: boolean,
): (race: MonsterRace) => boolean {
  return (race) => {
    if (baseDChar !== "" && baseDChar !== race.base.glyph) return false;
    if (
      currentLevel < 40 &&
      race.flags.has(RF.UNDEAD) &&
      race.flags.has(RF.INVISIBLE)
    ) {
      return false;
    }
    if (race.flags.has(RF.UNIQUE)) {
      if (!allowUnique) return false;
      if (rng.randint0(5) !== 0) return false;
    }
    return true;
  };
}

/**
 * mon_pit_hook (gen-room.c L901): accept a race for the given resolved pit.
 * Pure (no RNG). The else-if chain is order-preserved (any failing test
 * rejects); base/color are matched only when every earlier test passes.
 */
export function monPitHook(pit: ResolvedPit): (race: MonsterRace) => boolean {
  return (race) => {
    if (race.flags.has(RF.UNIQUE)) return false;
    /* rf_is_subset(race->flags, pit->flags): every required flag present. */
    if (!race.flags.isSubset(pit.flags)) return false;
    if (race.flags.isInter(pit.forbiddenFlags)) return false;
    if (!race.spellFlags.isSubset(pit.spellFlags)) return false;
    if (race.spellFlags.isInter(pit.forbiddenSpellFlags)) return false;
    if (race.freqInnate < pit.freqInnate) return false;
    for (const m of pit.forbiddenMonsters) {
      if (race === m) return false;
    }

    let matchBase = true;
    if (pit.bases.length > 0) {
      matchBase = pit.bases.some((b) => race.base === b);
    }
    let matchColor = true;
    if (pit.colors.length > 0) {
      matchColor = pit.colors.some((c) => race.dAttr === c);
    }
    return matchBase && matchColor;
  };
}

/**
 * set_pit_type (gen-room.c L968): choose a pit profile for `depth`. For each
 * candidate (skipping empty pits or the wrong room type when `type` != 0),
 * draw a normally-distributed depth and keep the closest that also passes its
 * rarity roll. `type` is 1 for pits, 2 for nests, 0 for any.
 *
 * Returns the chosen ResolvedPit (pits[0] when nothing was selected, matching
 * the upstream pit_idx = 0 default).
 */
export function setPitType(
  rng: Rng,
  pits: ResolvedPit[],
  depth: number,
  type: number,
): ResolvedPit {
  let pitIdx = 0;
  let pitDist = 999;
  for (let i = 0; i < pits.length; i++) {
    const pit = pits[i] as ResolvedPit;
    /* Skip empty pits or pits of the wrong room type. */
    if (type && (!pit.name || pit.roomType !== type)) continue;

    const offset = rng.randNormal(pit.ave, 10);
    const dist = Math.abs(offset - depth);

    if (dist < pitDist && rng.oneIn(pit.rarity)) {
      pitIdx = i;
      pitDist = dist;
    }
  }
  return pits[pitIdx] as ResolvedPit;
}

/* ------------------------------------------------------------------ *
 * mon_restrict + spread_monsters.
 * ------------------------------------------------------------------ */

/** Result of a mon_restrict call: whether it succeeded and the pit set. */
export interface MonRestrictResult {
  ok: boolean;
  pit: ResolvedPit | null;
}

/**
 * mon_restrict (gen-monster.c L115): rebuild the monster allocation table for
 * the given restriction against `table`. NULL clears; "random" draws a random
 * base via the 2500-try loop; any other name selects that pit profile.
 *
 * `depth` is the native selection depth, `currentDepth` the level the monsters
 * will be placed on. Returns whether the table was (re)built and the pit used.
 */
export function monRestrict(
  rng: Rng,
  table: MonAllocTable,
  races: MonsterRace[],
  pits: ResolvedPit[],
  type: string | null,
  depth: number,
  currentDepth: number,
  uniqueOk: boolean,
): MonRestrictResult {
  /* No monster type specified, no restrictions. */
  if (type === null) {
    table.prep(null);
    return { ok: true, pit: null };
  }

  if (type === "random") {
    /* r_max = races.length (index 0 is the <player> placeholder). */
    let i = 0;
    let j = 0;
    for (i = 0; i < 2500; i++) {
      j = rng.randint1(races.length - 1);
      const race = races[j] as MonsterRace | undefined;

      /* Must be a real monster. */
      if (!race || !race.rarity) continue;

      if (i < 200) {
        if (
          !race.flags.has(RF.UNIQUE) &&
          race.level !== 0 &&
          race.level <= depth &&
          Math.abs(race.level - currentDepth) < 1 + Math.trunc(currentDepth / 4)
        ) {
          break;
        }
      } else if (
        !race.flags.has(RF.UNIQUE) &&
        race.level !== 0 &&
        race.level <= depth
      ) {
        break;
      }
    }

    if (i < 2499) {
      const race = races[j] as MonsterRace;
      table.prep(monSelect(rng, race.base.glyph, currentDepth, uniqueOk));
      return { ok: true, pit: null };
    }
    /* Paranoia - area stays empty if no monster is found. */
    return { ok: false, pit: null };
  }

  /* Use a pit profile. */
  const profile = pits.find((p) => p.name === type) ?? null;
  if (!profile) return { ok: false, pit: null };
  table.prep(monPitHook(profile));
  return { ok: true, pit: profile };
}

/**
 * spread_monsters (gen-monster.c L199): place up to `num` monsters spread over
 * a rectangle centred on (y0, x0) with half-dimensions (dy, dx). Restricts the
 * table by `type`, draws a gate get_mon_num, then runs the 50-try placement
 * loop (10-try in-bounds retries, square_isempty gate, sleeping group-ok
 * placement, and the mon_max - start > num*2 group rein). Clears the
 * restriction at the end.
 *
 * Not wired to a builder yet (room_of_chambers/cavern callers are deferred),
 * but reproduced faithfully so those builders can call it unchanged.
 */
export function spreadMonsters(
  g: Gen,
  races: MonsterRace[],
  pits: ResolvedPit[],
  type: string | null,
  depth: number,
  num: number,
  y0: number,
  x0: number,
  dy: number,
  dx: number,
  origin: number,
): void {
  if (!g.monDeps) return;
  const table = g.monDeps.table;
  const c = g.c;
  const startMonNum = g.monsters.length;

  /* Restrict monsters. Allow uniques. Leave area empty if none found. */
  if (!monRestrict(g.rng, table, races, pits, type, depth, c.depth, true).ok) {
    return;
  }

  /* Build the monster probability table. */
  if (!table.getMonNum(g.rng, depth, c.depth)) {
    monRestrict(g.rng, table, races, pits, null, depth, c.depth, true);
    return;
  }

  let count = 0;
  let y = y0;
  let x = x0;
  for (let i = 0; count < num && i < 50; i++) {
    if (dy === 0 && dx === 0) {
      y = y0;
      x = x0;
      if (!c.inBounds(loc(x, y))) {
        monRestrict(g.rng, table, races, pits, null, depth, c.depth, true);
        return;
      }
    } else {
      let broke = false;
      for (let j = 0; j < 10; j++) {
        y = g.rng.randSpread(y0, dy);
        x = g.rng.randSpread(x0, dx);
        if (!c.inBounds(loc(x, y))) {
          if (j < 9) continue;
          monRestrict(g.rng, table, races, pits, null, depth, c.depth, true);
          return;
        }
        broke = true;
        break;
      }
      if (!broke) {
        monRestrict(g.rng, table, races, pits, null, depth, c.depth, true);
        return;
      }
    }

    /* Require "empty" floor grids. */
    if (!squareIsEmpty(g, loc(x, y))) continue;

    /* Place the monster (sleeping, allow groups). */
    pickAndPlaceMonster(g, loc(x, y), depth, true, true, origin);

    /* Rein in monster groups and escorts a little. */
    if (g.monsters.length - startMonNum > num * 2) break;

    count++;
    i = 0;
  }

  /* Remove monster restrictions. */
  monRestrict(g.rng, table, races, pits, null, depth, c.depth, true);
}

/* ------------------------------------------------------------------ *
 * get_vault_monsters (racial-symbol vault monsters, item #75).
 * ------------------------------------------------------------------ */

/**
 * get_vault_monsters (gen-monster.c L277): for each racial symbol, prep
 * mon_select on that base symbol, draw a gate get_mon_num, then place a
 * monster (awake, no groups) on every grid of the [y1..y2] x [x1..x2]
 * rectangle whose vault data char equals the symbol.
 *
 * `dataCharAt(t)` returns the t-th char of the raw vault text (rows laid out
 * at the vault's original width), matching the upstream linear `*t` walk over
 * the rectangle, which ignores the symmetry transform exactly as upstream.
 */
export function getVaultMonsters(
  g: Gen,
  racialSymbols: string[],
  vaultType: string,
  dataCharAt: (t: number) => string,
  y1: number,
  y2: number,
  x1: number,
  x2: number,
): void {
  if (!g.monDeps) return;
  const table = g.monDeps.table;
  const c = g.c;

  for (const sym of racialSymbols) {
    /* Determine level of monster from the vault tier. */
    let depth: number;
    if (vaultType.includes("Lesser vault")) depth = c.depth + 2;
    else if (vaultType.includes("Medium vault")) depth = c.depth + 4;
    else if (vaultType.includes("Greater vault")) depth = c.depth + 6;
    else depth = c.depth;

    /* Prepare allocation table. Require correct race, allow uniques. */
    table.prep(monSelect(g.rng, sym, c.depth, true));

    /* Build the monster probability table (gate draw). */
    if (!table.getMonNum(g.rng, depth, c.depth)) continue;

    /* Place the monsters on every matching grid (linear data walk). */
    let t = 0;
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++, t++) {
        if (dataCharAt(t) === sym) {
          /* get_vault_monsters (gen-monster.c L322-323): ORIGIN_DROP_SPECIAL. */
          pickAndPlaceMonster(g, loc(x, y), depth, false, false, ORIGIN.DROP_SPECIAL);
        }
      }
    }
  }

  /* Clear any current monster restrictions. */
  table.prep(null);
}

/* ------------------------------------------------------------------ *
 * get_chamber_monsters (room-of-chambers monster fill, gen-monster.c L344).
 * ------------------------------------------------------------------ */

/**
 * get_chamber_monsters (gen-monster.c L344): fill a room of chambers with a
 * creature race or type offering a challenge at the character's depth - similar
 * to a monster pit, but over a wider range of monsters.
 *
 * RNG order, verified line-by-line against gen-monster.c L344-418:
 *   1. one_in_(20)                              -> `random`
 *   2. randint0(11)                             -> legal depth (c.depth + n - 5)
 *   3. if !random: set_pit_type(depth, 0) in a while-loop until the chosen pit
 *      has a name (each set_pit_type draws Rand_normal + one_in_ per candidate)
 *   4. mon_restrict("random"|pit.name, depth', c.depth, true)
 *      ("random" runs the 2500-try randint1 loop; a pit name draws nothing)
 *   5. get_mon_num(depth', c.depth) gate draw
 *   6. generate_mark(SQUARE_MON_RESTRICT) - no RNG
 *   7. 300-try loop: randint0(1+|y2-y1|), randint0(1+|x2-x1|); on an empty
 *      square draw randint0(3) for sleeping then pick_and_place_monster
 *   8. mon_restrict(NULL) cleanup - no RNG
 *
 * `area` is height * width (upstream passes it for the monster-quantity scale).
 * The name is used only by ROOM_LOG upstream (a no-op here), so it is dropped.
 */
export function getChamberMonsters(
  g: Gen,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
  area: number,
): void {
  if (!g.monDeps || !g.monDeps.pits) return;
  const c = g.c;
  const table = g.monDeps.table;
  const pits = g.monDeps.pits;
  const races = table.allRaces;

  const random = g.rng.oneIn(20);

  /* Get a legal depth. */
  let depth = c.depth + g.rng.randint0(11) - 5;

  /* Choose a pit profile, using that depth. */
  let chosenPit: ResolvedPit | null = null;
  if (!random) {
    for (;;) {
      /* Choose a pit profile; retry until one with a name was saved. */
      chosenPit = setPitType(g.rng, pits, depth, 0);
      if (chosenPit.name) break;
    }
  }

  /* Allow (slightly) tougher monsters. */
  depth = c.depth + (c.depth < 60 ? Math.trunc(c.depth / 12) : 5);

  /* Set monster generation restrictions. Occasionally random. */
  if (random) {
    if (!monRestrict(g.rng, table, races, pits, "random", depth, c.depth, true).ok) {
      return;
    }
  } else {
    if (
      !monRestrict(g.rng, table, races, pits, (chosenPit as ResolvedPit).name, depth, c.depth, true).ok
    ) {
      return;
    }
  }

  /* Build the monster probability table. */
  if (!table.getMonNum(g.rng, depth, c.depth)) {
    monRestrict(g.rng, table, races, pits, null, depth, c.depth, true);
    return;
  }

  /* No normal monsters. */
  generateMark(c, y1, x1, y2, x2, SQUARE.MON_RESTRICT);

  /* Allow about a monster every 20-30 grids. */
  let monstersLeft = Math.trunc(area / (30 - Math.trunc(c.depth / 10)));

  /* Place the monsters. */
  for (let i = 0; i < 300; i++) {
    /* Check for early completion. */
    if (!monstersLeft) break;

    /* Pick a random in-room square. */
    const y = y1 + g.rng.randint0(1 + Math.abs(y2 - y1));
    const x = x1 + g.rng.randint0(1 + Math.abs(x2 - x1));

    /* Require a passable square with no monster in it already. */
    if (!squareIsEmpty(g, loc(x, y))) continue;

    /* Place a single monster. Sleeping 2/3rds of the time. */
    const sleep = g.rng.randint0(3) !== 0;
    /* get_chamber_monsters (gen-monster.c L409-410): ORIGIN_DROP_SPECIAL. */
    pickAndPlaceMonster(g, loc(x, y), c.depth, sleep, false, ORIGIN.DROP_SPECIAL);

    /* One less monster to place. */
    monstersLeft--;
  }

  /* Remove our restrictions. */
  monRestrict(g.rng, table, races, pits, null, depth, c.depth, true);
}
