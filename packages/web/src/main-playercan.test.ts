/**
 * Source-pattern guards for a handful of standalone main.ts hunks from the
 * W1-playercan WIP snapshot: the player_can_*_prereq gates (player-util.c:1246
 * player_can_cast_prereq, :1255 player_can_study_prereq, :1287
 * player_can_refuel_prereq), the player_random_name wiring for birth
 * (player.c:375), and the resting-repeat-count reset (cmd-cave.c:1662-1664).
 *
 * main.ts cannot be imported directly in vitest: its module body reaches for
 * `document.getElementById`, `location.search`, and the live game pack at
 * load time (see command-lookup.upstream.test.ts for the same constraint and
 * the same work-around). So these are spot-checks on the source text, same as
 * that file's "main.ts COMMANDS rows match the oracle keys" test: they fail
 * if the gating call is removed, which is the failure mode these hunks
 * actually guard against (a silently un-gated key).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "main.ts"),
  "utf8",
);

describe("player_can_cast_prereq / player_can_study_prereq gate 'm'/'G' (player-util.c:1246,1255)", () => {
  it("castSpell checks playerCanCast before opening the book-choose menu", () => {
    const fn = src.slice(src.indexOf("async function castSpell"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toMatch(/if \(!playerCanCast\(state, \{ msg: say \}\)\) return;/);
    /* The gate must precede the book chooser, not follow it. */
    expect(body.indexOf("playerCanCast")).toBeLessThan(body.indexOf("chooseBook"));
  });

  it("studySpell checks playerCanCast before its own new-spells check", () => {
    const fn = src.slice(src.indexOf("async function studySpell"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toMatch(/if \(!playerCanCast\(state, \{ msg: say \}\)\) return;/);
    const castIdx = body.indexOf("playerCanCast");
    const newSpellsIdx = body.indexOf("upkeep.newSpells");
    expect(castIdx).toBeGreaterThan(-1);
    expect(newSpellsIdx).toBeGreaterThan(-1);
    expect(castIdx).toBeLessThan(newSpellsIdx);
  });
});

describe("player_random_name wiring for birth (player.c:375)", () => {
  it("builds the RANDNAME_TOLKIEN prob table once and threads it to birth deps", () => {
    expect(src).toContain("booted.registries.nameSections.get(RANDNAME_TOLKIEN)");
    expect(src).toMatch(
      /randomName: \(\) => playerRandomName\(state\.rng, tolkienNameProbs\(\)\)/,
    );
  });
});

describe("player_can_refuel_prereq gates 'F' at the key (player-util.c:1287)", () => {
  it("playerCanRefuelPrereq checks the worn light for OF_TAKES_FUEL", () => {
    expect(src).toMatch(/function playerCanRefuelPrereq\(\): boolean/);
    expect(src).toContain('OF.TAKES_FUEL');
    expect(src).toContain('"Your light cannot be refuelled."');
  });

  it("the 'F' binding calls the prereq before opening the refuel picker", () => {
    expect(src).toMatch(
      /\{ o: "F", act: \(\) => \{ if \(playerCanRefuelPrereq\(\)\) void openModal\(refuelItem\); else render\(\); \} \}/,
    );
  });
});

describe("special-rest repeat-count reset (cmd-cave.c:1662-1664)", () => {
  it("driveRest clears restRepeatCount for every special ('&'/'*'/'!') rest", () => {
    const fn = src.slice(src.indexOf("async function driveRest"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toMatch(
      /if \(restingIsSpecial\(n\)\) restRepeatCount = 0;/,
    );
    // Must run before the rest object is built and driven, matching every
    // upstream turn of a special rest resetting it (resting_count stays
    // negative for special rests, so the C always takes that branch).
    const resetIdx = body.indexOf("restRepeatCount = 0");
    const restObjIdx = body.indexOf("const rest: RestingState");
    expect(resetIdx).toBeGreaterThan(-1);
    expect(restObjIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeLessThan(restObjIdx);
  });
});
