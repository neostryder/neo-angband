import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// WP-11 command layer. main.ts is the ground truth for keyboard wiring; like
// options.test.ts / help.test.ts this reads it as source text and pins the
// faithful bindings + message strings so they cannot silently rot. The C
// oracle is cited on each expectation.
const MAIN_TS = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("WP-11 rest command (do_cmd_rest / textui_cmd_rest)", () => {
  it("prompts with the exact textui_cmd_rest string (ui-command.c:193)", () => {
    expect(MAIN_TS).toContain(
      "Rest (0-9999, '!' for HP or SP, '*' for HP and SP, '&' as needed): ",
    );
  });

  it("maps '&'/'*'/'!' to the REST_ constants (ui-command.c:200-215)", () => {
    // player-util.h:53-55: COMPLETE=-2, ALL_POINTS=-1, SOME_POINTS=-3.
    expect(MAIN_TS).toMatch(/REST_COMPLETE = -2/);
    expect(MAIN_TS).toMatch(/REST_ALL_POINTS = -1/);
    expect(MAIN_TS).toMatch(/REST_SOME_POINTS = -3/);
    expect(MAIN_TS).toMatch(/first === "&"\) n = REST_COMPLETE/);
    expect(MAIN_TS).toMatch(/first === "\*"\) n = REST_ALL_POINTS/);
    expect(MAIN_TS).toMatch(/first === "!"\) n = REST_SOME_POINTS/);
  });

  it("clamps entered turns to 1..9999 (ui-command.c:212-217)", () => {
    expect(MAIN_TS).toMatch(/Math\.min\(turns, 9999\)/);
  });

  it("drives the resting-state seam on GameState (loop.ts WIRING)", () => {
    // player_is_resting / player_resting_can_regenerate read state.resting.
    expect(MAIN_TS).toMatch(/StateWithRest\).resting = rest/);
    expect(MAIN_TS).toMatch(/REST_REQUIRED_FOR_REGEN = 5/);
    // player_resting_step_turn: decrement the count, bump the rested counter.
    expect(MAIN_TS).toMatch(/rest\.count -= 1/);
    expect(MAIN_TS).toMatch(/rest\.turnsRested \+= 1/);
  });

  it("binds 'R' to the rest command (cmd_action ui-game.c:142)", () => {
    expect(MAIN_TS).toMatch(/o: "R", act: \(\) => void openModal\(restCmd\)/);
  });
});

describe("WP-11 steal command (do_cmd_steal, cmd-cave.c:1039)", () => {
  it("binds 's' to the steal command (ui-game.c:216)", () => {
    expect(MAIN_TS).toMatch(/o: "s", act: \(\) => void openModal\(stealCmd\)/);
  });
  it("pushes the ported 'steal' core action with a direction", () => {
    expect(MAIN_TS).toMatch(/code: "steal", dir/);
  });
});

describe("WP-11 note command (do_cmd_note, cmd-misc.c:88)", () => {
  it("binds ':' to the note command (ui-game.c:211)", () => {
    expect(MAIN_TS).toMatch(/o: ":", act: \(\) => void openModal\(noteCmd\)/);
  });
  it("prompts 'Note: ' (cmd-misc.c:98)", () => {
    expect(MAIN_TS).toContain('"Note: "');
  });
  it("formats /say and /me exactly (cmd-misc.c:104-109)", () => {
    expect(MAIN_TS).toMatch(/tmp\.startsWith\("\/say "\)/);
    expect(MAIN_TS).toMatch(/says: "\$\{tmp\.slice\(5\)\}"/);
    expect(MAIN_TS).toMatch(/tmp\.startsWith\("\/me"\)/);
    expect(MAIN_TS).toMatch(/\$\{playerName\}\$\{tmp\.slice\(3\)\}/);
    expect(MAIN_TS).toMatch(/-- Note: \$\{tmp\}/);
  });
  it("ignores empty / space-first notes (cmd-misc.c:100)", () => {
    expect(MAIN_TS).toMatch(/!tmp\[0\] \|\| tmp\[0\] === " "/);
  });
  it("adds a HIST_USER_INPUT history entry (cmd-misc.c:114)", () => {
    expect(MAIN_TS).toMatch(/historyAdd\(state\.actor\.player, note, HIST\.USER_INPUT/);
  });
});

describe("WP-11 keyboard-parity sweep (ui-game.c cmd_* tables)", () => {
  it("binds tunnel 'T' (original) and ^T (cmd_action)", () => {
    // Original-keyset 'T' tunnels; the roguelike keyset uses ^T (r: null keeps
    // roguelike 'T' free for Take off).
    expect(MAIN_TS).toMatch(/o: "T", r: null, act: \(\) => void openModal\(tunnelCmd\)/);
    expect(MAIN_TS).toMatch(/void openModal\(tunnelCmd\)/);
  });
  it("binds close 'c' (cmd_action)", () => {
    expect(MAIN_TS).toMatch(/o: "c", act: \(\) => void openModal\(closeCmd\)/);
  });
  it("binds alter '+' (cmd_hidden)", () => {
    expect(MAIN_TS).toMatch(/o: "\+", act: \(\) => void openModal\(alterCmd\)/);
  });
  it("binds stand-still ',' (CMD_HOLD) and run '.' (CMD_RUN), swapped in roguelike", () => {
    // CMD_RUN {'.',','} and CMD_HOLD {',','.'} swap between keysets.
    expect(MAIN_TS).toMatch(/o: "\.", r: ",", act: \(\) => void openModal\(runDirCmd\)/);
    expect(MAIN_TS).toMatch(/o: ",", r: "\.", act: \(\) => holdCmd\(\)/);
    expect(MAIN_TS).toMatch(/code: "run", dir/);
  });
  it("binds ^S as a save alias (cmd_util)", () => {
    expect(MAIN_TS).toMatch(/ev\.key === "s" \|\| ev\.key === "S"/);
  });
});
