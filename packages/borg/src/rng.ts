/**
 * The Borg's own RNG, isolated from the game's.
 *
 * Upstream, the borg runs its damage/attack simulations on the game's global
 * RNG but swaps in its own local seed first and restores the game's seed after
 * (reference/src/borg/borg.c ~L481-501), so its "what if I attacked" dry-runs
 * never advance the real game stream. Our engine has no global RNG - each stream
 * is a first-class instance (core/src/rng.ts) - so the Borg simply OWNS a
 * separate generator. This preserves both invariants at once:
 *
 *  1. Game determinism (the maintainer's #1 faithfulness concern): the Borg
 *     never draws from or perturbs the game's RNG.
 *  2. Borg behavior: simulations use the same quick-LCRNG the C borg used, from
 *     a fixed local seed, so dry-run rolls are reproducible per decision.
 *
 * The Borg reseeds this generator at the start of each think (reseed()) so a
 * decision's simulations are a pure function of its inputs, exactly as the C
 * borg's seed-swap made them.
 */

import { Rng } from "@neo-angband/core";

/**
 * The Borg's fixed local seed (upstream borg_rand_local is a constant so
 * simulations are stable). Any nonzero constant works; this value is arbitrary
 * but fixed for reproducibility.
 */
export const BORG_LOCAL_SEED = 0x00c0ffee;

/**
 * Create the Borg's simulation RNG: a quick-mode (LCRNG) generator, matching the
 * mode the C borg used for its local rolls. Seeded from BORG_LOCAL_SEED.
 */
export function makeBorgRng(seed: number = BORG_LOCAL_SEED): Rng {
  return new Rng(seed >>> 0, { quick: true });
}

/**
 * Reseed a Borg RNG in place to the given (or default) seed, so the next
 * simulation batch is reproducible. Mirrors the upstream per-think seed reset.
 */
export function reseedBorgRng(rng: Rng, seed: number = BORG_LOCAL_SEED): void {
  // Quick mode uses only the LCRNG `value`; setState restores it cleanly.
  rng.setState({
    quick: true,
    value: seed >>> 0,
    state: new Array(32).fill(0),
    stateI: 0,
    fixed: false,
    fixval: 0,
  });
}
