/**
 * Light-source maintenance and illumination - a faithful port of borg-light.c:
 * borg_maintain_light (refuel/replace), borg_refuel_lantern and
 * borg_check_light_only (call light / wizard light).
 *
 * The engine has no typed "refuel" verb on the frozen act facade, so refuelling
 * uses the raw escape hatch with the engine's "refill" command code
 * (game/obj-cmd.ts). Wielding a fresh light uses act.wear.
 *
 * FIDELITY on the "should I bother lighting" scan: borg_check_light_only reads
 * the borg's own grid cache (borg_grids, BORG_LIGHT/floor/glow). We read the
 * live CellView (passable=floor, glow=perma-lit, inView) around the player, which
 * expresses the same intent through the frozen contract. The action ladder and
 * the when_call_light / when_wizard_light timers are preserved exactly.
 */

import type { BorgContext, ItemView, AgentCommand } from "./types";
import { BI } from "../trait/trait-index";
import { CLASS_NECROMANCER } from "../trait/trait-index";
import { TV, SVAL } from "./svals";
import type { ItemDeps } from "./deps";
import { trait, borgSlot, clockOf } from "./deps";
import { hasFlag } from "../trait/item-util";
import {
  Spell,
  borgSpellFail,
  borgSpellOkayFail,
} from "./magic";
import {
  borgActivateItem,
  borgZapRod,
  borgUseStaff,
  borgReadScroll,
  borgEquipsRod,
  borgAimWand,
} from "./item-use";

/** enum borg_need (borg-item-use.h:31). */
export enum BorgNeed {
  NO_NEED = 0,
  MET_NEED = 1,
  UNMET_NEED = 2,
}

/** The result of borg_maintain_light: the need plus any action it produced. */
export interface MaintainLightResult {
  need: BorgNeed;
  cmd: AgentCommand | null;
}

/** The currently worn light source (equipment slot), or null. */
export function currentLight(ctx: BorgContext): ItemView | null {
  for (const item of ctx.view.equipment()) {
    if (item && item.number > 0 && item.tval === TV.LIGHT) return item;
  }
  return null;
}

/** borg_refuel_lantern (light.c:544). Returns the refill command or null. */
function borgRefuelLantern(
  ctx: BorgContext,
  cur: ItemView,
  d?: ItemDeps,
): AgentCommand | null {
  /* Prefer a flask of oil. */
  let source = borgSlot(ctx, TV.FLASK, SVAL.flask.oil!, d);

  /* Else a spare, fuelled, non-everburning lantern. */
  if (!source) {
    for (const item of ctx.view.inventory()) {
      if (item.number <= 0) continue;
      if (item.tval !== TV.LIGHT || item.sval !== SVAL.light.lantern) continue;
      if (hasFlag(item, "NO_FUEL")) continue;
      if (item.timeout > 0) {
        source = item;
        break;
      }
    }
  }
  if (!source) return null;

  /* Cannot refuel a torch with oil (light.c:584). */
  if (cur.sval !== SVAL.light.lantern) return null;

  return ctx.act.raw("refill", { handle: source.handle });
}

/**
 * borg_maintain_light (light.c:605): refuel/replace the light when low. Returns
 * the need and, when it acts (MET_NEED), the command.
 */
export function borgMaintainLight(
  ctx: BorgContext,
  d?: ItemDeps,
): MaintainLightResult {
  const cur = currentLight(ctx);

  if (cur && hasFlag(cur, "NO_FUEL")) {
    return { need: BorgNeed.NO_NEED, cmd: null };
  }
  /* Necromancers like the dark. */
  if (trait(ctx, BI.CLASS) === CLASS_NECROMANCER) {
    return { need: BorgNeed.NO_NEED, cmd: null };
  }

  if (cur) {
    if (cur.sval === SVAL.light.torch) {
      if (cur.timeout > 250) return { need: BorgNeed.NO_NEED, cmd: null };
      /* Torches auto-disappear at 0 turns; just need a spare in the pack. */
      const spare = borgSlot(ctx, TV.LIGHT, SVAL.light.torch!, d);
      if (!spare) return { need: BorgNeed.UNMET_NEED, cmd: null };
      return { need: BorgNeed.NO_NEED, cmd: null };
    }
    if (cur.sval === SVAL.light.lantern) {
      if (cur.timeout < 1000) {
        const cmd = borgRefuelLantern(ctx, cur, d);
        if (cmd) return { need: BorgNeed.MET_NEED, cmd };
        return { need: BorgNeed.UNMET_NEED, cmd: null };
      }
    }
    return { need: BorgNeed.NO_NEED, cmd: null };
  }

  /* No light equipped: wield a lantern, else a torch. */
  let src = borgSlot(ctx, TV.LIGHT, SVAL.light.lantern!, d);
  if (!src) src = borgSlot(ctx, TV.LIGHT, SVAL.light.torch!, d);
  if (!src) return { need: BorgNeed.UNMET_NEED, cmd: null };
  return { need: BorgNeed.MET_NEED, cmd: ctx.act.wear(src.handle) };
}

/** Count floor grids near the player (helper for the "bother lighting" scan). */
function litFloorScan(ctx: BorgContext, radius: number): number {
  const { x: px, y: py } = ctx.view.player().grid;
  let floors = 0;
  for (let y = py - radius; y <= py + radius; y++) {
    for (let x = px - radius; x <= px + radius; x++) {
      const c = ctx.view.cell(x, y);
      if (!c) continue;
      /* Floor lit by the player's light but not perma-lit (needs lighting). */
      if (c.passable && c.inView && !c.glow) floors++;
    }
  }
  return floors;
}

/** Count diagonal "corner" walls/unknowns around the player (radius-1 scan). */
function cornerScan(ctx: BorgContext): number {
  const { x: px, y: py } = ctx.view.player().grid;
  const diagonals: ReadonlyArray<readonly [number, number]> = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  let corners = 0;
  for (const [dx, dy] of diagonals) {
    const c = ctx.view.cell(px + dx, py + dy);
    if (!c) continue;
    if (!c.known) corners++;
    else if (!c.passable) corners++;
  }
  return corners;
}

/**
 * borg_check_light_only (light.c:108): illuminate the surroundings when it helps
 * (e.g. before resting to heal). Returns the light command or null. Necromancer
 * darkness handling and the corner/floor "bother" heuristics are preserved.
 */
export function borgCheckLightOnly(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): AgentCommand | null {
  /* Never in town, blind or hallucinating. */
  if (trait(ctx, BI.CDEPTH) === 0) return null;
  if (trait(ctx, BI.ISBLIND) || trait(ctx, BI.ISIMAGE)) return null;

  const borgT = clockOf(ctx, d);
  const self = ctx.world.self;

  /* Wizard light sometimes (light.c:117). */
  if (!self.whenWizardLight || borgT - self.whenWizardLight >= 1000) {
    const cmd =
      borgActivateItem(ctx, "act_clairvoyance", d) ||
      borgActivateItem(ctx, "act_enlightenment", d) ||
      borgSpellFail(ctx, Spell.FUME_OF_MORDOR, 40, playerHas) ||
      borgSpellFail(ctx, Spell.CLAIRVOYANCE, 40, playerHas);
    if (cmd) {
      self.whenWizardLight = borgT;
      return cmd;
    }
  }

  /* Necromancers like the dark (they call darkness instead). */
  if (trait(ctx, BI.CLASS) === CLASS_NECROMANCER) {
    return borgCheckDarkOnly(ctx, d, playerHas);
  }

  /* Don't bother if we just did it (light.c:136). */
  if (self.whenCallLight !== 0 && borgT - self.whenCallLight < 7) return null;

  /* Decide whether it's worth lighting (light.c:139). */
  const lightRadius = trait(ctx, BI.LIGHT);
  if (lightRadius === 1) {
    if (cornerScan(ctx) > 2) return null;
  } else if (lightRadius > 1) {
    if (litFloorScan(ctx, 2) < 11) return null;
  }

  /* Light it up (light.c:222). */
  const cmd =
    borgActivateItem(ctx, "act_illumination", d) ||
    borgActivateItem(ctx, "act_light", d) ||
    borgZapRod(ctx, SVAL.rod.illumination!, d) ||
    borgUseStaff(ctx, SVAL.staff.light!, d) ||
    borgReadScroll(ctx, SVAL.scroll.light!, d) ||
    borgSpellFail(ctx, Spell.LIGHT_ROOM, 40, playerHas) ||
    borgSpellFail(ctx, Spell.CALL_LIGHT, 40, playerHas);
  if (cmd) {
    self.whenCallLight = borgT;
    return cmd;
  }
  return null;
}

/** borg_check_dark_only (light.c:44): necromancers call darkness on lit areas. */
function borgCheckDarkOnly(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): AgentCommand | null {
  if (trait(ctx, BI.CLASS) !== CLASS_NECROMANCER) return null;

  const borgT = clockOf(ctx, d);
  const self = ctx.world.self;
  /* Necromancers borrow the call-light counter for darkness. */
  if (self.whenCallLight !== 0 && borgT - self.whenCallLight < 7) return null;

  /* Count glowing floors in the 5x5 area. */
  const { x: px, y: py } = ctx.view.player().grid;
  let floors = 0;
  for (let y = py - 2; y <= py + 2; y++) {
    for (let x = px - 2; x <= px + 2; x++) {
      const c = ctx.view.cell(x, y);
      if (!c) continue;
      if (c.passable && c.glow) floors++;
    }
  }
  if (floors < 11) return null;

  const cmd = borgSpellFail(ctx, Spell.CREATE_DARKNESS, 40, playerHas);
  if (cmd) {
    self.whenCallLight = borgT;
    return cmd;
  }
  return null;
}

/**
 * borg_light_beam(simulation=false): light a hallway with Spear of Light / a rod
 * or wand of light (light.c:675). The full four-direction corridor geometry is a
 * navigation concern (P8.6); here we port the ability gate and, when able, emit
 * the light action. Returns the command (or null); with simulation the caller
 * only wants to know if it is possible - use borgLightBeamOkay for that.
 */
export function borgLightBeamOkay(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): boolean {
  if (trait(ctx, BI.ISWEAK)) return false;
  const wand = borgSlot(ctx, TV.WAND, SVAL.wand.light!, d);
  return (
    borgSpellOkayFail(ctx, Spell.SPEAR_OF_LIGHT, 20, playerHas) ||
    (wand !== null && wand.pval > 0) ||
    borgEquipsRod(ctx, SVAL.rod.light!, d)
  );
}

export function borgLightBeam(
  ctx: BorgContext,
  d?: ItemDeps,
  playerHas?: (flag: string) => boolean,
): AgentCommand | null {
  if (!borgLightBeamOkay(ctx, d, playerHas)) return null;
  return (
    borgSpellFail(ctx, Spell.SPEAR_OF_LIGHT, 20, playerHas) ||
    borgZapRod(ctx, SVAL.rod.light!, d) ||
    borgAimWand(ctx, SVAL.wand.light!, d)
  );
}
