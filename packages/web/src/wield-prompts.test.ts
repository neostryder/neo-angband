/**
 * do_cmd_wield's two questions, wired into the shell (cmd-obj.c:265-353).
 *
 * The behaviour is unit-tested in core (obj-cmd.test.ts, "registered command:
 * wield"). What core CANNOT test is whether the shell ever asks: core owns the
 * prompt text and the count, and the shell owns the keyboard, so a perfectly
 * correct wieldRingChoice() that nothing calls reads exactly like a finished
 * feature. That is this repo's governing failure mode - code review cannot find
 * absence - so the call sites are pinned here by reading the source, the shape
 * exit-to-title.test.ts established (main.ts boots a real game at module scope
 * and cannot be imported into a unit test).
 *
 * What must hold:
 *   1. wieldPrompts asks the ring question BEFORE the "!t" confirm, because the
 *      "!t" is owed by whatever occupies the hand the ring question settled
 *      (cmd-obj.c:298-311 then :321-330).
 *   2. Backing out of either returns false and NOTHING is queued - the whole
 *      point of asking before the command runs is that no turn is spent and, now
 *      that the floor pickup has moved inside inven_wield, no item moves either.
 *   3. EVERY path that queues a "wield" command goes through it. There are three
 *      (dispatchItemVerb, dispatchItemRef, swapWeaponCmd's @0 fast path) and a
 *      fourth would be a silent regression.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

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

/** Source with line and block comments stripped, so a citation cannot score. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
}

describe("wieldPrompts asks do_cmd_wield's two questions", () => {
  const body = stripComments(functionBody(MAIN, "wieldPrompts"));

  it("asks the ring question through the faithful USE_EQUIP picker", () => {
    /* cmd_get_item(cmd, "replace", ..., tval_is_ring, USE_EQUIP) - cmd-obj.c:298.
     * The prompt and error come from core (wieldRingChoice), never from a literal
     * here: a second copy of a player-visible string is a paraphrase waiting to
     * happen, and no census can see one. */
    expect(body).toContain("wieldRingChoice(state, obj)");
    expect(body).toContain("choice.prompt");
    expect(body).toContain("choice.error");
    expect(body).toContain("tvalIsRing(o.tval)");
    expect(body).toContain("{ equip: true }");
    expect(body).not.toContain("Replace which ring");
  });

  it("threads the chosen slot back as args.slot", () => {
    /* slot = equipped_item_slot(player->body, equip_obj) (cmd-obj.c:309); the
     * command carries it so inven_wield does not re-derive it. */
    expect(body).toContain('args["slot"]');
  });

  it("aborts the whole wield when the ring picker is escaped", () => {
    /* cmd_get_item != CMD_OK -> return (cmd-obj.c:305-306). Falling through to a
     * hand of our choosing would be the original bug wearing a hat. */
    expect(body).toMatch(/if \(ref === null[\s\S]{0,60}return false/u);
  });

  it("asks the '!t' confirm AFTER the ring question, once per occurrence", () => {
    expect(body).toContain("wieldTakeoffConfirm(state, slot)");
    expect(body).toMatch(/for \(let i = 0; i < ask\.count; i\+\+\)/u);
    expect(body).toContain("confirmYesNo(ask.prompt)");
    /* Order: the ring answer settles `slot`, which the "!t" lookup then reads. */
    expect(body.indexOf("wieldRingChoice")).toBeLessThan(
      body.indexOf("wieldTakeoffConfirm"),
    );
    /* And the prompt is core's, not a second literal. */
    expect(body).not.toContain("Really take off");
  });

  it("refusing the '!t' confirm returns false so nothing is queued", () => {
    expect(body).toMatch(/confirmYesNo\(ask\.prompt\)\)\) return false/u);
  });
});

describe("every wield dispatch path goes through wieldPrompts", () => {
  it("dispatchItemVerb (the context menu / already-chosen item)", () => {
    const body = stripComments(functionBody(MAIN, "dispatchItemVerb"));
    expect(body).toMatch(/code === "wield" && !\(await wieldPrompts\(obj, args\)\)/u);
    /* And it runs BEFORE the push, or the questions are decorative. */
    expect(body.indexOf("wieldPrompts")).toBeLessThan(body.indexOf("commandBuffer.push"));
  });

  it("dispatchItemRef (the item picker, pack or floor)", () => {
    const body = stripComments(functionBody(MAIN, "dispatchItemRef"));
    expect(body).toMatch(/code === "wield" && !\(await wieldPrompts\(obj, args\)\)/u);
    expect(body.indexOf("wieldPrompts")).toBeLessThan(body.indexOf("commandBuffer.push"));
  });

  it("swapWeaponCmd's @0 fast path (a @0-tagged RING still owes the question)", () => {
    const body = stripComments(functionBody(MAIN, "swapWeaponCmd"));
    expect(body).toContain("wieldPrompts(obj, args)");
    expect(body.indexOf("wieldPrompts")).toBeLessThan(body.indexOf("commandBuffer.push"));
  });

  it("and there is no FOURTH place that queues a wield without asking", () => {
    /* Every `code: "wield"` / `push({ code, args })` route is one of the three
     * above. This counts the literal queue sites so a new one has to be
     * deliberate. */
    const src = stripComments(MAIN);
    const literal = src.match(/commandBuffer\.push\(\{\s*code:\s*"wield"/gu) ?? [];
    expect(literal.length).toBe(1); // swapWeaponCmd only
  });
});

/**
 * The floor-pile overlay's wiring (ui-display.c:2629-2647).
 *
 * showFloorList is unit-tested in overlay.test.ts; what cannot be tested there is
 * whether the shell still routes the pile through showTextScreen (which clears
 * the terminal and appends an invented footer). Pinned here by reading the
 * source, same reason as above.
 */
describe("showFloorPileScreen uses the real show_floor overlay", () => {
  const body = stripComments(functionBody(MAIN, "showFloorPileScreen"));

  it("calls showFloorList, never showTextScreen (which clears the map)", () => {
    expect(body).toContain("showFloorList(term,");
    expect(body).not.toContain("showTextScreen");
  });

  it("builds the prompt as upstream's `You %s: `, with p as its own variable", () => {
    /* ui-display.c:2587 (`p = "see"`), :2625-2628, :2640. */
    expect(body).toContain("have no room for the following objects");
    expect(body).toContain("feel something on the floor");
    expect(body).toMatch(/`You \$\{p\}: `/u);
  });

  it("passes the OLIST_WEIGHT column (obj->number * object_weight_one)", () => {
    expect(body).toContain("objectWeightOne(o");
    expect(body).toContain("o.number *");
  });

  it("re-feeds the dismissing key through the input queue (Term_event_push)", () => {
    expect(body).toContain("enqueueKeys([{ key }])");
  });

  it("repaints afterwards (screen_load, ui-display.c:2646)", () => {
    expect(body).toMatch(/render\(\);\s*\}$/u);
  });
});
