/**
 * buildLoreColorState: assemble the LoreColorState (mon/lore-describe.ts) that
 * spell_color / blow_color read, from the live GameState. Upstream's spell_color
 * / blow_color (mon-lore.c L59-276) pull the resist / protection / save-skill /
 * stat_ind values off the global player's known_state and scan p->upkeep->inven
 * / the light slot; this reproduces that from the port's derived player_state
 * (state.playerState, whose equipment contributions are already rune-gated per
 * decision 25) and the gear store, so the recall viewer colours a monster's
 * spells and blows by whether the player actually resists them.
 *
 * The bound timed-effect table is passed in (GameState does not carry it, same
 * as effect-env.ts) so the EF_TIMED_INC branch of spell_color can run the real
 * player_inc_check (player/timed.ts) against the derived state.
 */

import { ELEM, OF, PF, STAT, TMD } from "../generated";
import { adj_dex_safe } from "../player/calcs";
import { playerIncCheck } from "../player/timed";
import type { PlayerIncCheckQueries } from "../player/timed";
import { SKILL } from "../player/types";
import type { TimedEffect } from "../player/types";
import { tvalCanHaveCharges, tvalIsEdible } from "../obj/object";
import { gearGet } from "./gear";
import type { LoreColorState } from "../mon/lore-describe";
import type { GameState } from "./context";

/** Map a generated-enum name to its index, or -1 when absent. */
function enumIndex(table: Record<string, number>, name: string): number {
  const idx = table[name];
  return idx === undefined ? -1 : idx;
}

/**
 * Build the LoreColorState for the current player. `timedTable` is the bound
 * player-timed effect table (player/bind.ts), used only for the EF_TIMED_INC
 * spell_color branch; an empty table makes every timed effect appear able to
 * land (the recolouring then behaves like a player with no protection).
 */
export function buildLoreColorState(
  state: GameState,
  timedTable: readonly TimedEffect[] = [],
): LoreColorState {
  const p = state.actor.player;
  const ps = state.playerState;

  const resLevel = (elem: number): number => ps?.elInfo[elem]?.resLevel ?? 0;
  const hasFlag = (of: number): boolean => (ps ? ps.flags.has(of) : false);

  /* player_inc_check queries over the derived state (player/timed.ts). */
  const queries: PlayerIncCheckQueries = {
    objectFlag: (name) => {
      const i = enumIndex(OF as Record<string, number>, name);
      return i >= 0 && hasFlag(i);
    },
    resistLevel: (name) => resLevel(enumIndex(ELEM as Record<string, number>, name)),
    playerFlag: (name) => {
      const i = enumIndex(PF as Record<string, number>, name);
      return i >= 0 && (ps ? ps.pflags.has(i) : false);
    },
    timedActive: (name) => {
      const i = enumIndex(TMD as Record<string, number>, name);
      return i >= 0 && (p.timed[i] ?? 0) > 0;
    },
  };
  const byName = new Map<string, TimedEffect>();
  for (const e of timedTable) byName.set(e.name, e);
  const incCheck = (timedName: string): boolean => {
    const eff = byName.get(timedName);
    /* No bound effect -> treat as landable (full danger), matching a bare
       resistance-less player (effect-env.ts's absent-incQueries default). */
    return eff ? playerIncCheck(eff, queries) : true;
  };

  /* p->lev + adj_dex_safe[stat_ind[STAT_DEX]] >= 100 (mon-lore.c L208). */
  const dexInd = ps?.statInd[STAT.DEX] ?? 0;
  const theftSafe = p.lev + (adj_dex_safe[dexInd] ?? 0) >= 100;

  /* Pack scans (mon-lore.c L216-242): a chargeable item with charges, and any
     edible item. Equipped objects are not in gear.pack, matching p->upkeep->inven. */
  let hasChargeItem = false;
  let hasEdible = false;
  for (const handle of state.gear.pack) {
    const o = gearGet(state.gear, handle);
    if (!o) continue;
    if (tvalCanHaveCharges(o.tval) && o.pval) hasChargeItem = true;
    if (tvalIsEdible(o.tval)) hasEdible = true;
  }

  /* eat-light (mon-lore.c L243-250): the wielded light burns fuel. */
  const lightSlot = p.body.slots.findIndex((s) => s.type === "LIGHT");
  const lightObj = lightSlot >= 0 ? gearGet(state.gear, p.equipment[lightSlot] ?? 0) : null;
  const lightBurning = !!(
    lightObj &&
    lightObj.timeout &&
    !lightObj.flags.has(OF.NO_FUEL)
  );

  return {
    saveSkill: ps?.skills[SKILL.SAVE] ?? 0,
    resLevel,
    hasFlag,
    incCheck,
    theftSafe,
    hasChargeItem,
    hasEdible,
    lightBurning,
  };
}
