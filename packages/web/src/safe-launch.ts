/**
 * Starting without mods for one session.
 *
 * Safe mode is an override on this launch only. While it is on, no mod is
 * enabled: no code runs, no data, art or locale is composed in, and session and
 * draft mods are left out too. The player's enabled set and their saves are not
 * changed, so turning it off is a plain restart.
 *
 * There are three ways in. The `safe=1` URL flag, which the desktop shell sets
 * for `--safe-mode`. Holding Shift while the game starts. And the offer the game
 * makes after two starts in a row that never reached the menus.
 *
 * The flag stays in the address for the whole session, so a reload from inside
 * the game (a mod toggle, a profile switch) comes back up in safe mode as well.
 */

import { bootRecordFormat } from "@rpgm-tools/neo-angband-mod-sdk";
import { readStoredDocument, writeStoredDocument, type DocumentStorage } from "./json-storage";

export const SAFE_LAUNCH_PARAM = "safe";
export const BOOT_RECORD_KEY = "neo-angband:boot-record";
/** Shift has to be held this long from its first press to mean "start safe". */
export const SAFE_KEY_HOLD_MS = 1500;
/** Starts in a row that stopped before the menus, after which the game offers a safe start. */
export const INCOMPLETE_STARTS_BEFORE_OFFER = 2;

let latched: boolean | null = null;

function flagInAddress(): boolean {
  try {
    return new URLSearchParams(location.search).get(SAFE_LAUNCH_PARAM) === "1";
  } catch {
    return false;
  }
}

/** True when this launch runs with every mod off. */
export function safeLaunch(): boolean {
  latched ??= flagInAddress();
  return latched;
}

/** Turn safe mode on for the rest of this session, and keep it across in-game reloads. */
export function enterSafeLaunch(): void {
  latched = true;
  try {
    const url = new URL(location.href);
    url.searchParams.set(SAFE_LAUNCH_PARAM, "1");
    history.replaceState(history.state, "", url);
  } catch {
    /* no location or history (a test host): the latch alone carries this session */
  }
}

/** The address of a normal start: this one, minus the safe flag. */
export function addressWithoutSafeLaunch(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(SAFE_LAUNCH_PARAM);
  return url.toString();
}

/** Forget the latch. Tests only. */
export function resetSafeLaunch(): void {
  latched = null;
}

function readIncompleteStarts(storage: DocumentStorage): number {
  const read = readStoredDocument(storage, BOOT_RECORD_KEY, bootRecordFormat, () => null);
  if (read.blocked) {
    /* A record that does not parse holds nothing worth keeping, and leaving it
     * would stop every later write. Start the count again. */
    try {
      storage.removeItem?.(BOOT_RECORD_KEY);
    } catch {
      /* storage refused; the count stays at zero for this launch */
    }
    return 0;
  }
  return Math.max(0, read.data?.incompleteStarts ?? 0);
}

/**
 * Count this start as unfinished until `bootCompleted` says otherwise, and
 * return how many unfinished starts came right before it.
 */
export function beginBoot(storage: DocumentStorage): number {
  const before = readIncompleteStarts(storage);
  writeStoredDocument(storage, BOOT_RECORD_KEY, bootRecordFormat, { incompleteStarts: before + 1 });
  return before;
}

/** The menus are up: this start finished. */
export function bootCompleted(storage: DocumentStorage): void {
  writeStoredDocument(storage, BOOT_RECORD_KEY, bootRecordFormat, { incompleteStarts: 0 });
}

export interface SafeKeyWatch {
  /**
   * Resolves true when Shift has been held for SAFE_KEY_HOLD_MS since it was
   * first pressed. When Shift is not down it resolves false at once, so a normal
   * start never waits on this.
   */
  decide(): Promise<boolean>;
  stop(): void;
}

interface KeyTarget {
  addEventListener(type: string, listener: (event: Event) => void, options?: boolean): void;
  removeEventListener(type: string, listener: (event: Event) => void, options?: boolean): void;
}

/** Watch for Shift from the first moment of boot, so it can be held through the start. */
export function watchSafeKey(target: KeyTarget, now: () => number = () => Date.now()): SafeKeyWatch {
  let downSince: number | null = null;
  let release: (() => void) | null = null;
  const onDown = (event: Event): void => {
    if ((event as KeyboardEvent).key === "Shift") downSince ??= now();
  };
  const letGo = (): void => {
    downSince = null;
    release?.();
  };
  const onUp = (event: Event): void => {
    if ((event as KeyboardEvent).key === "Shift") letGo();
  };
  target.addEventListener("keydown", onDown, true);
  target.addEventListener("keyup", onUp, true);
  target.addEventListener("blur", letGo, true);
  const stop = (): void => {
    target.removeEventListener("keydown", onDown, true);
    target.removeEventListener("keyup", onUp, true);
    target.removeEventListener("blur", letGo, true);
  };
  return {
    decide() {
      if (downSince === null) return Promise.resolve(false);
      const wait = Math.max(0, downSince + SAFE_KEY_HOLD_MS - now());
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          release = null;
          resolve(downSince !== null);
        }, wait);
        release = () => {
          clearTimeout(timer);
          release = null;
          resolve(false);
        };
      });
    },
    stop,
  };
}

export interface SafeLaunchInputs {
  readonly storage: DocumentStorage;
  readonly keyWatch: SafeKeyWatch;
  /** True when at least one mod would load on a normal start. */
  readonly anyModsEnabled: () => boolean;
  /** Ask the player whether to start without mods. Resolves true for yes. */
  readonly offer: (incompleteStarts: number) => Promise<boolean>;
}

export type SafeLaunchReason = "flag" | "key" | "offer";

/**
 * Runs before the first mod is read. Works out whether this launch is a safe one
 * and, when it is not, adds it to the count of unfinished starts. Returns what
 * asked for safe mode (the flag, the held key or the accepted offer), or null.
 *
 * Safe launches stay out of the count. Reaching the menus with every mod off
 * proves nothing about the mods, so the earlier count is kept and the next
 * normal start offers again.
 */
export async function decideSafeLaunch(inputs: SafeLaunchInputs): Promise<SafeLaunchReason | null> {
  try {
    if (safeLaunch()) return "flag";
    if (await inputs.keyWatch.decide()) {
      enterSafeLaunch();
      return "key";
    }
    const before = readIncompleteStarts(inputs.storage);
    if (before >= INCOMPLETE_STARTS_BEFORE_OFFER && inputs.anyModsEnabled() && (await inputs.offer(before))) {
      enterSafeLaunch();
      return "offer";
    }
    beginBoot(inputs.storage);
    return null;
  } finally {
    inputs.keyWatch.stop();
  }
}
