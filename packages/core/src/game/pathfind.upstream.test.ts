/**
 * Upstream unit tests from reference/src/tests/player/pathfind.c
 *
 * Mapping: pathfind_direction_to -> pathfindDirectionTo (player-path.ts).
 * DIR_* keypad values: N=8 S=2 E=6 W=4 NE=9 NW=7 SE=3 SW=1 NONE=5.
 */

import { describe, expect, it } from "vitest";
import { loc } from "../loc.js";
import { pathfindDirectionTo } from "./player-path.js";

describe("player/pathfind (reference/src/tests/player/pathfind.c)", () => {
  // upstream: test_dir_to
  it("dir-to", () => {
    expect(pathfindDirectionTo(loc(0, 0), loc(0, 1))).toBe(2); /* DIR_S */
    expect(pathfindDirectionTo(loc(0, 0), loc(1, 0))).toBe(6); /* DIR_E */
    expect(pathfindDirectionTo(loc(0, 0), loc(1, 1))).toBe(3); /* DIR_SE */
    expect(pathfindDirectionTo(loc(0, 0), loc(0, -1))).toBe(8); /* DIR_N */
    expect(pathfindDirectionTo(loc(0, 0), loc(-1, 0))).toBe(4); /* DIR_W */
    expect(pathfindDirectionTo(loc(0, 0), loc(-1, -1))).toBe(7); /* DIR_NW */
    expect(pathfindDirectionTo(loc(0, 0), loc(-1, 1))).toBe(1); /* DIR_SW */
    expect(pathfindDirectionTo(loc(0, 0), loc(1, -1))).toBe(9); /* DIR_NE */
    expect(pathfindDirectionTo(loc(0, 0), loc(0, 0))).toBe(5); /* DIR_NONE */

    expect(pathfindDirectionTo(loc(0, 0), loc(1, 10))).toBe(2); /* DIR_S */
    expect(pathfindDirectionTo(loc(0, 0), loc(8, 10))).toBe(3); /* DIR_SE */
    expect(pathfindDirectionTo(loc(0, 0), loc(12, 4))).toBe(6); /* DIR_E */
  });
});
