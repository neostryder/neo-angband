/**
 * The MCP server, driven against a real game.
 *
 * Every test here boots the actual engine and calls the actual tool handlers. No
 * fake view, no stubbed session. That is deliberate, and it is why this file
 * exists rather than a set of unit tests over the renderers: the Borg's own tests
 * run against a hand-built fake AgentView (its harness.ts header says so), and the
 * consequence was that the LIVE perceive path had never been driven by anything
 * but the web shell - which is how a 12740-cell level with `known` false on every
 * single square, including the player's own, went unnoticed. A fake view has
 * whatever fields the fake sets.
 *
 * Seeds are fixed, because the engine is a function of its seed and a flaky
 * roguelike test is a test nobody trusts. Nothing here asserts a specific dungeon
 * layout, though - only invariants that hold at any seed, so a content change does
 * not turn these red for the wrong reason.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { GameHost } from "./host.js";
import { TOOLS, callTool, stepTarget } from "./tools.js";
import { DIRECTION_KEYPAD, directionTo, distance, renderMap } from "./render.js";

/** One host per describe block; booting a game costs ~1s of level generation. */
function bootedHost(seed: number, depth = 1): GameHost {
  const host = new GameHost();
  host.newGame({ seed, depth });
  return host;
}

describe("the tool table", () => {
  it("names every tool uniquely and describes each one", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThan(10);
    for (const tool of TOOLS) {
      expect(tool.name, "tool name").toMatch(/^[a-z][a-z0-9_]*$/u);
      /* A description a model cannot act on is a tool it will misuse. These are
       * long on purpose; the floor is here so a future one-liner fails. */
      expect(tool.description.length, `${tool.name} description`).toBeGreaterThan(60);
      expect(tool.inputSchema["type"]).toBe("object");
    }
  });

  it("marks exactly the read-only tools as read-only", () => {
    /* Pinned as a LIST, not a count: the annotation is what an MCP client uses to
     * decide whether a call needs confirmation, so a tool that silently became
     * mutating must fail here rather than shift a number. */
    const readOnly = TOOLS.filter((t) => !t.mutates).map((t) => t.name);
    expect([...readOnly].sort()).toEqual([
      "commands",
      "inventory",
      "look",
      "map",
      "shop",
      "spells",
      "status",
    ]);
  });

  it("refuses every game tool before a game exists, and says how to start one", () => {
    const host = new GameHost();
    for (const tool of TOOLS) {
      if (tool.name === "new_game" || tool.name === "commands") continue;
      const result = callTool(host, tool.name, {});
      expect(result.isError, `${tool.name} before new_game`).toBe(true);
      expect(result.text, tool.name).toContain("new_game");
    }
  });

  it("reports an unknown tool rather than throwing", () => {
    const result = callTool(new GameHost(), "teleport_to_win", {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Unknown tool");
  });
});

describe("a live game", () => {
  let host: GameHost;
  beforeAll(() => {
    host = bootedHost(20260731);
  });

  it("starts a character and reports the seed that produced it", () => {
    const text = callTool(host, "new_game", { seed: 4242 }).text;
    expect(text).toContain("seed 4242");
    expect(text).toContain("Human Warrior");
    /* The determinism ratchet: an agent is not a seeded RNG, and a character it
     * touched must say so. Read back from the session rather than asserted from
     * the option we passed in. */
    expect(host.session()?.nondeterministic).toBe(true);
  });

  it("honours race and class, and refuses a name that does not exist", () => {
    expect(callTool(host, "new_game", { seed: 7, race: "Half-Troll", class: "Priest" }).text).toContain(
      "Half-Troll Priest",
    );
    const bad = callTool(host, "new_game", { seed: 7, race: "Balrog" });
    expect(bad.isError).toBe(true);
    expect(bad.text.toLowerCase()).toContain("balrog");
  });

  it("replays a seed exactly", () => {
    /* Decision 22: the engine is a function of its seed. Two games at one seed
     * must agree on the level, which is the property that makes reporting the
     * seed worth anything. */
    const a = new GameHost();
    a.newGame({ seed: 999, depth: 2 });
    const b = new GameHost();
    b.newGame({ seed: 999, depth: 2 });
    expect(a.session()?.view.player().grid).toEqual(b.session()?.view.player().grid);
    expect(renderMap(a.session()!.view).rows).toEqual(renderMap(b.session()!.view).rows);
  });
});

describe("the map an agent actually sees", () => {
  let host: GameHost;
  beforeAll(() => {
    host = bootedHost(4242);
  });

  it("knows where the player is standing", () => {
    /* THE REGRESSION. Measured before the session refreshed the derived view:
     * 0 of 12740 cells had `known` set, so this drew a rectangle of spaces and an
     * agent had no map at all. `runGameLoop` does not refresh the field of view;
     * the web shell does it on every render, and so must every other host. */
    const view = host.session()!.view;
    const player = view.player();
    const own = view.cell(player.grid.x, player.grid.y);
    expect(own?.known, "the player's own square must be known").toBe(true);

    const map = renderMap(view);
    const centre = map.rows[player.grid.y - map.window.y0]?.[player.grid.x - map.window.x0];
    expect(centre, "the player should be drawn as @").toBe("@");
  });

  it("draws something other than blank space", () => {
    /* Guards the guard: "@ is at the centre" is also true of a map that is one @
     * in a field of nothing, which is exactly the bug. */
    const map = renderMap(host.session()!.view);
    const drawn = map.rows.join("").replace(/ /gu, "");
    expect(drawn.length, "a map of only spaces is the no-known-cells bug").toBeGreaterThan(5);
    expect(drawn).toContain("@");
  });

  it("remembers where it has been", () => {
    const before = knownCount(host);
    for (let i = 0; i < 12; i++) callTool(host, "walk", { direction: "north" });
    expect(knownCount(host)).toBeGreaterThan(before);
  });

  it("shows the whole level on request, and a window by default", () => {
    const view = host.session()!.view;
    const bounds = view.mapBounds();
    const full = renderMap(view, { full: true });
    expect(full.rows.length).toBe(bounds.height);
    expect(full.rows[0]?.length).toBe(bounds.width);

    const window = renderMap(view, { radiusX: 5, radiusY: 3 });
    expect(window.rows.length).toBeLessThanOrEqual(7);
  });

  it("legends every monster and floor pile it draws, and nothing else", () => {
    /* This used to count `[0-9a-z]` characters in the map and compare that to
     * the legend length, which was wrong in both directions the moment the map
     * started drawing REAL glyphs: a store entrance is `1`-`8` and would be
     * counted as a legend entry, while a floor `!` or `?` would not be counted
     * at all. Counted from the VIEW instead - the map and the legend are two
     * renderings of the same squares, so the squares are what they must agree
     * on. */
    const view = host.session()!.view;
    const map = renderMap(view, { full: true });
    const monsters = new Map(view.monsters().map((m) => [m.id, m]));
    let expected = 0;
    const player = view.player();
    for (let y = 0; y < view.mapBounds().height; y++) {
      for (let x = 0; x < view.mapBounds().width; x++) {
        const cell = view.cell(x, y);
        if (!cell?.known) continue;
        if (x === player.grid.x && y === player.grid.y) continue;
        if (cell.monster !== 0 && monsters.get(cell.monster)?.visible === true) expected++;
        else if (cell.objectCount > 0) expected++;
      }
    }
    expect(map.legend.length).toBe(expected);
    for (const line of map.legend) {
      expect(line, "a legend line must name the square it is about").toMatch(
        /^. at \d+,\d+ = /u,
      );
    }
  });

  it("draws the characters the GAMEDATA gives, not a table of its own", () => {
    /* The defect this renderer was rebuilt for. Pinned against the pack rather
     * than against a literal: a glyph list in here would be the same second
     * source of truth that got lava wrong (see render.ts's header).
     *
     * The TOWN, not the shared dungeon host: it is lit end to end (measured,
     * 1451 painted cells against 15 for a dark corridor, which is not enough
     * map to catch anything), and it is where the old scheme actually broke -
     * the eight store entrances draw `1`-`8`, the very characters it handed out
     * as monster labels. */
    const view = bootedHost(4242, 0).session()!.view;
    const map = renderMap(view, { full: true });
    const drawn = new Set(map.rows.join("").split(""));
    drawn.delete(" ");
    drawn.delete("@");

    const legal = new Set<string>();
    for (let y = 0; y < view.mapBounds().height; y++) {
      for (let x = 0; x < view.mapBounds().width; x++) {
        const c = view.cell(x, y);
        if (!c) continue;
        for (const g of [c.glyph, c.trapGlyph, c.objectGlyph]) if (g !== undefined) legal.add(g);
      }
    }
    for (const m of view.monsters()) if (m.glyph !== undefined) legal.add(m.glyph);

    /* Guards the guard: "every character drawn is a legal one" is vacuously
     * true of a map that draws nothing, which is the exact shape of the
     * no-known-cells bug two tests up. Counted in CELLS, not in distinct
     * characters - a corridor legitimately has only a few of the latter. */
    const painted = map.rows.join("").replace(/[ ]/gu, "").length;
    expect(painted, "a map of only spaces is the no-known-cells bug").toBeGreaterThan(20);
    for (const ch of drawn) {
      expect(legal.has(ch), `"${ch}" is on the map but is no glyph the view reports`).toBe(true);
    }
  });

  it("does not show an agent a trap the player has not found", () => {
    /* Measured before this: over 15 fresh levels, 74 trapped squares, 74 of them
     * undetected, and the renderer drew `^` on every one. A view field named
     * `trap` that means "a trap is here" is the trap; `trapGlyph` is the one
     * that means "the player can see it". */
    const view = host.session()!.view;
    let undetected = 0;
    for (let y = 0; y < view.mapBounds().height; y++) {
      for (let x = 0; x < view.mapBounds().width; x++) {
        const c = view.cell(x, y);
        if (c?.trap === true && c.trapGlyph === undefined) undetected++;
      }
    }
    if (undetected === 0) return; // nothing to prove on a level with no traps
    const map = renderMap(view, { full: true });
    const shown = map.rows.join("").split("").filter((ch) => ch === "^").length;
    expect(shown, `${String(undetected)} undetected traps on this level`).toBe(0);
  });

  it("resolves the view's glyphs at all - the fallback is not what is running", () => {
    /* NO_GLYPH is a blank, and a blank is also what an unknown square draws, so
     * a renderer whose glyph dep silently went missing would look like a mostly
     * unexplored level rather than like a fault. This is the assertion that
     * fails if session.ts stops passing `glyphs`. */
    const view = host.session()!.view;
    const own = view.cell(view.player().grid.x, view.player().grid.y);
    expect(own?.glyph, "the live session must supply the glyph dep").toBeTypeOf("string");
  });
});

function knownCount(host: GameHost): number {
  const view = host.session()!.view;
  const bounds = view.mapBounds();
  let known = 0;
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      if (view.cell(x, y)?.known === true) known++;
    }
  }
  return known;
}

describe("acting", () => {
  let host: GameHost;
  beforeAll(() => {
    host = bootedHost(4242);
  });

  it("reports the messages the engine emitted, including a refusal", () => {
    /* seed 4242 starts in a dead end with a wall east. A refused command costs no
     * game time and SAYS SO, which is the difference between an agent that adapts
     * and one that walks into a wall forever. */
    const result = callTool(host, "walk", { direction: "east" });
    expect(result.text).toContain("There is a wall in the way!");
    expect(result.text).toContain("0 game turn(s) passed");
  });

  it("accepts a direction as a digit or a compass word, identically", () => {
    const a = new GameHost();
    a.newGame({ seed: 555 });
    const b = new GameHost();
    b.newGame({ seed: 555 });
    const byWord = callTool(a, "walk", { direction: "north" }).text;
    const byDigit = callTool(b, "walk", { direction: 8 }).text;
    expect(byWord).toBe(byDigit);
  });

  it("rejects a direction that is not one", () => {
    const result = callTool(host, "walk", { direction: "upwards" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("keypad digit");
  });

  it("refuses to attack an empty square instead of moving into it", () => {
    /* The whole reason `attack` exists next to `walk`: upstream melee IS walking
     * into a monster, so an agent that meant to attack and hit floor gets a move
     * it did not ask for, and the result text looks the same either way. */
    const view = host.session()!.view;
    const player = view.player();
    const empty = [1, 2, 3, 4, 6, 7, 8, 9].find((dir) => {
      const t = stepTarget(player.grid, dir);
      return view.cell(t.x, t.y)?.monster === 0;
    });
    expect(empty, "the test needs one empty adjacent square").toBeDefined();
    const before = view.player().grid;
    const result = callTool(host, "attack", { direction: empty as number });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("No monster");
    expect(view.player().grid, "a refused attack must not move the player").toEqual(before);
  });

  it("passes an arbitrary command through, and refuses one the registry lacks", () => {
    expect(callTool(host, "act", { code: "hold" }).text).toContain("hold");
    const bogus = callTool(host, "act", { code: "ascend_to_heaven" });
    expect(bogus.isError).toBe(true);
  });

  it("rests, and rest can cost many turns", () => {
    const result = callTool(host, "rest", {});
    const turns = /(\d+) game turn\(s\) passed/u.exec(result.text);
    expect(turns).not.toBeNull();
    expect(Number(turns?.[1])).toBeGreaterThan(0);
  });

  it("lists items with the handle the item tools take", () => {
    const text = callTool(host, "inventory", {}).text;
    expect(text).toContain("handle");
    const handle = /\[handle (\d+)\]/u.exec(text);
    expect(handle, "a starting Warrior carries gear").not.toBeNull();
    /* And the handle WORKS: a wear of a carried torch either succeeds or is
     * refused for a game reason, never "no such item". */
    const used = callTool(host, "use_item", { action: "wear", handle: Number(handle?.[1]) });
    expect(used.text).not.toContain("must be an integer");
  });

  it("refuses an item action it does not have", () => {
    const result = callTool(host, "use_item", { action: "sharpen", handle: 1 });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("unknown action");
  });
});

describe("read-only tools take no game time", () => {
  it("leaves the turn counter alone", () => {
    const host = bootedHost(31337);
    const before = host.session()!.turn;
    for (const tool of TOOLS.filter((t) => !t.mutates)) {
      callTool(host, tool.name, tool.name === "look" ? { x: 1, y: 1 } : {});
    }
    expect(host.session()!.turn).toBe(before);
  });
});

describe("directions", () => {
  it("maps every compass word to a distinct keypad digit", () => {
    const digits = Object.values(DIRECTION_KEYPAD);
    expect(new Set(digits).size).toBe(digits.length);
    expect(digits).toContain(5);
  });

  it("agrees with stepTarget in both directions, for all eight steps", () => {
    /* directionTo and stepTarget are inverses, and a sign error in either would
     * send an agent the wrong way with no message to show it. y increases SOUTH. */
    const origin = { x: 10, y: 10 };
    for (const dir of [1, 2, 3, 4, 6, 7, 8, 9]) {
      const target = stepTarget(origin, dir);
      expect(directionTo(origin, target), `dir ${String(dir)} round trip`).toBe(dir);
      expect(distance(origin, target)).toBe(1);
    }
  });

  it("puts north above and south below", () => {
    expect(stepTarget({ x: 5, y: 5 }, DIRECTION_KEYPAD["north"] as number)).toEqual({ x: 5, y: 4 });
    expect(stepTarget({ x: 5, y: 5 }, DIRECTION_KEYPAD["south"] as number)).toEqual({ x: 5, y: 6 });
    expect(stepTarget({ x: 5, y: 5 }, DIRECTION_KEYPAD["east"] as number)).toEqual({ x: 6, y: 5 });
    expect(stepTarget({ x: 5, y: 5 }, DIRECTION_KEYPAD["west"] as number)).toEqual({ x: 4, y: 5 });
  });
});

describe("the host owns one game at a time", () => {
  it("replaces the session and uninstalls the old controller", () => {
    const host = new GameHost();
    const first = host.newGame({ seed: 1 });
    const second = host.newGame({ seed: 2 });
    expect(host.session()).toBe(second);
    expect(host.gamesStarted).toBe(2);
    /* The old session's controller is unbound, so the abandoned GameState is not
     * left holding a live command provider. */
    expect(() => {
      first.perform(first.act_.hold());
    }).not.toThrow();
  });
});
