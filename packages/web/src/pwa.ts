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

export function installAutoUpdate(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  const sw = navigator.serviceWorker;

  // Whether a worker already controlled this page when the script ran. If not,
  // the first `controllerchange` is that initial worker claiming a fresh visit
  // (clientsClaim) - NOT an update - so we must not reload for it.
  const hadController = !!sw.controller;
  let reloading = false;
  sw.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  const check = (reg: ServiceWorkerRegistration): void => {
    reg.update().catch(() => {
      /* offline or transient: try again on the next focus */
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
