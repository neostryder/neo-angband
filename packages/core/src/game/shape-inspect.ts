/**
 * Game-layer bridge for the shape-lore browser: assemble the ShapeLoreEnv that
 * the pure player/shape-lore.ts chain needs from a live GameState plus the
 * registry bits a GameState does not carry. The sibling of object-inspect.ts,
 * and for the same reason - the chain is a describer and must not reach into
 * the effect or class registries itself.
 *
 * It exists because the chain's last two sections were seams nobody supplied.
 * shapeLoreLines has been a faithful port of shape_lore for a long time, and
 * its own test proved the tails render when handed to it; what no host ever
 * did was hand them over, so every shape recall stopped after the misc flags.
 * A player reading about Bear form was told what it does to their stats and
 * nothing about how to get into it or out of it.
 *
 * PURE READ: the change-effect text is `describeEffect`, which reads dice and
 * never rolls them, over a chain built the same way inspection builds an
 * object's. The triggering-spell scan is registry data only.
 *
 * Attribution: neostryder / RPGM Tools.
 */

import { EF } from "../generated/index.js";
import { describeEffect } from "../effects/effect-info.js";
import type { EffectDescribeDeps } from "../effects/effect-info.js";
import { OBJ_PROPERTY } from "../obj/types.js";
import type { EffectRecordJson, ObjectProperty } from "../obj/types.js";
import type {
  PlayerClass,
  Shape,
  ShapeEffectJson,
} from "../player/types.js";
import type {
  ShapeLoreEnv,
  ShapeLorePlayerAbility,
} from "../player/shape-lore.js";
import type { GameState } from "./context.js";
import { buildObjectEffectChain } from "./obj-cmd.js";
import type { ObjectInfoExtras } from "./object-inspect.js";

/** Registry data the shape-lore chain needs that a GameState does not carry. */
export interface ShapeLoreExtras {
  /** obj_properties (1-based, index 0 null): lookup_obj_property. */
  properties: readonly (ObjectProperty | null)[];
  /** player_abilities filtered to streq(type, "player"). */
  playerAbilities: readonly ShapeLorePlayerAbility[];
  /**
   * EVERY class, in registry order. shape_lore_append_triggering_spells walks
   * the whole class list, not the player's own class - browsing a shape tells
   * you which class could reach it, even one you are not.
   */
  classes: readonly PlayerClass[];
  /**
   * lookup_kind(book->tval, book->sval)->name, or null when the kind is
   * missing. Upstream skips a book whose kind has no name (L2078-2080).
   */
  bookKindName(tvalIdx: number, sval: number): string | null;
  /** The same extras object-info inspection uses (projections + effect text). */
  inspect: ObjectInfoExtras;
}

function statName(state: GameState, statIndex: number): string {
  for (const p of state.runeEnv.properties) {
    if (p && p.type === OBJ_PROPERTY.STAT && p.propIndex === statIndex) {
      return p.name;
    }
  }
  return "";
}

/**
 * shape_lore_append_change_effects (ui-knowledge.c:3043):
 * `effect_describe(s->effect, "Changing into the shape ", 0, false)`. Null when
 * the shape has no effect records, which is upstream's `if (tbe)` - a shape
 * with no effect prints nothing rather than an empty sentence.
 */
export function shapeChangeEffectText(
  state: GameState,
  shape: Shape,
  extras: ShapeLoreExtras,
): string | null {
  /* No early-out on an empty effect list: describeEffect walks a null chain and
   * returns null on its own, which is upstream's `if (tbe)` (L3048) and the one
   * guard here. A second one in front of it read like a separate rule and was
   * untestable - nothing can distinguish the two paths. */
  const chain = buildObjectEffectChain(
    shape.effects as readonly ShapeEffectJson[] as EffectRecordJson[],
    state,
  );
  const deps: EffectDescribeDeps = {
    projections: extras.inspect.projections,
    playerLevel: state.actor.player.lev,
    foodValue: extras.inspect.constants.foodValue,
    statName: (i) => statName(state, i),
    ...(extras.inspect.timedDesc ? { timedDesc: extras.inspect.timedDesc } : {}),
    ...(extras.inspect.summonDesc ? { summonDesc: extras.inspect.summonDesc } : {}),
  };
  const text = describeEffect(chain, "Changing into the shape ", 0, false, deps);
  return text ? text : null;
}

/**
 * shape_lore_append_triggering_spells (ui-knowledge.c:3059): every class, every
 * book, every spell, every effect in that spell's chain - anything that is an
 * EF_SHAPECHANGE into THIS shape gets a line naming the class, the spell and
 * the book it lives in.
 *
 * The spell's effect records are still raw here (ClassSpell.effectsRaw, the
 * compile is deferred), which is enough: this only needs the effect's name and
 * its subtype, both of which are strings on the record. The subtype is matched
 * by SHAPE NAME rather than by sidx because that is what the pack stores -
 * `effect:SHAPECHANGE:bear` - and resolving it to an index here would just
 * invert the same lookup.
 */
export function shapeTriggeringSpells(
  shape: Shape,
  extras: ShapeLoreExtras,
): string[] {
  const out: string[] = [];
  for (const cls of extras.classes) {
    for (const book of cls.magic.books) {
      const kindName = extras.bookKindName(book.tvalIdx, book.sval);
      /* `if (!kind || !kind->name) continue;` (L2078). */
      if (!kindName) continue;
      for (const spell of book.spells) {
        for (const raw of spell.effectsRaw) {
          const rec = raw as { eff?: string; type?: string };
          if (rec.eff !== EF_SHAPECHANGE_NAME) continue;
          if (rec.type !== shape.name) continue;
          out.push(
            `The ${cls.name} spell, ${spell.name}, from ${kindName} ` +
              `triggers the shapechange.`,
          );
        }
      }
    }
  }
  return out;
}

/** The effect name the pack writes for EF_SHAPECHANGE. */
const EF_SHAPECHANGE_NAME = "SHAPECHANGE";

/* A compile-time tie between the string above and the effect it names: if the
 * generated table ever loses SHAPECHANGE, this stops building rather than
 * silently matching nothing. */
const _shapechangeExists: number = EF.SHAPECHANGE;
void _shapechangeExists;

/**
 * The complete ShapeLoreEnv for a live game - all ten sections, including the
 * two tails. Hosts should call this rather than assembling the env by hand:
 * the three table fields are trivial, which is exactly why hand-assembly
 * looked complete and quietly left the tails off.
 */
export function makeShapeLoreEnv(
  state: GameState,
  extras: ShapeLoreExtras,
): ShapeLoreEnv {
  return {
    properties: extras.properties,
    elementNames: extras.inspect.projections.map((p) => p.name),
    playerAbilities: extras.playerAbilities,
    changeEffectText: (shape) => shapeChangeEffectText(state, shape, extras),
    triggeringSpells: (shape) => shapeTriggeringSpells(shape, extras),
  };
}
