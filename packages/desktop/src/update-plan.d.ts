/**
 * WHAT an in-place update moves, decided before anything is moved.
 *
 * Replacing the folder a program is running out of is the one operation in this
 * project that can destroy an install, so the decision and the doing are split:
 * everything here is a pure function of paths and platform, tested without a
 * filesystem, and `updater.ts` is the thin part that carries it out.
 *
 * THE ORDER IS THE SAFETY PROPERTY. Move the old files ASIDE, move the new ones
 * IN, and only then delete what was moved aside:
 *
 *     install/*  ->  attic/*        (rename; atomic on one volume)
 *     staging/*  ->  install/*
 *     rm -rf attic                  (only once the above both worked)
 *
 * A crash between the first two steps leaves the attic intact and the recovery
 * is to move it back, which is why the attic is a SIBLING of the install rather
 * than a temp directory: `os.tmpdir()` is frequently on another volume, where a
 * rename becomes a copy, stops being atomic, and can half-finish.
 *
 * `neo-angband-data` is never moved, on any path. There is no save-scumming in
 * this game, so a deleted savefile is a dead character - the same rule
 * install-portable.mjs keeps, and the same constant.
 */
/** Kept byte-for-byte across an update. Must match data-dir.ts. */
export declare const PRESERVE: readonly string[];
/** Where an update's downloads and half-extracted files live. */
export declare const WORK_DIRNAME = ".neo-update";
/**
 * How this launch can be updated.
 *
 *  - `swap`   the app is a folder we own and can replace in place.
 *  - `manual` an update exists and can be downloaded, but this launch cannot
 *             install it over itself - the file is revealed instead.
 *  - `none`   do not offer anything.
 */
export type Updatability = "swap" | "manual" | "none";
export interface LaunchShape {
    readonly platform: string;
    /** app.isPackaged. A dev run has no install to replace. */
    readonly packaged: boolean;
    /** electron-builder's `portable` target sets this. */
    readonly portableExecutableDir?: string | undefined;
    /** An AppImage launch sets this. */
    readonly appImage?: string | undefined;
    /** Whether the install root can actually be written to. */
    readonly writable: boolean;
}
/**
 * A SINGLE-FILE LAUNCH CANNOT BE SWAPPED, and it is the case most likely to be
 * got wrong, because everything about it looks normal from inside.
 *
 * Both `portable.exe` and an AppImage unpack themselves to a temp directory and
 * run from there, so `app.getPath("exe")` points at a folder that will not exist
 * after the next reboot. Swapping it would appear to succeed and change nothing:
 * the player would press (U)pdate, watch a progress bar, get a relaunch, and
 * still be on the old version - with no error anywhere. Those launches are
 * offered the download and told where it went.
 */
export declare function updatability(shape: LaunchShape): Updatability;
/**
 * The install root: the directory an update replaces.
 *
 * On Windows and Linux that is the folder holding the executable. On macOS it is
 * the `.app` BUNDLE - three levels up from `Contents/MacOS/Neo Angband` - and not
 * the MacOS folder, because a bundle is the unit macOS signs, quarantines and
 * moves. Replacing its innards while leaving the outer directory would keep the
 * old `_CodeSignature`, which is the state that makes an arm64 build refuse to
 * launch (see scripts/adhoc-sign.cjs).
 */
export declare function installRoot(platform: string, execPath: string): string;
/** Whether the swap replaces a directory's CONTENTS or the directory itself. */
export type SwapMode = "contents" | "bundle";
export interface SwapPlan {
    readonly mode: SwapMode;
    /** The directory being replaced (contents), or the bundle itself. */
    readonly target: string;
    /** Where the extracted new version is. */
    readonly staging: string;
    /** Where the outgoing files are parked until the swap has succeeded. */
    readonly attic: string;
    /** Entries under `target` that must survive. Empty in bundle mode. */
    readonly preserve: readonly string[];
    /** What to start once the swap is done. */
    readonly relaunch: string;
}
/**
 * macOS swaps the whole bundle; Windows and Linux swap the contents.
 *
 * The difference is not stylistic. On Windows the folder is very often the
 * player's own (`C:\Games\Neo Angband`), it holds `neo-angband-data`, and it may
 * be the target of a shortcut or a Start-menu entry - so the folder must keep
 * its identity and only its contents change. A `.app` holds no player data and
 * IS the thing the OS tracks, so it is replaced whole.
 */
export declare function swapPlan(args: {
    platform: string;
    installRoot: string;
    staging: string;
    execPath: string;
}): SwapPlan;
/** Shell-quote for PowerShell: single quotes, with '' as the escape. */
export declare function psQuote(s: string): string;
/** Shell-quote for POSIX sh. */
export declare function shQuote(s: string): string;
/**
 * The script that finishes the job after the app has exited.
 *
 * IT HAS TO BE AN EXTERNAL PROCESS. A program cannot replace its own running
 * executable on Windows (the file is locked) and cannot reliably do it on macOS
 * either, so the last step belongs to something that outlives us. The script
 * waits for our PID, swaps, relaunches, and deletes the attic.
 *
 * THE WAIT IS BOUNDED. If the app somehow never exits, an unbounded wait leaves
 * a process polling forever and, worse, a staged update that silently never
 * lands. After the timeout the script gives up WITHOUT touching anything, which
 * leaves a working old install rather than a half-swapped new one.
 */
export declare function swapScript(plan: SwapPlan, pid: number, platform: string): string;
//# sourceMappingURL=update-plan.d.ts.map