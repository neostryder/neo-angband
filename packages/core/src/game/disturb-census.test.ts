/**
 * The disturb() census: every upstream `disturb(p)` accounted for.
 *
 * WHY THIS EXISTS, AND WHAT IT IS PAYING FOR
 *
 * disturb() (player-util.c:1645) stops a run, cancels a rest, frees the path
 * steps and flushes the command queue. Upstream calls it from 53 places, and
 * every one of them is a promise to the player: THIS is a thing you would want to
 * know about, so this will not keep walking you into the dark. A missing call is
 * invisible in review - the function is right, the caller is simply not there -
 * and no coverage guard, lint rule or behaviour test in this repo could see it,
 * because nothing can distinguish a function nobody calls YET from one nobody
 * needs to call.
 *
 * It cost three wrong answers in one sitting to learn that:
 *
 *  1. "disturb() has zero callers" - from grepping the port for the C's own
 *     spelling. It had eleven importers.
 *  2. "there are 38 upstream sites" - from grepping `disturb(player)` when the C
 *     also writes `disturb(p)`. There are 53, and the 15 that grep could not see
 *     included the player's own melee, a monster's blow landing, and the two run
 *     safety-stops that are the whole point of the DTrap indicator.
 *  3. Three separate claims about which of them were ported, each built on one of
 *     the above.
 *
 * So the census is derived from the C, not declared: UPSTREAM below is a reading
 * that the parser has to agree with. Get the pattern wrong and the totals part
 * company, which is exactly what should have happened the first two times.
 *
 * The port side is a flat count per file. It is coarse on purpose - keying it to
 * line numbers would fail on every unrelated edit and get switched off - but it
 * fails the moment a call is deleted, and PORT_SITES names what each one is for,
 * so the failure message says which behaviour just went missing.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const C_SRC = join(ROOT, "reference", "src");
const PORT = join(ROOT, "packages", "core", "src");

/**
 * BOTH spellings. The C passes the global `player` in some files and a local
 * `struct player *p` in others, and a census that knows only one of them
 * undercounts by 15 without saying so.
 */
const CALL = /\bdisturb\((?:player|p)\);/;

/** The identifier immediately before the '(' of a column-0 function definition. */
const DEFN = /^[A-Za-z_][\w *]*?([A-Za-z_]\w*)\s*\(/;

/** Upstream census: "file:function" -> number of disturb() calls in it. */
function censusC(): Map<string, number> {
  const out = new Map<string, number>();
  const files = new Set(UPSTREAM.map((u) => u.at.split(":")[0] as string));
  for (const file of files) {
    const lines = readFileSync(join(C_SRC, file), "utf8").split(/\r?\n/u);
    let fn = "?";
    for (const line of lines) {
      const d = DEFN.exec(line);
      /* A definition line, not a call or a declaration inside a body. */
      if (d && !line.startsWith(" ") && !line.startsWith("\t")) fn = d[1] as string;
      if (CALL.test(line)) {
        const key = `${file}:${fn}`;
        out.set(key, (out.get(key) ?? 0) + 1);
      }
    }
  }
  return out;
}

/**
 * Every upstream disturb() call, by the function that makes it, with what the
 * port does about it. `port` names the port file that carries the equivalent, or
 * a reason the port carries none.
 */
const UPSTREAM: readonly { at: string; sites: number; port: string }[] = [
  /* --- cmd-cave.c: the command layer --------------------------------- */
  {
    at: "cmd-cave.c:do_cmd_open",
    sites: 2,
    port: "queueCommandRepeat (game/context.ts) - both are `cancel repeat`, and NOT re-queueing is the cancellation",
  },
  { at: "cmd-cave.c:do_cmd_close", sites: 2, port: "queueCommandRepeat - cancel repeat" },
  { at: "cmd-cave.c:do_cmd_tunnel", sites: 2, port: "queueCommandRepeat - cancel repeat" },
  { at: "cmd-cave.c:do_cmd_disarm", sites: 2, port: "queueCommandRepeat - cancel repeat" },
  { at: "cmd-cave.c:do_cmd_alter_aux", sites: 1, port: "queueCommandRepeat - cancel repeat" },
  {
    at: "cmd-cave.c:move_player",
    sites: 3,
    port: "game/player-turn.ts walkAction - impassable grid, the known-trap run-stop, the DTRAP-edge run-stop",
  },
  {
    at: "cmd-cave.c:do_cmd_walk_test",
    sites: 1,
    port: "game/player-turn.ts walkAction - the SAME call as move_player's impassable branch; the port merges do_cmd_walk and move_player",
  },
  { at: "cmd-cave.c:do_cmd_hold", sites: 1, port: "game/player-turn.ts holdAction - the store-door disturb" },
  {
    at: "cmd-cave.c:display_feeling",
    sites: 1,
    port: "session/game.ts - the updateFov onFeeling callback (the reveal path, cave-view.c:852, is display_feeling(true)'s only caller)",
  },

  /* --- the rest, in file order -------------------------------------- */
  { at: "cmd-pickup.c:do_autopickup", sites: 1, port: "game/pickup.ts doAutopickup" },
  { at: "game-world.c:recharged_notice", sites: 1, port: "game/world.ts rechargedNotice" },
  {
    at: "game-world.c:process_world",
    sites: 3,
    port: "game/world.ts (faint from hunger) + game/loop.ts (word recall, deep descent)",
  },
  {
    at: "game-world.c:on_new_level",
    sites: 1,
    port: "session/game.ts - THREE calls, one per level-arrival path (see session/feeling-announce.test.ts)",
  },
  { at: "mon-attack.c:make_ranged_attack", sites: 1, port: "game/mon-ranged.ts" },
  {
    at: "mon-attack.c:make_attack_normal",
    sites: 2,
    port: "combat/mon-melee.ts via the env.disturb hook supplied by game/mon-side.ts - a connecting blow and a visible miss, NEITHER of which take_hit covers",
  },
  { at: "mon-move.c:monster_turn_can_move", sites: 1, port: "game/monster-turn.ts" },
  { at: "mon-move.c:monster_turn", sites: 1, port: "game/monster-turn.ts" },
  { at: "mon-spell.c:do_mon_spell", sites: 1, port: "game/mon-cast.ts" },
  { at: "mon-util.c:update_mon", sites: 2, port: "game/known.ts - appearance and disappearance in view" },
  { at: "obj-curse.c:do_curse_effect", sites: 1, port: "game/curse-tick.ts" },
  { at: "obj-gear.c:pack_overflow", sites: 1, port: "game/obj-cmd.ts" },
  { at: "player-attack.c:py_attack", sites: 1, port: "game/player-turn.ts attackMonster" },
  { at: "player-path.c:run_step", sites: 7, port: "game/player-path.ts runStep + pathfindStep" },
  { at: "player-timed.c:player_set_timed", sites: 1, port: "session/game.ts timedHooks.onNotify" },
  { at: "player-util.c:take_hit", sites: 1, port: "game/take-hit-hooks.ts onDisturb" },
  { at: "player-util.c:player_update_light", sites: 2, port: "game/world.ts - light out, light growing faint" },
  {
    at: "player-util.c:player_resting_complete_special",
    sites: 3,
    port: "the HOST owns the rest lifecycle (restingCompleteSpecial, web/src/main.ts): it returns true and the host stops the rest, which is the disturb's whole effect there",
  },
  {
    at: "player-util.c:player_handle_post_move",
    sites: 1,
    port: "game/player-turn.ts walkAction - the store-door disturb after a step",
  },
  {
    at: "player-util.c:search",
    sites: 2,
    port: "game/player-turn.ts search - a found secret door, a discovered chest trap",
  },
  { at: "project-player.c:project_p", sites: 1, port: "game/take-hit-hooks.ts - the same onDisturb take_hit uses" },
  { at: "trap.c:hit_trap", sites: 1, port: "session/game.ts - the trap env's disturb" },
  {
    at: "ui-game.c:check_for_player_interrupt",
    sites: 1,
    port: "game/loop.ts checkForPlayerInterrupt",
  },
  {
    at: "ui-game.c:save_game_checked",
    sites: 1,
    port: "the HOST's save flow; saving from the game menu is not reachable mid-run in either host",
  },
];

/**
 * Port files that call disturb(), and how many times. Update this WITH the code,
 * and say what each call is - the number on its own is not evidence of anything.
 */
const PORT_SITES: readonly { file: string; n: number; what: string }[] = [
  { file: "game/curse-tick.ts", n: 1, what: "do_curse_effect" },
  { file: "game/known.ts", n: 2, what: "update_mon: appears in view, leaves view" },
  { file: "game/loop.ts", n: 3, what: "check_for_player_interrupt, word recall, deep descent" },
  { file: "game/mon-cast.ts", n: 1, what: "do_mon_spell" },
  { file: "game/mon-ranged.ts", n: 1, what: "make_ranged_attack" },
  { file: "game/mon-side.ts", n: 1, what: "the env.disturb make_attack_normal calls at two points" },
  { file: "game/monster-turn.ts", n: 2, what: "a bashed door, a visible monster that cannot move" },
  { file: "game/obj-cmd.ts", n: 1, what: "pack_overflow" },
  { file: "game/pickup.ts", n: 1, what: "do_autopickup" },
  {
    file: "game/player-path.ts",
    n: 8,
    what: "run_step's 7 stops plus the blocked-step stop move_player performs",
  },
  {
    file: "game/player-turn.ts",
    n: 8,
    what:
      "py_attack; the known-trap run-stop; the impassable grid (move_player + do_cmd_walk_test, merged); " +
      "the DTRAP edge; the store door after a step; a found secret door; a discovered chest trap; the store door on hold",
  },
  { file: "game/take-hit-hooks.ts", n: 1, what: "take_hit / project_p" },
  {
    file: "game/world.ts",
    n: 4,
    what: "recharged_notice, fainting from hunger, light gone out, light growing faint",
  },
  {
    file: "session/game.ts",
    n: 7,
    what: "3 level arrivals, the feeling reveal, take_hit's onDisturb, the trap env, timed onNotify",
  },
];

/** disturb() calls in a port file: the two spellings the port uses. */
function countPort(file: string): number {
  const text = readFileSync(join(PORT, file), "utf8");
  return (text.match(/\bdisturb\((?:state|s)\)/gu) ?? []).length;
}

describe("upstream's disturb() census", () => {
  it("is read correctly - the parser agrees with UPSTREAM, both ways", () => {
    const parsed = censusC();
    const declared = new Map(UPSTREAM.map((u) => [u.at, u.sites]));

    const missing = [...parsed].filter(([k, n]) => declared.get(k) !== n);
    const extra = [...declared].filter(([k, n]) => (parsed.get(k) ?? 0) !== n);
    expect(
      { parsedButNotDeclared: missing, declaredButNotParsed: extra },
      "the reference's disturb() sites moved. Re-derive UPSTREAM from the C; do not " +
        "adjust the numbers to match a guess.",
    ).toEqual({ parsedButNotDeclared: [], declaredButNotParsed: [] });
  });

  it("totals 53 calls across 16 files", () => {
    /* The number that was 38 for as long as the census grepped one spelling. It is
     * asserted so a future reader can see at a glance whether the pattern still
     * finds everything, rather than trusting that it does. */
    const parsed = censusC();
    const total = [...parsed.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(53);
    expect(new Set([...parsed.keys()].map((k) => k.split(":")[0])).size).toBe(16);
  });
});

describe("the port's disturb() calls", () => {
  it("has exactly the calls PORT_SITES claims", () => {
    const wrong = PORT_SITES.filter((p) => countPort(p.file) !== p.n).map((p) => ({
      file: p.file,
      expected: p.n,
      found: countPort(p.file),
      forWhat: p.what,
    }));
    expect(
      wrong,
      "a disturb() call was added or removed. If removed, the behaviour in `forWhat` " +
        "is now silently absent - that is the whole failure mode this file exists for.",
    ).toEqual([]);
  });

  it("has no disturb() calls outside PORT_SITES", () => {
    /* The other direction: a new call in a file nobody listed is a site that was
     * never reconciled against the C, and the next census would miss it. */
    const known = new Set(PORT_SITES.map((p) => p.file));
    const stray: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(join(PORT, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory()) {
          walk(rel);
        } else if (e.name.endsWith(".ts") && !e.name.includes(".test.")) {
          if (countPort(rel) > 0 && !known.has(rel)) stray.push(rel);
        }
      }
    };
    walk("");
    expect(stray, "reconcile these against UPSTREAM, then list them in PORT_SITES").toEqual([]);
  });

  it("every UPSTREAM row names a port file that exists, or says why there is none", () => {
    /* A row whose `port` is a path must be a real path: the disposition of an
     * upstream site cannot rot into a reference to a file that was renamed away. */
    const paths = UPSTREAM.flatMap((u) => u.port.match(/(?:game|session|combat|player|obj)\/[\w.-]+\.ts/gu) ?? []);
    expect(paths.length).toBeGreaterThan(10);
    const gone = paths.filter((p) => !existsSync(join(PORT, p)));
    expect(gone).toEqual([]);
  });
});
