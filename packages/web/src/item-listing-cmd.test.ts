/**
 * do_cmd_inven / do_cmd_equip / do_cmd_quiver - the i, e and | keys
 * (ui-knowledge.c:3913, 3959, 4008).
 *
 * These are not read-only screens upstream. Each opens its listing as a get_item
 * PICKER and runs the chosen object's context menu, looping on the return code:
 *
 *   while (ret == 3)                                    // menu cancelled: re-pick
 *     if (!get_item(...)) { ret = -1 }                   // picker cancelled: leave
 *     else while ((ret = context_menu_object(obj)) == 2); // it showed a screen:
 *                                                        // reopen the menu
 *
 * The port had all three as passive listings, and reached the context menu only
 * through an invented "Item actions" row whose picker offered the pack and worn
 * gear (not the quiver, not the floor) under a prompt written here rather than
 * transcribed. So the three most-used inventory keys had lost their purpose and
 * the substitute was both narrower and unfaithful.
 *
 * Read from the source the way amount-and-rest.test.ts does: main.ts boots a real
 * game at module scope and cannot be imported. The pieces that CAN be tested for
 * real are, elsewhere - context-menu.test.ts covers the menu's rows.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

/**
 * main.ts with comments stripped. An assertion that a name is GONE has to run on
 * code only: the comment recording what was removed names it, and would keep it
 * "present" forever - the same trap that bit the upstream text census and, before
 * that, the rest-message pin.
 */
const CODE = MAIN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** The body of a top-level `function`/`async function` declaration, by name. */
function functionBody(src: string, name: string): string {
  const start = src.search(new RegExp(`function ${name}\\s*[(<]`));
  expect(start, `main.ts no longer declares ${name}()`).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading ${name}()`);
}

describe("i / e / | run do_cmd_inven's picker, not a listing", () => {
  it("binds all three keys to it, each opening on its own list", () => {
    expect(MAIN).toMatch(
      new RegExp(String.raw`\{ desc: "[^"]*", cat: (?:null|"[^"]*"), o: "i", act: \(\) => void openModal\(\(\) => doCmdItemListing\("inven"\)\) \}`),
    );
    expect(MAIN).toMatch(
      new RegExp(String.raw`\{ desc: "[^"]*", cat: (?:null|"[^"]*"), o: "e", act: \(\) => void openModal\(\(\) => doCmdItemListing\("equip"\)\) \}`),
    );
    expect(MAIN).toMatch(
      new RegExp(String.raw`\{ desc: "[^"]*", cat: (?:null|"[^"]*"), o: "\|", act: \(\) => void openModal\(\(\) => doCmdItemListing\("quiver"\)\) \}`),
    );
  });

  it("dropped the passive listing stand-in entirely", () => {
    /* listingScreen was the port's own invention standing in for these three
     * commands. Left behind it would invite a future key to use it again. */
    expect(CODE).not.toContain("listingScreen");
  });

  it("dropped the invented Item actions picker and its prompt", () => {
    expect(CODE).not.toContain("openItemActionsMenu");
    expect(CODE).not.toContain("Item actions - which item?");
    expect(CODE).not.toContain("You have nothing to act on.");
  });

  it("points the touch menu's row at the same command i runs", () => {
    const at = MAIN.indexOf('case "item-actions":');
    expect(at).toBeGreaterThan(-1);
    expect(MAIN.slice(at, at + 400)).toContain('doCmdItemListing("inven")');
  });
});

describe("doCmdItemListing's loop matches the C's", () => {
  const body = functionBody(MAIN, "doCmdItemListing");

  it("uses get_item's own prompt, not one written here", () => {
    expect(body).toContain('"Select Item:"');
  });

  it("offers everything GET_ITEM_PARAMS offers (L4019-4020)", () => {
    /* EQUIP | INVEN | QUIVER | FLOOR - the invented picker had inven+equip only,
     * so the quiver and the floor were unreachable from it. */
    const mode = body.match(/\{[^{}]*inven: true[^{}]*\}/)?.[0] ?? "";
    for (const src of ["inven: true", "equip: true", "quiver: true", "floor: true"]) {
      expect(mode, `picker cannot reach ${src}`).toContain(src);
    }
  });

  it("passes IS_HARMLESS, so the picker itself asks no use-confirmation", () => {
    /* The picker runs no command, so the "really use that unknown thing?" gate
     * belongs on the command the menu queues, not here. */
    expect(body).toMatch(/true,\s*mode,\s*\)/);
  });

  it("opens on the list its key names (command_wrk)", () => {
    expect(body).toMatch(/selectItemFrom\([\s\S]{0,400}mode,\s*\)/);
  });

  it("re-picks when the menu was cancelled (ret == 3)", () => {
    expect(body).toMatch(/while \(ret === CTX_CANCELLED\)/);
    /* And it STARTS in that state, so the first pass runs at all. */
    expect(body).toMatch(/let ret: ContextMenuResult = CTX_CANCELLED;/);
  });

  it("reopens the menu on the same object when it showed a screen (ret == 2)", () => {
    expect(body).toMatch(/do \{\s*ret = await runContextMenuObject\(ref\.handle\);\s*\} while \(ret === CTX_REOPEN\);/);
  });

  it("leaves when the picker itself is cancelled (ret = -1)", () => {
    const at = body.indexOf("if (ref === null");
    expect(at).toBeGreaterThan(-1);
    expect(body.slice(at, at + 120)).toContain("return");
  });

  it("gates the menu on player_is_shapechanged, not the picker (L4053-4055)", () => {
    /* Upstream picks the item first and only then declines to open the menu, so
     * the order matters: the shapechange check sits between them. */
    const pick = body.indexOf("selectItemFrom");
    const shape = body.indexOf("playerIsShapechanged(state)");
    const menu = body.indexOf("runContextMenuObject");
    expect(shape).toBeGreaterThan(pick);
    expect(menu).toBeGreaterThan(shape);
  });

  it("keeps each command's own emptiness message (L4030-4033)", () => {
    for (const m of [
      '"You have nothing in your inventory."',
      '"You are not wielding or wearing anything."',
      '"You have nothing in your quiver."',
    ]) {
      expect(body).toContain(m);
    }
  });
});

describe("context_menu_object returns the C's 1/2/3", () => {
  const body = functionBody(MAIN, "runContextMenuObject");

  it("returns 3 when the user escapes the menu (L809-810)", () => {
    expect(body).toMatch(/if \(idx === null\) return CTX_CANCELLED;/);
  });

  it("returns 2 from Inspect (L821) and Browse (L871-876)", () => {
    const inspect = body.indexOf('case "inspect"');
    const browse = body.indexOf('case "browse"');
    expect(inspect).toBeGreaterThan(-1);
    expect(browse, "the Browse row has no handler").toBeGreaterThan(-1);
    expect(body.slice(inspect, inspect + 600)).toContain("return CTX_REOPEN");
    expect(body.slice(browse, browse + 300)).toContain("return CTX_REOPEN");
  });

  it("returns 1 otherwise", () => {
    expect(body).toMatch(/return CTX_DONE;\s*\}$/);
  });

  it("reaches the browse screen without a get_item of its own", () => {
    /* "copied from textui_spell_browse" (L872): the book is already chosen, so
     * the shared body had to be split out of browseCmd. */
    expect(MAIN).toMatch(/async function browseBookObject\(handle: number\)/);
    expect(body).toContain("await browseBookObject(handle)");
  });
});
