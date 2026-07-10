import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, MFLAG, SQUARE } from "../generated";
import { loc } from "../loc";
import { EffectRegistry, sourcePlayer } from "../effects/interpreter";
import type { EffectContext } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { getLore } from "../mon/lore";
import { addMon, makeRace, makeState } from "./harness";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import { attachGameEnv } from "./effect-game-env";
import { registerGeneralHandlers } from "./effect-general";

const projections = bindProjections(
  (
    JSON.parse(
      readFileSync(
        new URL("../../../content/pack/projection.json", import.meta.url),
        "utf8",
      ),
    ) as { records: ProjectionRecordJson[] }
  ).records,
);

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerGeneralHandlers(r);
  return r;
}

function env(state: GameState, msgs: string[]): EffectContext {
  return attachGameEnv(
    {
      rng: state.rng,
      messages: { msg: (t: string) => msgs.push(t) },
    },
    {
      state,
      cast: { projections, maxRange: 20, playerActor: basicPlayerActor(state) },
    },
  );
}

describe("EF_PROBE (effect-handler-general.c L2451)", () => {
  it("probes visible in-view monsters, learning everything", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const seen = addMon(state, makeRace(), loc(14, 10), { hp: 33 });
    seen.mflag.on(MFLAG.VISIBLE);
    state.chunk.sqinfoOn(seen.grid, SQUARE.VIEW);
    /* A second monster out of view stays unprobed. */
    const hidden = addMon(state, makeRace(), loc(20, 20), { hp: 10 });
    hidden.mflag.on(MFLAG.VISIBLE);

    const msgs: string[] = [];
    const used = registry().effectSimple(EF.PROBE, env(state, msgs), {
      origin: sourcePlayer(),
    });

    expect(used).toBe(true);
    expect(msgs[0]).toBe("Probing...");
    expect(msgs).toContain(
      `${seen.race.name.charAt(0).toUpperCase()}${seen.race.name.slice(1)}` +
        " has 33 hit points.",
    );
    expect(msgs[msgs.length - 1]).toBe("That's all.");
    expect(getLore(state.lore, seen.race).allKnown).toBe(true);
  });

  it("finds nothing without a visible monster in view", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    addMon(state, makeRace(), loc(14, 10), { hp: 30 }); /* not visible */
    const msgs: string[] = [];
    registry().effectSimple(EF.PROBE, env(state, msgs), {
      origin: sourcePlayer(),
    });
    expect(msgs).toEqual([]);
    expect(state.lore.size).toBe(0);
  });
});
