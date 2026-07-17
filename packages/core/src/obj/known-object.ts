/**
 * The per-object "known shadow" synthesis, ported from
 * reference/src/obj-knowledge.c (Angband 4.2.6).
 *
 * Upstream every live object carries a twin `obj->known`: a stripped struct
 * object holding only what the player has learned about it. object_desc reads
 * that twin wherever a value or a name must be gated by knowledge (the ego
 * name shows only if known->ego, the combat numbers come from known->to_h and
 * friends, etc.). The port DEFERRED the persistent twin; this module
 * synthesises an equivalent shadow ON DEMAND from the port's cumulative rune
 * knowledge model (Player.objKnown, i.e. upstream p->obj_k), by porting
 * object_set_base_known (L820) and player_know_object (L1022) line-for-line
 * onto the port's fields. desc.ts then reads the shadow exactly where upstream
 * reads obj->known, so names come out identical for identical knowledge.
 *
 * The progressive-ID entry points (obj-knowledge.c L860-1013) are ported to fit
 * this on-demand model:
 * - object_set_base_known is exported here for callers/tests.
 * - object_touch / object_grab (objectTouch / objectGrab) mark the live object
 *   ASSESSED - the bit that gates the fuller shadow - and fire the artifact-log
 *   and flavour-awareness side effects; the twin's own field writes are
 *   subsumed by objectKnownShadow. Their live call sites (stepping onto / over
 *   a floor pile, grabbing a monster's drop, quake/destruction object rubble)
 *   live in the world/game layer -> emitted as WIRING-NEEDED.
 * - object_see / object_sense (the known-cave floor OBJECT LIST) and
 *   update_player_object_knowledge (the twin re-sync + autoinscribe + inventory
 *   redraw) are world/UI concerns handled by game/known.ts (squareKnowPile /
 *   squareSensePile) and the port's knowledge-update sites, not a per-object
 *   twin; there is no separate obj-layer body for them.
 *
 * Synthesis notes (each ledgered inline):
 * - p->obj_k->dd/ds/ac (the "know dice"/"know ac" runes) are now real fields on
 *   Player.objKnown, ALWAYS 1: player_outfit (player-birth.c L584-596) grants
 *   them as obvious knowledge at birth and nothing ever learns them by use. The
 *   shadow multiplies the object's base dd/ds/ac by them exactly as upstream
 *   (obj-knowledge.c L830-838, L1039-1041), so base dice and armour of even an
 *   unidentified item are known from the start. See objectSetBaseKnown.
 * - The shadow has no independent `notice`; upstream obj->known->notice's
 *   ASSESSED bit is mirrored from the real object's notice. Under on-demand
 *   synthesis this is provably byte-identical to a persistent twin that carried
 *   its own notice: the only consumer of shadow.notice is its ASSESSED bit,
 *   read back within this same call, and it equals obj's ASSESSED bit because
 *   the port keeps the assessed state on the live object. So this is exact, not
 *   an approximation.
 * - object_flavor_aware side effects in player_know_object's jewelry and
 *   special-artifact branches (L1163-1175) are a knowledge-UPDATE, not part of
 *   describing an object. Firing them here would let a display path mutate the
 *   player's knowledge, so they are deliberately NOT fired in this synthesis;
 *   they are wired into the port's knowledge-update sites instead
 *   (playerKnowObjectAwareness in knowledge.ts, called from
 *   objectLearnUnknownRune). The shadow's own fields are unaffected.
 * - known->artifact: upstream object_touch (L963) sets it when the object is
 *   ASSESSED (touched / picked up), so the shadow gates obj.artifact on the
 *   ASSESSED notice bit - the artifact name reveals on touch while its powers
 *   stay hidden until their runes are learned, exactly as upstream.
 * - The is_unknown() placeholder path (obj->kind != obj->known->kind) is a
 *   game-list-layer concern in the port; object_desc always gets a real
 *   object, so it is not modelled here.
 */

import type { RandomValue } from "../rng";
import type { Player } from "../player/player";
import type { CurseData, GameObject } from "./object";
import {
  objectNew,
  cursesAreEqual,
  tvalCanHaveFlavor,
  tvalIsChest,
  tvalIsJewelry,
  tvalIsLauncher,
  tvalIsWearable,
} from "./object";
import type { RuneEnv } from "./knowledge";
import {
  OBJ_NOTICE,
  objectHasStandardToH,
  playerKnowsBrand,
  playerKnowsCurse,
  playerKnowsSlay,
} from "./knowledge";
import type { ObjectKind, ElementInfo } from "./types";
import { ELEM_MAX, OBJ_MOD_MAX } from "./types";

/**
 * The flavour-awareness view object_desc / the shadow synthesis need. Upstream
 * awareness lives on the shared object_kind template (kind->aware / kind->tried);
 * the port keeps it in a per-game FlavorKnowledge (obj/knowledge.ts) keyed by
 * kidx, so it is injected rather than read off the object or player.
 */
export interface KnownDesc {
  /** object_flavor_is_aware(obj): player knows this flavoured kind's identity. */
  isAware(kind: ObjectKind): boolean;
  /** object_flavor_was_tried(obj): a kind of this flavour has been tried. */
  isTried(kind: ObjectKind): boolean;
  /**
   * obj->kind->flavor != NULL: whether flavor_init assigned this kind a
   * flavour. Optional; when absent the tval-only kindHasFlavor is used (the
   * behaviour before flavor_init was wired). Every flavoured tval's kinds are
   * assigned a flavour, so the two agree in practice.
   */
  hasFlavor?(kind: ObjectKind): boolean;
  /** obj->kind->flavor->text: the "Smoky" adjective or scroll title. */
  flavorText?(kind: ObjectKind): string;
  /**
   * OPT(p, show_flavors): show the flavour even once aware. Defaults to true
   * (the upstream default), matching a game whose option is unset.
   */
  showFlavors?(): boolean;
  /**
   * ignore_item_ok(p, obj) (obj-ignore.c L622): whether the object is eligible
   * for ignoring right now, for the " {ignore}" / "ignore" description markers
   * (obj-desc.c L537, L630). Optional; when absent the markers are omitted (a
   * caller with no ignore environment, e.g. an omniscient/spoiled describe).
   */
  ignoreItemOk?(obj: GameObject): boolean;
}

/**
 * Whether an object's kind carries a flavour (upstream obj->kind->flavor, a
 * struct flavor pointer). The port does NOT bind the flavour<->kind link onto
 * ObjectKind, so this is approximated by tval_can_have_flavor_k (obj-tval.c
 * L322), which is exactly the set of tvals every kind of which is assigned a
 * flavour by flavor_init. DEFERRED: the flavour TEXT (adjective / scroll title)
 * remains unavailable; see desc.ts for how the missing '#' modstr is handled.
 */
export function kindHasFlavor(obj: GameObject): boolean {
  return tvalCanHaveFlavor(obj.tval);
}

/**
 * randcalc(v, MAX_RAND_DEPTH, MAXIMISE) for a RandomValue, evaluated purely
 * (the maximise aspect is deterministic: damcalc = dice*sides, mBonusCalc =
 * mBonus). rng.ts owns the general randcalc; this avoids threading an Rng.
 */
function randcalcMax(v: RandomValue): number {
  return v.base + v.dice * v.sides + v.mBonus;
}

/**
 * randcalc(v, MAX_RAND_DEPTH, MINIMISE), evaluated purely (damcalc minimise =
 * dice, mBonusCalc minimise = 0).
 */
function randcalcMin(v: RandomValue): number {
  return v.base + v.dice;
}

/** Allocate a zeroed curse-data array of `n` entries (mem_zalloc twin). */
function newCurseData(n: number): CurseData[] {
  const out: CurseData[] = [];
  for (let i = 0; i < n; i++) out.push({ power: 0, timeout: 0 });
  return out;
}

/**
 * object_set_base_known (obj-knowledge.c L820): set the basic details a player
 * always knows once an object is seen - kind/tval/sval/weight/number, the
 * generic dice and ac (gated by the "know dice"/"know ac" runes p->obj_k->dd/
 * ds/ac, which are always 1 from birth), the standard to-hit for armour,
 * launcher multipliers, and the pval/effect for aware flavours and unflavored
 * non-wearables.
 *
 * Mutates `shadow` in place.
 */
export function objectSetBaseKnown(
  shadow: GameObject,
  obj: GameObject,
  p: Player,
  env: RuneEnv,
  deps: KnownDesc,
): void {
  shadow.kind = obj.kind; // L823
  shadow.tval = obj.tval; // L824
  shadow.sval = obj.sval; // L825
  shadow.weight = obj.weight; // L826
  shadow.number = obj.number; // L827

  /* Generic dice and ac, gated by the dd/ds/ac runes (always 1 from birth). */
  if (!shadow.dd) shadow.dd = obj.kind.dd * p.objKnown.dd; // L830-832
  if (!shadow.ds) shadow.ds = obj.kind.ds * p.objKnown.ds; // L833-835
  if (!shadow.ac) shadow.ac = obj.kind.ac * p.objKnown.ac; // L836-838
  if (objectHasStandardToH(env, obj)) {
    shadow.toH = obj.kind.toH.base; // L839-841
  }
  if (tvalIsLauncher(obj.tval)) {
    shadow.pval = obj.pval; // L842-844
  }

  /* Aware flavours and unflavored non-wearables get info now (L846-851). */
  const flavored = kindHasFlavor(obj);
  if (
    (deps.isAware(obj.kind) && flavored) ||
    (!tvalIsWearable(obj.tval) && !flavored)
  ) {
    shadow.pval = obj.pval;
    shadow.effect = obj.effect;
  }

  /* Know standard activations for wearables (L853-856). */
  if (tvalIsWearable(obj.tval) && obj.kind.effect && deps.isAware(obj.kind)) {
    shadow.effect = obj.effect;
  }
}

/**
 * player_knows_ego (obj-knowledge.c L475): is `ego` known to the player, for
 * the specific object `obj` (obj lets a zero-valued modifier count as known
 * when the ego's modifier range straddles zero)?
 */
export function playerKnowsEgo(
  p: Player,
  ego: GameObject["ego"],
  obj: GameObject,
  env: RuneEnv,
): boolean {
  if (!ego) return false; // L480

  /* All flags known (L483): ego->flags subset of p->obj_k->flags. */
  if (!p.objKnown.flags.isSubset(ego.flags)) return false;

  /* All modifiers known (L486-504). */
  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    const mod = ego.modifiers[i];
    if (!mod) continue;
    const modmax = randcalcMax(mod);
    const modmin = randcalcMin(mod);
    if ((modmax > 0 || modmin < 0) && !(p.objKnown.modifiers[i] ?? 0)) {
      if (!obj || modmax * modmin > 0 || (obj.modifiers[i] ?? 0) !== 0) {
        return false;
      }
    }
  }

  /* All elements known (L507-509). */
  for (let i = 0; i < ELEM_MAX; i++) {
    if (
      (ego.elInfo[i]?.resLevel ?? 0) &&
      !(p.objKnown.elInfo[i]?.resLevel ?? 0)
    ) {
      return false;
    }
  }

  /* All brands known (L512-516). */
  for (let i = 1; i < env.brands.length; i++) {
    if (ego.brands && ego.brands[i] && !playerKnowsBrand(p, i)) return false;
  }

  /* All slays known (L519-523). */
  for (let i = 1; i < env.slays.length; i++) {
    if (ego.slays && ego.slays[i] && !playerKnowsSlay(p, i)) return false;
  }

  /* All curses known (L526-530). */
  for (let i = 1; i < env.curses.length; i++) {
    if (ego.curses && ego.curses[i] && !playerKnowsCurse(p, i)) return false;
  }

  return true;
}

/**
 * object_effect_is_known (obj-knowledge.c L540): the player knows the object's
 * effect when the shadow's effect chain is the real one. GameObject.effect is a
 * shared reference to the same EffectRecordJson[] (or null), so reference
 * equality matches upstream's obj->effect == obj->known->effect pointer test.
 */
export function objectEffectIsKnown(obj: GameObject, shadow: GameObject): boolean {
  return obj.effect === shadow.effect;
}

/**
 * object_non_curse_runes_known (obj-knowledge.c L678): are all non-curse runes
 * on `obj` reflected in its `shadow`?
 */
function objectNonCurseRunesKnown(
  obj: GameObject,
  shadow: GameObject,
  env: RuneEnv,
): boolean {
  /* Not all combat details known (L686-688). */
  if (shadow.toA !== obj.toA) return false;
  if (shadow.toH !== obj.toH) return false;
  if (shadow.toD !== obj.toD) return false;

  /* Not all modifiers known (L691-693). */
  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    if ((obj.modifiers[i] ?? 0) !== (shadow.modifiers[i] ?? 0)) return false;
  }

  /* Not all elements known (L696-699). */
  for (let i = 0; i < ELEM_MAX; i++) {
    if (
      (obj.elInfo[i]?.resLevel ?? 0) !== 0 &&
      (shadow.elInfo[i]?.resLevel ?? 0) === 0
    ) {
      return false;
    }
  }

  /* Not all brands known (L702-710). */
  if (obj.brands) {
    if (!shadow.brands) return false;
    for (let i = 0; i < env.brands.length; i++) {
      if (obj.brands[i] && !shadow.brands[i]) return false;
    }
  }

  /* Not all slays known (L713-721). */
  if (obj.slays) {
    if (!shadow.slays) return false;
    for (let i = 0; i < env.slays.length; i++) {
      if (obj.slays[i] && !shadow.slays[i]) return false;
    }
  }

  /* Not all flags known (L724): obj->flags subset of obj->known->flags. */
  if (!shadow.flags.isSubset(obj.flags)) return false;

  return true;
}

/**
 * object_runes_known (obj-knowledge.c L734), ported to compare the real object
 * against its synthesised shadow (upstream compares obj->known, which is filled
 * from the same rune knowledge). Named ...Upstream to distinguish it from the
 * existing reduced objectRunesKnown in knowledge.ts, which walks the rune list
 * over the player's knowledge directly rather than a per-object twin.
 */
export function objectRunesKnownUpstream(
  obj: GameObject,
  shadow: GameObject,
  _p: Player,
  env: RuneEnv,
): boolean {
  /* Not all curses known (L740-742). */
  if (!cursesAreEqual(obj, shadow)) return false;

  /* Answer is now the same as for non-curse runes (L745). */
  return objectNonCurseRunesKnown(obj, shadow, env);
}

/**
 * object_fully_known (obj-knowledge.c L754): all runes known AND the effect
 * known.
 */
export function objectFullyKnown(
  obj: GameObject,
  shadow: GameObject,
  p: Player,
  env: RuneEnv,
): boolean {
  if (!objectRunesKnownUpstream(obj, shadow, p, env)) return false; // L757
  if (!objectEffectIsKnown(obj, shadow)) return false; // L760
  return true;
}

/**
 * Synthesise the per-object known shadow (upstream obj->known) from the
 * player's cumulative rune knowledge. Ports object_set_base_known (L820) then
 * player_know_object (L1022) onto the port's fields; the shadow is a fresh
 * GameObject holding only what the player knows.
 *
 * @returns a shadow GameObject to be read wherever upstream reads obj->known.
 */
export function objectKnownShadow(
  obj: GameObject,
  p: Player,
  env: RuneEnv,
  deps: KnownDesc,
): GameObject {
  const shadow = objectNew(obj.kind);
  const assessed = (obj.notice & OBJ_NOTICE.ASSESSED) !== 0;
  /* The port keeps assessed state on the live object; mirror it (see docs -
   * byte-identical to a twin's own notice under on-demand synthesis). */
  shadow.notice = obj.notice;

  objectSetBaseKnown(shadow, obj, p, env, deps);

  /* Distant / unassessed objects just get base properties (L1033-1035). */
  if (!assessed) return shadow;

  /* Dice (gated by the dd/ds/ac runes, always 1), and the pval for anything but
   * chests (L1039-1043). */
  shadow.dd = obj.dd * p.objKnown.dd;
  shadow.ds = obj.ds * p.objKnown.ds;
  shadow.ac = obj.ac * p.objKnown.ac;
  if (!tvalIsChest(obj.tval)) shadow.pval = obj.pval;

  /* Combat details (L1046-1049). */
  shadow.toA = (p.objKnown.toA ? 1 : 0) * obj.toA;
  if (!objectHasStandardToH(env, obj)) {
    shadow.toH = (p.objKnown.toH ? 1 : 0) * obj.toH;
  }
  shadow.toD = (p.objKnown.toD ? 1 : 0) * obj.toD;

  /* Modifiers (L1052-1058). */
  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    shadow.modifiers[i] = (p.objKnown.modifiers[i] ?? 0)
      ? (obj.modifiers[i] ?? 0)
      : 0;
  }

  /* Elements (L1061-1069). */
  for (let i = 0; i < ELEM_MAX; i++) {
    const se = shadow.elInfo[i];
    if (!se) continue;
    if ((p.objKnown.elInfo[i]?.resLevel ?? 0) === 1) {
      se.resLevel = obj.elInfo[i]?.resLevel ?? 0;
      se.flags = obj.elInfo[i]?.flags ?? 0;
    } else {
      se.resLevel = 0;
      se.flags = 0;
    }
  }

  /* Object flags (L1072-1078): shadow.flags = obj.flags intersect obj_k. */
  shadow.flags.wipe();
  for (const flag of p.objKnown.flags) {
    if (obj.flags.has(flag)) shadow.flags.on(flag);
  }

  /* Brands (L1086-1106). */
  if (obj.brands) {
    let knownBrand = false;
    for (let i = 1; i < env.brands.length; i++) {
      if (playerKnowsBrand(p, i) && obj.brands[i]) {
        if (!shadow.brands) {
          shadow.brands = new Array<boolean>(env.brands.length).fill(false);
        }
        shadow.brands[i] = true;
        knownBrand = true;
      } else if (shadow.brands) {
        shadow.brands[i] = false;
      }
    }
    if (!knownBrand) shadow.brands = null;
  }

  /* Slays (L1109-1129). */
  if (obj.slays) {
    let knownSlay = false;
    for (let i = 1; i < env.slays.length; i++) {
      if (playerKnowsSlay(p, i) && obj.slays[i]) {
        if (!shadow.slays) {
          shadow.slays = new Array<boolean>(env.slays.length).fill(false);
        }
        shadow.slays[i] = true;
        knownSlay = true;
      } else if (shadow.slays) {
        shadow.slays[i] = false;
      }
    }
    if (!knownSlay) shadow.slays = null;
  }

  /* Curses (L1131-1153). */
  if (obj.curses) {
    let knownCursed = false;
    for (let i = 1; i < env.curses.length; i++) {
      if ((p.objKnown.curses[i] ?? 0) && (obj.curses[i]?.power ?? 0)) {
        if (!shadow.curses) shadow.curses = newCurseData(env.curses.length);
        const sc = shadow.curses[i];
        if (sc) sc.power = obj.curses[i]?.power ?? 0;
        knownCursed = true;
      } else if (shadow.curses) {
        const sc = shadow.curses[i];
        if (sc) sc.power = 0;
      }
    }
    if (!knownCursed) shadow.curses = null;
  } else if (shadow.curses) {
    shadow.curses = null;
  }

  /* Ego type, if known (L1156-1161). */
  shadow.ego = playerKnowsEgo(p, obj.ego, obj, env) ? obj.ego : null;

  /* Jewellery / special-artifact awareness (L1163-1175): the
   * object_flavor_aware side effect is a knowledge-UPDATE and is deliberately
   * NOT fired here - this is a display-only synthesis and must never mutate the
   * player's knowledge. It is wired at the knowledge-update sites instead
   * (playerKnowObjectAwareness, knowledge.ts). The shadow's fields are
   * unaffected by it. */

  /* Ensure effect is known as if object_set_base_known had run (L1178-1182). */
  const flavored = kindHasFlavor(obj);
  if (
    (deps.isAware(obj.kind) && flavored) ||
    (!tvalIsWearable(obj.tval) && !flavored) ||
    (tvalIsWearable(obj.tval) && obj.kind.effect && deps.isAware(obj.kind))
  ) {
    shadow.effect = obj.effect;
  }

  /* known->artifact (object_touch L963): the artifact is automatically
   * noticed when the object is ASSESSED (touched / picked up), NOT when its
   * runes are fully known - so an assessed artifact shows its name while its
   * powers stay hidden until learned, exactly as upstream. */
  shadow.artifact = obj.artifact && assessed ? obj.artifact : null;
  const fullyKnown = objectFullyKnown(obj, shadow, p, env);

  /* Fully known objects mirror the real element and flag info (L1203-1210). */
  if (fullyKnown) {
    for (let i = 0; i < ELEM_MAX; i++) {
      const se = shadow.elInfo[i];
      const oe = obj.elInfo[i];
      if (se && oe) {
        se.resLevel = oe.resLevel;
        se.flags = oe.flags;
      }
    }
    shadow.flags.copy(obj.flags);
  }

  return shadow;
}

/**
 * object_is_known_artifact (obj-knowledge.c L552): whether the object is known
 * to be an artifact. Reads the shadow's artifact field (set from the ASSESSED
 * bit in objectKnownShadow), matching upstream's obj->known->artifact.
 */
export function objectIsKnownArtifact(shadow: GameObject): boolean {
  return shadow.artifact !== null;
}

/* ------------------------------------------------------------------ */
/* Progressive object-knowledge hooks (obj-knowledge.c L860-1013)       */
/* ------------------------------------------------------------------ */

/**
 * The side effects object_touch / object_grab fire beyond marking the object
 * assessed, injected so this obj-layer helper stays free of the player-history
 * ledger and the flavour/rune knowledge-update path.
 */
export interface ObjectTouchDeps {
  /**
   * history_find_artifact (obj-knowledge.c L971): log that the player has now
   * seen artifact `aidx`. Fired only for an artifact object.
   */
  onArtifactFound?(aidx: number): void;
  /**
   * player_know_object's flavour-awareness side effect (obj-knowledge.c
   * L967 -> L1163-1175), i.e. playerKnowObjectAwareness(p, env, obj, ...) built
   * by the caller. The rest of player_know_object (the obj->known twin writes)
   * is synthesised on demand by objectKnownShadow, so only this awareness half
   * needs firing here.
   */
  onKnow?(obj: GameObject): void;
}

/**
 * object_touch (obj-knowledge.c L960): gain knowledge from being on the same
 * square as an object (or picking it up). Upstream sets obj->known->artifact,
 * marks obj->known ASSESSED, runs player_know_object, and logs a found artifact.
 *
 * The port keeps ASSESSED on the LIVE object (the fuller known shadow is gated
 * by it - objectKnownShadow L350, desc.ts) and synthesises obj->known on
 * demand, so this reduces to: set ASSESSED (which also reveals the artifact
 * name via the shadow's assessed gate), fire the awareness half of
 * player_know_object, then log the artifact. Draws no RNG.
 */
export function objectTouch(obj: GameObject, deps: ObjectTouchDeps = {}): void {
  /* obj->known->artifact = obj->artifact (L963) is subsumed by the shadow's
   * ASSESSED gate (objectKnownShadow L477); marking ASSESSED is enough. */
  obj.notice |= OBJ_NOTICE.ASSESSED; // L964

  /* player_know_object(p, obj) (L967): only the awareness side effect needs a
   * home here (the twin is on-demand). */
  deps.onKnow?.(obj);

  /* Log artifacts if found (L970-971). */
  if (obj.artifact) deps.onArtifactFound?.(obj.artifact.aidx);
}

/**
 * object_grab (obj-knowledge.c L978): gain knowledge from grabbing an object
 * off a monster. Upstream's body is known-cave floor-list bookkeeping (making /
 * relocating the obj->known twin and its object_set_base_known fill) followed by
 * object_touch (L1012). In the port the known-cave floor list is maintained by
 * the world layer (game/known.ts squareKnowPile / object_see) and the twin is
 * on demand, so grabbing reduces to object_touch. Draws no RNG.
 */
export function objectGrab(obj: GameObject, deps: ObjectTouchDeps = {}): void {
  objectTouch(obj, deps);
}
