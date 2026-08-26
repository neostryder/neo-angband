/**
 * The ENTER command browser (PORT_TODO 3.18): textui_action_menu_choose
 * (ui-context.c:1268) over cmd_menu (:1157).
 *
 * No jsdom in this repo (see help.test.ts): a fake window plus a string-grid
 * term, the same shape the other browser tests use.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it, afterEach } from "vitest";
import {
  chooseCommand,
  commandEntryText,
  groupCommands,
  keyForKeyset,
  keypressToReadable,
  runCommandList,
  KEYPRESS_COMMAND_TABLE_ID,
  transformKeypressCommandTable,
} from "./command-menu";
import type { CommandCategory } from "./command-menu";
import { menuRegistry } from "./menu-registry";
import type { GlyphTerm } from "./term";

interface FakeWindow {
  addEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function makeFakeWindow(): FakeWindow {
  const listeners: { type: string; fn: (ev: Event) => void; capture: boolean }[] = [];
  return {
    addEventListener(type, fn, capture = false) {
      listeners.push({ type, fn, capture });
    },
    removeEventListener(type, fn, capture = false) {
      const i = listeners.findIndex(
        (l) => l.type === type && l.fn === fn && l.capture === capture,
      );
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(ev) {
      for (const l of [...listeners].filter((x) => x.type === ev.type)) l.fn(ev);
    },
  };
}

interface FakeTerm extends GlyphTerm {
  snapshot(): string[];
}

function makeTerm(cols = 80, rows = 24): FakeTerm {
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  return {
    size: () => ({ cols, rows }),
    clear: () => {
      for (const row of grid) row.fill(" ");
    },
    print: (x: number, y: number, text: string) => {
      const row = grid[y];
      if (!row) return;
      for (let i = 0; i < text.length && x + i < cols; i++) row[x + i] = text[i] ?? " ";
    },
    eraseToEol: () => undefined,
    setCursor: () => undefined,
    onCellTap: () => undefined,
    snapshot: () => grid.map((r) => r.join("").replace(/\s+$/u, "")),
  } as unknown as FakeTerm;
}

function press(win: FakeWindow, key: string): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
  win.dispatchEvent(ev);
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A cmds_all-shaped table, including a port addition and a keyset-only row. */
const ROWS = [
  { desc: "Inscribe an object", cat: "Items", o: "{" },
  { desc: "Take off/unwield an item", cat: "Items", o: "t", r: "T" },
  { desc: "Swap weapon", cat: null, o: "x", r: null },
  { desc: "Disarm a trap or chest", cat: "Action commands", o: "D" },
  { desc: "Fire at nearest target", cat: "Action commands", o: "h", r: "Tab" },
  { desc: "Repeat previous command", cat: "Hidden", o: "n", r: null },
  { desc: "Center map", cat: "Hidden", o: null, r: "@" },
];

function cats(rogue: boolean, ran: string[] = []): CommandCategory[] {
  /* keyForKeyset, not a copy of the rule: the shell calls the same function, so
   * these tests grade IT rather than a mirror of it. They graded a mirror
   * first, and "the browser ignores the keyset" survived the mutation run. */
  return groupCommands(
    ROWS,
    (row) => keyForKeyset(row, rogue),
    (row) => () => ran.push(row.desc),
  );
}

/**
 * `main.ts` owns the closures, so importing it would boot the browser shell.
 * Compile just its actual table builder and call it: every act remains an
 * uncalled closure, while the test exercises the exact declarations the shell
 * passes to transformKeypressCommandTable.
 */
function buildActualKeypressTable(): Array<{ desc: string; cat: string | null }> {
  const path = fileURLToPath(new URL("./main.ts", import.meta.url));
  const source = readFileSync(path, "utf8");
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.ES2023, false, ts.ScriptKind.TS);
  const declaration = parsed.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "buildCommandTable",
  );
  if (!declaration) throw new Error("main.ts no longer declares buildCommandTable");
  const emitted = ts.transpileModule(source.slice(declaration.getFullStart(), declaration.getEnd()), {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None },
  }).outputText;
  const build = new Function(
    "debugCommandCategories",
    `${emitted}\nreturn buildCommandTable;`,
  )(() => []);
  return build();
}

describe("groupCommands (cmds_all -> its lists)", () => {
  it("keeps upstream's list order and drops rows with no cmd_info behind them", () => {
    const g = cats(false);
    expect(g.map((c) => c.name)).toEqual(["Items", "Action commands", "Hidden"]);
    /* "Swap weapon" is the port's own row for the pref.prf w0 macro, not a
     * cmd_info entry, so upstream's menu cannot list it and neither does this. */
    expect(g.flatMap((c) => c.commands).map((c) => c.desc)).not.toContain("Swap weapon");
  });

  it("reads each row's key in the keyset the player is using", () => {
    const orig = new Map(cats(false).flatMap((c) => c.commands).map((c) => [c.desc, c.key]));
    const rogue = new Map(cats(true).flatMap((c) => c.commands).map((c) => [c.desc, c.key]));
    /* cmd_sub_entry reads commands[oid].key[mode] (:1132-1135). */
    expect(orig.get("Take off/unwield an item")).toBe("t");
    expect(rogue.get("Take off/unwield an item")).toBe("T");
    /* An ABSENT `r` means cmd_init copied key[0] into key[1] (ui-game.c:409-410)
     * - "same as original", NOT "no key". Nothing here checked that case under
     * the roguelike keyset, and treating absent as none survived a mutation. */
    expect(orig.get("Inscribe an object")).toBe("{");
    expect(rogue.get("Inscribe an object")).toBe("{");
    /* A row whose key moved to a control key in one keyset is still LISTED
     * there - it just shows no key, which is what key[mode] == 0 prints. */
    expect(orig.get("Repeat previous command")).toBe("n");
    expect(rogue.get("Repeat previous command")).toBeNull();
    expect(orig.get("Center map")).toBeNull();
    expect(rogue.get("Center map")).toBe("@");
  });
});

describe("keypress command table registry adapter", () => {
  afterEach(() => {
    menuRegistry.clear();
  });

  it("keeps an unmodded command table's commands, bindings, and order intact", () => {
    const ran: string[] = [];
    const table = [
      { desc: "Inscribe an object", cat: "Items", o: "{", act: () => ran.push("inscribe") },
      { desc: "Take off/unwield an item", cat: "Items", o: "t", r: "T", act: () => ran.push("take-off") },
      { desc: "Center map", cat: "Hidden", o: null, r: "@", act: () => ran.push("center") },
      { desc: "Debug mode commands", cat: "Hidden", o: null, r: null, ctrl: "A", act: () => ran.push("debug") },
    ];

    const actual = transformKeypressCommandTable(table, (id, rows) => {
      expect(id).toBe(KEYPRESS_COMMAND_TABLE_ID);
      return rows;
    });

    /* The assertion reads the adapter's actual output, including the original
     * closures, rather than deriving an expected table by transforming input
     * data in the test. This is the no-mod branch main.ts uses on every key. */
    expect(
      actual.map(({ id, desc, cat, o, r, ctrl }) => ({ id, desc, cat, o, r, ctrl })),
    ).toEqual([
      { id: "core:keypress-command:0", desc: "Inscribe an object", cat: "Items", o: "{", r: undefined, ctrl: undefined },
      { id: "core:keypress-command:1", desc: "Take off/unwield an item", cat: "Items", o: "t", r: "T", ctrl: undefined },
      { id: "core:keypress-command:2", desc: "Center map", cat: "Hidden", o: null, r: "@", ctrl: undefined },
      { id: "core:keypress-command:3", desc: "Debug mode commands", cat: "Hidden", o: null, r: null, ctrl: "A" },
    ]);
    actual.forEach((command) => command.act());
    expect(ran).toEqual(["inscribe", "take-off", "center", "debug"]);
  });

  it("keeps all 64 unmodded keypress commands in main.ts in their upstream table order", () => {
    const actual = transformKeypressCommandTable(buildActualKeypressTable(), (_id, rows) => rows);

    /* This is the live builder's output through the same transformation main.ts
     * calls. The expected order is deliberately recorded, not reconstructed from
     * the source rows, so removing or moving a command makes this fail. */
    expect(actual.map((command) => command.desc)).toEqual([
      "Inscribe an object",
      "Uninscribe an object",
      "Wear/wield an item",
      "Take off/unwield an item",
      "Examine an item",
      "Drop an item",
      "Fire your missile weapon",
      "Use a staff",
      "Aim a wand",
      "Zap a rod",
      "Activate an object",
      "Eat some food",
      "Quaff a potion",
      "Read a scroll",
      "Fuel your light source",
      "Use an item",
      "Disarm a trap or chest",
      "Rest for a while",
      "Look around",
      "Swap weapon",
      "Target monster or location",
      "Target closest monster",
      "Dig a tunnel",
      "Go up staircase",
      "Go down staircase",
      "Open a door or a chest",
      "Close a door",
      "Fire at nearest target",
      "Throw an item",
      "Walk into a trap",
      "Display equipment listing",
      "Display inventory listing",
      "Display quiver listing",
      "Pick up objects",
      "Ignore an item",
      "Browse a book",
      "Gain new spells",
      "View abilities",
      "Cast a spell",
      "Full dungeon map",
      "Toggle ignoring of items",
      "Display visible item list",
      "Display visible monster list",
      "Locate player on map",
      "Identify symbol",
      "Character description",
      "Check knowledge",
      "Interact with options",
      "Retire character and quit",
      "Save \"screen dump\"",
      "Take notes",
      "Version info",
      "Load a single pref line",
      "Alter a grid",
      "Steal from a monster",
      "Walk",
      "Start running",
      "Stand still",
      "Stand still (numpad)",
      "Start exploring",
      "Repeat previous command",
      "Center map",
      "Debug mode commands",
      "Borg commands",
    ]);
  });

  it("gives a mod declarations only, then applies its label, category, and binding rewrite", () => {
    const run = () => undefined;
    const seen: unknown[] = [];
    menuRegistry.forOwner("key-rebinder").register(KEYPRESS_COMMAND_TABLE_ID, (_id, rows) => {
      seen.push(rows[0]);
      return rows.map((row) =>
        row.label === "Inscribe an object"
          ? {
              ...row,
              label: "Etch a rune",
              semantic: {
                ...row.semantic,
                data: {
                  ...row.semantic.data,
                  category: "Runes",
                  originalKey: "!",
                  roguelikeUsesOriginal: false,
                  roguelikeKey: "#",
                },
              },
            }
          : row,
      );
    });

    const actual = transformKeypressCommandTable(
      [{ desc: "Inscribe an object", cat: "Items", o: "{", act: run }],
      (id, rows) => menuRegistry.transform(id, rows),
    );

    expect(seen[0]).toEqual({
      id: "core:keypress-command:0",
      label: "Inscribe an object",
      semantic: {
        kind: "keypress-command",
        ref: 0,
        data: {
          category: "Items",
          originalKey: "{",
          roguelikeKey: null,
          roguelikeUsesOriginal: true,
          controlKey: null,
        },
      },
    });
    expect(seen[0]).not.toHaveProperty("act");
    expect(actual).toMatchObject([
      { id: "core:keypress-command:0", desc: "Etch a rune", cat: "Runes", o: "!", r: "#", act: run },
    ]);
  });
});

describe("commandEntryText (cmd_sub_entry, ui-context.c:1126)", () => {
  it("appends the key in parentheses, and nothing when there is none", () => {
    expect(commandEntryText({ desc: "Quaff a potion", key: "q", run: () => undefined })).toBe(
      "Quaff a potion (q)",
    );
    expect(commandEntryText({ desc: "Center map", key: null, run: () => undefined })).toBe(
      "Center map",
    );
  });

  it("brackets a named key the way keypress_to_readable does", () => {
    expect(keypressToReadable("h")).toBe("h");
    expect(keypressToReadable("Tab")).toBe("[Tab]");
    /* A control key is "^" + the character and is NOT bracketed (:317-321).
     * The first version of this bracketed it, and the nested-tier test caught
     * it by printing "Debug mode commands ([^A])". */
    expect(keypressToReadable("^A")).toBe("^A");
    expect(commandEntryText({ desc: "Fire at nearest target", key: "Tab", run: () => undefined }))
      .toBe("Fire at nearest target ([Tab])");
  });
});

describe("chooseCommand (textui_action_menu_choose)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    menuRegistry.clear();
  });

  const open = (term: FakeTerm, rogue = false, ran: string[] = []) =>
    chooseCommand(term, cats(rogue, ran), () => term.clear());

  it("opens on the category list, boxed where window_make puts it", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = open(term);
    const shot = term.snapshot();
    /* window_make(19, 4, 58, 11); the names start at region col 21, row 5. */
    expect(shot[4]!.indexOf("+")).toBe(19);
    expect(shot[4]![58]).toBe("+");
    expect(shot[11]!.indexOf("+")).toBe(19);
    expect(shot[5]!.slice(21, 26)).toBe("Items");
    expect(shot[6]).toContain("Action commands");
    /* No letters on this screen - both upstream menus have a NULL get_tag. */
    for (const line of shot) expect(line).not.toMatch(/\b[a-z]\) /u);
    press(win, "Escape");
    await done;
  });

  it("lets a mod transform the real keypress command list before the player sees it", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    /* This is the same registry facade a loaded plugin receives.  The assertion
     * reads the actual command browser after its normal input route, rather than
     * calling the transformer or modelling its result in the test. */
    menuRegistry.forOwner("command-dial").register("core:keypress-command:items", (_id, rows) =>
      rows.map((row) =>
        row.label === "Inscribe an object ({)"
          ? { ...row, label: "Modded inscription ({)", tag: "z" }
          : row,
      ),
    );

    const done = open(term);
    press(win, "Enter"); // Items
    await tick();
    expect(term.snapshot().join("\n")).toContain("Modded inscription ({)");
    press(win, "z"); // the mod's explicit tag, before positional selection
    expect((await done)?.desc).toBe("Inscribe an object");
  });

  it("a category opens its commands, indented, with the category still behind", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = open(term);
    press(win, "Enter");
    await tick();
    const shot = term.snapshot();
    /* region { 23, 4, ... } boxed at col - 2 = 21, row - 1 = 3. */
    expect(shot[3]!.indexOf("+")).toBe(21);
    expect(shot[4]!.slice(23)).toContain("Inscribe an object ({)");
    /* The category box is NOT erased. Its interior IS covered - the command box
     * starts at column 21, exactly where the category names sit - so what stays
     * visible is its frame at columns 19-20. That is upstream's own geometry
     * (window_make(19,4,58,11) under a box at col 23 - 2), and it is why nesting
     * indents at all. The first version of this test asserted the names were
     * still readable; the screen dump says otherwise. */
    expect(shot[5]!.slice(19, 22)).toBe("| |");
    expect(shot[5]).not.toContain("Items");
    /* One tick between them: the first ESC resolves the command list, and the
     * category menu re-arms its listener on a microtask after that. Two ESCs in
     * a single tick means the second lands on nothing and the menu waits for
     * ever - which is a property of this fake window, not of the browser. */
    press(win, "Escape");
    await tick();
    press(win, "Escape");
    await done;
  });

  it("ESC in the command list goes back to the categories and leaves no frame behind", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    let resolved = false;
    const done = open(term).then(() => {
      resolved = true;
    });
    press(win, "Enter"); // into Items
    await tick();
    press(win, "Escape"); // back one level, NOT out (:1215-1221)
    await tick();
    expect(resolved).toBe(false);
    const shot = term.snapshot();
    expect(shot[5]).toContain("Items");
    /* screen_load: the command box is gone, not left drawn under the category
     * list. Its frame corner was at column 21 of row 3, and its right edge at
     * column 62 - neither of which the category box (19..58) ever touches. */
    expect(shot[3]).toBe("");
    for (const line of shot) expect(line.length).toBeLessThanOrEqual(59);

    press(win, "Escape"); // now out
    await tick();
    await done;
    expect(resolved).toBe(true);
  });

  it("choosing a command returns it WITHOUT running it", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const ran: string[] = [];
    const done = chooseCommand(term, cats(false, ran), () => term.clear());
    press(win, "Enter"); // Items
    await tick();
    press(win, "ArrowDown"); // Take off/unwield
    await tick();
    press(win, "Enter");
    const chosen = await done;
    expect(chosen?.desc).toBe("Take off/unwield an item");
    /* upstream returns the cmd_info and its CALLER dispatches, which is what
     * lets the shell put the row through key_confirm_command. */
    expect(ran).toEqual([]);
    chosen?.run();
    expect(ran).toEqual(["Take off/unwield an item"]);
  });

  it("both menus wrap at their ends", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = open(term);
    press(win, "ArrowUp"); // from the first category to the last
    await tick();
    press(win, "Enter");
    await tick();
    expect(term.snapshot()[4]).toContain("Repeat previous command");
    press(win, "Escape");
    await tick();
    press(win, "Escape");
    await done;
  });

  it("a category with no listable rows never appears", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const done = chooseCommand(
      term,
      [
        { name: "Items", commands: [{ desc: "Quaff a potion", key: "q", run: () => undefined }] },
        { name: "Empty", commands: [] },
      ],
      () => term.clear(),
    );
    const shot = term.snapshot();
    expect(shot.join("\n")).toContain("Items");
    expect(shot.join("\n")).not.toContain("Empty");
    press(win, "Escape");
    await done;
  });

  it("with nothing to list at all it resolves null without drawing", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    expect(await chooseCommand(term, [], () => term.clear())).toBeNull();
    expect(term.snapshot().join("")).toBe("");
  });
});

describe("runCommandList nesting (cmd_menu, :1174-1175)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("indents two columns right and one row up per level", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const cat: CommandCategory = {
      name: "Debug",
      commands: [{ desc: "Items", key: null, run: () => undefined }],
    };
    const done = runCommandList(term, cat, () => term.clear(), 1);
    const shot = term.snapshot();
    /* level 1: col 23 + 2 = 25, row 4 - 1 = 3, boxed at (23, 2). */
    expect(shot[2]!.indexOf("+")).toBe(23);
    expect(shot[3]!.slice(25)).toContain("Items");
    press(win, "Escape");
    await done;
  });
});

/**
 * The nested tier (cmd_menu recursing on nested_name, ui-context.c:1196-1213).
 * Upstream's only instance is "Debug mode commands" -> cmd_debug's nine
 * categories -> each cmd_debug_* list, and it is the reason those categories
 * are unreachable without this browser at all.
 */
describe("a placeholder row opens a nested list", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  const nested = (ran: string[]): CommandCategory[] => [
    {
      name: "Hidden",
      commands: [
        {
          desc: "Debug mode commands",
          key: "^A",
          run: () => ran.push("FLAT ^A PROMPT"),
          nested: () => [
            {
              name: "Teleport",
              commands: [{ desc: "Teleport to", key: "t", run: () => ran.push("teleport-to") }],
            },
            { name: "Empty category", commands: [] },
          ],
        },
      ],
    },
  ];

  it("descends two levels and returns the leaf command, not the placeholder", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const ran: string[] = [];
    const done = chooseCommand(term, nested(ran), () => term.clear());
    press(win, "Enter"); // Hidden
    await tick();
    expect(term.snapshot()[4]).toContain("Debug mode commands (^A)");
    press(win, "Enter"); // the placeholder -> the debug categories
    await tick();
    const shot = term.snapshot();
    expect(shot.join("\n")).toContain("Teleport");
    /* An empty cmd_debug_* list cannot be entered, so it is not offered. */
    expect(shot.join("\n")).not.toContain("Empty category");
    /* Each level indents two columns right and one row up (:1174-1175):
     * level 1 boxes at (23, 2), and the level-0 command box at (21, 3) is still
     * behind it. */
    expect(shot[2]!.indexOf("+")).toBe(23);
    press(win, "Enter"); // the Teleport category
    await tick();
    expect(term.snapshot()[2]).toContain("Teleport to (t)");

    press(win, "Enter"); // the leaf
    const chosen = await done;
    expect(chosen?.desc).toBe("Teleport to");
    /* The placeholder's own `run` - the flat ^A prompt - must NOT have fired:
     * upstream's placeholder has cmd and hook both NULL and only recurses. */
    expect(ran).toEqual([]);
    chosen?.run();
    expect(ran).toEqual(["teleport-to"]);
  });

  it("ESC climbs back one level at a time", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    let resolved = false;
    const done = chooseCommand(term, nested([]), () => term.clear()).then(() => {
      resolved = true;
    });
    press(win, "Enter"); await tick(); // Hidden
    press(win, "Enter"); await tick(); // debug categories
    press(win, "Enter"); await tick(); // Teleport's commands
    expect(term.snapshot()[2]).toContain("Teleport to (t)");

    press(win, "Escape"); await tick(); // back to the categories
    expect(term.snapshot().join("\n")).toContain("Teleport");
    expect(term.snapshot()[2]).not.toContain("Teleport to (t)");
    expect(resolved).toBe(false);

    press(win, "Escape"); await tick(); // back to Hidden
    expect(term.snapshot()[4]).toContain("Debug mode commands");
    expect(resolved).toBe(false);

    press(win, "Escape"); await tick(); // back to the categories
    press(win, "Escape"); await tick(); // out
    await done;
    expect(resolved).toBe(true);
  });
});
