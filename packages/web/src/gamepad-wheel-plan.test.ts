/**
 * The wheel's split, checked against the REAL command table.
 *
 * The table lives inside `main.ts`, which cannot be imported here: it is the
 * entry module and evaluating it starts a game. So the rows are read out of the
 * source instead. That is deliberately not a hand-written fixture - a fixture
 * would be an unchecked assertion about the producer, and the one thing these
 * tests exist to prove is that no real command falls off the wheel.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandName, type ControlCommand } from "./control-surface";
import { iconNames, iconShapes, isIconName } from "./gamepad-wheel-icons";
import {
  WHEEL_GROUPS, entryFor, entryForSelector, groupCommands, missingIcons,
  namedSelectors, replyEntry, shortWord, unreachableCommands,
} from "./gamepad-wheel-plan";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(here, "main.ts"), "utf8");

/** The body of `buildCommandTable`, from its opening array to its `];`. */
function tableBody(): string {
  const start = SRC.indexOf("function buildCommandTable(): CommandRow[] {");
  expect(start).toBeGreaterThan(-1);
  const end = SRC.indexOf("\n  ];", start);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

/** A string literal in either quote style, unescaped. */
function literal(source: string, field: string): string | undefined {
  const match = new RegExp(`${field}: (?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)')`)
    .exec(source);
  if (!match) return undefined;
  return (match[1] ?? match[2] ?? "").replace(/\\(.)/g, "$1");
}

/**
 * Every command the surface hands the wheel, in the surface's own order:
 * `buildCommandTable`'s rows, then the eleven root commands that live outside
 * the cached keypress registry. Macros are per-player and are not part of the
 * shipped table.
 */
function realCommands(): readonly ControlCommand[] {
  const body = tableBody();
  const out: ControlCommand[] = [];
  const marks = [...body.matchAll(/desc:/g)].map((match) => match.index);
  marks.forEach((at, n) => {
    const window = body.slice(at, marks[n + 1] ?? body.length);
    const desc = literal(window, "desc");
    if (desc === undefined) return;
    const ctrl = literal(window, "ctrl");
    const original = literal(window, "o");
    const key = ctrl !== undefined ? `^${ctrl}` : original;
    out.push({
      id: `core:keypress-command:${n}`,
      label: desc,
      category: literal(window, "cat") ?? "Port",
      ...(key === undefined ? {} : { key }),
      run: () => {},
    });
  });

  const extraAt = SRC.indexOf("const extra = [");
  expect(extraAt).toBeGreaterThan(-1);
  const extra = SRC.slice(extraAt, SRC.indexOf("] as const;", extraAt));
  for (const match of extra.matchAll(/\["([^"]+)", "([^"]*)", (?:true|false)\]/g)) {
    out.push({
      id: `key:${match[2]}`, label: match[1]!, category: "System", run: () => {},
    });
  }
  return out;
}

describe("the command wheel's split", () => {
  const commands = realCommands();

  it("reads the real table rather than a fixture", () => {
    // 64 rows from the table plus the eleven root commands. A change to either
    // number should be a change somebody meant to make.
    expect(commands.length).toBe(75);
    expect(commands.map((command) => command.label)).toContain("Cast a spell");
    expect(commands.map((command) => command.label)).toContain("Command browser");
  });

  it("reaches every command", () => {
    expect(unreachableCommands(commands).map((command) => command.label)).toEqual([]);
  });

  it("puts every command on exactly one ring", () => {
    const seen = new Map<string, string[]>();
    for (const group of WHEEL_GROUPS) {
      for (const command of groupCommands(group, commands)) {
        seen.set(command.id, [...(seen.get(command.id) ?? []), group.id]);
      }
    }
    expect([...seen].filter(([, groups]) => groups.length !== 1)).toEqual([]);
    expect(seen.size).toBe(commands.length);
  });

  it("splits the rings the way the design document states", () => {
    const sizes = Object.fromEntries(
      WHEEL_GROUPS.map((group) => [group.id, groupCommands(group, commands).length]),
    );
    expect(sizes).toEqual({
      use: 8, magic: 4, fight: 7, gear: 8, travel: 8, carry: 7, map: 8, more: 25,
    });
  });

  it("names a word and an icon for every shipped command", () => {
    const unnamed = commands
      .filter((command) => entryForSelector(commandName(command)) === undefined)
      .map((command) => command.label);
    expect(unnamed).toEqual([]);
  });

  it("gives the first ring eight groups, each one word and one icon", () => {
    expect(WHEEL_GROUPS.length).toBe(8);
    for (const group of WHEEL_GROUPS) {
      expect(group.word).toMatch(/^[A-Z][a-z]+$/);
      expect(isIconName(group.icon)).toBe(true);
    }
  });

  it("labels every wedge with one word", () => {
    for (const selector of namedSelectors()) {
      const entry = entryForSelector(selector);
      expect(entry?.word).toMatch(/^\S+$/);
    }
  });

  it("draws every icon it references", () => {
    expect(missingIcons()).toEqual([]);
  });

  it("claims a selector at most once", () => {
    const claimed = WHEEL_GROUPS.flatMap((group) => group.members);
    expect(claimed.length).toBe(new Set(claimed).size);
  });

  it("carries a mod's own command to More rather than dropping it", () => {
    const mine: ControlCommand = {
      id: "mod:example:teleport", label: "Fold space", category: "Example",
      run: () => {},
    };
    const more = WHEEL_GROUPS.find((group) => group.id === "more")!;
    const reached = groupCommands(more, [...commands, mine]);
    expect(reached.map((command) => command.id)).toContain("mod:example:teleport");
    expect(entryFor(mine)).toEqual({ word: "Fold", icon: "command" });
  });

  it("marks a player keymap with the macro icon", () => {
    expect(entryFor({
      id: "macro:^F", label: "^F: nnn", category: "Macros", run: () => {},
    })).toEqual({ word: "^F", icon: "macro" });
  });
});

describe("the drawn icon set", () => {
  it("draws something for every name", () => {
    for (const name of iconNames()) {
      expect(iconShapes(name).length).toBeGreaterThan(0);
    }
  });

  it("keeps every stroke wide enough to survive a 30px draw over texture", () => {
    const thin = iconNames().flatMap((name) => iconShapes(name)
      .filter((shape) => shape.stroke !== undefined && shape.stroke < 1.6)
      .map(() => name));
    expect(thin).toEqual([]);
  });

  it("gives every shape exactly one geometry", () => {
    for (const name of iconNames()) {
      for (const shape of iconShapes(name)) {
        const kinds = [shape.d, shape.circle, shape.rect].filter((v) => v !== undefined);
        expect(kinds.length).toBe(1);
      }
    }
  });
});

describe("wedge words", () => {
  it("takes the first word and drops trailing punctuation", () => {
    expect(shortWord("Fire at nearest target")).toBe("Fire");
    expect(shortWord("Wear/wield an item")).toBe("Wear");
    expect(shortWord("Select target")).toBe("Select");
    expect(shortWord("Inven.")).toBe("Inven");
  });

  it("never returns an empty word", () => {
    expect(shortWord("   ")).toBe("   ");
  });
});

describe("prompt replies", () => {
  it("reads a role as its icon", () => {
    expect(replyEntry({ id: "key:Escape", label: "Cancel", role: "cancel", run: () => {} }))
      .toEqual({ word: "Cancel", icon: "cancel" });
    expect(replyEntry({ id: "key:t", label: "Select target", role: "accept", run: () => {} }))
      .toEqual({ word: "Select", icon: "accept" });
  });

  it("names the item sources and the target loop's own actions", () => {
    expect(replyEntry({ id: "key:/", label: "Inven", run: () => {} }).icon)
      .toBe("inventory");
    expect(replyEntry({ id: "key:o", label: "Free cursor", run: () => {} }).icon)
      .toBe("crosshair");
  });

  it("falls back rather than leaving a reply text-only", () => {
    expect(replyEntry({ id: "key:w", label: "Something new", run: () => {} }))
      .toEqual({ word: "Something", icon: "reply" });
  });
});
