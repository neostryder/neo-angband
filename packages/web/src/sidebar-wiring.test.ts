/**
 * PORT_TODO 3.17: the shell draws the sidebar through sidebarLayout.
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
