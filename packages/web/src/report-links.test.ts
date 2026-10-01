import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DISCORD_FORUMS, browserName, detailRows, discordPostText, githubIssueUrl, issueSearchApi,
  issueSearchPage, issueTitle, parseIssueSearch, searchTerms, surfaceOption, type SystemDetails,
} from "./report-links";

const template = (name: string): string =>
  readFileSync(new URL(`../../../.github/ISSUE_TEMPLATE/${name}`, import.meta.url), "utf8");

const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0";
const ELECTRON = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) neo-angband/1.19.1 Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36";

const system = (over: Partial<SystemDetails> = {}): SystemDetails => ({
  version: "1.19.1", shell: "browser", userAgent: FIREFOX, platform: "Win32", devServer: false,
  mods: [{ id: "qol", version: "1.4.0" }], ...over,
});

describe("report links", () => {
  it("fills in the bug form's fields by their ids", () => {
    const url = new URL(githubIssueUrl({ kind: "bug", summary: "Black screen", details: "On the stairs", system: system() }));
    expect(url.pathname).toBe("/neostryder/neo-angband/issues/new");
    const p = url.searchParams;
    expect(p.get("template")).toBe("2-bug.yml");
    expect(p.get("title")).toBe("[bug] Black screen");
    expect(p.get("what")).toBe("On the stairs");
    expect(p.get("version")).toBe("1.19.1");
    expect(p.get("surface")).toBe("Browser");
    expect(p.get("browser")).toBe("Firefox 148");
    expect(p.get("mods")).toBe("qol 1.4.0");
  });

  it("leaves the system fields out until the player agrees to share them", () => {
    const p = new URL(githubIssueUrl({ kind: "bug", summary: "x", details: "" })).searchParams;
    expect([...p.keys()].sort()).toEqual(["template", "title"]);
  });

  it("sends an idea to the idea form and never with system details", () => {
    const p = new URL(githubIssueUrl({ kind: "idea", summary: "Light radius", details: "Show it", system: system() })).searchParams;
    expect(p.get("template")).toBe("4-idea.yml");
    expect(p.get("title")).toBe("[idea] Light radius");
    expect(p.get("idea")).toBe("Show it");
    expect(p.has("version")).toBe(false);
  });

  it("uses field ids and dropdown options that the issue forms actually have", () => {
    const bug = template("2-bug.yml");
    for (const id of ["what", "version", "surface", "browser", "mods"]) expect(bug).toContain(`id: ${id}\n`);
    expect(template("4-idea.yml")).toContain("id: idea\n");
    const options = [
      surfaceOption(system()),
      surfaceOption(system({ shell: "installed" })),
      surfaceOption(system({ devServer: true })),
      surfaceOption(system({ shell: "desktop", userAgent: ELECTRON })),
      surfaceOption(system({ shell: "desktop", platform: "MacIntel", userAgent: "Macintosh Electron" })),
      surfaceOption(system({ shell: "desktop", platform: "Linux x86_64", userAgent: "X11; Linux Electron" })),
    ];
    for (const option of options) expect(bug).toContain(`- ${option}\n`);
  });

  it("names the browser only outside the desktop app", () => {
    expect(browserName(ELECTRON)).toBe("Chrome 140");
    expect(detailRows(system({ shell: "desktop", userAgent: ELECTRON })).map(([label]) => label)).toEqual(["Version", "Where", "Mods"]);
    expect(detailRows(system({ mods: [] }))).toContainEqual(["Mods", "none"]);
  });

  it("copies a Discord post with the summary first and the details only when shared", () => {
    expect(discordPostText({ kind: "bug", summary: "Black screen", details: "On the stairs", system: system() }))
      .toBe("Black screen\n\nOn the stairs\n\nVersion: 1.19.1\nWhere: Browser\nBrowser: Firefox 148\nMods: qol 1.4.0");
    expect(discordPostText({ kind: "idea", summary: "", details: "" })).toBe("Idea");
    expect(DISCORD_FORUMS.bug).not.toBe(DISCORD_FORUMS.idea);
  });

  it("searches on the summary's longer words", () => {
    expect(searchTerms("The screen went black on the stairs")).toEqual(["the", "screen", "went", "black", "stairs"]);
    expect(issueSearchApi("a b")).toBeNull();
    const q = new URL(issueSearchApi("Black screen")!).searchParams.get("q");
    expect(q).toBe("repo:neostryder/neo-angband is:issue black screen");
    expect(new URL(issueSearchPage("Black screen")).searchParams.get("q")).toBe("is:issue black screen");
  });

  it("reads issues out of a search answer and skips pull requests", () => {
    expect(parseIssueSearch({ items: [
      { number: 5, title: "Black screen", html_url: "https://github.com/x/5", state: "closed" },
      { number: 6, title: "A fix", html_url: "https://github.com/x/6", state: "open", pull_request: {} },
      { number: "7" },
    ] })).toEqual([{ number: 5, title: "Black screen", url: "https://github.com/x/5", open: false }]);
    expect(parseIssueSearch(null)).toEqual([]);
  });

  it("cuts a long summary the same way for the form and for the fixed notice", () => {
    const long = "word ".repeat(60);
    const title = issueTitle({ kind: "bug", summary: long });
    expect(title.length).toBeLessThanOrEqual(126);
    expect(new URL(githubIssueUrl({ kind: "bug", summary: long, details: "" })).searchParams.get("title")).toBe(title);
  });
});
