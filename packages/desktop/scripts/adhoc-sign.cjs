/**
 * Ad-hoc sign the macOS app after packaging.
 *
 * WHY THIS EXISTS. There is no Apple Developer identity behind this project, so
 * `MacTargetHelper.findSigningIdentity` finds nothing, `MacPackager.sign`
 * returns false, and electron-builder signs the bundle NOT AT ALL - it logs
 * "skipped macOS code signing" and moves on. On Intel that is merely unsigned,
 * which Gatekeeper will let a user past. On Apple Silicon it is fatal: arm64
 * Mach-O binaries must carry AT LEAST an ad-hoc signature or the kernel refuses
 * to run them, and macOS reports that as `"Neo Angband" is damaged and can't be
 * opened. You should move it to the Trash.` - which reads as a corrupt download.
 *
 * THIS FIXES A LAUNCH DEFECT AND NOT A SPEED ONE, which is a correction to what
 * this comment said first. The original argument was that the "damaged" dialog
 * sends people to the Intel build, so they end up running the whole game under
 * Rosetta and file a report about lag on an M4 - a signing fault wearing a
 * performance costume. That chain needs Rosetta 2 to exist, and Apple is taking
 * it away: macOS 27 removes it during installation and macOS 28 keeps it only
 * for a named set of old games. On such a Mac the Intel build does not run
 * slowly, it does not run, so the lag was the arm64 build going at its own
 * speed - see the renderer's paint-count ratchet for the thing that was actually
 * costing the frames. Shipping an arm64 app with no signature of any kind is
 * wrong on its own terms, which is reason enough for this hook.
 *
 * Electron's own prebuilt binary arrives ad-hoc signed and electron-builder
 * invalidates that signature the moment it rewrites Info.plist and adds
 * resources, so re-signing after packaging is the only place this can go.
 *
 * `-` is the ad-hoc identity: it produces a valid code signature with no
 * certificate and no identity, which is exactly what "unsigned but runnable"
 * means on Apple Silicon. It does not make the app notarised, does not silence
 * Gatekeeper, and does not change what a user has to click - see the macOS
 * section of docs/INSTALL.md for that.
 *
 * IT NEVER FAILS THE BUILD. A signing problem should not cost the Windows and
 * Linux artifacts of a release, and an unsigned bundle is still what we shipped
 * before this existed. It logs loudly instead.
 */

const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  /* Cross-building a Mac app from another OS is possible and `codesign` is not,
   * so this is a no-op there rather than an error. */
  if (process.platform !== "darwin") {
    console.log("[adhoc-sign] not on macOS; leaving the bundle unsigned");
    return;
  }
  const app = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  try {
    /* --deep is deprecated by Apple and is still the only one-shot way to reach
     * the nested helper apps and frameworks an Electron bundle carries; each of
     * them needs its own signature, and every one of them is unsigned here. */
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], {
      stdio: "inherit",
    });
    /* Verified rather than assumed: `codesign` exiting 0 is not the same as the
     * bundle being acceptable, and this is the check the machine that cannot run
     * the result would otherwise skip. */
    execFileSync("codesign", ["--verify", "--verbose=2", app], { stdio: "inherit" });
    console.log(`[adhoc-sign] ad-hoc signed ${app}`);
  } catch (err) {
    console.error(
      `[adhoc-sign] FAILED to ad-hoc sign ${app}. The arm64 build will be ` +
        `reported as damaged on Apple Silicon.`,
      err,
    );
  }
};
