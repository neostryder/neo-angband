/**
 * "Allow third-party mods" - the one gate, and where it has to live.
 *
 * A mod is CODE. A pack with no plugin.js contributes data and is only as dangerous
 * as data, but a mod folder may carry a plugin (mod-code.ts) and a plugin runs in
 * the same page as the game with the same access to the player's saved characters.
 * Nothing in this project reviews that code, including the mods this project
 * publishes. So installing one is a decision a player should make once, knowingly,
 * rather than a thing that happens because they pressed Enter on a list.
 *
 * WHERE THE GATE IS. At the INSTALL, not at the row. Drawing a row is harmless and
 * hiding rows would just make the feature look broken; what needs consent is the
 * moment bytes are stored under a mod's name and become code the game will load. So
 * `installBlocked` is called by the installer, and a UI that forgets to check still
 * cannot install anything - the opposite arrangement (a check in the screen only)
 * is the shape that ships a gate with a way round it.
 *
 * WHAT IS EXEMPT, AND WHY THAT IS DEFENSIBLE. The curated list in this game's own
 * repository is not exempt from the RISK - it is the same code from the same kind of
 * repository - but it is exempt from the CONSENT PROMPT, because the maintainer
 * putting a repository on that list is the act of vouching, and the game asking the
 * player to also vouch for it adds a click without adding a decision. Everything
 * else - a third-party registry, a repository somebody pasted - needs the toggle
 * first. The disclaimer says plainly that curated does not mean audited, because it
 * does not.
 *
 * The toggle is off by default, and turning it off again does NOT uninstall
 * anything: consent governs acquiring code, not keeping what you chose. Pretending
 * otherwise would make the switch dangerous to touch, and a safety control nobody
 * dares use is not a safety control.
 */

/** Where a player's answer is kept. */
export const CONSENT_KEY = "neo-angband:allow-third-party-mods";

/** How a mod arrived, which is the only thing consent depends on. */
export type ModOrigin =
  /** From the curated list in this game's own repository. */
  | "curated"
  /** From somebody else's registry, or a repository the player named. */
  | "third-party";

/** Read the answer. Never throws; anything unreadable means "not allowed". */
export function readConsent(store: Pick<Storage, "getItem"> | null): boolean {
  try {
    return store?.getItem(CONSENT_KEY) === "yes";
  } catch {
    /* Storage can throw outright in a locked-down browser. Refusing is the safe
     * answer: the cost is a prompt, and the cost of the other default is code the
     * player never agreed to. */
    return false;
  }
}

/** Record the answer. Best effort - a storage failure must not appear to succeed. */
export function writeConsent(store: Pick<Storage, "setItem"> | null, allow: boolean): boolean {
  try {
    store?.setItem(CONSENT_KEY, allow ? "yes" : "no");
    return true;
  } catch {
    return false;
  }
}

/**
 * Why this install cannot proceed, or null.
 *
 * The message names the switch and where it is, because "not allowed" with no route
 * forward is the same as a broken feature to the person reading it.
 */
export function installBlocked(origin: ModOrigin, allowed: boolean): string | null {
  if (origin === "curated" || allowed) return null;
  return (
    "Third-party mods are not enabled. A mod can include code that runs inside " +
    "the game, so this has to be turned on deliberately: press T on the Mods " +
    "screen, read what it says, and choose."
  );
}

/**
 * The disclaimer, as the player reads it before answering.
 *
 * Written to be true rather than reassuring. It says what a mod can reach, it says
 * that nothing reviews it INCLUDING the mods this project ships, and it does not
 * promise that the curated list is audited - because a disclaimer that oversells
 * the protections is worse than none, and this is the one screen where a player is
 * deciding how much to trust everything that follows.
 *
 * Returned as lines rather than one blob so the caller can lay it out; the text
 * lives here so it is one thing to review and one thing to translate.
 */
export const CONSENT_DISCLAIMER: readonly string[] = [
  "A mod is not just data. A mod folder can contain code, and that code runs",
  "inside the game with the same reach the game has - including your saved",
  "characters and the settings stored in this browser or app.",
  "",
  "Nobody reviews that code. Not this project, not GitHub, and not the",
  "recommended list - a recommendation says a maintainer thought the mod was",
  "worth offering, NOT that anybody audited it.",
  "",
  "If you turn this on:",
  "  - Install from repositories you have a reason to trust, and prefer authors",
  "    whose work you can see the history of.",
  "  - A mod is pinned to the repository it came from on first install, so a",
  "    later update can only come from that same place.",
  "  - Look at what it ships. The manager lists every file it stored and can",
  "    tell you whether those files have changed since.",
  "  - A mod's code runs only while it is ENABLED. Turning one off is the fastest",
  "    thing you can do if the game starts misbehaving.",
  "  - Back your characters up before trying something new. Death is permanent",
  "    here, and a broken mod is not a reason the game will forgive.",
  "",
  "You can turn this off again at any time. Doing so does not uninstall or",
  "delete anything you have already chosen to add.",
];
