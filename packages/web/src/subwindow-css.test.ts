import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUBWINDOW_CONTENT_FILTER } from "./subwindow-shell";

/* The panel rules live in index.html's one style block, so these read it. */
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const rule = (selector: string): string => {
  const at = html.indexOf(`${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return html.slice(at, html.indexOf("}", at));
};

describe("subwindow panel stylesheet", () => {
  it("applies the body's filter to each child through the property the shell sets", () => {
    expect(rule(".tile-body > *")).toContain(`filter: var(${SUBWINDOW_CONTENT_FILTER}, none)`);
  });

  it("takes a hidden terminal canvas out of the flow, so a mod pane's content starts at the top", () => {
    expect(rule(".tile-body canvas[hidden]")).toContain("display: none");
  });

  it("hides the drop preview once a drag ends, although its shown state sets display", () => {
    expect(rule(".tile-drop-preview[hidden]")).toContain("display: none");
  });
});
