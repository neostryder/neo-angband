/**
 * Where the bytes of an imported mod come from, and what may be done with the file after.
 *
 * TWO DOORS, AND THEY ARE NOT THE SAME DOOR.
 *
 *   THE MODS FOLDER. The desktop build owns a `mods/` directory and already serves it
 *   over its loopback port, so an archive dropped in there can be listed, read, and -
 *   the part that matters - DELETED once it has been installed. This is the only place
 *   "remove the zip after installing" can be true, because it is the only file the game
 *   put a name to before the player picked it.
 *
 *   A FILE THE PLAYER CHOOSES. Works everywhere, including a browser tab. A page is
 *   handed the bytes of a chosen file and no authority whatsoever over the file itself:
 *   there is no API that deletes it and there should not be. So this half installs and
 *   then says, in those words, that the archive is still where the player left it.
 *
 * The difference is REPORTED rather than smoothed over. A screen that said "imported and
 * removed" on both would be lying on one of them, and the player would go looking for a
 * file that is still there or, worse, stop looking for one that is.
 *
 * NOTHING HERE DISCOVERS ANYTHING AT LOAD. The listing is asked for by the import screen
 * when the player opens it. A shell that unpacked whatever it found in a folder at
 * startup would put an arbitrary archive parser on the one path that must never surprise
 * anybody, and would do it on every launch for the lifetime of the install.
 */

import { installModFromZip, type InstallResult, type InstallEnv } from "./mod-install";

/** One archive waiting in the game's own mods folder. */
export interface WaitingZip {
  readonly name: string;
  readonly bytes: number;
}

/** Everything the import screen needs, injected so its tests need no shell and no DOM. */
export interface ZipImportDeps {
  /** Archives in the game's mods folder. Empty in a browser tab, which has no folder. */
  readonly waiting: () => Promise<readonly WaitingZip[]>;
  /** Read one of those by name, or null when it has gone. */
  readonly read: (name: string) => Promise<Uint8Array | null>;
  /** Ask the player for a file. Null when they cancelled. */
  readonly pick: () => Promise<{ readonly name: string; readonly bytes: Uint8Array } | null>;
  /** Validate and store. Enforces consent itself - see installModFromZip. */
  readonly install: (bytes: Uint8Array) => Promise<InstallResult>;
  /**
   * Delete an archive from the mods folder, or null on a front end that cannot.
   *
   * Null is the honest answer for a browser tab and is what the screen reads to decide
   * which sentence to print. A stub that returned false would say "it could not be
   * deleted", which sounds like a fault rather than like a platform.
   */
  readonly discard: ((name: string) => Promise<{ ok: boolean; error?: string }>) | null;
  /** The mods folder's real path, for the line that tells a player where to drop a zip. */
  readonly folder: () => string | null;
}

/** The shape the desktop preload exposes, declared structurally and checked at runtime. */
interface DesktopZipBridge {
  readonly modsIndexUrl?: unknown;
  readonly modsBaseUrl?: unknown;
  readonly dataDir?: unknown;
  readonly discardModZip?: unknown;
}

function bridgeOf(scope: unknown): DesktopZipBridge | null {
  const desktop = (scope as { neoDesktop?: unknown }).neoDesktop;
  if (desktop === null || typeof desktop !== "object") return null;
  return desktop as DesktopZipBridge;
}

/** The `zips` array off the mods index, or [] for anything that is not one. */
function parseWaiting(parsed: unknown): readonly WaitingZip[] {
  if (parsed === null || typeof parsed !== "object") return [];
  const raw = (parsed as { zips?: unknown }).zips;
  if (!Array.isArray(raw)) return [];
  const out: WaitingZip[] = [];
  for (const entry of raw as unknown[]) {
    if (entry === null || typeof entry !== "object") continue;
    const { name, bytes } = entry as { name?: unknown; bytes?: unknown };
    if (typeof name !== "string" || name === "") continue;
    out.push({ name, bytes: typeof bytes === "number" && bytes >= 0 ? bytes : 0 });
  }
  return out;
}

/**
 * Ask the player for one file, as bytes.
 *
 * A hidden `<input type="file">` rather than showOpenFilePicker, for the reason
 * pickTextFile in userdir.ts gives: the File System Access API is Chromium-only, and
 * the browsers that cannot hand the game a directory are exactly the ones whose players
 * have no other way to install a mod. The cancel path is that file's too - a cancel
 * produces no DOM event anywhere, so the promise settles on `change`, or on the window
 * regaining focus with nothing chosen.
 */
export function pickZipFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: { name: string; bytes: Uint8Array } | null): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(v);
    };
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        done(null);
        return;
      }
      file
        .arrayBuffer()
        .then((buf) => done({ name: file.name, bytes: new Uint8Array(buf) }))
        .catch(() => done(null));
    });
    /* Deferred a tick past focus because Chrome fires focus BEFORE change when a file
     * was chosen, and resolving null there would throw away the file just picked. */
    const onFocus = (): void => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) done(null);
      }, 300);
    };
    window.addEventListener("focus", onFocus);
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * The production wiring.
 *
 * Everything the desktop half needs is feature-detected off `neoDesktop`, so the same
 * bundle serves a browser tab: there, `waiting` answers with nothing, `discard` is null,
 * and only the picked-file door is offered.
 */
export function zipImportDeps(
  env: InstallEnv,
  allowed: () => boolean,
  scope: unknown = globalThis,
): ZipImportDeps {
  const bridge = bridgeOf(scope);
  const indexUrl = typeof bridge?.modsIndexUrl === "string" ? bridge.modsIndexUrl : null;
  const baseUrl = typeof bridge?.modsBaseUrl === "string" ? bridge.modsBaseUrl : null;
  const discardFn = typeof bridge?.discardModZip === "function" ? bridge.discardModZip : null;
  const doFetch = (scope as { fetch?: typeof fetch }).fetch?.bind(scope) ?? null;

  return {
    waiting: async () => {
      if (indexUrl === null || doFetch === null) return [];
      try {
        const res = await doFetch(indexUrl);
        if (!res.ok) return [];
        return parseWaiting(await res.json());
      } catch {
        /* The folder listing is a convenience, not a fact the screen depends on: the
         * picked-file door still works, so a failure here shows an empty list rather
         * than an error about something the player did not ask for. */
        return [];
      }
    },
    read: async (name) => {
      if (baseUrl === null || doFetch === null) return null;
      try {
        /* encodeURIComponent, so a name with a space or a `#` in it addresses the file
         * it names rather than a truncated one - and so a name cannot smuggle a path
         * segment past the route. The main process checks the leaf again anyway. */
        const res = await doFetch(`${baseUrl}/${encodeURIComponent(name)}`);
        if (!res.ok) return null;
        return new Uint8Array(await res.arrayBuffer());
      } catch {
        return null;
      }
    },
    pick: pickZipFile,
    install: async (bytes) => await installModFromZip(bytes, env, allowed()),
    discard:
      discardFn === null
        ? null
        : async (name) => {
            try {
              const answer = await (discardFn as (n: string) => Promise<unknown>)(name);
              if (answer !== null && typeof answer === "object" && "ok" in answer) {
                const { ok, error } = answer as { ok?: unknown; error?: unknown };
                return typeof error === "string"
                  ? { ok: ok === true, error }
                  : { ok: ok === true };
              }
              return { ok: false, error: "the shell gave no answer" };
            } catch (e) {
              return { ok: false, error: e instanceof Error ? e.message : String(e) };
            }
          },
    folder: () => (typeof bridge?.dataDir === "string" ? `${bridge.dataDir}/mods` : null),
  };
}
