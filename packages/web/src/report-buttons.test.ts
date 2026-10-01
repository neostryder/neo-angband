// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserKeydown } from "./input-door";
import { BUG_TOOLTIP, IDEA_TOOLTIP, mountReportButtons, readReportButtonsEnabled, type ReportButtonsHost } from "./report-buttons";
import type { WatchEntry } from "./report-watch";

function setup(over: Partial<ReportButtonsHost> = {}) {
  document.body.innerHTML = '<div id="view"><canvas></canvas></div>';
  const host = document.getElementById("view")!;
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
  const opened: string[] = [];
  const watched: WatchEntry[] = [];
  const notices: string[] = [];
  const buttons = mountReportButtons({
    host,
    notice: { show: (text) => { notices.push(text); }, dismiss: () => {} },
    storage,
    system: () => ({ version: "1.19.1", shell: "browser", userAgent: "Firefox/148", platform: "Win32", devServer: false, mods: [] }),
    characterDump: () => "dump",
    screenshot: () => Promise.resolve(new Blob(["png"])),
    open: (url) => { opened.push(url); return true; },
    fetchJson: () => Promise.resolve({ items: [] }),
    watch: (entry) => { watched.push(entry); },
    now: () => 1000,
    ...over,
  });
  const q = <T extends Element>(selector: string) => host.querySelector<T>(selector)!;
  const popup = q<HTMLElement>(".report-popup");
  const byText = (text: string) => [...popup.querySelectorAll("button")].find((b) => b.textContent === text)!;
  return { host, buttons, storage, opened, watched, notices, q, popup, byText };
}

afterEach(() => { document.body.replaceChildren(); });

describe("report buttons", () => {
  it("shows two buttons with tooltips, the idea one pointing at mods", () => {
    const page = setup();
    const [bug, idea] = page.host.querySelectorAll<HTMLButtonElement>(".report-dock-button");
    expect(bug!.title).toBe(BUG_TOOLTIP);
    expect(idea!.title).toBe(IDEA_TOOLTIP);
    expect(idea!.title).toContain("Bring your ideas to a Neo Angband mod!");
    expect(bug!.getAttribute("aria-label")).toBe(BUG_TOOLTIP);
    page.buttons.destroy();
  });

  it("asks before sharing system details and opens a filled-in form", () => {
    const page = setup();
    page.q<HTMLButtonElement>('[data-kind="bug"]').click();
    expect(page.popup.hidden).toBe(false);
    const details = page.q<HTMLElement>(".report-details");
    expect(details.hidden).toBe(false);
    expect(details.classList.contains("report-details-off")).toBe(true);
    expect(details.textContent).toContain("1.19.1");
    page.q<HTMLInputElement>(".report-field input").value = "Black screen";
    page.byText("Open a GitHub issue").click();
    let url = new URL(page.opened.at(-1)!);
    expect(url.searchParams.get("title")).toBe("[bug] Black screen");
    expect(url.searchParams.has("version")).toBe(false);
    const consent = page.q<HTMLInputElement>(".report-consent input");
    consent.checked = true;
    consent.dispatchEvent(new Event("change"));
    expect(details.classList.contains("report-details-off")).toBe(false);
    page.byText("Open a GitHub issue").click();
    url = new URL(page.opened.at(-1)!);
    expect(url.searchParams.get("version")).toBe("1.19.1");
    expect(page.watched.at(-1)).toEqual({ title: "[bug] Black screen", at: 1000 });
    page.buttons.destroy();
  });

  it("offers an idea no system details, screenshot or dump", () => {
    const page = setup();
    page.q<HTMLButtonElement>('[data-kind="idea"]').click();
    expect(page.popup.textContent).toContain("Bring your ideas to a Neo Angband mod!");
    expect(page.q<HTMLElement>(".report-consent").hidden).toBe(true);
    expect(page.q<HTMLElement>(".report-actions").hidden).toBe(true);
    page.byText("Open a GitHub issue").click();
    expect(new URL(page.opened.at(-1)!).searchParams.get("template")).toBe("4-idea.yml");
    page.buttons.destroy();
  });

  it("copies the post and offers the invite and the forum for Discord", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const page = setup();
    page.q<HTMLButtonElement>('[data-kind="bug"]').click();
    page.q<HTMLInputElement>(".report-field input").value = "Black screen";
    page.byText("Post on Discord").click();
    await vi.waitFor(() => { expect(page.q<HTMLElement>(".report-discord-steps").hidden).toBe(false); });
    expect(writeText).toHaveBeenCalledWith("Black screen");
    page.byText("1. Join the Discord").click();
    page.byText("2. Open the bug reports forum").click();
    expect(page.opened.slice(-2)).toEqual(["https://discord.gg/YegtwbHTBQ", "https://discord.com/channels/1019812414348345375/1540837430205227142"]);
    page.buttons.destroy();
  });

  it("lists similar reports and watches one the player says is theirs", async () => {
    const page = setup({ fetchJson: () => Promise.resolve({ items: [
      { number: 12, title: "Black screen on stairs", html_url: "https://github.com/neostryder/neo-angband/issues/12", state: "open" },
    ] }) });
    page.q<HTMLButtonElement>('[data-kind="bug"]').click();
    page.q<HTMLInputElement>(".report-field input").value = "Black screen";
    page.byText("Look for similar reports").click();
    await vi.waitFor(() => { expect(page.popup.querySelectorAll(".report-similar-list li")).toHaveLength(1); });
    page.byText("Same here").click();
    expect(page.watched.at(-1)).toEqual({ number: 12, at: 1000 });
    expect(page.opened.at(-1)).toBe("https://github.com/neostryder/neo-angband/issues/12");
    page.buttons.destroy();
  });

  it("closes on Escape before the game sees the key", () => {
    const page = setup();
    page.q<HTMLButtonElement>('[data-kind="bug"]').click();
    const key = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    browserKeydown(key);
    expect(key.defaultPrevented).toBe(true);
    expect(page.popup.hidden).toBe(true);
    const again = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    browserKeydown(again);
    expect(again.defaultPrevented).toBe(false);
    page.buttons.destroy();
  });

  it("hides from its own close control and remembers that", () => {
    const page = setup();
    page.q<HTMLButtonElement>(".report-dock-hide").click();
    expect(page.q<HTMLElement>(".report-dock").hidden).toBe(true);
    expect(page.notices.at(-1)).toContain("Subwindow setup");
    expect(readReportButtonsEnabled(page.storage)).toBe(false);
    page.buttons.setEnabled(true);
    expect(page.q<HTMLElement>(".report-dock").hidden).toBe(false);
    page.buttons.destroy();
  });

  it("turns off the dump button with no character in play", () => {
    const page = setup({ characterDump: () => null });
    page.q<HTMLButtonElement>('[data-kind="bug"]').click();
    expect(page.byText("Copy character dump").disabled).toBe(true);
    page.buttons.destroy();
  });
});
