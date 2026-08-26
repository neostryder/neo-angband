/**
 * The two ui-display seams the shell has to supply, guarded from the source.
 *
 * PORT_TODO 3.17: the shell draws the sidebar through sidebarLayout.
 * PORT_TODO 3.15: displayDeps passes the pack's feeling-need.
 *
 * update_sidebar's culling is verified where it lives, in core
 * (display.test.ts). What core cannot verify is that the shell USES it -
 * `currentHudFrame` is a closure inside main.ts's module body, reachable only by
 * booting the whole game against a canvas. So this is a source-text guard, and
 * it is worth exactly what a source-text guard is worth: it proves the call is
 * written, not that the pixels moved. It exists because the failure it guards
 * against is not a wrong answer but an unused one - a correct sidebarLayout
 * that nothing calls looks identical from core's side.
 *
 * WHAT MOVED IN #253: the layout rules are no longer in main.ts at all. The
 * shell's whole remaining job is to hand core's models to `buildHudFrame` and
 * hand the result to a sink, so the rules this file used to search for as
 * strings - where the fields go, how far a run may reach, which rows are legal -
 * now have an executable test of their own (`hud-view.test.ts`). What is still
 * only checkable from the source is the WIRING: that the shell calls the model
 * rather than transcribing it a second time, and that nothing paints the vitals
 * behind the sink's back.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const hudFrame = /function currentHudFrame\([\s\S]*?\n\}/u.exec(src)?.[0] ?? "";

describe("the shell's HUD wiring", () => {
  it("has one producer and one consumer for every cell of it", () => {
    expect(hudFrame).not.toBe("");
    expect(src.match(/currentHudFrame\(/gu)?.length).toBe(2); // the definition and one call
    /* One sink, constructed once and presented to once. A second draw path for
     * the vitals is exactly what made the HUD unreplaceable, and it would not
     * look like a bug from anywhere else - the pixels would be right. */
    expect(src.match(/glyphHudSectionSink\(/gu)?.length).toBe(1);
    expect(src.match(/renderHudFrame\(/gu)?.length).toBe(1);
    /* And exactly one routed sink, built once per selection rather than inside
     * render() - a sink rebuilt per frame forgets which region's owner faulted
     * and re-enters it on the next repaint (#253). */
    expect(src.match(/hudFrameSink\(/gu)?.length).toBe(2); // the module default and the mod boot
    expect(src).toMatch(/renderHudFrame\([\s\S]*?, liveHudSink\);/u);
  });

  it("hands the menus to whoever the mod boot selected", () => {
    /* `selectFromMenu` reads a MODULE-LEVEL holder rather than an argument, so
     * nothing in `menu-runtime.test.ts` can tell whether the shipped boot ever
     * fills it - the tests set it themselves. This is the join: if the install
     * call is dropped, the seam still passes every one of its own tests and no
     * mod is ever asked anything.
     *
     * Also that the reporter is wired, because a presenter's misbehaviour that
     * reaches no player is the same as one that was never noticed. */
    expect(src).toMatch(/setMenuPresenter\(\s*\n?\s*installMenu\(/u);
    expect(src).toContain("setUiFaultReporter(reportDisplayFault)");
  });

  it("hands the full screens to whoever the mod boot selected", () => {
    /* Same join as the menus above, same reason: `showTextScreen` reads a
     * MODULE-LEVEL holder, so `screen-runtime.test.ts` fills it itself and would
     * go on passing if the shipped boot never did. And exactly one install call -
     * a second one would re-run every candidate's `screen()` and leave the loser
     * of the second pass holding whatever it mounted in the first. */
    expect(src).toMatch(/setScreenPresenter\(\s*\n?\s*installScreen\(/u);
    expect(src.match(/installScreen\(/gu)?.length).toBe(1);
  });

  it("places every field with sidebarLayout rather than a running counter", () => {
    expect(hudFrame).toContain("sidebarLayout(rows)");
    /* The hand-placed version: a set of key names, a `y++` per field, and a
     * `+= 2` for the two consecutive NULL rows after prt_health. Each of those
     * was a transcription of the C table living in the shell. */
    expect(src).not.toContain("spacerAfter");
    expect(hudFrame).not.toContain("y++");
  });

  it("draws no HUD cell itself", () => {
    /* The producer returns values. The moment it prints one it has an opinion a
     * replacement cannot override, and the seam is a seam with a hole in it. */
    expect(hudFrame).not.toContain("term.print");
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
    expect(src).toContain("chooseCommand(term, commandCategories(), render, roguelike)");
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
