/**
 * The in-place updater's main-process half: download, verify, extract, swap.
 *
 * WHY NOT electron-updater. It does not support the `portable` target at all and
 * it needs a real Apple Developer identity on macOS, because it hands the job to
 * Squirrel.Mac, which validates the signature. This project ships an unpacked
 * folder as its main desktop shape and ad-hoc signs on macOS, so the supported
 * library would have covered NSIS and Linux AppImage users and nobody else - not
 * the folder install the docs recommend, and no Mac. Swapping a directory needs
 * neither, and it is one code path on all three platforms.
 *
 * WHAT IS NOT TRUSTED HERE:
 *
 *  - The archive. Its SHA-256 must equal the digest GitHub reported for that
 *    asset, or nothing is extracted. A download that cannot be verified is
 *    deleted, not installed - see the digest note in web/src/update.ts.
 *  - The URL. It must be an https release asset on github.com, so a poisoned or
 *    stale catalogue cannot point the updater at an arbitrary host.
 *  - Our own success. The swap runs from a script that keeps the outgoing files
 *    until the incoming ones are in place (update-plan.ts).
 *
 * The decisions are in update-plan.ts and unit-tested; this file is the part
 * that touches the disk.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { WORK_DIRNAME, installRoot, swapPlan, swapScript, updatability } from "./update-plan.js";
import type { Updatability } from "./update-plan.js";
import { unpackArchive } from "./unpack.js";

/**
 * Path arithmetic for the TARGET platform, not the host's.
 *
 * `node:path` picks its separator from where the process is running. Every
 * function here already takes the platform as an argument, so using the bare
 * module would make them silently host-dependent - true at runtime, where the
 * two always agree, and false the moment anything reasons about another
 * platform. That is a function that cannot be tested, which is how it stays
 * wrong.
 */
function paths(platform: string): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * The only repository an update may be downloaded from.
 *
 * Stated here as well as in the renderer's update.ts rather than shared, because
 * the two are answering different questions and only one of them is a security
 * boundary: the renderer's copy decides which API to ASK, and this one decides
 * what this process is willing to FETCH. A renderer that has been talked into a
 * different catalogue must not be able to bring its own host with it.
 * `packaging.test.ts` asserts the two strings agree.
 */
export const UPDATE_REPO = "neostryder/neo-angband";

/** Where downloads and extraction happen: a sibling of the install, same volume. */
export function workDir(root: string, platform: string): string {
  const P = paths(platform);
  /* On macOS the install root IS the bundle, so the work directory goes beside
   * it rather than inside - anything written into Contents/ breaks the seal we
   * just spent a release adding. */
  return platform === "darwin"
    ? P.join(P.dirname(root), WORK_DIRNAME)
    : P.join(root, WORK_DIRNAME);
}

/** Whether the install root can be written to, tested rather than assumed. */
export function isWritable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    /* accessSync passes on Windows for directories the ACL will still refuse, so
     * the real question is asked: can a file be created here. */
    const probe = path.join(dir, `.neo-write-probe-${String(process.pid)}`);
    fs.writeFileSync(probe, "");
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Only an https release asset from the project's own repository.
 *
 * The catalogue this URL comes from is fetched over the network, so it is input,
 * not configuration. Everything else about the update is verified by digest -
 * but a digest only proves the bytes match what the API said, and the API answer
 * is what an attacker with DNS would replace. This is the check that says WHERE.
 */
export function isAllowedAssetUrl(url: string, repo: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.hostname !== "github.com" && u.hostname !== "objects.githubusercontent.com") return false;
  if (u.hostname === "github.com" && !u.pathname.startsWith(`/${repo}/releases/download/`)) {
    return false;
  }
  return true;
}

/** The SHA-256 of a file, lowercase hex. */
export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const rs = fs.createReadStream(file);
    rs.on("data", (c) => hash.update(c));
    rs.on("end", () => {
      resolve();
    });
    rs.on("error", reject);
  });
  return hash.digest("hex");
}

/**
 * Windows program paths, named absolutely rather than looked up on PATH.
 *
 * THE BUG THIS EXISTS FOR, in full, because it came back once already. The
 * extractor used to be a bare `tar`, and PATH does not promise which tar that
 * is: Git Bash, MSYS2 and Cygwin all prepend GNU tar, which cannot read zip -
 * the format the Windows build ships in - and reads any `C:\...` path as a
 * REMOTE HOST because of the colon. Both failures are total and neither depends on the
 * archive. It was found only because a test had been failing the whole time and
 * read as flaky.
 *
 * The extractor is gone now (see unpack.ts), but the swap script is still handed
 * to a shell, and `powershell.exe` is the same lookup with the same hazard one
 * function below the one that was fixed. Naming System32 removes the question.
 */
export function systemProgram(name: string, systemRoot?: string): string {
  const root = (systemRoot ?? process.env["SystemRoot"] ?? "C:\\Windows").replace(/[\\/]+$/u, "");
  return `${root}\\System32\\${name}`;
}

/**
 * The extractor for a platform: a program, or null when we do it ourselves.
 *
 * Only macOS still shells out, and only to `/usr/bin/ditto`, which is part of
 * the operating system rather than something a player installs - so the rule
 * this change was made for (the game must not expect an installed tool) holds
 * either way.
 *
 * WHAT WAS MEASURED, because the usual reason given for ditto turns out not to
 * apply here. Reading `Neo.Angband-0.16.0-arm64-mac.zip` with unpack.ts's own
 * reader: 601 entries, 14 symlinks (the `Electron Framework.framework/Versions/
 * Current` chain), unix modes on all 601 with 348 executable, no zip64 - and
 * **zero `__MACOSX` entries**. There is no AppleDouble metadata in the archive
 * at all, so there are no resource forks or extended attributes for ditto to
 * reattach. The only things it does that a plain unzip must also do are the
 * symlinks and the mode bits, and unpack.ts does both.
 *
 * So this stays for exactly one reason, and it is not a technical one: nobody
 * on this project has a Mac, and "the bundle still LAUNCHES" is not a property
 * any test here can observe. Both round trips that could be checked were -
 * the Windows zip and the Linux tar.gz each extract byte-for-byte identically
 * to bsdtar's output over 77 entries - and this is the third, unchecked.
 * Switching it is one line plus one person who can then open the app.
 */
export function extractCommand(
  archive: string,
  into: string,
  platform: string,
): { cmd: string; args: string[] } | null {
  if (platform === "darwin") return { cmd: "/usr/bin/ditto", args: ["-x", "-k", archive, into] };
  return null;
}

/**
 * Run a command, resolving only on exit code 0.
 *
 * A missing extractor is reported as a SENTENCE, because this message is not for
 * a log - update-ui.ts prints whatever comes back straight onto the screen. The
 * raw failure is `spawn tar ENOENT`, which tells a player nothing about what
 * went wrong or that the download they just waited for is intact and the manual
 * route still works. The tools involved ship with every supported OS (see
 * extractCommand), so this should be unreachable; it is exactly the kind of
 * unreachable that turns up on someone's stripped-down Windows image.
 */
export function run(cmd: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, [...args], { stdio: "ignore", windowsHide: true });
    p.on("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "ENOENT"
          ? new Error(`this system has no '${cmd}', which is needed to unpack the update`)
          : err,
      );
    });
    p.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${String(code)}`));
    });
  });
}

export interface DownloadArgs {
  readonly url: string;
  readonly sha256: string;
  readonly size: number;
  readonly repo: string;
  readonly root: string;
  readonly platform: string;
  readonly onProgress?: (received: number, total: number) => void;
}

/**
 * Fetch the archive and prove it is the one GitHub described.
 *
 * The file lands under the work directory and the caller gets its path. Nothing
 * outside the work directory is touched, so an abandoned or failed download
 * costs disk and nothing else.
 */
export async function downloadArchive(args: DownloadArgs): Promise<string> {
  if (!isAllowedAssetUrl(args.url, args.repo)) {
    throw new Error("refusing to download from an unexpected host");
  }
  if (!/^[0-9a-f]{64}$/u.test(args.sha256)) {
    throw new Error("refusing to install an archive with no digest to check");
  }
  const work = workDir(args.root, args.platform);
  fs.mkdirSync(work, { recursive: true });
  const file = paths(args.platform).join(work, path.posix.basename(new URL(args.url).pathname));
  const res = await fetch(args.url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${String(res.status)}`);
  const total = Number(res.headers.get("content-length") ?? args.size);
  let received = 0;
  const out = fs.createWriteStream(file);
  /* Streamed rather than buffered: these archives are 120-165 MB, and holding
   * one in memory in the main process while the renderer is drawing is how a
   * progress bar ends up stuttering on the machine it is reassuring. */
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    args.onProgress?.(received, total);
    if (!out.write(value)) {
      await new Promise<void>((r) => out.once("drain", r));
    }
  }
  await new Promise<void>((resolve, reject) => {
    out.end(() => {
      resolve();
    });
    out.on("error", reject);
  });
  const got = await sha256File(file);
  if (got !== args.sha256) {
    fs.rmSync(file, { force: true });
    throw new Error("the download did not match its published checksum");
  }
  return file;
}

/**
 * Extract into a fresh staging directory and report what to swap in.
 *
 * On macOS the archive contains `Neo Angband.app` at the top level and the swap
 * replaces a bundle, so the staging path points AT the bundle. Everywhere else
 * the archive's top level is the install's contents and staging is the directory
 * itself.
 */
export async function stageArchive(
  archive: string,
  root: string,
  platform: string,
): Promise<string> {
  const P = paths(platform);
  const staging = P.join(workDir(root, platform), "new");
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const external = extractCommand(archive, staging, platform);
  if (external) await run(external.cmd, external.args);
  else await unpackArchive(archive, staging, platform);
  if (platform === "darwin") {
    const bundle = fs.readdirSync(staging).find((n) => n.endsWith(".app"));
    if (!bundle) throw new Error("the macOS archive contained no .app bundle");
    return P.join(staging, bundle);
  }
  /* A sanity check that costs nothing and catches an archive whose layout
   * changed: the extracted tree must contain the executable we are replacing. */
  if (fs.readdirSync(staging).length === 0) throw new Error("the archive was empty");
  return staging;
}

/**
 * Write the swap script and hand it to a process that will outlive us.
 *
 * Returns after SPAWNING it, not after the swap: the script's first act is to
 * wait for this process to exit, so the caller's next move must be to quit.
 */
export function launchSwap(args: {
  root: string;
  staging: string;
  platform: string;
  execPath: string;
  pid: number;
}): void {
  const plan = swapPlan({
    platform: args.platform,
    installRoot: args.root,
    staging: args.staging,
    execPath: args.execPath,
  });
  const work = workDir(args.root, args.platform);
  fs.mkdirSync(work, { recursive: true });
  const isWin = args.platform === "win32";
  const script = paths(args.platform).join(work, isWin ? "swap.ps1" : "swap.sh");
  fs.writeFileSync(script, swapScript(plan, args.pid, args.platform), "utf8");
  if (!isWin) fs.chmodSync(script, 0o755);
  /*
   * The one thing that still cannot be done in-process: a running program cannot
   * replace its own files, so the swap has to outlive us. `powershell.exe` and
   * `/bin/sh` are components of their operating systems rather than tools a
   * player installs - but the Windows one is named ABSOLUTELY, because "whatever
   * PATH hands over" is exactly what put GNU tar in the extractor's place.
   */
  const child = isWin
    ? spawn(
        systemProgram("WindowsPowerShell\\v1.0\\powershell.exe"),
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
        { detached: true, stdio: "ignore", windowsHide: true },
      )
    : spawn("/bin/sh", [script], { detached: true, stdio: "ignore" });
  /* Unref, or Electron's own exit waits on the very process that is waiting for
   * Electron to exit. */
  child.unref();
}

/** Everything the renderer is told about this launch's update options. */
export function shapeOf(args: {
  platform: string;
  arch: string;
  packaged: boolean;
  execPath: string;
  env: Record<string, string | undefined>;
}): { how: Updatability; installRoot: string; platform: string; arch: string } {
  const root = installRoot(args.platform, args.execPath);
  const how = updatability({
    platform: args.platform,
    packaged: args.packaged,
    portableExecutableDir: args.env["PORTABLE_EXECUTABLE_DIR"],
    appImage: args.env["APPIMAGE"],
    /* A dev run has no install root worth probing, and probing it would create a
     * file in the repository. */
    writable: args.packaged ? isWritable(root) : false,
  });
  return { how, installRoot: root, platform: args.platform, arch: args.arch };
}
