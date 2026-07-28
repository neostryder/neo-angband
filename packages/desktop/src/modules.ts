/**
 * modules[] (main.c:63-95) for the desktop front end.
 *
 * Duplicated from the renderer's own list rather than imported, because the two
 * live on opposite sides of a process boundary and the desktop package must not
 * depend on the web package (the dependency runs the other way: the renderer is
 * a bundle this process serves). The list is one entry long and its only
 * observable use here is the `-m<sys>` line of the usage text.
 *
 * The renderer's copy is packages/web/src/launch.ts LAUNCH_MODULES, and a
 * disagreement would show up as a usage text that advertises a module `-m`
 * rejects - so if a second module is ever added, both change.
 */

import type { LaunchModule } from "@neo-angband/core/host";

export const LAUNCH_MODULES: readonly LaunchModule[] = [
  { name: "web", help: "Canvas terminal (browser and desktop)" },
];
