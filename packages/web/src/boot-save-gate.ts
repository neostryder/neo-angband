/**
 * Holds saves until the page can write them, then reports whether one was missed.
 *
 * A save needs the mod catalog and the mod-set guard, and the page builds both late in
 * its boot, after the mods' resources have been applied. Anything that asks for a save
 * before then, such as a controller install that resumed straight from the keyboard
 * dialog, used to be told the save failed, so the player saw "Saving failed." although
 * nothing was wrong and the write that mattered (the mark that an autoplayer took the
 * character) was skipped until the next timed save. The gate makes the request wait
 * instead: `admit` says no and remembers it, and `open` says whether to save once now.
 */
export interface BootSaveGate {
  /** True when a save may be written now. When false, the request is remembered. */
  admit(): boolean;
  /** Mark saving ready. True when a save was requested while it was not. */
  open(): boolean;
}

export function createBootSaveGate(): BootSaveGate {
  let ready = false;
  let missed = false;
  return {
    admit(): boolean {
      if (!ready) missed = true;
      return ready;
    },
    open(): boolean {
      ready = true;
      const wasMissed = missed;
      missed = false;
      return wasMissed;
    },
  };
}
