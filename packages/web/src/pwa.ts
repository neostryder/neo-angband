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
