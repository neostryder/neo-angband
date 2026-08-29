/**
 * Three main.ts wirings that a player reported and that only the SHELL can get
 * wrong, so they are pinned by reading the source the way exit-to-title.test.ts
 * and term.test.ts do (main.ts boots a real game at module scope and cannot be
 * imported into a unit test). The engine-side halves are tested for real in
 * core: pickup.test.ts for the partial-pickup prompt, display.test.ts for the
 * "Rest" status field, obj-cmd.test.ts for the drop itself.
 *
 *   1. do_cmd_drop (cmd-obj.c:360-388) asks how many, over EQUIP|INVEN|QUIVER.
 *   2. do_cmd_pickup's partial branch asks too (cmd-pickup.c:270).
 *   3. Resting is announced by prt_state's status field (ui-display.c:957) and
 *      by nothing else - the shell had invented a message line that outlived
 *      both a finished and a disturbed rest.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

/** The body of a top-level `function`/`async function` declaration, by name. */
function functionBody(src: string, name: string): string {
  /* `[(<]` so a GENERIC declaration matches too (openModal<T>), not only `name(`. */
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

/**
 * Drop line and block comments. An assertion that a STRING is absent has to run
 * on code only, or the comment explaining why it was removed keeps it "present"
 * - the same trap the upstream text census fell into.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("do_cmd_drop (cmd-obj.c:360-388)", () => {
  const body = functionBody(MAIN, "dropItem");

  it("is what the 'd' key runs", () => {
    /* It used to be a useItem("drop", ...) call with the default pack-only mode
     * and no amount prompt - both defects on one line. */
    expect(MAIN).toMatch(
      new RegExp(String.raw`\{ desc: "[^"]*", cat: (?:null|"[^"]*"), o: "d", act: \(\) => void openModal\(dropItem\) \}`),
    );
  });

  it("offers equipment, pack and quiver, and NOT the floor (L374)", () => {
    /* USE_EQUIP | USE_INVEN | USE_QUIVER: worn gear and quivered ammo drop from
     * the same prompt. There is no USE_FLOOR - dropping the floor is a no-op. */
    const mode = body.match(/\{[^{}]*inven: true[^{}]*\}/)?.[0] ?? "";
    expect(mode).toContain("equip: true");
    expect(mode).toContain("inven: true");
    expect(mode).toContain("quiver: true");
    expect(body).not.toContain("floor: true");
  });

  it("uses the exact cmd_get_item prompt and refusal", () => {
    expect(body).toContain('"Drop which item?"');
    expect(body).toContain('"You have nothing to drop."');
  });

  it("asks the amount with get_quantity(NULL, obj->number) (L383)", () => {
    /* null builds upstream's own "Quantity (0-N, *=all): "; the ceiling is the
     * chosen object's own count, not the pack's or a constant. */
    expect(body).toMatch(/getQuantity\(term, null, obj\.number\)/);
  });

  it("aborts on a 0 answer, before queuing anything (cmd-core.c:1097)", () => {
    const abort = body.indexOf("quantity <= 0) return");
    const queue = body.indexOf("commandBuffer.push");
    expect(abort).toBeGreaterThan(-1);
    expect(abort).toBeLessThan(queue);
  });

  it("passes the amount through to the command", () => {
    expect(body).toMatch(/commandBuffer\.push\(\{ code: "drop", args: \{ handle, quantity \} \}\)/);
  });
});

describe("player_pickup_aux's partial-pickup prompt (cmd-pickup.c:253-274)", () => {
  const body = functionBody(MAIN, "pickupCmd");

  it("asks only when part of the stack fits (max !== obj.number)", () => {
    expect(body).toMatch(/invenCarryNum\(state\.gear, target, constants\)/);
    expect(body).toMatch(/max > 0 && max !== target\.number/);
    expect(body).toMatch(/pendingPickupQuantity = await getQuantity\(term, null, max\)/);
  });

  it("queues the command even on a 0 answer, because the turn is spent", () => {
    /* player_pickup_item counts the object at L389 BEFORE player_pickup_aux's
     * early return, so cancelling the amount still costs the turn. Nothing may
     * sit between the prompt and the push that skips it. */
    const prompt = body.indexOf("pendingPickupQuantity = await");
    const push = body.indexOf('commandBuffer.push({ code: "pickup" })');
    expect(prompt).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(prompt);
    expect(body.slice(prompt, push)).not.toContain("return");
  });

  it("hands the answer to the core hook, defaulting to the whole amount", () => {
    /* null means "the UI did not ask", which must NOT read as zero. */
    expect(MAIN).toMatch(/getQuantity: \(max\): number => \{[\s\S]{0,200}?return answer \?\? max;/);
  });
});

describe("resting is announced by prt_state, not by a message", () => {
  const body = functionBody(MAIN, "driveRest");

  it("sets no message line of its own", () => {
    /* The reported bug: the resting message still showed after the rest was
     * disturbed or ran out. It was an invented "Resting..." line assigned to
     * `message` and never cleared - and being invented, no census saw it. */
    const src = code(body);
    /* No string literal announcing a rest, and no assignment to the top line at
     * all (the two ways the line could come back). */
    expect(src).not.toMatch(/"[^"\n]*[Rr]esting[^"\n]*"/);
    expect(src).not.toMatch(/\bmessage\s*=/);
  });

  it("still reports the interrupt upstream reports", () => {
    /* "Cancelled." is real (check_for_player_interrupt, ui-game.c:663); the
     * monster and damage disturbs are silent. Dropping the invented line must
     * not take this one with it. */
    expect(body).toContain('say("Cancelled.")');
  });

  it("clears state.resting when the rest ends, so the field goes away", () => {
    expect(body).toMatch(/delete \(state as StateWithRest\)\.resting/);
  });

  it("keeps state.resting live for the whole loop (the field's only source)", () => {
    /* stateRuns reads state.resting through playerIsResting; assigning it before
     * the loop and deleting it in the finally is what makes the status field
     * appear and disappear at the right moments. */
    const assign = body.indexOf("(state as StateWithRest).resting = rest");
    const clear = body.indexOf("delete (state as StateWithRest).resting");
    expect(assign).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(assign);
  });

  it("has exactly one player_resting_is_special, core's", () => {
    /* There were three bodies of it: this file's, loop.ts's and display.ts's
     * inline -1/-2/-3 tests. */
    expect(MAIN).toMatch(/const restingIsSpecial = playerRestingIsSpecial;/);
    expect(MAIN).not.toMatch(/function restingIsSpecial\(/);
  });
});
