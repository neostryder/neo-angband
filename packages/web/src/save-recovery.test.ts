import { describe, expect, it } from "vitest";
import { SaveFromFutureError } from "@rpgm-tools/neo-angband-core";
import { describeLoadFailure, describeMigration } from "./save-recovery.js";

/* The terminal is a fixed 80 columns and the message line shares it with
 * nothing, but a line that reaches the edge reads as a wall. 78 leaves room. */
const MAX = 78;

describe("describeLoadFailure", () => {
  it("tells a player with a too-new save to update, and does not alarm them", () => {
    const line = describeLoadFailure(new SaveFromFutureError(99, 3));
    expect(line).toContain("newer version");
    expect(line).toContain("Update");
    for (const scary of ["corrupt", "damaged", "lost", "deleted", "new game"]) {
      expect(line.toLowerCase()).not.toContain(scary);
    }
  });

  it("promises, for every other failure, that the save was left alone", () => {
    for (const err of [
      new Error("unexpected token"),
      new TypeError("x is not a function"),
      "a thrown string",
      undefined,
    ]) {
      const line = describeLoadFailure(err);
      expect(line).toContain("untouched");
      /* The old message ended "starting a new game", which is precisely the
       * sentence that made players believe the character was gone. */
      expect(line.toLowerCase()).not.toContain("new game");
    }
  });

  it("fits the terminal", () => {
    expect(describeLoadFailure(new SaveFromFutureError(99, 3)).length).toBeLessThanOrEqual(MAX);
    expect(describeLoadFailure(new Error("x")).length).toBeLessThanOrEqual(MAX);
  });
});

describe("describeMigration", () => {
  it("says nothing when nothing was converted", () => {
    expect(describeMigration({ applied: [], notes: [] })).toBe("");
  });

  it("says the save was updated when it was", () => {
    const line = describeMigration({ applied: ["ids everywhere"], notes: [] });
    expect(line).toContain("updated");
    expect(line.length).toBeLessThanOrEqual(MAX);
  });

  it("leads with what was lost, because that is what the player must know", () => {
    const line = describeMigration({
      applied: ["ids everywhere"],
      notes: ["2 items referred to game data this build does not have."],
    });
    expect(line).toContain("2 items");
  });
});
