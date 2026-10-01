/**
 * After an update, tells the player when an issue they reported is marked fixed (#326).
 *
 * The game never sees the number of an issue opened on GitHub, because the form
 * is filled in there. So it keeps two kinds of entry: an issue the player marked
 * "Same here" in the similar-reports list, by number, and a new report, by its
 * title and the time it was opened. The next check looks that title up and keeps
 * the number. If the title was changed on GitHub the lookup misses, and the entry
 * ages out.
 *
 * The check runs on the first launch of a new version, and only when the list is
 * not empty. A player who never reports anything never makes this request.
 */

import { NEO_ANGBAND_REPO } from "./report-links";

export const REPORT_WATCH_STORAGE_KEY = "neo-angband:report-watch";
/** Entries kept at most; the oldest go first. */
export const WATCH_MAX = 20;
/** An entry older than this is dropped whether or not it was ever resolved. */
export const WATCH_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

export interface WatchEntry {
  readonly number?: number;
  readonly title?: string;
  /** When it was added, in ms. */
  readonly at: number;
}

export interface WatchState {
  /** The version that last ran, or "" before the first launch that kept one. */
  readonly version: string;
  readonly entries: readonly WatchEntry[];
}

type WatchStorage = Pick<Storage, "getItem" | "setItem">;

const EMPTY: WatchState = Object.freeze({ version: "", entries: Object.freeze([]) });

export function readWatchState(storage: WatchStorage): WatchState {
  try {
    const raw = storage.getItem(REPORT_WATCH_STORAGE_KEY);
    if (raw === null) return EMPTY;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data === null || typeof data !== "object" || data["v"] !== 1) return EMPTY;
    const entries: WatchEntry[] = [];
    if (Array.isArray(data["entries"])) {
      for (const e of data["entries"] as unknown[]) {
        if (e === null || typeof e !== "object") continue;
        const { number, title, at } = e as Record<string, unknown>;
        if (typeof at !== "number") continue;
        const n = typeof number === "number" && Number.isInteger(number) && number > 0 ? number : undefined;
        const tl = typeof title === "string" && title !== "" ? title : undefined;
        if (n === undefined && tl === undefined) continue;
        entries.push({ ...(n !== undefined ? { number: n } : {}), ...(tl !== undefined ? { title: tl } : {}), at });
      }
    }
    return { version: typeof data["version"] === "string" ? data["version"] : "", entries };
  } catch {
    return EMPTY;
  }
}

export function writeWatchState(storage: WatchStorage, state: WatchState): boolean {
  try {
    storage.setItem(REPORT_WATCH_STORAGE_KEY, JSON.stringify({ v: 1, ...state }));
    return true;
  } catch {
    return false;
  }
}

/** The state with `entry` added: a number already watched is not added twice. */
export function addWatch(state: WatchState, entry: WatchEntry): WatchState {
  if (entry.number !== undefined && state.entries.some((e) => e.number === entry.number)) return state;
  return { ...state, entries: [...state.entries, entry].slice(-WATCH_MAX) };
}

/** What one issue looks like to the check. */
export interface IssueStatus {
  readonly number: number;
  readonly title: string;
  readonly fixed: boolean;
}

export interface WatchLookup {
  issue(number: number): Promise<IssueStatus | null>;
  /** The issue opened with this exact title on or after `since`, if one is found. */
  byTitle(title: string, since: number): Promise<IssueStatus | null>;
}

export interface WatchResult {
  readonly state: WatchState;
  readonly fixed: readonly IssueStatus[];
}

/**
 * Check the watched issues for this launch.
 *
 * Nothing is asked on the same version that ran last, or with nothing watched.
 * A fixed issue leaves the list; one that could not be looked up stays for the
 * next update.
 */
export async function checkWatched(state: WatchState, version: string, now: number, lookup: WatchLookup): Promise<WatchResult> {
  const fresh = state.entries.filter((e) => now - e.at < WATCH_MAX_AGE_MS);
  if (state.version === "" || state.version === version || fresh.length === 0) {
    return { state: { version, entries: fresh }, fixed: [] };
  }
  const kept: WatchEntry[] = [];
  const fixed: IssueStatus[] = [];
  for (const entry of fresh) {
    let status: IssueStatus | null = null;
    try {
      status = entry.number !== undefined
        ? await lookup.issue(entry.number)
        : await lookup.byTitle(entry.title ?? "", entry.at);
    } catch {
      status = null;
    }
    if (status === null) kept.push(entry);
    else if (status.fixed) fixed.push(status);
    else kept.push({ number: status.number, at: entry.at });
  }
  return { state: { version, entries: kept }, fixed };
}

/** The one line the notice shows for what `checkWatched` found. */
export function fixedNotice(fixed: readonly IssueStatus[]): string | null {
  if (fixed.length === 0) return null;
  if (fixed.length === 1) {
    const only = fixed[0]!;
    return `An issue you reported is marked fixed: #${String(only.number)} ${only.title}`;
  }
  return `Issues you reported are marked fixed: ${fixed.map((f) => `#${String(f.number)}`).join(", ")}`;
}

/** Closed as completed counts as fixed. Closed as a duplicate or as not planned does not. */
function statusOf(body: unknown): IssueStatus | null {
  if (body === null || typeof body !== "object") return null;
  const { number, title, state, state_reason: reason } = body as Record<string, unknown>;
  if (typeof number !== "number" || typeof title !== "string") return null;
  return { number, title, fixed: state === "closed" && reason === "completed" };
}

/** The lookups over GitHub's public API, with no token. */
export function githubWatchLookup(fetchJson: (url: string) => Promise<unknown>): WatchLookup {
  return {
    async issue(number) {
      return statusOf(await fetchJson(`https://api.github.com/repos/${NEO_ANGBAND_REPO}/issues/${String(number)}`));
    },
    async byTitle(title, since) {
      const day = new Date(since).toISOString().slice(0, 10);
      const q = `repo:${NEO_ANGBAND_REPO} is:issue in:title "${title.replace(/"/g, "")}" created:>=${day}`;
      const body = await fetchJson(`https://api.github.com/search/issues?${new URLSearchParams({ q }).toString()}`);
      const items = (body as { items?: unknown } | null)?.items;
      if (!Array.isArray(items)) return null;
      const match = items.map(statusOf).find((s) => s !== null && s.title.trim() === title.trim());
      return match ?? null;
    },
  };
}
