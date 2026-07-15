/**
 * The think session: the per-Borg wiring hub that binds the abstract subsystem
 * seams (flow hooks, danger globals, item/store deps, the monster-race and
 * activation resolvers) to the concrete ported subsystems, exactly as the C
 * borg's file-scope globals connected borg_flow / borg_danger / borg_item* /
 * borg_store* to one another.
 *
 * It owns the single persistent Flow (borg_init_flow's scratch state, reused
 * across thinks so track_less/more/glyph and the boredom clock survive), the
 * store anti-loop memory, and the injected resolvers. A ctx holder lets the
 * FlowHooks - whose signatures predate the per-think ctx - reach the live view
 * during a flow; the controller refreshes it at the top of every think.
 *
 * RESOLVER SEAMS (see BorgResolvers). The frozen AgentView cannot surface a
 * monster race's blow[]/freq/spell_power, an artifact's activation identity, the
 * exact "am I standing in shop N" signal, or the power of a hypothetical
 * loadout. These are injected via createBorg's options and default to faithful
 * conservative behavior (zero-magnitude danger, no activations, never in a shop,
 * no power gain from an unevaluated swap/buy/sell) so the Borg is correct-but-
 * cautious until a host wires real engine data.
 */

import type { BorgContext } from "./context";
import type { FactsResolver } from "./danger";
import {
  borgDanger,
  borgLos,
  getDangerGlobals,
  getFearCaches,
  getDangerState,
} from "./danger";
import type { Flow, FlowHooks } from "./flow";
import type { ItemDeps } from "./item";
import { createFlow } from "./flow";
import { BI } from "./trait";
import { borgPrepared } from "./trait";
import {
  borgCountSell,
  borgFirstEmptyInventorySlot,
  createStoreMemory,
  type StoreDeps,
  type StoreMemory,
} from "./store";
import {
  Spell,
  borgReadScroll,
  borgSpell,
  borgSpellLegal,
  borgSpellOkayFail,
  SVAL,
} from "./item";
import type { BorgWorld } from "./world/model";

/**
 * Injection points a host supplies via createBorg. All optional; each defaults
 * to the faithful conservative behavior documented on the field.
 */
export interface BorgResolvers {
  /**
   * Resolve a tracked kill index to its full MonsterFacts (r_info blow[]/freq/
   * spell_power/...). Default: MonsterView-derived facts with zero blows/freq
   * (borg_danger sees no melee/spell threat). Wire this for real danger.
   */
  resolveMonsterFacts?: FactsResolver;
  /**
   * borg_equips_item(act, checkCharge): does the borg wear an item granting the
   * named activation (a charged one when checkCharge). Default: false.
   */
  resolveActivation?: (
    ctx: BorgContext,
    act: string,
    checkCharge: boolean,
  ) => boolean;
  /** borg_activate_item(act) -> the gear handle to activate, or null. */
  activateHandle?: (ctx: BorgContext, act: string) => number | null;
  /**
   * square_shopnum: the shop number (0..7, 7 = home) the borg is standing in,
   * or null when not in a shop. The frozen view has no in-shop signal, so this
   * defaults to null (the borg never enters shop-interaction mode without a
   * host-supplied signal). Town flow-to-shop still works from the ladder.
   */
  inShop?: (ctx: BorgContext) => number | null;
  /** OPT(player, birth_force_descend): the level cannot be climbed. */
  forceDescend?: boolean;
}

/** Default resolvers: every seam inert / conservative. */
export function defaultResolvers(): BorgResolvers {
  return {};
}

/** The per-Borg wiring hub. */
export interface ThinkSession {
  /** The single persistent flow (track lists + boredom clock live here). */
  readonly flow: Flow;
  /** The store anti-loop memory (recordSold / recordBought). */
  readonly storeMem: StoreMemory;
  /** The injected host resolvers. */
  readonly resolvers: BorgResolvers;
  /** The live decision context for this think (refreshed by the controller). */
  ctx: BorgContext | null;
}

/** Build the persistent flow hooks, closing over the session's ctx holder. */
function buildFlowHooks(session: ThinkSession): FlowHooks {
  const ctx = (): BorgContext => {
    if (!session.ctx) throw new Error("borg flow hook used outside a think");
    return session.ctx;
  };
  return {
    danger: (_world, y, x) => borgDanger(ctx(), y, x, 1, true, false),
    canDigMagic: (_world, checkFail) => {
      const c = ctx();
      if (checkFail) {
        return (
          borgSpellOkayFail(c, Spell.TURN_STONE_TO_MUD, 40) ||
          borgSpellOkayFail(c, Spell.SHATTER_STONE, 40)
        );
      }
      return (
        borgSpellLegal(c, Spell.TURN_STONE_TO_MUD) ||
        borgSpellLegal(c, Spell.SHATTER_STONE)
      );
    },
    hasDistanceAttack: (_world) => {
      // Proxy for borg_has_distance_attack: the borg can shoot if it has shots
      // (a launcher + ammo). A real ranged-damage evaluator can replace this.
      return (ctx().view.player().shots ?? 0) > 0;
    },
    layGlyph: (c) =>
      borgSpell(c, Spell.GLYPH_OF_WARDING) ??
      borgReadScroll(c, SVAL.scroll.rune_of_protection!),
    forceDescend: session.resolvers.forceDescend ?? false,
    preparedToDescend: (world) =>
      borgPrepared(ctx(), (world.self.trait[BI.CDEPTH] ?? 0) + 1) === null,
    countSell: (_world) => borgCountSell(ctx(), buildStoreDeps(session)),
    packFull: (_world) => borgFirstEmptyInventorySlot(ctx()) < 0,
    monsterHasFlag: (_world, killIndex, flag) => {
      const facts = getDangerState(ctx().world).globals.resolveFacts(
        ctx(),
        killIndex,
      );
      return facts.flags.has(flag);
    },
    los: (world, y1, x1, y2, x2) => borgLos(world, y1, x1, y2, x2),
  };
}

/** Build the item/consumable deps for this think from ctx + danger state. */
export function buildItemDeps(session: ThinkSession): ItemDeps {
  const c = session.ctx;
  if (!c) throw new Error("buildItemDeps outside a think");
  const w = c.world;
  const py = w.self.c.y;
  const px = w.self.c.x;
  const dangerHere = borgDanger(c, py, px, 1, true, false);
  const fear = getFearCaches(w);
  const res = session.resolvers;
  return {
    danger: dangerHere,
    avoidance: w.self.trait[BI.CURHP] ?? 0,
    canRest: true,
    clock: w.clock,
    fearRegion: fear.region(py, px),
    ...(res.resolveActivation
      ? {
          equipsItem: (act: string, checkCharge: boolean) =>
            res.resolveActivation!(c, act, checkCharge),
        }
      : {}),
    ...(res.activateHandle
      ? { activateItem: (act: string) => res.activateHandle!(c, act) }
      : {}),
  };
}

/** Build the store deps for this think (shares the anti-loop memory). */
export function buildStoreDeps(session: ThinkSession): StoreDeps {
  return { mem: session.storeMem };
}

/** Create a fresh think session with the given resolvers. */
export function buildThinkSession(resolvers: BorgResolvers = {}): ThinkSession {
  const session: ThinkSession = {
    flow: undefined as unknown as Flow,
    storeMem: createStoreMemory(),
    resolvers,
    ctx: null,
  };
  (session as { flow: Flow }).flow = createFlow(buildFlowHooks(session));
  return session;
}

const SESSIONS = new WeakMap<BorgWorld, ThinkSession>();

/**
 * The think session for a world, created lazily with default (inert) resolvers.
 * The controller pre-installs one carrying the host resolvers via
 * installThinkSession; direct test calls to think() get this default.
 */
export function getThinkSession(world: BorgWorld): ThinkSession {
  let s = SESSIONS.get(world);
  if (!s) {
    s = buildThinkSession();
    SESSIONS.set(world, s);
  }
  return s;
}

/** Install a pre-built session for a world (controller wiring). */
export function installThinkSession(
  world: BorgWorld,
  session: ThinkSession,
): void {
  SESSIONS.set(world, session);
}

/**
 * Set the per-think danger globals the C toggles around maneuvers
 * (avoidance = current HP, the facts resolver, the flow avoidance mirror), then
 * refresh the session ctx holder. Call at the top of every think.
 */
export function primeSession(session: ThinkSession, ctx: BorgContext): void {
  session.ctx = ctx;
  const w = ctx.world;
  const g = getDangerGlobals(w);
  const curhp = w.self.trait[BI.CURHP] ?? 0;
  g.avoidance = curhp;
  if (session.resolvers.resolveMonsterFacts) {
    g.resolveFacts = session.resolvers.resolveMonsterFacts;
  }
  session.flow.state.avoidance = curhp;
  session.flow.state.hooks.forceDescend = session.resolvers.forceDescend ?? false;
}
