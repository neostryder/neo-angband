import { describe, expect, it } from "vitest";

import {
  CONSENT_DISCLAIMER,
  CONSENT_KEY,
  installBlocked,
  readConsent,
  writeConsent,
} from "./mod-consent";

/** A localStorage that can be made to throw, which real ones do. */
function store(initial: Record<string, string> = {}, throws = false) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string): string | null => {
      if (throws) throw new Error("denied");
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string): void => {
      if (throws) throw new Error("denied");
      map.set(k, v);
    },
    read: (k: string): string | undefined => map.get(k),
  };
}

describe("the third-party consent switch", () => {
  it("is OFF until somebody says yes", () => {
    /* The whole point of an opt-in. A default of "on" would mean the disclaimer is
     * shown after the risk has already been taken. */
    expect(readConsent(store())).toBe(false);
    expect(readConsent(null)).toBe(false);
  });

  it("remembers a yes and a no", () => {
    const s = store();
    expect(writeConsent(s, true)).toBe(true);
    expect(s.read(CONSENT_KEY)).toBe("yes");
    expect(readConsent(s)).toBe(true);
    writeConsent(s, false);
    expect(readConsent(s)).toBe(false);
  });

  it("refuses rather than allows when storage cannot be read", () => {
    /* A locked-down browser throws outright. The cost of refusing is a prompt; the
     * cost of the other default is code the player never agreed to. */
    expect(readConsent(store({}, true))).toBe(false);
  });

  it("reports a failure to record rather than appearing to succeed", () => {
    /* Otherwise the switch looks set, the next launch finds it unset, and the player
     * is told to enable a thing they already enabled. */
    expect(writeConsent(store({}, true), true)).toBe(false);
  });

  it("treats a value that is not exactly yes as no", () => {
    for (const raw of ["", "no", "true", "1", "YES"]) {
      expect(readConsent(store({ [CONSENT_KEY]: raw })), raw).toBe(false);
    }
  });
});

describe("installBlocked", () => {
  it("lets the curated list through without a prompt", () => {
    /* The maintainer putting a repository on that list IS the act of vouching;
     * asking the player to vouch again adds a click and no decision. */
    expect(installBlocked("curated", false)).toBeNull();
    expect(installBlocked("curated", true)).toBeNull();
  });

  it("blocks a third-party install until the switch is on", () => {
    expect(installBlocked("third-party", false)).not.toBeNull();
    expect(installBlocked("third-party", true)).toBeNull();
  });

  it("names the switch and where it is", () => {
    /* "Not allowed" with no route forward reads as a broken feature. */
    const why = installBlocked("third-party", false) ?? "";
    expect(why).toMatch(/Mods screen/u);
    expect(why).toMatch(/\bT\b/u);
  });
});

describe("the disclaimer", () => {
  it("says a mod can run code and reach the player's characters", () => {
    /* The two facts that make this a decision rather than a formality. */
    const text = CONSENT_DISCLAIMER.join(" ");
    expect(text).toMatch(/code/u);
    expect(text).toMatch(/characters/u);
  });

  it("does NOT claim the recommended list is audited", () => {
    /* The failure this guards against is a disclaimer that oversells the
     * protections, which is worse than none: it spends trust the project has not
     * earned, on exactly the screen where a player decides how much to extend. */
    const text = CONSENT_DISCLAIMER.join(" ");
    expect(text).toMatch(/Nobody reviews that code/u);
    expect(text).toMatch(/NOT that anybody audited it/u);
  });

  it("says turning it off does not delete anything", () => {
    /* A safety control nobody dares touch is not a safety control. */
    expect(CONSENT_DISCLAIMER.join(" ")).toMatch(/does not uninstall or\s+delete/u);
  });

  it("gives safety recommendations, not just warnings", () => {
    const text = CONSENT_DISCLAIMER.join(" ");
    for (const advice of [/pinned to the repository/u, /ENABLED/u, /Back your characters up/u]) {
      expect(text, String(advice)).toMatch(advice);
    }
  });
});
