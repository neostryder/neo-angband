/**
 * The two ui-display seams the shell has to supply, guarded from the source.
 *
 * PORT_TODO 3.17: the shell draws the sidebar through sidebarLayout.
 * PORT_TODO 3.15: displayDeps passes the pack's feeling-need.
 *
 * update_sidebar's culling is verified where it lives, in core
 * (display.test.ts). What core cannot verify is that the shell USES it -
 * `renderSidebar` is a closure inside main.ts's module body, reachable only by
 * booting the whole game against a canvas. So this is a source-text guard, and
 * it is worth exactly what a source-text guard is worth: it proves the call is
 * written, not that the pixels moved. It exists because the failure it guards
 * against is not a wrong answer but an unused one - a correct sidebarLayout
 * that nothing calls looks identical from core's side.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const renderSidebar = /function renderSidebar\([\s\S]*?\n\}/u.exec(src)?.[0] ?? "";

describe("renderSidebar", () => {
  it("exists and is the sidebar's only draw path", () => {
    expect(renderSidebar).not.toBe("");
    expect(src.match(/renderSidebar\(/gu)?.length).toBe(2); // the definition and one call
  });

  it("places every field with sidebarLayout rather than a running counter", () => {
    expect(renderSidebar).toContain("sidebarLayout(rows)");
    /* The hand-placed version: a set of key names, a `y++` per field, and a
     * `+= 2` for the two consecutive NULL rows after prt_health. Each of those
     * was a transcription of the C table living in the shell. */
    expect(renderSidebar).not.toContain("spacerAfter");
    expect(renderSidebar).not.toContain("y++");
  });

  it("still bounds what it draws to the terminal", () => {
    /* sidebarLayout is given the height, but a from-bottom row on a table a mod
     * supplied could still compute a row outside it. */
    expect(renderSidebar).toContain("y >= rows");
  });
});

/**
 * PORT_TODO 3.15: the status line's level-feeling indicator reads
 * z_info->feeling_need. `displayDeps()` did not supply it, so the model used
 * its shipped-value fallback and a pack that changed world:feeling-need was
 * obeyed by ^F (which is passed constants.feelingNeed) and ignored by the
 * indicator beside it. The two answers agree on the shipped data, which is why
 * this can only be checked structurally from here.
 */
describe("displayDeps", () => {
  const displayDeps = /function displayDeps\(\)[\s\S]*?\n\}/u.exec(src)?.[0] ?? "";

  it("supplies feelingNeed from the loaded constants", () => {
    expect(displayDeps).not.toBe("");
    expect(displayDeps).toContain("feelingNeed: constants.feelingNeed");
  });
});

/**
 * PORT_TODO 3.18: ENTER opens the command browser, and the table it browses is
 * upstream's.
 *
 * The browser itself is verified in command-menu.test.ts. What only the source
 * can show from here is that main.ts reaches it, that the command table is
 * MODULE level (it used to be a const inside the keydown handler, rebuilt per
 * keypress and reachable from nowhere - the whole reason this could not be
 * ported), and that every cmd_info.desc in it is the C's own string.
 */
describe("the ENTER command browser", () => {
  it("is reached from the keydown handler, through the key-confirm gate", () => {
    expect(src).toContain('if (ev.key === "Enter")');
    expect(src).toContain("chooseCommand(term, commandCategories(), render)");
    /* Not a second copy of the inscription veto: the menu row and the keypress
     * go through the one runConfirmedCommand. */
    expect(src.match(/runConfirmedCommand\(/gu)?.length).toBe(3); // 1 definition, 2 callers
    expect(src.match(/keyConfirmCount\(/gu)?.length).toBe(1);
  });

  it("builds the command table at module level, not per keypress", () => {
    expect(src).toContain("function buildCommandTable(): CommandRow[] {");
    /* If this reverts to a `const COMMANDS` inside the handler, the browser
     * silently loses its data source - and so does the dispatcher, which is why
     * the handler must be reading the shared one and not a local of its own. */
    expect(src).not.toContain("    const COMMANDS: {");
    expect(src).toContain("const COMMANDS = commandTable();");
    /* And the browser reads the same table through the same keyset rule. */
    expect(src).toContain("groupCommands(");
    expect(src).toContain("commandTable(),");
    expect(src).toContain("keyForKeyset(row, roguelike)");
  });

  it("carries the C's own desc for every row (spot-checked against ui-game.c)", () => {
    const cSrc = readFileSync(
      new URL("../../../reference/src/ui-game.c", import.meta.url),
      "utf8",
    );
    /* Derived, not declared: pull every cmd_info description out of the six
     * tables and require that each desc main.ts uses is one of them. A typo or
     * a paraphrase fails here rather than reading fine. */
    const block = cSrc.slice(
      cSrc.indexOf("struct cmd_info cmd_item[]"),
      cSrc.indexOf("struct cmd_info cmd_debug[]"),
    );
    const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
    const upstream = new Set(
      [...block.matchAll(new RegExp(String.raw`\{\s*` + STR + String.raw`,\s*\{`, "gu"))].map(
        (m) => m[1]!.replaceAll(String.raw`\"`, '"'),
      ),
    );
    expect(upstream.size).toBeGreaterThan(50);
    const used = [
      ...src.matchAll(new RegExp(String.raw`\{ desc: ` + STR + String.raw`, cat: (null|"[^"]*")`, "gu")),
    ];
    expect(used.length).toBeGreaterThan(50);
    for (const m of used) {
      const desc = m[1]!.replaceAll(String.raw`\"`, '"');
      if (m[2] === "null") continue; // a port addition, with no cmd_info behind it
      expect(upstream, `"${desc}" is not a cmd_info desc in ui-game.c`).toContain(desc);
    }
  });
});
