/**
 * Game-layer bridge for item inspection: assemble the ObjectInfoDeps that the
 * pure obj/object-info.ts engine needs from a live GameState plus the registry
 * bits a GameState does not carry (the projection table, the monster-race
 * origin lookup and the effect registry). Mirrors describe.ts's describeObject
 * bridge, and keeps the heavy calc / effect / combat imports out of describe.ts
 * (avoiding an import cycle through obj-cmd).
 *
 * PURE READ: every closure it builds is deterministic and RNG-free. The
 * hypothetical calc_bonuses re-derive passes update=false with the
 * statIndBoost hack; buildObjectEffectChain and describeEffect are RNG-safe by
 * construction (dice are read, never rolled); getUseDeviceChance and
 * breakageChance are pure. See obj/object-info.test.ts for the invariance guard.
 */

import { calcBonuses } from "../player/calcs";
import type { PlayerState } from "../player/calcs";
import type { Constants } from "../constants";
import { OBJ_PROPERTY } from "../obj/types";
import type { GameObject } from "../obj/object";
import type { ProjectionInfo } from "../world/projection";
import { describeEffect as describeEffectChain } from "../effects/effect-info";
import type { EffectDescribeDeps } from "../effects/effect-info";
import {
  OINFO,
  objectInfo,
  type ObjectInfoDeps,
  type OriginRace,
  type Textblock,
} from "../obj/object-info";
import { breakageChance } from "../combat/ranged";
import { calcDiggingChances } from "./cave-cmd";
import { gearGet, wieldSlot } from "./gear";
import {
  buildObjectEffectChain,
  effectRecordsNeedAim,
  getUseDeviceChance,
} from "./obj-cmd";
import { turnEnergy } from "./energy";
import { isDaytime } from "./world";
import type { GameState } from "./context";
import { knownDescOf } from "./describe";

/** Registry-only data the engine needs that a GameState does not carry. */
export interface ObjectInfoExtras {
  /** reg.projections (PROJ-indexed ProjectionInfo[]) for elements + effects. */
  projections: readonly ProjectionInfo[];
  /** reg.constants: the full z_info (fuel_lamp + the O-combat crit tables). */
  constants: Constants;
  /** Resolve GameObject.originRace (a handle) to a race name + flags. */
  raceOrigin?(handle: number): OriginRace | null;
  /** timed_effects[idx].desc, for EFINFO_CURE / EFINFO_TIMED effect text. */
  timedDesc?(tmdIndex: number): string;
  /** summon_desc(idx), for EFINFO_SUMM effect text. */
  summonDesc?(summonIndex: number): string;
}

function statName(state: GameState, statIndex: number): string {
  for (const p of state.runeEnv.properties) {
    if (p && p.type === OBJ_PROPERTY.STAT && p.propIndex === statIndex) {
      return p.name;
    }
  }
  return "";
}

/** Build the ObjectInfoDeps for inspecting `obj` in the current game. */
export function makeObjectInfoDeps(
  state: GameState,
  obj: GameObject,
  extras: ObjectInfoExtras,
): ObjectInfoDeps {
  const player = state.actor.player;
  const timedEffects = state.world?.timedTable ?? [];
  const daytime = isDaytime(state.turn, state.z.dayLength);

  const equipObjects = player.equipment.map((h) =>
    h ? gearGet(state.gear, h) : null,
  );

  /* The live derived state (update=true, no boost), matching refreshDerived. */
  const liveState: PlayerState =
    state.playerState ??
    calcBonuses(player, {
      equipment: equipObjects,
      timedEffects,
      update: true,
      depth: state.chunk.depth,
      isDaytime: daytime,
    });

  const deriveState = (
    equip: readonly (GameObject | null)[],
    strBoost: number,
    dexBoost: number,
  ): PlayerState =>
    calcBonuses(player, {
      equipment: equip.slice(),
      timedEffects,
      update: false,
      depth: state.chunk.depth,
      isDaytime: daytime,
      statIndBoost: { str: strBoost, dex: dexBoost },
    });

  const weaponSlot = player.body.slots.findIndex((s) => s.type === "WEAPON");
  const bowSlot = player.body.slots.findIndex((s) => s.type === "BOW");
  const bow = bowSlot >= 0 ? (equipObjects[bowSlot] ?? null) : null;

  /* object_effect(obj) chain, built once (RNG-free). */
  const effRecords = obj.activation?.effect ?? obj.effect ?? null;
  const chain = effRecords ? buildObjectEffectChain(effRecords, state) : null;
  const effectDeps: EffectDescribeDeps = {
    projections: extras.projections,
    playerLevel: player.lev,
    foodValue: extras.constants.foodValue,
    statName: (i) => statName(state, i),
    ...(extras.timedDesc ? { timedDesc: extras.timedDesc } : {}),
    ...(extras.summonDesc ? { summonDesc: extras.summonDesc } : {}),
  };

  const deps: ObjectInfoDeps = {
    player,
    env: state.runeEnv,
    known: knownDescOf(state),
    projections: extras.projections,
    z: {
      fuelLamp: extras.constants.fuelLamp,
      maxRange: extras.constants.maxRange,
      oMeleeCritical: extras.constants.oMeleeCritical,
      oRangedCritical: extras.constants.oRangedCritical,
    },
    percentDamage: state.options?.get("birth_percent_damage") ?? false,
    randarts: state.options?.get("birth_randarts") ?? false,
    currentState: liveState,
    speedMultiplier: turnEnergy(liveState.speed),
    equipObjects,
    bow,
    weaponSlot,
    wieldSlot: (o) => wieldSlot(player.body, o.tval, player.equipment),
    deriveState,
    breakageChance: (o) => breakageChance(o, true),
    calcDiggingChances,
    effect: {
      aimed: effRecords ? effectRecordsNeedAim(effRecords) : false,
      deviceFailure: getUseDeviceChance(state, obj),
      describe: (prefix, boost, onlyFirst) =>
        describeEffectChain(chain, prefix, boost, onlyFirst, effectDeps),
    },
    ...(extras.raceOrigin ? { raceOrigin: extras.raceOrigin } : {}),
  };
  return deps;
}

/** object_info(obj, OINFO_SUBJ): the inspection run-stream for a live object. */
export function objectInfoTextblock(
  state: GameState,
  obj: GameObject,
  extras: ObjectInfoExtras,
): Textblock {
  return objectInfo(obj, OINFO.SUBJ, makeObjectInfoDeps(state, obj, extras));
}
