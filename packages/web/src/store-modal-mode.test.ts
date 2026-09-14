/**
 * A shop screen renders under the same "play" viewport as ordinary play, so a
 * display-oriented mod (the qol mod's responsive status sidebar, in
 * particular) cannot tell a shop apart from the dungeon unless the shell says
 * so (#234). storeModalActive is that signal: true for exactly the lifetime
 * of enterStoreModal's own modal, read back by displayControl.snapshot()'s
 * mode field.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

function functionBody(name: string): string {
  const start = src.search(new RegExp(`(?:async )?function ${name}\\s*\\(`));
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

describe("enterStoreModal reports a distinct display mode while a shop is open (#234)", () => {
  it("sets storeModalActive before the modal and always clears it in a finally", () => {
    const body = functionBody("enterStoreModal");
    const setAt = body.indexOf("storeModalActive = true;");
    const openAt = body.indexOf("await openModal(");
    const finallyAt = body.indexOf("} finally {");
    expect(setAt, "enterStoreModal no longer sets storeModalActive").toBeGreaterThan(-1);
    expect(openAt).toBeGreaterThan(-1);
    expect(setAt).toBeLessThan(openAt);
    expect(finallyAt).toBeGreaterThan(openAt);
    expect(body.slice(finallyAt)).toContain("storeModalActive = false;");
  });

  it("displayControl.snapshot() reports mode \"store\" only while that flag is set", () => {
    expect(src).toContain(
      'mode: storeModalActive\n        ? ("store" as const)\n        : modalDepth > 0\n          ? ("modal" as const)\n          : ("play" as const),',
    );
  });
});

describe('displayControl.snapshot() reports mode "modal" over any other full-screen takeover (#250)', () => {
  it("falls back to modalDepth once storeModalActive is ruled out, ahead of the ordinary \"play\" default", () => {
    const at = src.indexOf('mode: storeModalActive');
    expect(at, "main.ts no longer computes mode from storeModalActive").toBeGreaterThan(-1);
    const clause = src.slice(at, at + 200);
    const storeAt = clause.indexOf('"store" as const');
    const modalAt = clause.indexOf("modalDepth > 0");
    const modalValueAt = clause.indexOf('"modal" as const');
    const playAt = clause.indexOf('"play" as const');
    expect(storeAt).toBeGreaterThan(-1);
    expect(modalAt).toBeGreaterThan(storeAt);
    expect(modalValueAt).toBeGreaterThan(modalAt);
    expect(playAt).toBeGreaterThan(modalValueAt);
  });
});
