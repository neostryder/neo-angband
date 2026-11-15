/**
 * Reads from api.github.com, cached and rate-limit aware, shared by the update
 * check and the mod screens (#493).
 *
 * The game asks GitHub without credentials, and GitHub allows sixty such requests
 * an hour per address, shared by every program on the machine and everyone behind
 * the same router. Before this module every launch asked for the releases list and
 * every opening of the Recommended list asked for two documents per mod, so a few
 * launches and one browse were enough to be refused for the rest of the hour.
 *
 * Three rules, in the order a read meets them:
 *
 * 1. A cached answer younger than FRESH_MS is used as it is, with no request. This
 *    is the rule that saves requests: GitHub counts a 304 against an anonymous
 *    caller like any other request (its docs exempt a 304 only for a request with
 *    an Authorization header), so revalidating on every read would save bandwidth
 *    and nothing else.
 * 2. While GitHub has asked the game to wait (Retry-After, or X-RateLimit-Reset
 *    after X-RateLimit-Remaining reached 0), nothing is sent until that time, in
 *    this launch or a later one. A caller that allows it gets the last answer
 *    instead; the others get a refusal that says when to try again.
 * 3. Otherwise the request goes out, with If-None-Match when there is a cached
 *    answer, and a 304 renews that answer.
 *
 * The cache is one storage key, read by both callers, so the update check and the
 * mod screens share what they learn and share one wait. Bodies are reduced to the
 * fields the game reads (see compactBody) before they are kept, because the store
 * is localStorage, the same quota character saves are written to.
 */

import type { StorageLike } from "./mod-store";

/** Where the cached answers live. Global, not per profile: GitHub's answer is the same for every profile. */
export const GITHUB_CACHE_KEY = "neo-angband:github-cache";
/** Until when GitHub asked the game not to send requests, in epoch milliseconds. */
export const GITHUB_BACKOFF_KEY = "neo-angband:github-backoff";

/** How long an answer is used without asking again. */
export const FRESH_MS = 10 * 60_000;
/** The cache's total size, in characters, before the least recently used answers go. */
export const MAX_CACHE_CHARS = 256_000;
/** An answer bigger than this, after compacting, is used once and not kept. */
export const MAX_ENTRY_CHARS = 96_000;
/** The wait GitHub's docs prescribe for a rate-limit answer that names no time. */
export const DEFAULT_BACKOFF_MS = 60_000;
/** The longest wait honoured, so a wrong clock or header cannot stop requests for days. */
export const MAX_BACKOFF_MS = 61 * 60_000;

const API_ORIGIN = "https://api.github.com/";

/** What a read answers. Shaped like the part of a Response the callers use. */
export interface GithubReply {
  readonly ok: boolean;
  readonly status: number;
  /**
   * `network` is a new answer, `revalidated` a cached one GitHub confirmed with a
   * 304, `fresh` a cached one used without asking, `stale` a cached one used
   * because GitHub asked the game to wait, and `waiting` no answer at all for the
   * same reason.
   */
  readonly source: "network" | "revalidated" | "fresh" | "stale" | "waiting";
  /** When GitHub will take requests again, if it has asked the game to wait. */
  readonly retryAt: number | null;
  text(): Promise<string>;
}

export interface GithubReadOptions {
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  /** Whether a cached answer may stand in while GitHub has asked the game to wait. Default true. */
  readonly stale?: boolean;
}

export type GithubRead = (url: string, options?: GithubReadOptions) => Promise<GithubReply>;

/** The parts of a fetch Response this module reads, so a test can hand it a plain object. */
interface FetchedResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers?: { get(name: string): string | null } | null;
  text?(): Promise<string>;
  json?(): Promise<unknown>;
}

export interface GithubReaderDeps {
  readonly fetch: (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<FetchedResponse>;
  /** Where the cache and the wait are kept; null keeps both in memory for this launch only. */
  readonly storage: StorageLike | null;
  readonly now?: () => number;
}

export interface GithubReader {
  readonly read: GithubRead;
  /** When GitHub will take requests again, or null when it has not asked the game to wait. */
  waitingUntil(): number | null;
}

interface Entry {
  readonly etag: string | null;
  readonly body: string;
  /** When GitHub last answered or confirmed this body. */
  readonly at: number;
  /** When a read last used it, for eviction. */
  readonly used: number;
}

type Entries = Record<string, Entry>;

function isEntry(value: unknown): value is Entry {
  if (value === null || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (e["etag"] === null || typeof e["etag"] === "string") && typeof e["body"] === "string" &&
    typeof e["at"] === "number" && typeof e["used"] === "number";
}

/** The `/repos/<owner>/<repo>/...` part of an API URL, or null for anything else. */
function apiPath(url: string): string | null {
  if (!url.startsWith(API_ORIGIN)) return null;
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function pick(source: unknown, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (source === null || typeof source !== "object") return out;
  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * The body reduced to the fields the game reads, for the three kinds of document
 * it asks for; null when the URL is some other kind, which is then kept as sent.
 *
 * - a releases list: what parseReleases in update.ts reads
 * - a tags list: what listTagRefs in mod-discover.ts reads
 * - a git tree: what tryTree in mod-discover.ts reads
 *
 * Every answer is handed to its caller in this form, the first one included, so a
 * caller that came to need another field would find out on its first read rather
 * than only on a cached one.
 */
export function compactBody(url: string, text: string): string | null {
  const path = apiPath(url);
  if (path === null) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (/^\/repos\/[^/]+\/[^/]+\/releases$/u.test(path) && Array.isArray(body)) {
    return JSON.stringify(body.map((release: unknown) => ({
      ...pick(release, ["tag_name", "draft", "prerelease", "html_url"]),
      assets: Array.isArray((release as { assets?: unknown } | null)?.assets)
        ? ((release as { assets: unknown[] }).assets).map((asset) => pick(asset, ["name", "browser_download_url", "size", "digest"]))
        : [],
    })));
  }
  if (/^\/repos\/[^/]+\/[^/]+\/tags$/u.test(path) && Array.isArray(body)) {
    return JSON.stringify(body.map((tag: unknown) => ({
      ...pick(tag, ["name"]),
      commit: pick((tag as { commit?: unknown } | null)?.commit, ["sha"]),
    })));
  }
  if (/^\/repos\/[^/]+\/[^/]+\/git\/trees\//u.test(path) && body !== null && typeof body === "object" && !Array.isArray(body)) {
    const tree = (body as { tree?: unknown }).tree;
    return JSON.stringify({
      ...pick(body, ["truncated"]),
      tree: Array.isArray(tree) ? tree.map((entry) => pick(entry, ["path", "type", "size"])) : tree,
    });
  }
  return null;
}

/**
 * When GitHub asked the game to wait, from a refused or exhausted answer, or null
 * when the answer does not ask for one.
 *
 * GitHub's documented order: Retry-After first, then X-RateLimit-Reset once
 * X-RateLimit-Remaining is 0, and otherwise at least a minute for an answer that
 * is a rate-limit refusal. A 403 that carries none of these and does not say "rate
 * limit" is some other refusal and asks for no wait.
 */
export function waitFromAnswer(status: number, header: (name: string) => string | null, body: string, now: number): number | null {
  const retryAfter = Number(header("retry-after"));
  const remaining = header("x-ratelimit-remaining");
  const reset = Number(header("x-ratelimit-reset"));
  const exhausted = remaining !== null && remaining.trim() === "0";
  const refused = status === 429 || status === 403;
  /* Only a refusal or a good answer can ask for a wait. A 404 or a 500 that happens
   * to spend the last request of the hour is that error, not a rate limit. */
  if (!refused && (status < 200 || status >= 300)) return null;
  let until: number | null = null;
  if (refused && header("retry-after") !== null && Number.isFinite(retryAfter) && retryAfter >= 0) until = now + retryAfter * 1000;
  else if (exhausted && Number.isFinite(reset) && reset > 0) until = reset * 1000;
  else if (status === 429 || (status === 403 && (exhausted || /rate limit/iu.test(body)))) until = now + DEFAULT_BACKOFF_MS;
  if (until === null) return null;
  /* A reset already in the past still means a refusal just happened: wait the minimum. */
  return Math.min(Math.max(until, now + 1000), now + MAX_BACKOFF_MS);
}

async function bodyText(res: FetchedResponse): Promise<string> {
  if (typeof res.text === "function") return await res.text();
  if (typeof res.json === "function") return JSON.stringify(await res.json());
  return "";
}

function reply(status: number, source: GithubReply["source"], body: string | Promise<string>, retryAt: number | null): GithubReply {
  const text = typeof body === "string" ? Promise.resolve(body) : body;
  /* Not left unhandled when a caller only looks at the status. */
  text.catch(() => undefined);
  return { ok: status >= 200 && status < 300, status, source, retryAt, text: () => text };
}

export function createGithubReader(deps: GithubReaderDeps): GithubReader {
  const now = deps.now ?? Date.now;
  let memoryEntries: Entries = {};
  let memoryWait: number | null = null;
  const inFlight = new Map<string, Promise<GithubReply>>();

  const loadEntries = (): Entries => {
    if (!deps.storage) return memoryEntries;
    try {
      const raw = deps.storage.getItem(GITHUB_CACHE_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((pair): pair is [string, Entry] => isEntry(pair[1])));
    } catch {
      return {};
    }
  };

  /* Oldest-used first out until the rest fits. A write the storage refuses costs the
   * cache, never the read that produced it. */
  const saveEntries = (entries: Entries): void => {
    const kept = Object.entries(entries).sort(([, a], [, b]) => b.used - a.used);
    let size = 0;
    const out: Entries = {};
    for (const [url, entry] of kept) {
      size += url.length + entry.body.length + (entry.etag?.length ?? 0) + 64;
      if (size > MAX_CACHE_CHARS) break;
      out[url] = entry;
    }
    if (!deps.storage) {
      memoryEntries = out;
      return;
    }
    try {
      deps.storage.setItem(GITHUB_CACHE_KEY, JSON.stringify(out));
    } catch {
      /* storage full or disabled: the next read asks GitHub again */
    }
  };

  const waitingUntil = (): number | null => {
    let until = memoryWait;
    if (deps.storage) {
      try {
        const raw = deps.storage.getItem(GITHUB_BACKOFF_KEY);
        until = raw === null ? null : Number(raw);
      } catch {
        until = memoryWait;
      }
    }
    /* A deadline past the cap was written under a wrong clock or by hand: ignore it. */
    return until !== null && Number.isFinite(until) && until > now() && until <= now() + MAX_BACKOFF_MS ? until : null;
  };

  const waitUntil = (until: number): void => {
    memoryWait = until;
    try {
      deps.storage?.setItem(GITHUB_BACKOFF_KEY, String(until));
    } catch {
      /* kept in memory for this launch */
    }
  };

  const store = (url: string, etag: string | null, body: string): void => {
    if (body.length > MAX_ENTRY_CHARS) return;
    const at = now();
    saveEntries({ ...loadEntries(), [url]: { etag, body, at, used: at } });
  };

  const renew = (url: string, entry: Entry): void => {
    const at = now();
    saveEntries({ ...loadEntries(), [url]: { ...entry, at, used: at } });
  };

  const ask = async (url: string, options: GithubReadOptions): Promise<GithubReply> => {
    const cached = loadEntries()[url];
    if (cached && now() - cached.at >= 0 && now() - cached.at < FRESH_MS) {
      /* Not written back: a fresh read changes nothing worth a localStorage write. */
      return reply(200, "fresh", cached.body, null);
    }
    const allowStale = options.stale !== false;
    const waiting = waitingUntil();
    if (waiting !== null) {
      if (cached && allowStale) return reply(200, "stale", cached.body, waiting);
      return reply(429, "waiting", "", waiting);
    }
    const headers: Record<string, string> = { ...options.headers };
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    const res = await deps.fetch(url, { headers, ...(options.signal ? { signal: options.signal } : {}) });
    const header = (name: string): string | null => {
      try {
        return res.headers?.get(name) ?? null;
      } catch {
        return null;
      }
    };
    /* A plain object from a test may say only `ok`. */
    const status = typeof res.status === "number" ? res.status : res.ok ? 200 : 0;
    if (status === 304 && cached) {
      renew(url, cached);
      return reply(200, "revalidated", cached.body, null);
    }
    if (!res.ok) {
      const text = await bodyText(res).catch(() => "");
      const until = waitFromAnswer(status, header, text, now());
      if (until !== null) {
        waitUntil(until);
        if (cached && allowStale) return reply(200, "stale", cached.body, until);
      }
      return reply(status === 304 ? 502 : status, "network", text, until);
    }
    /* A good answer that used the last request of the hour: the next one would be refused. */
    const spent = waitFromAnswer(status, header, "", now());
    if (spent !== null) waitUntil(spent);
    let text: string;
    try {
      text = await bodyText(res);
    } catch (e) {
      /* The body could not be read (or the caller's clock ran out): nothing is kept. */
      return reply(status, "network", Promise.reject(e instanceof Error ? e : new Error(String(e))), null);
    }
    const body = compactBody(url, text) ?? text;
    store(url, header("etag"), body);
    return reply(status, "network", body, null);
  };

  const read: GithubRead = (url, options = {}) => {
    /* Only api.github.com is metered; anything else is passed straight through. */
    if (apiPath(url) === null) {
      return deps.fetch(url, { headers: { ...options.headers }, ...(options.signal ? { signal: options.signal } : {}) })
        .then((res) => reply(res.status, "network", bodyText(res), null));
    }
    /* Two callers asking for the same document at once share one request. A caller
     * with its own abort signal does not, so one caller's timeout cannot end another's read. */
    const key = `${options.stale === false ? "fresh-only" : "any"} ${url}`;
    const shared = options.signal === undefined ? inFlight.get(key) : undefined;
    if (shared) return shared;
    if (options.signal !== undefined) return ask(url, options);
    /* Cleared before the read settles, so a read made right after it sends its own request. */
    const pending = ask(url, options).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
  };

  return { read, waitingUntil };
}

/** Whole minutes until `until`, at least one, for "try again in N minutes". */
export function minutesUntil(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 60_000));
}
