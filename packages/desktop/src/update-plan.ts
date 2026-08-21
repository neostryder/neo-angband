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
export const PRESERVE: readonly string[] = ["neo-angband-data"];

/** Where an update's downloads and half-extracted files live. */
export const WORK_DIRNAME = ".neo-update";

/**
 * How this launch can be updated.
 *
 *  - `swap`   the app is a folder this build owns and can replace in place.
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
export function updatability(shape: LaunchShape): Updatability {
  if (!shape.packaged) return "none";
  if (shape.portableExecutableDir || shape.appImage) return "manual";
  if (!shape.writable) return "manual";
  if (shape.platform !== "win32" && shape.platform !== "darwin" && shape.platform !== "linux") {
    return "none";
  }
  return "swap";
}

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
export function installRoot(platform: string, execPath: string): string {
  const parts = execPath.split(/[\\/]/u);
  const up = (n: number): string => parts.slice(0, parts.length - n).join(platform === "win32" ? "\\" : "/");
  if (platform === "darwin") {
    /* .../Neo Angband.app/Contents/MacOS/Neo Angband */
    const bundle = up(3);
    return bundle.endsWith(".app") ? bundle : up(1);
  }
  return up(1);
}

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
export function swapPlan(args: {
  platform: string;
  installRoot: string;
  staging: string;
  execPath: string;
}): SwapPlan {
  const sep = args.platform === "win32" ? "\\" : "/";
  const attic = `${args.installRoot}.old`;
  if (args.platform === "darwin") {
    return {
      mode: "bundle",
      target: args.installRoot,
      staging: args.staging,
      attic,
      preserve: [],
      relaunch: args.installRoot,
    };
  }
  return {
    mode: "contents",
    target: args.installRoot,
    staging: args.staging,
    attic: `${args.installRoot}${sep}${WORK_DIRNAME}${sep}old`,
    preserve: PRESERVE,
    relaunch: args.execPath,
  };
}

/** Shell-quote for PowerShell: single quotes, with '' as the escape. */
export function psQuote(s: string): string {
  return `'${s.replace(/'/gu, "''")}'`;
}

/** Shell-quote for POSIX sh. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/gu, `'\\''`)}'`;
}

/**
 * The script that finishes the job after the app has exited.
 *
 * IT HAS TO BE AN EXTERNAL PROCESS. A program cannot replace its own running
 * executable on Windows (the file is locked) and cannot reliably do it on macOS
 * either, so the last step belongs to something that outlives this process. The script
 * waits for the app's PID, swaps, relaunches, and deletes the attic.
 *
 * THE WAIT IS BOUNDED. If the app somehow never exits, an unbounded wait leaves
 * a process polling forever and, worse, a staged update that silently never
 * lands. After the timeout the script gives up WITHOUT touching anything, which
 * leaves a working old install rather than a half-swapped new one.
 */
export function swapScript(plan: SwapPlan, pid: number, platform: string): string {
  if (platform === "win32") {
    const q = psQuote;
    const keep = plan.preserve.map((p) => q(p)).join(",");
    return [
      `$ErrorActionPreference = 'Stop'`,
      `$target = ${q(plan.target)}`,
      `$staging = ${q(plan.staging)}`,
      `$attic = ${q(plan.attic)}`,
      `$keep = @(${keep})`,
      /* The swapper runs with no console, no window and no parent left to report
       * to, so a line in a file is the ONLY account anyone will ever get of what
       * it did. It lives in the work directory, which the move loop skips, so it
       * survives the swap it is describing. Swallowed on failure: a log that
       * cannot be written must not be the reason an update stops. */
      `$logf = Join-Path $target '${WORK_DIRNAME}\\swap.log'`,
      `function Say($m) { try { Add-Content -LiteralPath $logf -Value ((Get-Date).ToString('s') + ' ' + $m) } catch { } }`,
      `Say "swap starting; waiting for pid ${String(pid)}"`,
      `for ($i = 0; $i -lt 120; $i++) {`,
      `  if (-not (Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue)) { break }`,
      `  Start-Sleep -Milliseconds 500`,
      `}`,
      `if (Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue) { Say 'gave up: the app was still running after 60s'; exit 1 }`,
      `Say 'the app has exited; swapping'`,
      `New-Item -ItemType Directory -Force -Path $attic | Out-Null`,
      `$moved = @()`,
      `try {`,
      `  foreach ($e in Get-ChildItem -LiteralPath $target -Force) {`,
      `    if ($keep -contains $e.Name) { continue }`,
      `    if ($e.Name -eq '${WORK_DIRNAME}') { continue }`,
      `    Move-Item -LiteralPath $e.FullName -Destination (Join-Path $attic $e.Name) -Force`,
      `    $moved += $e.Name`,
      `  }`,
      `  foreach ($e in Get-ChildItem -LiteralPath $staging -Force) {`,
      `    Move-Item -LiteralPath $e.FullName -Destination (Join-Path $target $e.Name) -Force`,
      `  }`,
      `} catch {`,
      `  Say ('the swap failed, rolling back: ' + $_.Exception.Message)`,
      `  foreach ($n in $moved) {`,
      `    $back = Join-Path $attic $n`,
      `    if (Test-Path -LiteralPath $back) { Move-Item -LiteralPath $back -Destination (Join-Path $target $n) -Force }`,
      `  }`,
      `  Say 'rollback complete; the old version is intact'`,
      `  exit 1`,
      `}`,
      `Remove-Item -LiteralPath $attic -Recurse -Force -ErrorAction SilentlyContinue`,
      `Say 'swap complete; relaunching'`,
      /* -WorkingDirectory, because this process was created by the WMI provider
       * host and inherited ITS current directory (System32), not the game's. */
      `Start-Process -FilePath ${q(plan.relaunch)} -WorkingDirectory $target`,
    ].join("\n");
  }
  const q = shQuote;
  const keep = plan.preserve.map((p) => q(p)).join(" ");
  const bundle = plan.mode === "bundle";
  return [
    `#!/bin/sh`,
    `set -e`,
    `target=${q(plan.target)}`,
    `staging=${q(plan.staging)}`,
    `attic=${q(plan.attic)}`,
    /* The same account the Windows branch keeps, for the same reason: nobody is
     * left to report to. In bundle mode the target is replaced wholesale, so the
     * log goes beside the work directory rather than inside the thing that moves. */
    `logf=${q(`${plan.mode === "bundle" ? plan.staging.replace(/[\\/]new$/u, "") : `${plan.target}/${WORK_DIRNAME}`}/swap.log`)}`,
    `say() { printf '%s %s\\n' "$(date +%FT%T)" "$1" >> "$logf" 2>/dev/null || true; }`,
    `say "swap starting; waiting for pid ${String(pid)}"`,
    `i=0`,
    `while [ $i -lt 120 ] && kill -0 ${String(pid)} 2>/dev/null; do sleep 0.5; i=$((i+1)); done`,
    `if kill -0 ${String(pid)} 2>/dev/null; then say 'gave up: the app was still running after 60s'; exit 1; fi`,
    `say 'the app has exited; swapping'`,
    bundle
      ? [
          `rm -rf "$attic"`,
          `mv "$target" "$attic"`,
          `if ! mv "$staging" "$target"; then mv "$attic" "$target"; exit 1; fi`,
          `rm -rf "$attic"`,
        ].join("\n")
      : [
          `mkdir -p "$attic"`,
          /* The moved names are recorded to a file rather than a shell word
           * list: `for n in $moved` splits on spaces, and half of an Electron
           * folder is "Neo Angband something". A rollback that skips the files
           * with spaces in them is worse than none, because it looks like it
           * worked. */
          `: > "$attic/.moved"`,
          `restore() {`,
          `  while IFS= read -r n; do`,
          `    [ -e "$attic/$n" ] && mv "$attic/$n" "$target/$n"`,
          `  done < "$attic/.moved"`,
          `  exit 1`,
          `}`,
          `for e in "$target"/* "$target"/.[!.]*; do`,
          `  [ -e "$e" ] || continue`,
          `  n=$(basename "$e")`,
          `  case "$n" in ${keep ? `${plan.preserve.join("|")}|` : ""}${WORK_DIRNAME}) continue ;; esac`,
          `  mv "$e" "$attic/$n" || restore`,
          `  printf '%s\\n' "$n" >> "$attic/.moved"`,
          `done`,
          `for e in "$staging"/* "$staging"/.[!.]*; do`,
          `  [ -e "$e" ] || continue`,
          `  mv "$e" "$target/$(basename "$e")" || restore`,
          `done`,
          `rm -rf "$attic"`,
        ].join("\n"),
    `say 'swap complete; relaunching'`,
    bundle ? `open ${q(plan.relaunch)}` : `${q(plan.relaunch)} &`,
  ].join("\n");
}
