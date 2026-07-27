/**
 * move_player / do_cmd_walk_test's blocked-by-terrain messages
 * (cmd-cave.c:1088-1130 and :1240-1257), and the map memory each one writes.
 *
 * Found by the upstream text census (packages/cli/src/text-census.ts): all six
 * "blocking your way" lines were absent from the port, which had been using the
 * known-grid "in the way!" wording for both cases. The wording is the visible
 * half; the invisible half is that upstream MEMORIZES a wall you bump into
 * blind, which is how a player feels along an unlit corridor.
 */

import { describe, expect, it } from "vitest";
import { loc } from "../loc";
import { walkAction } from "./player-turn";
import { knownFeat, squareIsKnown, squareMemorize } from "./known";
import { featureReg, makeState, GRANITE } from "./harness";
import type { GameState } from "./context";

const RUBBLE = featureReg.byCodeName("RUBBLE").fidx;
const CLOSED = featureReg.byCodeName("CLOSED").fidx;
const FLOOR = featureReg.byCodeName("FLOOR").fidx;

const EAST = loc(16, 10);

/** A state whose eastern neighbour carries `feat`, optionally already known. */
function blockedState(feat: number, known: boolean): {
  state: GameState;
  said: string[];
} {
  const state = makeState({ playerGrid: loc(15, 10) });
  state.chunk.setFeat(EAST, feat);
  if (known) squareMemorize(state, EAST);
  const said: string[] = [];
  state.msg = (text: string): void => void said.push(text);
  return { state, said };
}

describe("bumping unknown terrain (move_player, cmd-cave.c:1092-1106)", () => {
  it("says you FEEL a wall, and memorizes it", () => {
    const { state, said } = blockedState(GRANITE, false);
    expect(squareIsKnown(state, EAST)).toBe(false);

    const spent = walkAction(state, { code: "walk", dir: 6 });

    expect(said).toEqual(["You feel a wall blocking your way."]);
    expect(spent).toBe(0); // a deliberate bump refunds the turn
    expect(state.actor.grid).toEqual(loc(15, 10));
    /* square_memorize at :1104 - the grid is now on the player's map. */
    expect(squareIsKnown(state, EAST)).toBe(true);
    expect(knownFeat(state, EAST)).toBe(GRANITE);
  });

  it("says you FEEL a pile of rubble, and memorizes it", () => {
    const { state, said } = blockedState(RUBBLE, false);
    walkAction(state, { code: "walk", dir: 6 });
    expect(said).toEqual(["You feel a pile of rubble blocking your way."]);
    expect(knownFeat(state, EAST)).toBe(RUBBLE);
  });

  it("says you FEEL a door, and memorizes it", () => {
    const { state, said } = blockedState(CLOSED, false);
    walkAction(state, { code: "walk", dir: 6 });
    expect(said).toEqual(["You feel a door blocking your way."]);
    expect(knownFeat(state, EAST)).toBe(CLOSED);
  });

  it("carries MSG_HITWALL, so the line is coloured and sounded as a bump", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    state.chunk.setFeat(EAST, GRANITE);
    const types: (string | number | undefined)[] = [];
    state.msg = (_t: string, type?: string | number): void =>
      void types.push(type);
    walkAction(state, { code: "walk", dir: 6 });
    expect(types).toEqual(["HITWALL"]);
  });
});

describe("bumping known terrain (do_cmd_walk_test, cmd-cave.c:1240-1257)", () => {
  it("says there IS a wall in the way - the player could already see it", () => {
    const { state, said } = blockedState(GRANITE, true);
    walkAction(state, { code: "walk", dir: 6 });
    expect(said).toEqual(["There is a wall in the way!"]);
  });

  it("says there IS a pile of rubble in the way", () => {
    const { state, said } = blockedState(RUBBLE, true);
    walkAction(state, { code: "walk", dir: 6 });
    expect(said).toEqual(["There is a pile of rubble in the way!"]);
  });

  it("stays silent for a known closed door - the walk override opens it", () => {
    const { state, said } = blockedState(CLOSED, true);
    walkAction(state, { code: "walk", dir: 6 });
    expect(said).toEqual([]);
  });

  it("forgets a grid remembered as floor that turns out to be wall (:1253-1257)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    /* Remember FLOOR here, then make it granite behind the player's back - the
     * shape a wall-remembered-as-passable takes after an earth-remoulding. */
    state.chunk.setFeat(EAST, FLOOR);
    squareMemorize(state, EAST);
    state.chunk.setFeat(EAST, GRANITE);
    state.msg = (): void => {};

    walkAction(state, { code: "walk", dir: 6 });

    /* square_forget: the stale memory is dropped rather than left contradicting
     * what the player just walked into. */
    expect(squareIsKnown(state, EAST)).toBe(false);
  });

  it("re-memorizes rubble the player misremembered as floor (:1243-1246)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    state.chunk.setFeat(EAST, FLOOR);
    squareMemorize(state, EAST);
    state.chunk.setFeat(EAST, RUBBLE);
    state.msg = (): void => {};

    walkAction(state, { code: "walk", dir: 6 });

    expect(knownFeat(state, EAST)).toBe(RUBBLE);
  });
});
