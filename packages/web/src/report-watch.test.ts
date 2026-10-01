import { describe, expect, it } from "vitest";
import {
  WATCH_MAX, WATCH_MAX_AGE_MS, addWatch, checkWatched, fixedNotice, githubWatchLookup, readWatchState,
  writeWatchState, type IssueStatus, type WatchLookup, type WatchState,
} from "./report-watch";

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
};

const NOW = 1_800_000_000_000;

function lookup(issues: Record<number, IssueStatus>, titles: Record<string, IssueStatus> = {}): WatchLookup & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    issue(n) { calls.push(`#${String(n)}`); return Promise.resolve(issues[n] ?? null); },
    byTitle(title) { calls.push(title); return Promise.resolve(titles[title] ?? null); },
  };
}

describe("reported-issue watch", () => {
  it("round-trips through storage and reads anything malformed as empty", () => {
    const storage = memory();
    const state: WatchState = { version: "1.19.1", entries: [{ number: 4, at: NOW }, { title: "[bug] x", at: NOW }] };
    writeWatchState(storage, state);
    expect(readWatchState(storage)).toEqual(state);
    storage.setItem("neo-angband:report-watch", "{");
    expect(readWatchState(storage)).toEqual({ version: "", entries: [] });
  });

  it("keeps a number once and only the newest entries", () => {
    let state: WatchState = { version: "", entries: [] };
    state = addWatch(addWatch(state, { number: 4, at: 1 }), { number: 4, at: 2 });
    expect(state.entries).toHaveLength(1);
    for (let i = 0; i < WATCH_MAX + 5; i++) state = addWatch(state, { title: `t${String(i)}`, at: i });
    expect(state.entries).toHaveLength(WATCH_MAX);
    expect(state.entries.at(-1)?.title).toBe(`t${String(WATCH_MAX + 4)}`);
  });

  it("asks nothing on the version that ran last, or on the first launch", async () => {
    const l = lookup({});
    const same = await checkWatched({ version: "1.19.1", entries: [{ number: 4, at: NOW }] }, "1.19.1", NOW, l);
    const first = await checkWatched({ version: "", entries: [{ number: 4, at: NOW }] }, "1.19.1", NOW, l);
    expect(l.calls).toEqual([]);
    expect(same.fixed).toEqual([]);
    expect(first.state.version).toBe("1.19.1");
  });

  it("reports fixed issues after an update and keeps the rest, resolving titles to numbers", async () => {
    const l = lookup(
      { 4: { number: 4, title: "Black screen", fixed: true }, 5: { number: 5, title: "Open", fixed: false } },
      { "[bug] Stairs": { number: 9, title: "[bug] Stairs", fixed: false } },
    );
    const result = await checkWatched({ version: "1.19.0", entries: [
      { number: 4, at: NOW }, { number: 5, at: NOW }, { title: "[bug] Stairs", at: NOW },
      { title: "[bug] Gone", at: NOW }, { number: 6, at: NOW - WATCH_MAX_AGE_MS },
    ] }, "1.19.1", NOW, l);
    expect(result.fixed.map((f) => f.number)).toEqual([4]);
    expect(result.state).toEqual({ version: "1.19.1", entries: [
      { number: 5, at: NOW }, { number: 9, at: NOW }, { title: "[bug] Gone", at: NOW },
    ] });
    expect(l.calls).not.toContain("#6");
  });

  it("keeps an entry whose lookup failed for the next update", async () => {
    const failing: WatchLookup = { issue: () => Promise.reject(new Error("offline")), byTitle: () => Promise.reject(new Error("offline")) };
    const result = await checkWatched({ version: "1.19.0", entries: [{ number: 4, at: NOW }] }, "1.19.1", NOW, failing);
    expect(result.state.entries).toEqual([{ number: 4, at: NOW }]);
  });

  it("counts only an issue closed as completed as fixed", async () => {
    const answers: Record<string, unknown> = {
      "/issues/1": { number: 1, title: "a", state: "closed", state_reason: "completed" },
      "/issues/2": { number: 2, title: "b", state: "closed", state_reason: "not_planned" },
    };
    const l = githubWatchLookup((url) => Promise.resolve(answers[url.slice(url.indexOf("/issues/"))]));
    expect((await l.issue(1))?.fixed).toBe(true);
    expect((await l.issue(2))?.fixed).toBe(false);
  });

  it("matches a title search only on the exact title", async () => {
    const urls: string[] = [];
    const l = githubWatchLookup((url) => {
      urls.push(url);
      return Promise.resolve({ items: [{ number: 3, title: "[bug] Stairs again", state: "open" }, { number: 2, title: "[bug] Stairs", state: "open" }] });
    });
    expect((await l.byTitle("[bug] Stairs", Date.UTC(2026, 8, 30)))?.number).toBe(2);
    expect(new URL(urls[0]!).searchParams.get("q")).toBe('repo:neostryder/neo-angband is:issue in:title "[bug] Stairs" created:>=2026-09-30');
  });

  it("words the notice for one fixed issue and for several", () => {
    expect(fixedNotice([])).toBeNull();
    expect(fixedNotice([{ number: 4, title: "Black screen", fixed: true }])).toBe("An issue you reported is marked fixed: #4 Black screen");
    expect(fixedNotice([{ number: 4, title: "a", fixed: true }, { number: 7, title: "b", fixed: true }])).toBe("Issues you reported are marked fixed: #4, #7");
  });
});
