import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

function functionBody(src: string, name: string): string {
  const start = src.search(new RegExp(`function ${name}\\s*\\(`));
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
 * A marker glyph painted mid-animation (paintProjectionMarker) is only ever
 * erased by a LATER render() - the loop's own next iteration, or the
 * unconditional one at the end. If anything throws partway through, nothing
 * else ever revisits an unexplored cell, so the marker sticks in the model
 * indefinitely (#222, #213). These two guards are what closes that gap:
 * playProjectionAnimation always reaches its cleanup render() via `finally`,
 * and its caller never lets a rejection silently skip the rest of the turn.
 */
describe("playProjectionAnimation always cleans up, even if a step throws (#222, #213)", () => {
  it("wraps the animation body in try/finally, with render() in the finally", () => {
    const body = functionBody(MAIN, "playProjectionAnimation");
    const tryAt = body.indexOf("try {");
    const finallyAt = body.indexOf("} finally {");
    expect(tryAt, "playProjectionAnimation no longer wraps its body in try/finally").toBeGreaterThan(-1);
    expect(finallyAt).toBeGreaterThan(tryAt);
    const finallyBlock = body.slice(finallyAt);
    expect(finallyBlock).toContain("render();");
  });

  it("guards the call site so a rejected animation still reaches continueAdvance", () => {
    const body = functionBody(MAIN, "advance");
    expect(body).toContain("void playProjectionAnimation(bolts, blasts, monsterSnapshot)");
    expect(body).toContain(".catch((e: unknown) => {");
    expect(body).toContain("taintSession({");
    expect(body).toContain('hook: "playing a projection animation"');
    // The catch handler still leads into continueAdvance, not a dead end.
    const catchAt = body.indexOf(".catch((e: unknown) => {");
    const tail = body.slice(catchAt);
    expect(tail).toContain(".then(() => {");
    expect(tail).toContain("continueAdvance(status, preLen, beforeX, beforeY, seeFloorReq);");
  });
});

/**
 * The turn that generates a bolt/blast event has already fully resolved
 * (including any monster's own move) by the time the animation replay
 * starts, so a replay reading LIVE monster positions draws every monster at
 * its post-turn grid for the whole flight - the projectile visually travels
 * toward a target that appears to have already moved (#233). advance() takes
 * its monsterIndex() snapshot before runGameLoop touches anything, and the
 * replay draws from that frozen snapshot throughout, settling onto the real,
 * live positions only in the unconditional cleanup render() at the end.
 */
describe("playProjectionAnimation replays from a pre-turn monster snapshot (#233)", () => {
  it("captures the snapshot in advance() before runGameLoop runs", () => {
    const body = functionBody(MAIN, "advance");
    const snapshotAt = body.indexOf("const monsterSnapshot = monsterIndex();");
    const runGameLoopAt = body.indexOf("status = runGameLoop(state, registry);");
    expect(snapshotAt, "advance() no longer captures a monsterIndex() snapshot").toBeGreaterThan(-1);
    expect(runGameLoopAt).toBeGreaterThan(-1);
    expect(snapshotAt).toBeLessThan(runGameLoopAt);
  });

  it("threads the snapshot into every mid-flight render(), never the cleanup one", () => {
    const body = functionBody(MAIN, "playProjectionAnimation");
    const midFlightCalls = body.match(/render\(undefined, monsterSnapshot\);/gu) ?? [];
    // One per bolt step and one per blast ring boundary.
    expect(midFlightCalls.length).toBe(2);
    const finallyAt = body.indexOf("} finally {");
    const finallyBlock = body.slice(finallyAt);
    expect(finallyBlock).toContain("render();");
    expect(finallyBlock).not.toContain("monsterSnapshot");
  });
});
