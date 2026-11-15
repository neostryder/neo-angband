import { describe, expect, it, vi } from "vitest";
import {
  compactBody,
  createGithubReader,
  DEFAULT_BACKOFF_MS,
  FRESH_MS,
  GITHUB_BACKOFF_KEY,
  GITHUB_CACHE_KEY,
  MAX_BACKOFF_MS,
  waitFromAnswer,
} from "./github-cache";
import { checkForUpdate, parseReleases, UPDATE_CHECK_UNAVAILABLE } from "./update";
import { discoverMod, listTagRefs, type DiscoverEnv } from "./mod-discover";

const RELEASES = "https://api.github.com/repos/neostryder/neo-angband/releases?per_page=20";
const TAGS = "https://api.github.com/repos/a/b/tags?per_page=100";
const TREE = "https://api.github.com/repos/a/b/git/trees/v1.0.0?recursive=1";
const MANIFEST = "https://raw.githubusercontent.com/a/b/refs/tags/v1.0.0/manifest.json";

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
}

interface Answer { status: number; body?: unknown; headers?: Record<string, string> }

/** A fake GitHub: each URL answers from a queue, and every request is recorded with its headers. */
function fakeGithub(answers: Record<string, Answer[] | Answer>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: { ...init.headers } });
    const queue = answers[url];
    const answer = Array.isArray(queue) ? queue.shift() : queue;
    if (!answer) throw new Error(`unexpected request ${url}`);
    const headers = new Map(Object.entries(answer.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const text = answer.body === undefined ? "" : typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body);
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      text: () => Promise.resolve(text),
    };
  });
  return { fetch, calls };
}

const release = (tag: string) => ({
  tag_name: tag, draft: false, prerelease: true, html_url: `https://github.com/neostryder/neo-angband/releases/tag/${tag}`,
  body: "x".repeat(5000), author: { login: "someone", id: 1 },
  assets: [{ name: `Neo.Angband-${tag.slice(1)}-win.zip`, browser_download_url: "https://example.invalid/z", size: 9,
    digest: `sha256:${"c".repeat(64)}`, uploader: { login: "someone" }, download_count: 4 }],
});

describe("github-cache: one cached, rate-limit aware reader (#493)", () => {
  it("answers a second read inside the fresh window from storage, with no request, across launches", async () => {
    const storage = new MemoryStorage();
    let clock = 1_000_000;
    const gh = fakeGithub({ [TAGS]: { status: 200, body: [{ name: "v1.0.0", commit: { sha: "abc" } }], headers: { ETag: '"t1"' } } });
    const first = createGithubReader({ fetch: gh.fetch, storage, now: () => clock });
    expect((await first.read(TAGS)).source).toBe("network");
    clock += FRESH_MS - 1;
    /* A new reader over the same storage is the next launch. */
    const second = createGithubReader({ fetch: gh.fetch, storage, now: () => clock });
    const again = await second.read(TAGS);
    expect(again.source).toBe("fresh");
    expect(JSON.parse(await again.text())).toEqual([{ name: "v1.0.0", commit: { sha: "abc" } }]);
    expect(gh.calls).toHaveLength(1);
  });

  it("revalidates an older answer with If-None-Match and keeps the body on a 304", async () => {
    const storage = new MemoryStorage();
    let clock = 0;
    const gh = fakeGithub({
      [TAGS]: [
        { status: 200, body: [{ name: "v1.0.0", commit: { sha: "abc" } }], headers: { ETag: 'W/"t1"' } },
        { status: 304 },
      ],
    });
    const reader = createGithubReader({ fetch: gh.fetch, storage, now: () => clock });
    await (await reader.read(TAGS)).text();
    clock += FRESH_MS;
    const again = await reader.read(TAGS);
    expect(gh.calls[0]?.headers["If-None-Match"]).toBeUndefined();
    expect(gh.calls[1]?.headers["If-None-Match"]).toBe('W/"t1"');
    expect(again.source).toBe("revalidated");
    expect(again.ok).toBe(true);
    expect(JSON.parse(await again.text())).toEqual([{ name: "v1.0.0", commit: { sha: "abc" } }]);
    /* The 304 renewed the answer: the next read is fresh again. */
    expect((await reader.read(TAGS)).source).toBe("fresh");
    expect(gh.calls).toHaveLength(2);
  });

  it("after a 403 with X-RateLimit-Reset, sends nothing until the reset, in this launch or the next", async () => {
    const storage = new MemoryStorage();
    let clock = 5_000_000;
    const reset = Math.floor(clock / 1000) + 20 * 60;
    const gh = fakeGithub({
      [RELEASES]: [
        { status: 403, body: { message: "API rate limit exceeded" }, headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(reset) } },
        { status: 200, body: [] },
      ],
    });
    const reader = createGithubReader({ fetch: gh.fetch, storage, now: () => clock });
    const refused = await reader.read(RELEASES);
    expect(refused.status).toBe(403);
    expect(refused.retryAt).toBe(reset * 1000);
    expect(storage.getItem(GITHUB_BACKOFF_KEY)).toBe(String(reset * 1000));

    clock += 10 * 60_000;
    const nextLaunch = createGithubReader({ fetch: gh.fetch, storage, now: () => clock });
    const held = await nextLaunch.read(RELEASES, { stale: false });
    expect(held.source).toBe("waiting");
    expect(held.ok).toBe(false);
    expect(gh.calls).toHaveLength(1);

    clock = reset * 1000 + 1;
    expect((await nextLaunch.read(RELEASES)).source).toBe("network");
    expect(gh.calls).toHaveLength(2);
  });

  it("honours Retry-After on a 429, and serves the last answer meanwhile only to a caller that allows it", async () => {
    const storage = new MemoryStorage();
    let clock = 0;
    const gh = fakeGithub({ [TAGS]: [{ status: 200, body: [{ name: "v1.0.0" }], headers: { ETag: '"a"' } }, { status: 429, headers: { "Retry-After": "120" } }] });
    const reader = createGithubReader({ fetch: gh.fetch, storage, now: () => clock });
    await (await reader.read(TAGS)).text();
    clock += FRESH_MS;
    const stale = await reader.read(TAGS);
    expect(stale.source).toBe("stale");
    expect(stale.retryAt).toBe(clock + 120_000);
    expect(await stale.text()).toContain("v1.0.0");
    const strict = await reader.read(TAGS, { stale: false });
    expect(strict.source).toBe("waiting");
    expect(reader.waitingUntil()).toBe(clock + 120_000);
    expect(gh.calls).toHaveLength(2);
  });

  it("starts the wait when a good answer spends the last request of the hour", async () => {
    const storage = new MemoryStorage();
    const clock = 0;
    const gh = fakeGithub({ [TAGS]: { status: 200, body: [], headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1800" } } });
    const reader = createGithubReader({ fetch: gh.fetch, storage, now: () => clock });
    expect((await reader.read(TAGS)).ok).toBe(true);
    expect(reader.waitingUntil()).toBe(1_800_000);
  });

  it("reads the wait the way GitHub documents it", () => {
    const h = (headers: Record<string, string>) => (name: string) => headers[name] ?? null;
    expect(waitFromAnswer(429, h({ "retry-after": "30" }), "", 0)).toBe(30_000);
    expect(waitFromAnswer(403, h({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "600" }), "", 0)).toBe(600_000);
    expect(waitFromAnswer(429, h({}), "", 0)).toBe(DEFAULT_BACKOFF_MS);
    expect(waitFromAnswer(403, h({}), '{"message":"You have exceeded a secondary rate limit"}', 0)).toBe(DEFAULT_BACKOFF_MS);
    /* A 403 that is not about the rate limit asks for no wait. */
    expect(waitFromAnswer(403, h({ "x-ratelimit-remaining": "42" }), '{"message":"Repository access blocked"}', 0)).toBeNull();
    expect(waitFromAnswer(200, h({ "x-ratelimit-remaining": "5" }), "", 0)).toBeNull();
    /* A reset days away (a wrong clock) is capped. */
    expect(waitFromAnswer(403, h({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(10 ** 10) }), "", 0)).toBe(MAX_BACKOFF_MS);
  });

  it("shares one request between two callers asking for the same document at once", async () => {
    const gh = fakeGithub({ [TAGS]: { status: 200, body: [{ name: "v1.0.0" }] } });
    const reader = createGithubReader({ fetch: gh.fetch, storage: new MemoryStorage(), now: () => 0 });
    const [a, b] = await Promise.all([reader.read(TAGS), reader.read(TAGS)]);
    expect(await a.text()).toBe(await b.text());
    expect(gh.calls).toHaveLength(1);
  });

  it("keeps working when storage refuses writes", async () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => undefined };
    const gh = fakeGithub({ [TAGS]: [{ status: 200, body: [] }, { status: 200, body: [] }] });
    const reader = createGithubReader({ fetch: gh.fetch, storage, now: () => 0 });
    expect((await reader.read(TAGS)).ok).toBe(true);
    expect((await reader.read(TAGS)).ok).toBe(true);
  });

  it("keeps only what the game reads, and the cache under its size cap", async () => {
    const full = JSON.stringify([release("v1.23.0"), release("v1.22.0")]);
    const small = compactBody(RELEASES, full)!;
    expect(small.length).toBeLessThan(full.length / 5);
    expect(parseReleases(JSON.parse(small))).toEqual(parseReleases(JSON.parse(full)));
    const tree = JSON.stringify({ sha: "s", url: "u", truncated: false, tree: [{ path: "manifest.json", mode: "100644", type: "blob", sha: "x", size: 12, url: "y" }] });
    expect(JSON.parse(compactBody(TREE, tree)!)).toEqual({ truncated: false, tree: [{ path: "manifest.json", type: "blob", size: 12 }] });
    expect(compactBody(MANIFEST, "{}")).toBeNull();

    const storage = new MemoryStorage();
    const gh = fakeGithub({ [RELEASES]: { status: 200, body: JSON.parse(full), headers: { ETag: '"r"' } } });
    await (await createGithubReader({ fetch: gh.fetch, storage, now: () => 0 }).read(RELEASES)).text();
    const stored = storage.getItem(GITHUB_CACHE_KEY)!;
    expect(stored).not.toContain("download_count");
    expect(stored).not.toContain("xxxxx");
  });
});

describe("the update check through the shared reader (#493)", () => {
  const WIN = { platform: "win32", arch: "x64" };

  it("answers a 403 with the quiet line and the wait GitHub gave, then makes no request on the next launch", async () => {
    const storage = new MemoryStorage();
    const clock = 1_000_000;
    const gh = fakeGithub({ [RELEASES]: { status: 403, headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(clock / 1000 + 25 * 60) } } });
    const deps = { fetch: gh.fetch as never, machine: WIN, current: "1.22.0", channel: "beta" as const, now: () => clock };
    const first = await checkForUpdate({ ...deps, read: createGithubReader({ fetch: gh.fetch, storage, now: () => clock }).read });
    expect(first).toEqual({ ok: false, reason: `${UPDATE_CHECK_UNAVAILABLE} Try again in 25 minutes.` });
    const next = await checkForUpdate({ ...deps, read: createGithubReader({ fetch: gh.fetch, storage, now: () => clock }).read });
    expect(next.ok).toBe(false);
    expect(!next.ok && next.reason).toContain(UPDATE_CHECK_UNAVAILABLE);
    expect(gh.calls).toHaveLength(1);
  });

  it("does not call an old list up to date while GitHub asks the game to wait", async () => {
    const storage = new MemoryStorage();
    let clock = 0;
    const gh = fakeGithub({ [RELEASES]: [{ status: 200, body: [release("v1.22.0")], headers: { ETag: '"e"' } }, { status: 429, headers: { "Retry-After": "300" } }] });
    const read = createGithubReader({ fetch: gh.fetch, storage, now: () => clock }).read;
    const deps = { fetch: gh.fetch as never, machine: WIN, current: "1.22.0", channel: "beta" as const, read, now: () => clock };
    expect((await checkForUpdate(deps)).ok).toBe(true);
    clock += FRESH_MS;
    expect(await checkForUpdate(deps)).toEqual({ ok: false, reason: `${UPDATE_CHECK_UNAVAILABLE} Try again in 5 minutes.` });
  });
});

describe("the mod screens and the update check share one cache (#493)", () => {
  const discoverEnv = (read: ReturnType<typeof createGithubReader>["read"], stale: boolean): DiscoverEnv => ({
    engineVersion: "1.23.0",
    fetch: async (url) => {
      const res = await read(url, { stale });
      return { ok: res.ok, status: res.status, retryAt: res.retryAt, source: res.source, text: () => res.text() };
    },
  });

  it("a cold Recommended row costs two API reads, and opening the list again costs none", async () => {
    const storage = new MemoryStorage();
    const gh = fakeGithub({
      [TAGS]: { status: 200, body: [{ name: "v1.0.0", commit: { sha: "c1" } }], headers: { ETag: '"t"' } },
      [TREE]: { status: 200, body: { tree: [{ path: "manifest.json", type: "blob", size: 40 }] }, headers: { ETag: '"r"' } },
      [MANIFEST]: [{ status: 200, body: { id: "b", name: "B", version: "1.0.0" } }, { status: 200, body: { id: "b", name: "B", version: "1.0.0" } }],
    });
    const reader = createGithubReader({ fetch: gh.fetch, storage, now: () => 0 });
    const first = await discoverMod({ repo: "a/b" }, discoverEnv(reader.read, true));
    expect(first.ok).toBe(true);
    const api = () => gh.calls.filter((c) => c.url.startsWith("https://api.github.com/")).length;
    expect(api()).toBe(2);
    const again = await discoverMod({ repo: "a/b" }, discoverEnv(reader.read, true));
    expect(again).toEqual(first);
    expect(api()).toBe(2);
  });

  it("while GitHub asks the game to wait, a row says how long without sending a request", async () => {
    const storage = new MemoryStorage();
    storage.setItem(GITHUB_BACKOFF_KEY, String(Date.now() + 3 * 60_000));
    const gh = fakeGithub({});
    const reader = createGithubReader({ fetch: gh.fetch, storage });
    await expect(listTagRefs("a/b", discoverEnv(reader.read, false))).rejects.toThrow(/rate-limiting this connection\. Try again in 3 minutes\./u);
    expect(gh.calls).toHaveLength(0);
  });
});
