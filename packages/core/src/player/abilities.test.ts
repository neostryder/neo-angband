import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeState, plReg } from "../game/harness";
import { blankPlayer } from "./player";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { playerAbilities } from "./abilities";
import type { PlayerClass, PlayerRace } from "./types";
import { Rng } from "../rng";

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as { records: T[] };
  return parsed.records;
}

const projections = bindProjections(packJson<ProjectionRecordJson>("projection"));
const elementNames = projections.slice(0, 25).map((p) => p.name);

function race(name: string): PlayerRace {
  const r = plReg.races.find((x) => x.name === name);
  if (!r) throw new Error(`no race ${name}`);
  return r;
}

function cls(name: string): PlayerClass {
  const c = plReg.classes.find((x) => x.name === name);
  if (!c) throw new Error(`no class ${name}`);
  return c;
}

/** RNG is unused by playerAbilities; a no-draw sentinel proves it. */
function noRngDraws(): Rng {
  return new Proxy(new Rng(1), {
    get(target, prop, receiver) {
      if (typeof (target as never)[prop as never] === "function") {
        return (): never => {
          throw new Error(`unexpected RNG draw: ${String(prop)}`);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Rng;
}

describe("playerAbilities (player-properties.c view_abilities)", () => {
  it("lists Warrior class abilities (BRAVERY_30 / NO_MANA / SHIELD_BASH)", () => {
    const state = makeState();
    state.actor.player = blankPlayer(race("Human"), cls("Warrior"), plReg.bodies[0]!);
    state.rng = noRngDraws();

    const rows = playerAbilities(state, { properties: plReg.properties, elementNames });
    const classRows = rows.filter((r) => r.group === "class");
    expect(classRows.map((r) => r.name)).toEqual(
      expect.arrayContaining(["Relentless [30]", "No Magic", "Shield Bash"]),
    );
    const shieldBash = classRows.find((r) => r.name === "Shield Bash");
    expect(shieldBash?.desc).toBe("You can bash monsters with a shield in melee.");
  });

  it("class abilities are listed before race abilities", () => {
    const state = makeState();
    state.actor.player = blankPlayer(race("Dwarf"), cls("Warrior"), plReg.bodies[0]!);
    const rows = playerAbilities(state, { properties: plReg.properties, elementNames });
    const lastClassIdx = rows.map((r) => r.group).lastIndexOf("class");
    const firstRaceIdx = rows.map((r) => r.group).indexOf("race");
    expect(firstRaceIdx).toBeGreaterThan(lastClassIdx);
  });

  it("lists the Dwarf's SEE_ORE racial player-flag ability (Miner)", () => {
    const state = makeState();
    state.actor.player = blankPlayer(race("Dwarf"), cls("Warrior"), plReg.bodies[0]!);
    const rows = playerAbilities(state, { properties: plReg.properties, elementNames });
    const miner = rows.find((r) => r.name === "Miner");
    expect(miner).toBeDefined();
    expect(miner?.group).toBe("race");
    expect(miner?.desc).toBe("You can sense ore in the walls.");
  });

  it("expands the Half-Orc's RES_DARK element template into 'Dark Resistance'", () => {
    const state = makeState();
    state.actor.player = blankPlayer(race("Half-Orc"), cls("Warrior"), plReg.bodies[0]!);
    const rows = playerAbilities(state, { properties: plReg.properties, elementNames });
    const dark = rows.find((r) => r.name === "Dark Resistance");
    expect(dark).toBeDefined();
    expect(dark?.group).toBe("race");
    expect(dark?.desc).toBe("You resist dark.");
  });

  it("does not show element abilities for a race with no matching resLevel", () => {
    const state = makeState();
    state.actor.player = blankPlayer(race("Human"), cls("Warrior"), plReg.bodies[0]!);
    const rows = playerAbilities(state, { properties: plReg.properties, elementNames });
    expect(rows.some((r) => r.name.endsWith("Resistance"))).toBe(false);
  });

  it("draws no RNG (pure display/selection data)", () => {
    const state = makeState();
    state.actor.player = blankPlayer(race("Half-Orc"), cls("Blackguard"), plReg.bodies[0]!);
    state.rng = noRngDraws();
    expect(() =>
      playerAbilities(state, { properties: plReg.properties, elementNames }),
    ).not.toThrow();
  });
});
