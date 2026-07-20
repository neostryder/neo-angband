import { describe, expect, it } from "vitest";
import {
  colorToCss,
  colorTextToAttr,
  COLOUR_RED,
  COLOUR_MUD,
  COLOUR_WHITE,
  COLOUR_L_WHITE,
} from "@neo-angband/core";
import { parseNewsLine } from "./news";

describe("news title screen markup (news.txt {colour}...{/})", () => {
  it("colours bare text (outside any tag) COLOUR_WHITE", () => {
    expect(parseNewsLine("For help press '?' in-game")).toEqual([
      { text: "For help press '?' in-game", css: colorToCss(COLOUR_WHITE) },
    ]);
  });

  it("resolves a single {name}...{/} span by colour name", () => {
    expect(parseNewsLine("{red}Angband{/}")).toEqual([
      { text: "Angband", css: colorToCss(COLOUR_RED) },
    ]);
    expect(colorTextToAttr("red")).toBe(COLOUR_RED);
  });

  it("splits multiple spans on one line and returns to white after {/}", () => {
    expect(parseNewsLine("{mud}^^^{/}{red}_{/}  x")).toEqual([
      { text: "^^^", css: colorToCss(COLOUR_MUD) },
      { text: "_", css: colorToCss(COLOUR_RED) },
      { text: "  x", css: colorToCss(COLOUR_WHITE) },
    ]);
  });

  it("resolves the multi-word 'light slate' name used by the quote lines", () => {
    // news.txt draws the quote / website / forums in {light slate} = Light Slate.
    expect(parseNewsLine("{light slate}Website{/}")).toEqual([
      { text: "Website", css: colorToCss(COLOUR_L_WHITE) },
    ]);
    expect(colorTextToAttr("light slate")).toBe(COLOUR_L_WHITE);
  });

  it("preserves leading spaces (the art's baked-in centring)", () => {
    const runs = parseNewsLine("{mud}   ^   {/}");
    expect(runs).toEqual([{ text: "   ^   ", css: colorToCss(COLOUR_MUD) }]);
  });
});
