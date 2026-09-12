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
    expect(body).toContain("void playProjectionAnimation(bolts, blasts)");
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
