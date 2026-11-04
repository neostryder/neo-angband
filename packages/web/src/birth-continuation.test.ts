import { describe, expect, it } from "vitest";
import { Rng, saveGame, startGame } from "@rpgm-tools/neo-angband-core";
import { loadGamePack } from "./pack";
import { birthStartOptions, decodeBirthContinuation, encodeBirthContinuation } from "./birth-continuation";

const pack = loadGamePack();
const birth = { depth: 3, raceName: "Elf", className: "Rogue", roller: "point" as const, birthStats: [17, 13, 10, 16, 13] };

function advanced(seed: number) {
  const rng = new Rng(seed);
  for (let i = 0; i < 13; i++) rng.randint0(1000);
  return rng.getState();
}

describe("birth reload seed provenance", () => {
  it.each([0, 4242, 0xffffffff])("keeps original seed %s and the advanced stream when the next page draws another seed", (seed) => {
    const state = advanced(seed);
    const stored = encodeBirthContinuation(seed, state);
    const reloaded = startGame(pack, { ...birthStartOptions(9001, decodeBirthContinuation(stored)), ...birth });
    const expected = startGame(pack, { seed, rngState: state, ...birth });
    expect(reloaded.state.masterSeed).toBe(seed);
    expect(saveGame(reloaded)).toEqual(saveGame(expected));
    // Previously the page seed was passed beside the old stream. Correcting
    // the label must not change the actual generated world or RNG position.
    const previous = startGame(pack, { seed: 9001, rngState: state, ...birth });
    const { masterSeed: _actualSeed, ...actualWorld } = saveGame(reloaded);
    const { masterSeed: _pageSeed, ...previousWorld } = saveGame(previous);
    expect(actualWorld).toEqual(previousWorld);
  });

  it("resumes a legacy bare snapshot unchanged, without inventing its original seed", () => {
    const state = advanced(4242);
    const reloaded = startGame(pack, { ...birthStartOptions(9001, decodeBirthContinuation(JSON.stringify(state))), ...birth });
    const expected = startGame(pack, { seed: 4242, rngState: state, ...birth });
    expect(expected.state.masterSeed).toBe(4242);
    expect(reloaded.state).not.toHaveProperty("masterSeed");
    const { masterSeed: _knownSeed, ...known } = saveGame(expected);
    expect(saveGame(reloaded)).toEqual(known);
  });

  it("uses the fresh page's seed when there is no valid continuation", () => {
    for (const raw of ["not json", "null", "{}", JSON.stringify({ rngState: { state: [] }, seed: 4242 })]) {
      const continuation = decodeBirthContinuation(raw);
      expect(continuation).toBeNull();
      const game = startGame(pack, { ...birthStartOptions(9001, continuation), ...birth });
      expect(game.state.masterSeed).toBe(9001);
    }
  });
});
