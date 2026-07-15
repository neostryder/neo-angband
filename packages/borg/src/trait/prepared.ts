/**
 * borg_prepared / borg_restock - the depth-readiness gate
 * (reference/src/borg/borg-prepared.c). borg_prepared(depth) returns a reason
 * string when the Borg is NOT ready to be at `depth`, or null when it is ready.
 * borg_power uses it to reward being prepared for deeper levels.
 *
 * Faithful port of the non-dynamic (borg_cfg[BORG_USES_DYNAMIC_CALCS] == false)
 * path, reading ctx.world.self.trait[], the derived has[] map, config and the
 * home seam. The live-unique / Morgoth gating (borg_numb_live_unique,
 * borg_first_living_unique, r_info names, borg_t) is tracking state the world
 * model does not yet expose; it is modelled by the uniques seam (default: no
 * uniques hunted), so those tail branches resolve to "ready" as they do with
 * the stock borg_kills_uniques = false.
 */

import type { BorgContext } from "../context";
import {
  BI,
  CLASS_WARRIOR,
  CLASS_BLACKGUARD,
  CLASS_ROGUE,
  CLASS_PRIEST,
  CLASS_DRUID,
  CLASS_PALADIN,
  CLASS_RANGER,
  CLASS_MAGE,
  CLASS_NECROMANCER,
  spellStatForClass,
} from "./trait-index";
import { resolveOpts, type BorgTraitOpts, type ResolvedOpts } from "./config";
import { getDerived, has, type BorgDerived } from "./state";

/**
 * borg_prepared - is the Borg ready to dive to `depth`? Returns the blocking
 * reason, or null when prepared (borg-prepared.c:538).
 */
export function borgPrepared(
  ctx: BorgContext,
  depth: number,
  opts: BorgTraitOpts = {},
): string | null {
  const R = resolveOpts(opts);
  const t = ctx.world.self.trait;
  const d = getDerived(ctx.world);

  /* Town and first level (borg-prepared.c:543). */
  if (depth === 1) return null;

  /* Not prepared if I need to restock (borg-prepared.c:557). */
  const restock = borgRestock(ctx, depth, opts);
  if (restock) return restock;

  /* Clevel must be >= depth (borg-prepared.c:561). */
  if (t[BI.MAXCLEVEL]! < depth && t[BI.MAXCLEVEL]! < 50) return "Clevel < depth";

  /* Minimal requirements (borg-prepared.c:565). */
  if (depth <= 99) {
    const reason = borgPreparedAux(t, d, R, depth);
    if (reason) return reason;
  }

  /* No-deeper cap (borg-prepared.c:571). */
  if (depth >= R.cfg.noDeeper) return `No deeper ${R.cfg.noDeeper}.`;

  /* Once Morgoth is dead (borg-prepared.c:579). */
  if (t[BI.KING]) return null;

  /* Always okay from town (borg-prepared.c:584). */
  if (!t[BI.CDEPTH]) return null;

  /* Scum depth 80+ for *heal* potions (borg-prepared.c:588). */
  if (
    depth >= 82 &&
    R.home.numEzheal + R.home.numLife < 10 &&
    t[BI.AEZHEAL]! + t[BI.ALIFE]! < 10
  ) {
    return `Scumming *Heal* potions (${10 - R.home.numEzheal} to go).`;
  }

  if (depth >= 82 && t[BI.MAXDEPTH]! >= 97) {
    const heals =
      R.home.numEzhealTrue + t[BI.AEZHEAL]! + R.home.numLifeTrue + t[BI.ALIFE]!;
    if (heals < 30) return `Scumming *Heal* potions (${30 - heals} to go).`;
    if (
      t[BI.AEZHEAL]! + t[BI.ALIFE]! < 30 &&
      heals >= 30 &&
      R.home.numEzhealTrue >= 1 &&
      t[BI.MAXDEPTH]! >= 99
    ) {
      return `Collect from house (${R.home.numEzhealTrue + R.home.numLifeTrue} potions).`;
    }
  }

  /* Live-unique / Morgoth gating (borg-prepared.c:627): modelled by seam;
   * with stock borg_kills_uniques = false this resolves to "ready". */
  return null;
}

/** borg_prepared_aux - minimum requirements per depth band (prepared.c:46). */
function borgPreparedAux(
  t: number[],
  d: BorgDerived,
  R: ResolvedOpts,
  depth: number,
): string | null {
  const risky = R.cfg.playsRisky;
  const cls = t[BI.CLASS]!;
  const spellStat = spellStatForClass(cls);

  if (t[BI.KING]) return null;
  if (!depth) return null;

  /* Level 1 essentials. */
  if (t[BI.LIGHT]! < 1) return "1 Lite";
  if (t[BI.FOOD]! < 5) return "5 Food";
  if (depth <= 1) return null;

  /* Level 2. */
  if (t[BI.AFUEL]! < 5 && !t[BI.LIGHT]) return "5 Fuel";
  if (!risky) {
    if (t[BI.MAXHP]! < 30) return "30 hp";
  }
  if (depth <= 2) return null;

  /* Level 3-4. */
  if (!risky) {
    switch (cls) {
      case CLASS_WARRIOR:
      case CLASS_BLACKGUARD:
        if (t[BI.MAXHP]! < 50) return "50 hp";
        if (t[BI.MAXCLEVEL]! < 4) return "4 clevel";
        break;
      case CLASS_ROGUE:
        if (t[BI.MAXHP]! < 50) return "50 hp";
        if (t[BI.MAXCLEVEL]! < 8) return "8 clevel";
        break;
      case CLASS_PRIEST:
      case CLASS_DRUID:
        if (t[BI.MAXHP]! < 40) return "40 hp";
        if (t[BI.MAXCLEVEL]! < 9) return "9 level";
        break;
      case CLASS_PALADIN:
        if (t[BI.MAXHP]! < 50) return "50 hp";
        if (t[BI.MAXCLEVEL]! < 4) return "4 clevel";
        break;
      case CLASS_RANGER:
        if (t[BI.MAXHP]! < 50) return "50 hp";
        if (t[BI.MAXCLEVEL]! < 4) return "4 clevel";
        break;
      case CLASS_MAGE:
      case CLASS_NECROMANCER:
        if (t[BI.MAXHP]! < 60) return "60 hp";
        if (t[BI.MAXCLEVEL]! < 11) return "11 clevel";
        break;
    }
  }
  if (t[BI.MAXCLEVEL]! < 30 && t[BI.ACLW]! + t[BI.ACSW]! + t[BI.ACCW]! < 2)
    return "2 cure";
  if (depth <= 4) return null;

  /* Level 5-9. */
  if (!risky && t[BI.CDEPTH]) {
    switch (cls) {
      case CLASS_WARRIOR:
      case CLASS_BLACKGUARD:
        if (t[BI.MAXHP]! < 60) return "60 hp";
        if (t[BI.MAXCLEVEL]! < 6) return "6 clevel";
        break;
      case CLASS_ROGUE:
        if (t[BI.MAXHP]! < 60) return "60 hp";
        if (t[BI.MAXCLEVEL]! < 10) return "10 clevel";
        break;
      case CLASS_PRIEST:
      case CLASS_DRUID:
        if (t[BI.MAXHP]! < 60) return "60 hp";
        if (t[BI.MAXCLEVEL]! < 15) return "15 clevel";
        break;
      case CLASS_PALADIN:
        if (t[BI.MAXHP]! < 60) return "60 hp";
        if (t[BI.MAXCLEVEL]! < 6) return "6 clevel";
        break;
      case CLASS_RANGER:
        if (t[BI.MAXHP]! < 60) return "60 hp";
        if (t[BI.MAXCLEVEL]! < 6) return "6 clevel";
        break;
      case CLASS_MAGE:
      case CLASS_NECROMANCER:
        if (t[BI.MAXHP]! < 80) return "80 hp";
        if (t[BI.MAXCLEVEL]! < 15) return "15 level";
        break;
    }
  }
  if (t[BI.MAXCLEVEL]! < 30 && t[BI.ACLW]! + t[BI.ACSW]! + t[BI.ACCW]! < 2)
    return "2 cures (clw + csw + ccw)";
  if (t[BI.RECALL]! < 1) return "1 recall";
  if (depth <= 9) return null;

  /* Level 10-19. */
  if (t[BI.LIGHT]! < 2 && cls !== CLASS_NECROMANCER) return "2 light radius";
  if (t[BI.ATELEPORT]! + t[BI.AESCAPE]! < 2) return "2 tele + teleport staffs";
  if (!risky) {
    switch (cls) {
      case CLASS_WARRIOR:
      case CLASS_BLACKGUARD:
        if (t[BI.MAXCLEVEL]! < depth - 4 && depth <= 19) return "dlevel - 4 >= clevel";
        break;
      case CLASS_ROGUE:
      case CLASS_PRIEST:
      case CLASS_DRUID:
      case CLASS_PALADIN:
      case CLASS_RANGER:
        if (t[BI.MAXCLEVEL]! < depth && depth <= 19) return "dlevel >= clevel";
        break;
      case CLASS_MAGE:
      case CLASS_NECROMANCER:
        if (t[BI.MAXCLEVEL]! < depth + 5 && t[BI.MAXCLEVEL]! <= 28)
          return "dlevel + 5 > = clevel";
        break;
    }
  }
  if (t[BI.MAXCLEVEL]! < 30 && t[BI.ACCW]! < 3) return "ccw < 3";
  if (!t[BI.SINV] && !t[BI.DINV] && !t[BI.ESP]) return "See Invis : ESP";
  if (depth <= 19) return null;

  /* Level 20. */
  if (!t[BI.FRACT]) return "free action";
  if (depth <= 20) return null;

  /* Level 25. */
  if (!t[BI.SRFIRE]) return "resist fire";
  {
    const basics = t[BI.RACID]! + t[BI.RCOLD]! + t[BI.RELEC]!;
    if (basics < 2) return "2 basic resists";
  }
  if (t[BI.STR]! < 7) return "low STR";
  if (spellStat !== -1 && t[BI.STR + spellStat]! < 7) return "low spell stat";
  if (t[BI.DEX]! < 7) return "low DEX";
  if (t[BI.CON]! < 7) return "low CON";
  if (!risky) {
    switch (cls) {
      case CLASS_WARRIOR:
      case CLASS_BLACKGUARD:
        if (t[BI.MAXCLEVEL]! < depth + 5 && t[BI.MAXCLEVEL]! <= 38)
          return "dlevel + 5 >= clevel";
        break;
      case CLASS_ROGUE:
        if (t[BI.MAXCLEVEL]! < depth + 10 && t[BI.MAXCLEVEL]! <= 43)
          return "dlevel + 10 >= clevel";
        break;
      case CLASS_PRIEST:
      case CLASS_DRUID:
        if (t[BI.MAXCLEVEL]! < depth + 13 && t[BI.MAXCLEVEL]! <= 46)
          return "dlevel + 13 >= clevel";
        break;
      case CLASS_PALADIN:
        if (t[BI.MAXCLEVEL]! < depth + 7 && t[BI.MAXCLEVEL]! <= 40)
          return "dlevel + 7 >= clevel";
        break;
      case CLASS_RANGER:
        if (
          t[BI.MAXCLEVEL]! < depth + 8 &&
          t[BI.MAXCLEVEL]! <= 41 &&
          t[BI.MAXCLEVEL]! > 28
        )
          return "dlevel + 8 >= clevel";
        break;
      case CLASS_MAGE:
      case CLASS_NECROMANCER:
        if (t[BI.MAXCLEVEL]! < depth + 8 && t[BI.MAXCLEVEL]! <= 38)
          return "dlevel + 8 >= clevel";
        if (
          (t[BI.MAXCLEVEL]! - 38) * 2 + 30 < depth &&
          t[BI.MAXCLEVEL]! <= 44 &&
          t[BI.MAXCLEVEL]! > 38
        )
          return "(clevel-38)*2+30 < dlevel";
        break;
    }
  }
  if (depth <= 25) return null;

  /* Level 25-39. */
  if (!t[BI.SRCOLD]) return "resist cold";
  if (!t[BI.SRELEC]) return "resist elec";
  if (!t[BI.SRACID]) return "resist acid";
  if (t[BI.ATELEPORT]! + t[BI.AESCAPE]! < 6) return "6 tell + telep staffs";
  if (t[BI.MAXCLEVEL]! < 30 && t[BI.ACCW]! + t[BI.ACSW]! < 10) return "10 ccw + csw";
  if (depth <= 33) return null;
  if (t[BI.MAXCLEVEL]! < 40 && !risky) return "level 40";
  if (depth <= 39) return null;

  /* Level 40-45. */
  if (!t[BI.SRPOIS]) return "resist pois";
  if (!t[BI.SRCONF]) return "resist conf";
  if (t[BI.STR]! < 16) return "STR < 16";
  if (spellStat !== -1 && t[BI.STR + spellStat]! < 16) return "spell stat < 16";
  if (t[BI.DEX]! < 16) return "dex < 16";
  if (t[BI.CON]! < 16) return "con < 16";
  if (depth <= 45) return null;

  /* Level 46-55. */
  if (t[BI.SPEED]! < 115) return "+5 speed";
  if (t[BI.AHEAL]! < 1 && t[BI.AEZHEAL]! < 1) return "1 heal";
  if (!risky && t[BI.MAXHP]! < 500) return "HP 500";
  if (t[BI.STR]! < 18 + 40) return "str < 18(40)";
  if (spellStat !== -1 && t[BI.STR + spellStat]! < 18 + 100)
    return "spell stat needs to be max";
  if (t[BI.DEX]! < 18 + 60) return "dex < 18 (60)";
  if (t[BI.CON]! < 18 + 60) return "con < 18 (60)";
  if (!t[BI.SHLIFE] && t[BI.MAXCLEVEL]! < 50) return "hold life";
  if (depth <= 55) return null;

  /* Level 55-59. */
  if (t[BI.AHEAL]! < 2 && t[BI.AEZHEAL]! < 1) return "2 heal + *heal*";
  if (!t[BI.SRBLIND]) return "resist blind";
  if (!t[BI.ESP]) return "ESP";
  if (depth <= 59) return null;

  /* Level 61-80. */
  if (t[BI.SPEED]! < 120) return "+10 speed";
  if (!t[BI.SRKAOS]) return "resist chaos";
  if (!t[BI.SRDIS]) return "resist disenchant";
  if (depth <= 80) return null;

  /* Level 81-85. */
  if (t[BI.SPEED]! < 130) return "+20 Speed";
  if (depth <= 85) return null;

  /* Level 86-99. */
  if (depth <= 99) return null;

  /* Level 100. */
  if (!t[BI.KING]) {
    if (t[BI.MAXSP]! > 100 && has(d, "potion_restore_mana") < 15)
      return "10 restore mana";
    if (has(d, "potion_healing") < 5) return "5 Heal";
    if (t[BI.AEZHEAL]! + t[BI.ALIFE]! < 15) return "15 *heal* or life";
    if (t[BI.ASPEED]! < 10) return "10 speed potions";
  }
  if (depth <= 127) return null;
  return null;
}

/**
 * borg_restock - out of crucial supplies? (borg-prepared.c:694). The just-
 * arrived-at-100 turn check (borg_t - borg_began) is level-timing state not in
 * scope; treated as "not just arrived".
 */
export function borgRestock(
  ctx: BorgContext,
  depth: number,
  opts: BorgTraitOpts = {},
): string | null {
  const R = resolveOpts(opts);
  const t = ctx.world.self.trait;
  const d = getDerived(ctx.world);
  const cls = t[BI.CLASS]!;

  /* Level 1. */
  if (t[BI.LIGHT]! < 1) return "restock light radius < 1";
  if (t[BI.AFUEL]! < 1 && !t[BI.LIGHT]) return "restock fuel";
  if (depth <= 1) return null;

  /* Level 2-3. */
  if (t[BI.AFUEL]! < 2 && !t[BI.LIGHT]) return "restock fuel < 2";
  if (t[BI.FOOD]! < 3) return "restock food < 3";
  if (depth <= 3) return null;

  /* Level 3-5. */
  if (depth <= 5) return null;

  /* Level 6-9. */
  if (t[BI.APHASE]! < 1) return "restock phase door";
  if (t[BI.MAXCLEVEL]! < 30 && t[BI.ACLW]! + t[BI.ACSW]! + t[BI.ACCW]! < 1)
    return "restock clw+csw+ccw";
  if (depth <= 9) return null;

  /* Level 10-19. */
  if (t[BI.LIGHT]! < 2 && cls !== CLASS_NECROMANCER) return "2 light radius";
  if (t[BI.MAXCLEVEL]! < 30 && t[BI.ACLW]! + t[BI.ACSW]! + t[BI.ACCW]! < 2)
    return "restock clw + csw + ccw ";
  if (t[BI.ATELEPORT]! + t[BI.AESCAPE]! < 2) return "restock tele + tele staff < 2";
  if (depth <= 19) return null;

  /* Level 20-35. */
  if (t[BI.MAXCLEVEL]! < 30 && t[BI.ACSW]! + t[BI.ACCW]! < 4)
    return "restock csw + ccw < 4";
  if (t[BI.ATELEPORT]! + t[BI.AESCAPE]! < 4)
    return "restock 4 > teleport + teleport staff ";
  if (depth <= 35) return null;

  /* Level 36-45. */
  if (t[BI.ATELEPORT]! + t[BI.ATELEPORTLVL]! < 2)
    return "restock teleport + teleport level scrolls";
  if (depth <= 45) return null;

  /* Level 46-64. */
  if (depth <= 64) return null;

  /* Level 65-99. */
  if (t[BI.AHEAL]! + has(d, "rod_healing") + t[BI.AEZHEAL]! < 1)
    return "restock heal";
  if (depth <= 99) return null;

  /* Level 100: the just-arrived-low-on-heals check needs level timing; skipped. */
  void R;
  return null;
}
