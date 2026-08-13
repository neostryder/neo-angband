/**
 * What the map shows while the player is hallucinating, ported from
 * reference/src/cave-map.c L179-188 (map_info's rare-placeholder block) and
 * reference/src/ui-map.c L41-80 (hallucinatory_monster / hallucinatory_object)
 * of Angband 4.2.6.
 *
 * THE TWO HALVES. Upstream splits this across two files and it is easy to
 * attribute it to the wrong one. `map_info` decides WHETHER a grid hallucinates
 * and, on an otherwise-empty grid, whether to invent a monster or an object
 * that is not there. `grid_data_as_text` then decides WHAT GLYPH that grid
 * draws, and it is the only caller of the two selector functions. Both halves
 * live here because neither is meaningful alone.
 *
 * WHY THIS IS NOT IN map-text.ts. `monsterGlyph` implements the seven-arm
 * clear/unique/animated resolution a real monster goes through. A hallucinated
 * monster goes through NONE of it: ui-map.c L232-235 assigns the selected
 * race's attr/char directly and returns. Folding hallucination into
 * `monsterGlyph` would put an ATTR_CLEAR test on a monster that does not exist.
 *
 * DETERMINISM. Everything here draws random numbers, and that is the point -
 * but it draws them from an injected `HallucinationRandom`, never from the game
 * stream. Upstream rolls on the main RNG at render time, once per grid per
 * refresh, which is safe in a C program whose only repaint trigger is a game
 * event. This port repaints on window resize, on returning from a menu, and on
 * the animation timer, so binding these rolls to the game stream would make the
 * dungeon depend on how often the screen was painted. Owner ruling 2026-08-09
 * accepts a different RNG stream where the rules and the odds are unchanged,
 * which is exactly this case: same 1/128, same rejection loops, same
 * distribution over races and kinds. See docs/PARITY.md.
 */

/**
 * The two draws this module makes. `oneIn(n)` is upstream's `one_in_(n)`;
 * `randint0(n)` is upstream's `randint0(n)`. A caller supplies a display-only
 * stream (see the module docblock) or, in a test, a scripted one.
 */
export interface HallucinationRandom {
  oneIn(n: number): boolean;
  randint0(n: number): number;
}

/** What map_info already knows about a grid when it reaches L179. */
export interface HallucinationGridInput {
  /** `player->timed[TMD_IMAGE] > 0` (cave-map.c L105). */
  image: boolean;
  /** `g->m_idx > 0`: a monster that survived the visibility filter (L172-176). */
  monster: boolean;
  /** `g->first_kind != 0`: a real known object kind on this grid (L156-169). */
  object: boolean;
  /**
   * `g->unseen_money || g->unseen_object`: a SENSED marker rather than a known
   * kind. It leaves `first_kind` at 0, so such a grid is still eligible for a
   * placeholder - but grid_data_as_text tests the two unseen flags BEFORE the
   * first_kind arm (ui-map.c L199-212), so an invented object on a sensed grid
   * is drawn over by the star and never seen. The flag is carried so that
   * `objectGlyph` can report false there instead of the caller having to know.
   */
  sensed: boolean;
  /** `g->f_idx == FEAT_PERM` (L181, L183): an outer wall never gets one. */
  permanentWall: boolean;
}

/** map_info's verdict for one grid. */
export interface HallucinationGrid {
  /**
   * `g->hallucinate` as grid_data_as_text will see it. False either because the
   * player is not hallucinating at all, or because the grid was empty and both
   * placeholder rolls missed (cave-map.c L187). When false the grid draws
   * completely normally - INCLUDING its trap, which ui-map.c L193 suppresses
   * only while this is true.
   */
  hallucinate: boolean;
  /** Draw a random monster here: either a real one, or `m_idx = 1` (L182). */
  monsterGlyph: boolean;
  /** Draw a random object here: either a real one, or `first_kind = k_info` (L185). */
  objectGlyph: boolean;
}

/**
 * map_info's hallucination pass (cave-map.c L105 + L179-188).
 *
 * On a grid that already holds a monster or an object, hallucination simply
 * stays on and both are replaced by random ones. On an empty grid it invents
 * something at 1/128, an object at 127/16384, and otherwise turns itself off
 * for this grid - which is why hallucination looks like a sparse scatter of
 * impossible things rather than a screen of noise.
 *
 * Two details that are easy to lose. The rolls are exclusive (upstream's second
 * test is an `else if`), so a grid never gets both an invented monster AND an
 * invented object. And `one_in_(128)` is evaluated BEFORE the permanent-wall
 * test in each arm, so an empty outer wall consumes both draws and then gets
 * nothing - the short-circuit order below reproduces that draw count exactly.
 */
export function hallucinateGrid(
  input: HallucinationGridInput,
  rand: HallucinationRandom,
): HallucinationGrid {
  if (!input.image) {
    return { hallucinate: false, monsterGlyph: false, objectGlyph: false };
  }
  if (input.monster || input.object) {
    /* Something real is here; both arms substitute for what is drawn. */
    return { hallucinate: true, monsterGlyph: input.monster, objectGlyph: input.object };
  }
  if (rand.oneIn(128) && !input.permanentWall) {
    return { hallucinate: true, monsterGlyph: true, objectGlyph: false };
  }
  if (rand.oneIn(128) && !input.permanentWall) {
    /* The invented object is invisible under a sensed marker (see `sensed`). */
    return { hallucinate: true, monsterGlyph: false, objectGlyph: !input.sensed };
  }
  return { hallucinate: false, monsterGlyph: false, objectGlyph: false };
}

/** The monster table hallucinatory_monster rejects entries from. */
export interface HallucinationRacePool {
  /** `z_info->r_max`: the number of slots, index 0 (the player) included. */
  count: number;
  /** `race->name`: false for a hole upstream skips (ui-map.c L48). */
  named(ridx: number): boolean;
}

/** The kind table hallucinatory_object rejects entries from. */
export interface HallucinationKindPool {
  /** `z_info->k_max`: the number of slots. Index 0 is never selected. */
  count: number;
  /** `kind->name`: false for a hole upstream skips (ui-map.c L69). */
  named(kidx: number): boolean;
  /**
   * `kind_x_attr[kidx]` / `kind_x_char[kidx]`, the x_attr table and NOT the
   * flavour table - upstream is explicit that this is deliberate ("HACK -
   * without flavors", L71), so a hallucinated Potion of Speed shows the
   * unflavoured kind glyph rather than whatever colour that flavour rolled.
   * Return null for the `*a == 0 || *c == 0` rejection at L76.
   */
  glyph(kidx: number): { attr: number; char: string } | null;
}

/**
 * The bound both rejection loops give up at.
 *
 * Upstream writes `while (1)` and is safe doing so, because r_info and k_info
 * are compiled-in and always contain valid entries. Here the tables are
 * assembled at boot and a mod can replace them, so an empty or wholly invalid
 * table would spin forever inside the render loop - a hang with no frame drawn
 * and no way out. Rejecting after this many tries and returning null instead
 * costs a hallucinated glyph and keeps the game running. With the shipped
 * gamedata the loops terminate on the first or second try; this bound is never
 * approached.
 */
const REJECTION_LIMIT = 1000;

/**
 * hallucinatory_monster (ui-map.c L41-55): a uniform pick over the whole race
 * table, retried until it lands on a named entry.
 *
 * Index 0 is in the pool. That is upstream's behaviour and not an oversight:
 * r_info[0] is the `<player>` pseudo-race, so a hallucinating player genuinely
 * does see stray `@`s on the map.
 *
 * Returns the ridx rather than the glyph so the caller can resolve BOTH the
 * ASCII glyph and the tile from it. Upstream needs no such split because
 * monster_x_attr holds a tile code in graphics mode; this port keeps the two
 * tables apart (see glyph-table.ts), so the index is the common key.
 */
export function hallucinatoryMonster(
  pool: HallucinationRacePool,
  rand: HallucinationRandom,
): number | null {
  if (pool.count <= 0) return null;
  for (let tries = 0; tries < REJECTION_LIMIT; tries++) {
    const ridx = rand.randint0(pool.count);
    if (pool.named(ridx)) return ridx;
  }
  return null;
}

/**
 * hallucinatory_object (ui-map.c L61-80): `randint0(k_max - 1) + 1`, retried
 * until it lands on a named entry whose x_attr slot is non-empty.
 *
 * Note the `+ 1`: index 0 is excluded, because `first_kind = k_info` is the
 * sentinel map_info uses for an invented object and drawing it would be a
 * tell. Both rejection tests matter - a kind can be named and still have an
 * empty glyph slot, which is upstream's second `continue`.
 */
export function hallucinatoryObject(
  pool: HallucinationKindPool,
  rand: HallucinationRandom,
): number | null {
  if (pool.count <= 1) return null;
  for (let tries = 0; tries < REJECTION_LIMIT; tries++) {
    const kidx = rand.randint0(pool.count - 1) + 1;
    if (!pool.named(kidx)) continue;
    const g = pool.glyph(kidx);
    if (!g || g.attr === 0 || g.char === "" || g.char === "\0") continue;
    return kidx;
  }
  return null;
}
