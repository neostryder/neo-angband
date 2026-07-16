import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { EF, TV } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import {
  EffectRegistry,
  sourcePlayer,
} from "../effects/interpreter";
import type { EffectContext } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import type { CastContext } from "./project-cast";
import { attachGameEnv } from "./effect-game-env";
import { registerItemHandlers } from "./effect-item";
import type { ItemEffectEnv } from "./effect-item";
import { makeState } from "./harness";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const projections = bindProjections(
  (loadJson("projection") as { records: ProjectionRecordJson[] }).records,
);
const objReg = new ObjRegistry({
  objectBase: loadJson("object_base"),
  object: loadJson("object"),
  egoItem: loadJson("ego_item"),
  artifact: loadJson("artifact"),
  curse: loadJson("curse"),
  brand: loadJson("brand"),
  slay: loadJson("slay"),
  activation: loadJson("activation"),
  objectProperty: loadJson("object_property"),
  flavor: loadJson("flavor"),
} as ObjPackJson);
const constants = bindConstants(loadJson("constants"));

function makeObj(tval: number): GameObject {
  const kind = objReg.kinds.find(
    (k) => k.tval === tval && k.kidx < objReg.ordinaryKindCount,
  );
  if (!kind) throw new Error(`no ordinary kind for tval ${tval}`);
  return objectPrep(new Rng(9), objReg, constants, kind, 0, "average");
}

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerItemHandlers(r);
  return r;
}

function env(state: GameState, item: ItemEffectEnv): EffectContext {
  const cast: CastContext = {
    projections,
    maxRange: 20,
    playerActor: basicPlayerActor(state),
  };
  return attachGameEnv({ rng: state.rng }, { state, cast, item });
}

describe("EF_IDENTIFY (effect-handler-general.c L1945)", () => {
  it("learns one unknown rune of the chosen item", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 31 });
    const p = state.actor.player;
    /* Combat runes are known from birth (do_cmd_accept_character); clear them so
     * the sword's to-damage rune below is genuinely unknown for IDENTIFY. */
    p.objKnown.toA = 0;
    p.objKnown.toH = 0;
    p.objKnown.toD = 0;
    const sword = makeObj(TV.SWORD);
    sword.toD = 5; /* an unknown to-damage rune */
    sword.toH = 0;

    let offered: GameObject | null = null;
    const used = registry().effectSimple(EF.IDENTIFY, env(state, {
      getItem: (req) => {
        offered = req.tester(sword) ? sword : null;
        return offered;
      },
    }), { origin: sourcePlayer() });

    expect(used).toBe(true);
    expect(offered).toBe(sword);
    /* The to-damage combat rune is now known (learning is player-wide). */
    expect(p.objKnown.toD).toBe(1);
  });

  it("a cancelled pick (or no chooser) leaves the effect unused", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const used = registry().effectSimple(EF.IDENTIFY, env(state, {}), {
      origin: sourcePlayer(),
    });
    expect(used).toBe(false);
  });

  it("a fully-known item fails the tester", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const p = state.actor.player;
    p.objKnown.toD = 1;
    p.objKnown.toH = 1;
    const sword = makeObj(TV.SWORD);
    sword.toD = 5;
    let testerResult: boolean | null = null;
    registry().effectSimple(EF.IDENTIFY, env(state, {
      getItem: (req) => {
        testerResult = req.tester(sword);
        return null; /* nothing eligible */
      },
    }), { origin: sourcePlayer() });
    expect(testerResult).toBe(false);
  });
});
