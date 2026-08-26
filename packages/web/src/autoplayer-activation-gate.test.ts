/**
 * The warn-and-confirm gate on an autoplayer taking the keyboard (#125).
 *
 * WHY THIS READS SOURCE, same reasoning as borg-restart.test.ts: main.ts boots
 * a game on import and cannot be imported by a test, and what is being pinned
 * here is not a function's return value but the ORDER a boot takes - whether
 * the confirm runs before the install, and whether a save that already
 * carries NOSCORE_BORG is spared a second prompt.
 *
 * THE BUG THIS CLOSES: turning on the Borg mod's `borg.autoplay` rule flag -
 * an ordinary toggle on the generic "Fixes & tweaks" rule screen, with no
 * special-casing for this flag - was the only action needed before the next
 * boot's controller-install loop installed the controller and marked the save
 * NOSCORE_BORG, with no warning and no confirmation at all. The fix holds a
 * candidate that wants the keyboard, on a save that has never granted it
 * before, instead of installing it at once - and only finishes the install
 * once the player has seen upstream's own warning and said yes.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(here, "main.ts"), "utf8");

/** main.ts with comments stripped, so a comment naming a behaviour cannot
 * stand in for the code actually doing it. */
const NO_COMMENTS = SRC.replace(/\/\*[\s\S]*?\*\//gu, "").replace(
  /(^|[^:])\/\/[^\n]*/gu,
  "$1",
);

/** From `startMarker` (searched from `from`, or from the top) to `endMarker`. */
function bodyOf(startMarker: string, endMarker: string, label: string, from = 0): string {
  const at = NO_COMMENTS.indexOf(startMarker, from);
  expect(at, `${label}: start marker "${startMarker}" still present`).toBeGreaterThan(-1);
  const end = NO_COMMENTS.indexOf(endMarker, at);
  expect(end, `${label}: end marker "${endMarker}" still present after the start`).toBeGreaterThan(
    at,
  );
  return NO_COMMENTS.slice(at, end);
}

/**
 * Where finishAutoplayerInstall (the extracted install-and-pump helper, #125)
 * starts. There is exactly one function of this name, so this is unambiguous
 * even though "for (const loaded of activeModCode().plugins) {" on its own
 * matches twice in the file - once for an unrelated register() loop above
 * this point, once for the controller-install loop below it.
 */
function finishInstallAt(): number {
  const at = NO_COMMENTS.indexOf("function finishAutoplayerInstall(");
  expect(at, "the autoplayer install-and-pump helper is still here").toBeGreaterThan(-1);
  return at;
}

/** finishAutoplayerInstall's own body, not the loop that calls it. */
function finishBody(): string {
  return bodyOf(
    "function finishAutoplayerInstall(",
    "for (const loaded of activeModCode().plugins) {",
    "finishAutoplayerInstall",
    finishInstallAt(),
  );
}

/** The boot-time controller-install loop's body - the one AFTER finishAutoplayerInstall. */
function installLoop(): string {
  return bodyOf(
    "for (const loaded of activeModCode().plugins) {",
    'window as unknown as { __neo?: unknown }',
    "the controller-install loop",
    finishInstallAt(),
  );
}

describe("the boot-time install loop no longer installs unconditionally", () => {
  it("gates the install on NOSCORE.BORG already being set", () => {
    /* Upstream's own gate (do_cmd_try_borg, cmd-misc.c:127) is an
     * "already asked" short-circuit, not a port addition - a save that
     * carries the bit ran this exact confirmation on an earlier boot or
     * through Ctrl-Z, and installing again is the same character
     * continuing, not a new activation. */
    const body = installLoop();
    expect(body).toMatch(
      /if \(\(state\.actor\.player\.noscore & NOSCORE\.BORG\) !== 0\) \{/u,
    );
  });

  it("finishes the install at once only inside that gate", () => {
    const body = installLoop();
    const gateAt = body.indexOf("(state.actor.player.noscore & NOSCORE.BORG) !== 0");
    expect(gateAt).toBeGreaterThan(-1);
    const finishAt = body.indexOf("finishAutoplayerInstall(loaded, controller);");
    expect(finishAt, "finishAutoplayerInstall is still called from the loop").toBeGreaterThan(-1);
    expect(finishAt).toBeGreaterThan(gateAt);
  });

  it("holds an unconfirmed candidate instead of installing it", () => {
    const body = installLoop();
    expect(body).toMatch(/pendingAutoplayerInstall = \{ loaded, controller \};/u);
  });

  it("refuses a second autoplayer whether the first is installed or only pending", () => {
    /* Only one autoplayer can hold the keyboard - and a candidate waiting on
     * the confirm gate has just as much claim to the slot as one that is
     * already running, or two mods could both end up in confirmPending at
     * once with only one able to actually install. */
    const body = installLoop();
    expect(body).toMatch(/const holderId = currentOrPendingAutoplayerId\(\);/u);
    expect(body).toMatch(/if \(holderId\) \{/u);
  });
});

describe("finishAutoplayerInstall shows the on-screen indicator", () => {
  it("shows the banner as part of installing, not as an afterthought bolted on", () => {
    const body = finishBody();
    const markAt = body.indexOf("takenOver.noscore = markNoscore(takenOver.noscore, NOSCORE.BORG)");
    const bannerAt = body.indexOf("showAutoplayerBanner(loaded.id)");
    expect(markAt).toBeGreaterThan(-1);
    expect(bannerAt, "finishAutoplayerInstall still shows the banner").toBeGreaterThan(-1);
    expect(bannerAt).toBeGreaterThan(markAt);
  });

  it("hides the banner in the same place the keyboard is actually handed back", () => {
    const body = finishBody();
    const stopAt = body.indexOf("stopInstalledController = () => {");
    expect(stopAt).toBeGreaterThan(-1);
    const stopBody = body.slice(stopAt, body.indexOf("};", stopAt));
    expect(stopBody).toMatch(/hideAutoplayerBanner\(\);/u);
  });
});

describe("the confirm gate itself", () => {
  function confirmPendingBody(): string {
    return bodyOf(
      "async function confirmPendingAutoplayerInstall(",
      "async function waitingModUpdates(",
      "confirmPendingAutoplayerInstall",
    );
  }

  it("does nothing when there is no pending candidate", () => {
    const body = confirmPendingBody();
    expect(body).toMatch(/if \(!pending\) return;/u);
  });

  it("clears the pending slot before the async confirm, not after", () => {
    /* Clearing it after the await would leave a second boot's install loop
     * able to see a stale pending candidate if the reload path ran first -
     * belt and suspenders alongside reloadAfterModChange's own clear. */
    const body = confirmPendingBody();
    const clearAt = body.indexOf("pendingAutoplayerInstall = null;");
    const confirmAt = body.indexOf("confirmBorgActivation()");
    expect(clearAt).toBeGreaterThan(-1);
    expect(confirmAt).toBeGreaterThan(-1);
    expect(clearAt).toBeLessThan(confirmAt);
  });

  it("only installs after the player says yes", () => {
    const body = confirmPendingBody();
    const declineAt = body.indexOf("if (!(await confirmBorgActivation())) {");
    const finishAt = body.indexOf("finishAutoplayerInstall(pending.loaded, pending.controller);");
    expect(declineAt).toBeGreaterThan(-1);
    expect(finishAt, "still calls finishAutoplayerInstall on acceptance").toBeGreaterThan(-1);
    expect(finishAt).toBeGreaterThan(declineAt);
  });

  it("does not mark or install anything on decline", () => {
    const body = confirmPendingBody();
    const declineAt = body.indexOf("if (!(await confirmBorgActivation())) {");
    const declineEnd = body.indexOf("}", body.indexOf("return;", declineAt));
    const declineBranch = body.slice(declineAt, declineEnd);
    expect(declineBranch).not.toMatch(/finishAutoplayerInstall/u);
    expect(declineBranch).not.toMatch(/markNoscore/u);
  });

  it("is chained into the boot promise after the game screen is live", () => {
    /* gameScreenLive is set, and maybeShowGraphics runs, before this - so the
     * warning is the first thing painted on a screen the player can actually
     * see, never something that can flash past behind a loading screen or a
     * birth flow that still owns the terminal. */
    const at = NO_COMMENTS.indexOf(".then(maybeShowGraphics)");
    expect(at, "the boot chain still ends with maybeShowGraphics").toBeGreaterThan(-1);
    const nearby = NO_COMMENTS.slice(at, at + 200);
    expect(nearby).toMatch(/\.then\(confirmPendingAutoplayerInstall\)/u);
  });
});

describe("activateAutoplayerCmd (Ctrl-Z) marks the save before reloading", () => {
  function cmdBody(): string {
    return bodyOf(
      "async function activateAutoplayerCmd(",
      "async function confirmPendingAutoplayerInstall(",
      "activateAutoplayerCmd",
    );
  }

  it("marks NOSCORE.BORG before reloadAfterModChange, not after", () => {
    /* Marking it after the reload would mean the very next boot's install
     * loop still finds the bit unset and asks again for a confirmation the
     * player already gave - the double-prompt this fix has to avoid. */
    const body = cmdBody();
    const markAt = body.indexOf("takenOver.noscore = markNoscore(takenOver.noscore, NOSCORE.BORG)");
    const reloadAt = body.indexOf("reloadAfterModChange({ resume: true })");
    expect(markAt, "activateAutoplayerCmd still marks the save").toBeGreaterThan(-1);
    expect(reloadAt).toBeGreaterThan(-1);
    expect(markAt).toBeLessThan(reloadAt);
  });

  it("still asks before doing anything at all", () => {
    const body = cmdBody();
    expect(body).toMatch(/if \(!\(await confirmBorgActivation\(\)\)\) return;/u);
  });

  it("shares its warning text with the boot-time gate, not a second copy", () => {
    /* One shared helper (confirmBorgActivation) means the two entrances a
     * player can reach an autoplayer through cannot drift into saying
     * different things for the same decision. */
    const occurrences =
      NO_COMMENTS.match(/You are about to use the dangerous, unsupported, borg commands!/gu) ?? [];
    expect(occurrences.length).toBe(1);
  });
});

describe("a reload clears a pending candidate too", () => {
  it("reloadAfterModChange clears pendingAutoplayerInstall alongside installedController", () => {
    const at = NO_COMMENTS.indexOf("function reloadAfterModChange");
    expect(at, "reloadAfterModChange is still here").toBeGreaterThan(-1);
    const end = NO_COMMENTS.indexOf("location.reload()", at);
    const body = NO_COMMENTS.slice(at, end);
    expect(body).toMatch(/installedController = null;/u);
    expect(body).toMatch(/pendingAutoplayerInstall = null;/u);
    expect(body).toMatch(/hideAutoplayerBanner\(\);/u);
  });
});
