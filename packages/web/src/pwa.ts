// Keep the offline PWA from serving a stale build.
//
// The service worker (vite-plugin-pwa, registerType "autoUpdate") already ships
// `skipWaiting` + `clientsClaim`, so a freshly deployed worker installs and
// takes control the moment it is found. The default injected registration,
// however, only registers on load and never reacts when a new worker takes
// over - so a RETURNING visitor whose old worker is still in control sees the
// old build this visit and only gets the update on a *second* visit. That is
// the "it's stale until I reopen it" behaviour.
//
// This module closes that gap without touching the game:
//   1. Reload the page the instant a *new* worker takes control (an update),
//      but not on the very first install that simply claims a fresh visit.
//   2. Proactively poll for a new worker on load and whenever the tab regains
//      focus, so opening or returning to the page always lands on the latest
//      deployed build - no private window, no manual cache clear.
//
// A reload here is safe: play state is autosaved on pagehide/visibilitychange/
// beforeunload, and boot always returns to the title + character select, so the
// player simply lands on the current build with their save intact.

import { isStale, WEB_BUILD_ID, WEB_BUILD_ID_FILE } from "./build-id";

/**
 * The browser's own install prompt, held for the (I)nstall locally page.
 *
 * `beforeinstallprompt` fires ONCE, early, and only if the browser has decided
 * the page is installable. Its default action - the little address-bar chip -
 * has to be cancelled to keep the event alive, and the deferred event can then be
 * shown exactly once, from a user gesture. Nothing else in this app wants it, so
 * it is caught here at boot and parked; a page that waited until the player asked
 * would find the event long gone.
 *
 * Firefox and desktop Safari never fire it, and iOS Safari installs through the
 * Share sheet instead. That is why the page has to be able to say "your browser
 * did not offer this" rather than showing a button that does nothing.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: InstallPromptEvent | null = null;

export function captureInstallPrompt(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (ev) => {
    ev.preventDefault();
    deferredPrompt = ev as InstallPromptEvent;
  });
  /* Once installed the event will never fire again, and a stale deferred one
   * would offer an install that is already done. */
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
  });
}

/** Whether the browser has given us an install prompt to show. */
export function canPromptInstall(): boolean {
  return deferredPrompt !== null;
}

/**
 * Show it. Resolves true only when the browser reports the player accepted.
 *
 * The event is spent either way - a second `prompt()` on the same event throws -
 * so it is dropped before awaiting the choice rather than after, and a dismissal
 * means the page has to fall back to telling them where the menu item is.
 */
export async function promptInstall(): Promise<boolean> {
  const ev = deferredPrompt;
  if (!ev) return false;
  deferredPrompt = null;
  try {
    await ev.prompt();
    return (await ev.userChoice).outcome === "accepted";
  } catch {
    return false;
  }
}

/** True when this page is running as an installed app rather than in a tab. */
export function isStandalone(scope: typeof globalThis = globalThis): boolean {
  try {
    const mm = (scope as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
    if (typeof mm !== "function") return false;
    /* Three display modes count as installed. `standalone` is the common one;
     * `window-controls-overlay` and `fullscreen` are what a manifest can ask for
     * instead, and a page that only checked the first would tell a player who
     * HAS installed it to install it. */
    return (
      mm.call(scope, "(display-mode: standalone)").matches ||
      mm.call(scope, "(display-mode: window-controls-overlay)").matches ||
      mm.call(scope, "(display-mode: fullscreen)").matches
    );
  } catch {
    return false;
  }
}

/**
 * Is the code running in this page the code the site is serving?
 *
 * THIS USED TO BE AN INFERENCE AND IS NOW A COMPARISON, which is the change
 * worth understanding. The only signal was `controllerchange` - a service worker
 * taking control - and that is a different question wearing the same clothes. A
 * worker can take control without the build changing (a fresh visit claiming the
 * page) and, more to the point, the build can change without this page ever
 * seeing an event: the worker only looks when something asks it to, and a page
 * left open in an installed PWA asks once, at load.
 *
 * So the page now compares two strings: the build id compiled into this bundle,
 * and the one in `build-id.json` fetched with `cache: "no-store"`. That file is
 * kept out of the precache manifest on purpose (see vite.config.ts) - a cached
 * freshness check answers with the stale build's own id and concludes it is up
 * to date forever, which is the exact failure this replaces.
 *
 * The worker events are KEPT as a second trigger rather than replaced. They are
 * free, they fire on the machine that has already downloaded the new build, and
 * two independent signals for the same fact is the right number when the cost of
 * missing it is a player stuck on an old build with no way to say so.
 */
let swUpdateReady = false;

/** How often a page that stays open re-asks. Half an hour. */
export const FRESHNESS_POLL_MS = 30 * 60 * 1000;

/** How long the freshness fetch is allowed to take before it is abandoned. */
export const FRESHNESS_TIMEOUT_MS = 6000;

/** Whether the title screen should offer (and shimmer) an update. */
export function webUpdateReady(): boolean {
  return swUpdateReady;
}

/**
 * Ask the server what it is serving. Answers false on ANY failure.
 *
 * Offline, rate-limited, behind a captive portal, or served by something that
 * does not have the file: none of those is evidence that this build is old, and
 * a false positive here puts an (U)pdate row in front of a player that reloads
 * them onto the same build forever.
 */
export async function isBuildStale(
  fetchFn: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
  file: string = WEB_BUILD_ID_FILE,
): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => {
    ctl.abort();
  }, FRESHNESS_TIMEOUT_MS);
  try {
    const res = await fetchFn(`./${file}?t=${String(Date.now())}`, {
      cache: "no-store",
      signal: ctl.signal,
    });
    if (!res.ok) return false;
    return isStale(WEB_BUILD_ID, await res.json());
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Set by applyWebUpdate so the controllerchange handler does not race it. */
let reloading = false;

/**
 * Take the newer build.
 *
 * THREE STEPS, AND A BARE RELOAD IS NOT ENOUGH. If the worker has not yet
 * noticed the new build, reloading serves the cached old one out of its own
 * cache and the row comes straight back - so the worker is asked to check
 * first. If it has noticed but is only WAITING (which happens when a previous
 * worker did not skip waiting), it will not activate while this page is open,
 * so it is asked to, and the reload waits for it to take over.
 *
 * The wait is bounded and only entered when there is something waiting, so the
 * ordinary case is still a plain reload with no added delay.
 */
export async function applyWebUpdate(): Promise<void> {
  reloading = true;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.update().catch(() => undefined);
      const waiting = reg.waiting;
      if (waiting) {
        const claimed = new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener("controllerchange", () => {
            resolve();
          }, { once: true });
          setTimeout(resolve, 2000);
        });
        waiting.postMessage({ type: "SKIP_WAITING" });
        await claimed;
      }
    }
  } catch {
    /* No service worker at all, or a browser that refuses to talk about it.
     * The reload below is still the right move and is all a plain page needs. */
  }
  location.reload();
}

/** Set once per window, so a shell that stays stale cannot reload forever. */
const DESKTOP_REFRESHED_KEY = "neo:desktop-shell-refreshed";

/** What the desktop refresh needs, injected so it can be tested. */
export interface DesktopRefreshDeps {
  isDesktop?: () => boolean;
  check?: () => Promise<boolean>;
  /** Tear the worker and its caches down. Defaults to really doing it. */
  evict?: () => Promise<void>;
  reload?: () => void;
  once?: Pick<Storage, "getItem" | "setItem"> | null;
}

/**
 * Unregister every worker on this origin and delete every cache it kept.
 *
 * Swallows everything: this runs at boot, on a path the player did not ask
 * for, and a browser that refuses to discuss its service workers is not a
 * reason to fail to start a game.
 */
async function evictWorkers(): Promise<void> {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* no worker API, or a browser that will not talk about it */
  }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* no cache API */
  }
}

/**
 * ON THE DESKTOP A STALE SHELL IS NOT AN OFFER, IT IS A MISTAKE - and this is
 * the second half of "I updated and it was still on the old version".
 *
 * The web is asked whether it wants a newer build, because the files are on
 * somebody else's server and the player is mid-game. The desktop has already
 * downloaded, verified and installed those files; they are on the disk, three
 * inches away, and the only thing still serving the old ones is our own
 * service worker. The worker precaches the NEW shell during the launch that
 * follows an update and takes over on the launch after that, so the first
 * launch after every desktop update shows the previous version. Measured: the
 * window loaded `assets/index-s-LgS4MJ.js` while both the `index.html` on disk
 * and the worker's own precache named `assets/index-BizJOYdJ.js`, and it kept
 * doing so until the app was closed and opened again.
 *
 * There is nothing to ask about, so this does not ask. Every desktop boot
 * evicts the worker and its caches outright, which also means the NEXT
 * navigation has no controller and is served straight off the disk - the
 * staleness cannot recur. If this page is already the stale one, it reloads,
 * and at the title screen that is invisible.
 *
 * EVICTING IS THE POINT, AND ASKING THE WORKER NICELY IS NOT ENOUGH: the first
 * attempt here called applyWebUpdate, which does `registration.update()` and
 * then reloads. That resolves when the new worker has been FETCHED, not when
 * it has finished precaching and taken over, so the reload raced it and the
 * old worker served the old shell a second time. Measured: the guard was set,
 * the reload happened, and the very same `index-BR42Pn0V.js` came back.
 * Unregister-and-delete has no such race - with no controller and no cache,
 * the reload can only come from the loopback server.
 *
 * Once per window: if the reload does not fix it, a loop is far worse than a
 * stale title.
 */
export async function refreshStaleDesktopShell(
  deps: DesktopRefreshDeps = {},
): Promise<boolean> {
  const isDesktop =
    deps.isDesktop ?? ((): boolean => "neoDesktop" in (globalThis as object));
  if (!isDesktop()) return false;
  let store: Pick<Storage, "getItem" | "setItem"> | null;
  if (deps.once !== undefined) {
    store = deps.once;
  } else {
    try {
      store = globalThis.sessionStorage;
    } catch {
      store = null;
    }
  }
  /* Unconditionally, and before anything that can bail out: an evicted worker
   * is how the NEXT launch is guaranteed fresh, whatever happens to this one. */
  await (deps.evict ?? evictWorkers)();

  /* NO STORE, NO RELOAD. `store?.setItem(...)` would quietly do nothing and
   * every boot would reload again - and a reload loop is a worse bug than the
   * stale title it is trying to correct. The guard has to be real to act on. */
  if (!store) return false;
  try {
    if (store.getItem(DESKTOP_REFRESHED_KEY)) return false;
  } catch {
    return false;
  }
  const check = deps.check ?? ((): Promise<boolean> => isBuildStale());
  if (!(await check())) return false;
  try {
    store.setItem(DESKTOP_REFRESHED_KEY, "1");
  } catch {
    return false;
  }
  (deps.reload ?? ((): void => {
    location.reload();
  }))();
  return true;
}

/** The four things the freshness watch needs, injected so it can be tested. */
export interface FreshnessDeps {
  /** Answers "is this page out of date". Defaults to asking the server. */
  check?: () => Promise<boolean>;
  /** Called the first time the answer is yes. */
  onStale?: () => void;
  every?: (fn: () => void, ms: number) => void;
  onVisible?: (fn: () => void) => void;
  onOnline?: (fn: () => void) => void;
}

/**
 * Ask now, and keep asking.
 *
 * SEPARATE FROM THE SERVICE-WORKER HALF, and callable with fakes, because "the
 * check exists" and "something calls the check" are different claims and this
 * project has shipped the first without the second before. A watcher wired to
 * nothing looks identical to a watcher that has nothing to report.
 *
 * Three moments beyond the first ask, and each is a case the old code missed: a
 * page left open for hours in an installed PWA (the interval), a tab the player
 * comes back to (visibility), and a laptop that was shut when the deploy
 * happened (online).
 */
export function startFreshnessWatch(deps: FreshnessDeps = {}): () => void {
  const check = deps.check ?? ((): Promise<boolean> => isBuildStale());
  const onStale =
    deps.onStale ??
    ((): void => {
      swUpdateReady = true;
    });
  let told = false;
  const poll = (): void => {
    void check().then((stale) => {
      if (!stale || told) return;
      told = true;
      onStale();
    });
  };
  poll();
  try {
    (deps.every ?? ((fn, ms) => setInterval(fn, ms)))(poll, FRESHNESS_POLL_MS);
    (deps.onOnline ?? ((fn) => window.addEventListener("online", fn)))(poll);
    (deps.onVisible ??
      ((fn) => {
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") fn();
        });
      }))(poll);
  } catch {
    /* No window or document: the first ask still happened, and that is the one
     * that matters for a page that is about to be looked at. */
  }
  return poll;
}

/**
 * @param canReloadNow Whether reloading this instant is invisible to the player.
 *   True at the title screen, false mid-dungeon.
 */
export function installAutoUpdate(canReloadNow?: () => boolean): void {
  /*
   * THE BUILD-ID CHECK RUNS EVEN WITHOUT A SERVICE WORKER, which is why it is
   * before the guard rather than inside it. A browser with workers disabled, a
   * private window, an http:// origin during development - all of them still
   * cache, and all of them can be running an old bundle. The old code returned
   * at the guard below and the feature was simply off for every one of them.
   */
  startFreshnessWatch();

  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  const sw = navigator.serviceWorker;

  // Whether a worker already controlled this page when the script ran. If not,
  // the first `controllerchange` is that initial worker claiming a fresh visit
  // (clientsClaim) - NOT an update - so we must not reload for it.
  const hadController = !!sw.controller;
  sw.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    // A NEW BUILD IS READY. Whether to take it now is a question about where the
    // player is, not about the worker.
    //
    // This used to reload unconditionally, and defended it on the grounds that
    // play state is autosaved. That is true and it is not the point: a reload
    // in the middle of a fight is a screen flash, a lost message log and a
    // resumed turn the player did not ask for, and there was no way to decline
    // it. At the title screen the reload is invisible, so it still happens
    // there; anywhere else the update waits behind the (U)pdate row.
    swUpdateReady = true;
    if (canReloadNow && !canReloadNow()) return;
    reloading = true;
    location.reload();
  });

  const check = (reg: ServiceWorkerRegistration): void => {
    reg.update().catch(() => {
      /* offline or transient: try again on the next focus */
    });
    /*
     * A worker that installs and then WAITS is invisible to controllerchange,
     * because it never takes control while this page is open. That is the state
     * a page reaches when the previous worker did not skip waiting, and without
     * this listener the new build sits on the machine, fully downloaded, with
     * nothing offering it.
     */
    reg.addEventListener("updatefound", () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && sw.controller) swUpdateReady = true;
      });
    });
  };

  sw.ready
    .then((reg) => {
      check(reg);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check(reg);
      });
    })
    .catch(() => {
      /* no active registration yet: the injected register handles first install */
    });
}
