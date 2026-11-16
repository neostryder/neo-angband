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
import ts from "@typescript/typescript6";
import { createDefaultRegistry, LOOP_STATUS, restAction, runGameLoop, TMD, type PlayerCommand } from "@rpgm-tools/neo-angband-core";
import { makeState } from "../../core/src/game/harness.js";

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("web rest and repeat memory", () => {
  const source = ts.createSourceFile("main.ts", MAIN, ts.ScriptTarget.Latest, true);
  const fn = (name: string): string => source.statements.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name,
  )!.getText(source);
  const provider = source.statements.find((s) => s.getText(source).startsWith("state.nextCommand ="))!.getText(source);

  function harness(background: boolean) {
    const state = makeState();
    state.actor.player.timed[TMD.FOOD] = 5000;
    const registry = createDefaultRegistry();
    state.checkInterrupt = () => "pause";
    registry.register("rest", (s, cmd) => {
      const energy = restAction(s, cmd);
      if (background) for (const continuation of s.cmdQueue ?? []) continuation.background = 1;
      return energy;
    });
    const commandBuffer: PlayerCommand[] = [];
    const advance = (): void => {
      let status = runGameLoop(state, registry);
      while (status === LOOP_STATUS.PAUSE) status = runGameLoop(state, registry);
    };
    const deps = {
      state, commandBuffer, advance, emitPlayerCommand: () => {},
      anyVisibleMonster: () => false, repeatPrevAllowed: () => true,
      repeatDirSlots: () => [],
    };
    const emitted = ts.transpileModule(
      `let lastRepeatCmd = null;
${provider}
${fn("driveRest")}
${fn("repeatLastCommand")}
return { rest: driveRest, repeat: repeatLastCommand, remembered: () => lastRepeatCmd };`,
      { compilerOptions: { target: ts.ScriptTarget.ESNext } },
    ).outputText;
    const runtime = new Function(...Object.keys(deps), emitted)(...Object.values(deps)) as {
      rest: (count: number) => void;
      repeat: () => Promise<void>;
      remembered: () => PlayerCommand | null;
    };
    return { state, runtime, commandBuffer, advance };
  }

  it.each([false, true])("repeats R 50 with background marking %s", async (background) => {
    const h = harness(background);
    await h.runtime.rest(50);
    expect(h.state.restingTurn).toBe(50);
    expect(h.runtime.remembered()?.code).toBe("rest");
    await h.runtime.repeat();
    expect(h.state.restingTurn).toBe(100);
    expect(h.state.resting).toBeUndefined();
    expect(h.state.cmdQueue ?? []).toEqual([]);
  });

  it.each([-1, -2, -3])("clears the remembered count after special rest %s", (count) => {
    const h = harness(false);
    h.runtime.rest(50);
    h.runtime.rest(count);
    expect(h.state.restRepeatCount).toBe(0);
    expect(h.state.restingTurn).toBe(51);
    h.runtime.rest(1);
    expect(h.state.restingTurn).toBe(51);
  });

  it.each([1, 2])("skips background %s commands and still repeats ordinary commands", async (background) => {
    const h = harness(false);
    const original: PlayerCommand = { code: "hold" };
    h.commandBuffer.push(original, { code: "noop", background });
    h.advance();
    expect(h.runtime.remembered()).toBe(original);
    const before = h.state.actor.totalEnergy;
    await h.runtime.repeat();
    expect(h.state.actor.totalEnergy).toBe(before + h.state.z.moveEnergy);
  });
});

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

  it("lets Core check rest interrupts through the continuation pump", () => {
    const provider = MAIN.slice(MAIN.indexOf("state.checkInterrupt ="), MAIN.indexOf("\n};", MAIN.indexOf("state.checkInterrupt =")));
    expect(provider).not.toContain('if (state.resting) return "go"');
    expect(provider).toContain('return "cancel"');
    expect(provider).toContain('return "pause"');
  });

  it("leaves rest counters and cleanup to the Core action", () => {
    expect(body).toContain('commandBuffer.push({ code: "rest", args: { count } })');
    expect(body).not.toContain("state.resting");
    expect(body).not.toContain('code: "hold"');
  });
});

/**
 * anyVisibleMonster (#225): resting's own monster-disturb check, gating the
 * start of driveRest. It used to check MFLAG.VISIBLE, which telepathy sets at
 * unlimited range regardless of actual line of sight, and it never consulted
 * disturb_near at all - unlike known.ts's updateMon and monster-turn.ts's
 * monsterTurn, the only other two monster-visibility disturbs in the
 * codebase. A single telepathically-sensed monster anywhere on the level made
 * resting impossible from any position, forever, with the option off or on.
 */
describe("anyVisibleMonster (#225)", () => {
  const body = functionBody(MAIN, "anyVisibleMonster");

  it("checks MFLAG.VIEW (actually in sight), not MFLAG.VISIBLE (known by any means)", () => {
    expect(body).toContain("MFLAG.VIEW");
    expect(body).not.toContain("MFLAG.VISIBLE");
  });

  it("is gated on disturb_near, matching every other monster-visibility disturb", () => {
    expect(body).toMatch(/state\.options\?\.get\("disturb_near"\)/);
  });
});
