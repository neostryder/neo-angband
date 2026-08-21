/**
 * The update check that asks each mod's own repository, and the sentence it is not
 * allowed to say.
 *
 * The defect this replaces was not a wrong computation. `Update installed mods...
 * (all up to date)` was a true statement about the catalogue compiled into the
 * build, printed on the same screen where "Install a mod" correctly offered a newer
 * version. So most of what is asserted here is WORDING, because the wording was the
 * bug.
 */

import { describe, expect, it, vi } from "vitest";

import type { DiscoverEnv, DiscoverResponse } from "./mod-discover";
import type { InstalledModMeta } from "./mod-install";
import {
  modUpgradeNotice,
  modUpgradeRowLabel,
  pendingUpgrades,
  refreshInstalledMods,
  refreshRow,
  unavailableMods,
  upToDateHeadline,
  type ModRefresh,
} from "./mod-refresh";

function meta(id: string, tag: string, repo = `someone/${id}`): InstalledModMeta {
  return { id, repo, tag, files: ["manifest.json"], installedAt: "2026-08-03T00:00:00.000Z" };
}

/** A fetch that answers the tags API from a table, and 404s anything else. */
function tagsFetch(
  byRepo: Record<string, readonly string[] | { status: number }>,
): { fetch: DiscoverEnv["fetch"]; urls: string[] } {
  const urls: string[] = [];
  const fetch = (url: string): Promise<DiscoverResponse> => {
    urls.push(url);
    const repo = /repos\/([^/]+\/[^/]+)\/tags/u.exec(url)?.[1] ?? "";
    const answer = byRepo[repo];
    if (answer === undefined) {
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") });
    }
    if (!(answer instanceof Array)) {
      return Promise.resolve({
        ok: false,
        status: answer.status,
        text: () => Promise.resolve(""),
      });
    }
    const names: readonly string[] = answer;
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(names.map((name) => ({ name })))),
    });
  };
  return { fetch, urls };
}

function env(fetch: DiscoverEnv["fetch"], channel?: DiscoverEnv["channel"]): DiscoverEnv {
  return { fetch, engineVersion: "0.18.0", ...(channel ? { channel } : {}) };
}

describe("where an installed mod stands against its own repository", () => {
  it("is behind when the repository has a newer tag", async () => {
    const { fetch } = tagsFetch({ "someone/qol": ["v0.13.0", "v0.12.0"] });
    const [r] = await refreshInstalledMods([meta("qol", "v0.12.0")], env(fetch));
    expect(r?.standing).toBe("behind");
    expect(r?.newest).toBe("v0.13.0");
    expect(r?.problem).toBeNull();
  });

  it("is current when the installed tag is the newest", async () => {
    const { fetch } = tagsFetch({ "someone/qol": ["v0.13.0", "v0.12.0"] });
    const [r] = await refreshInstalledMods([meta("qol", "v0.13.0")], env(fetch));
    expect(r?.standing).toBe("same");
  });

  it("is ahead, not behind, when the copy on disk is newer", async () => {
    /* A mod author on their own unreleased tag. Offering the repository's older one
     * with the word "update" would roll them backwards. */
    const { fetch } = tagsFetch({ "someone/qol": ["v0.13.0"] });
    const [r] = await refreshInstalledMods([meta("qol", "v0.14.0")], env(fetch));
    expect(r?.standing).toBe("ahead");
    expect(pendingUpgrades([r!])).toEqual([]);
  });

  it("asks for the tags and NOTHING else - one request per mod", async () => {
    /* Four requests per mod to draw a row is how a mod screen becomes slow enough
     * that people stop opening it. The manifest and the tree are an install's
     * business, not a row's. */
    const { fetch, urls } = tagsFetch({
      "someone/a": ["v1.0.0"],
      "someone/b": ["v1.0.0"],
    });
    await refreshInstalledMods([meta("a", "v1.0.0"), meta("b", "v1.0.0")], env(fetch));
    expect(urls).toHaveLength(2);
    for (const u of urls) expect(u).toContain("/tags");
  });
});

describe("a repository that cannot be asked is UNKNOWN, not fine", () => {
  it("reports unavailable with a reason, and never a standing that reads as current", async () => {
    const { fetch } = tagsFetch({});
    const [r] = await refreshInstalledMods([meta("gone", "v1.0.0")], env(fetch));
    expect(r?.standing).toBe("unavailable");
    expect(r?.problem).toContain("404");
    expect(r?.newest).toBeNull();
  });

  it("treats a rate limit the same way, with its own advice", async () => {
    const { fetch } = tagsFetch({ "someone/qol": { status: 403 } });
    const [r] = await refreshInstalledMods([meta("qol", "v1.0.0")], env(fetch));
    expect(r?.standing).toBe("unavailable");
    expect(r?.problem).toContain("rate-limiting");
  });

  it("survives a fetch that throws outright (offline)", async () => {
    const [r] = await refreshInstalledMods(
      [meta("qol", "v1.0.0")],
      env(() => Promise.reject(new Error("network down"))),
    );
    expect(r?.standing).toBe("unavailable");
    expect(r?.problem).toContain("network down");
  });

  it("does not let one dead repository cost the others their answer", async () => {
    const { fetch } = tagsFetch({ "someone/ok": ["v2.0.0"] });
    const rs = await refreshInstalledMods(
      [meta("gone", "v1.0.0"), meta("ok", "v1.0.0")],
      env(fetch),
    );
    expect(rs.map((r) => r.standing)).toEqual(["unavailable", "behind"]);
    /* And the order is the order given, so the two lists read the same way round. */
    expect(rs.map((r) => r.id)).toEqual(["gone", "ok"]);
  });

  it("never offers an unreachable mod as an update", async () => {
    const { fetch } = tagsFetch({});
    const rs = await refreshInstalledMods([meta("gone", "v1.0.0")], env(fetch));
    expect(pendingUpgrades(rs)).toEqual([]);
    expect(unavailableMods(rs)).toHaveLength(1);
  });
});

describe("the player's game channel is their mod channel", () => {
  it("a stable player is not offered a prerelease, and is told why", async () => {
    const { fetch } = tagsFetch({ "someone/qol": ["v0.14.0-beta.1", "v0.13.0"] });
    const [r] = await refreshInstalledMods([meta("qol", "v0.13.0")], env(fetch, "stable"));
    expect(r?.newest).toBe("v0.13.0");
    expect(r?.standing).toBe("same");
    expect(r?.channelHeld).toBe("v0.14.0-beta.1");
    /* The row has to say it, or the mod's own front page makes the game look wrong. */
    expect(refreshRow(r!)).toContain("v0.14.0-beta.1");
  });

  it("an early player is offered it", async () => {
    const { fetch } = tagsFetch({ "someone/qol": ["v0.14.0-beta.1", "v0.13.0"] });
    const [r] = await refreshInstalledMods([meta("qol", "v0.13.0")], env(fetch, "early"));
    expect(r?.standing).toBe("behind");
    expect(r?.newest).toBe("v0.14.0-beta.1");
  });

  it("a reachable repository with nothing for this channel is not 'unavailable'", async () => {
    /* The question WAS answered. Calling this unavailable would send the player
     * looking for a network problem they do not have. */
    const { fetch } = tagsFetch({ "someone/qol": ["v0.14.0-beta.1"] });
    const [r] = await refreshInstalledMods([meta("qol", "v0.13.0")], env(fetch, "stable"));
    expect(r?.standing).not.toBe("unavailable");
    expect(r?.problem).toBeNull();
    expect(r?.channelHeld).toBe("v0.14.0-beta.1");
  });
});

describe("what the row is allowed to say", () => {
  const at = (standing: ModRefresh["standing"], over: Partial<ModRefresh> = {}): ModRefresh => ({
    id: "qol",
    repo: "someone/qol",
    installed: "v1.0.0",
    newest: "v1.0.0",
    standing,
    problem: standing === "unavailable" ? "not there (HTTP 404)" : null,
    channelHeld: null,
    engineHeld: null,
    ...over,
  });

  it("NEVER says 'up to date' - the phrase this screen shipped a lie in", () => {
    const cases: ModRefresh[][] = [
      [],
      [at("same")],
      [at("unavailable")],
      [at("same"), at("unavailable")],
      [at("behind", { newest: "v2.0.0" })],
      [at("ahead", { newest: "v0.9.0" })],
      [at("unorderable")],
    ];
    for (const refreshed of cases) {
      for (const checked of [true, false]) {
        const label = modUpgradeRowLabel(checked ? refreshed : null, refreshed.length || 1);
        expect(label, JSON.stringify({ refreshed, checked })).not.toMatch(/up to date/iu);
      }
    }
  });

  it("counts what could not be checked even when everything else is current", () => {
    /* The exact shape of the old defect: some true answers plus one unknown, and a
     * label that rounded the unknown down to "fine". */
    const label = modUpgradeRowLabel([at("same"), at("same"), at("unavailable")], 3);
    expect(label).toContain("1 could not be checked");
  });

  it("says so alongside a count of real updates", () => {
    const label = modUpgradeRowLabel([at("behind", { newest: "v2.0.0" }), at("unavailable")], 2);
    expect(label).toContain("1 available");
    expect(label).toContain("could not be checked");
  });

  it("names the repository as the thing measured when everything is current", () => {
    /* "each mod is at its repository's newest version" is a claim about what was
     * actually asked. It is longer than "up to date" on purpose. */
    expect(modUpgradeRowLabel([at("same")], 1)).toContain("repository");
  });

  it("distinguishes not-yet-checked from checked-and-quiet", () => {
    expect(modUpgradeRowLabel(null, 1)).not.toContain("newest version");
    expect(modUpgradeRowLabel([at("same")], 1)).toContain("newest version");
  });

  it("says 'none installed' rather than anything about versions", () => {
    expect(modUpgradeRowLabel([], 0)).toContain("none installed");
  });

  it("says GitHub could not be reached when NOTHING could be checked", () => {
    const label = modUpgradeRowLabel([at("unavailable"), at("unavailable")], 2);
    expect(label).toContain("could not reach GitHub");
  });

  it("stays silent on the update screen when there is nothing to do", () => {
    /* A screen that reports "0 updates" every time is a screen people stop reading. */
    expect(modUpgradeNotice([at("same"), at("unavailable")])).toBeNull();
    expect(modUpgradeNotice([at("behind", { newest: "v2.0.0" })])).toContain("v2.0.0");
  });
});

describe("one mod's own row", () => {
  const base: ModRefresh = {
    id: "qol",
    repo: "someone/qol",
    installed: "v1.0.0",
    newest: "v2.0.0",
    standing: "behind",
    problem: null,
    channelHeld: null,
    engineHeld: null,
  };

  it("shows the move it is offering", () => {
    expect(refreshRow(base)).toBe("qol v1.0.0 -> v2.0.0");
  });

  it("says what went wrong, on the row it went wrong on", () => {
    const row = refreshRow({
      ...base,
      standing: "unavailable",
      problem: "not there (HTTP 404)",
      newest: null,
    });
    expect(row).toContain("could not check");
    expect(row).toContain("404");
    /* And it must not read as an accusation that the mod is gone: a 404 is
     * deleted, renamed, private, a typo or a captive portal. */
    expect(row).not.toMatch(/removed|deleted|no longer/iu);
  });

  it("never renders an empty arrow when there is no newer tag", () => {
    for (const standing of ["same", "ahead", "unorderable", "absent"] as const) {
      expect(refreshRow({ ...base, standing }), standing).not.toContain("->");
    }
  });
});

describe("the network is only touched when the player asks", () => {
  it("refreshing nothing makes no requests at all", async () => {
    const fetch = vi.fn();
    const out = await refreshInstalledMods([], env(fetch as unknown as DiscoverEnv["fetch"]));
    expect(out).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the headline shrinks to fit what was actually asked", () => {
  const r = (id: string, standing: ModRefresh["standing"]): ModRefresh => ({
    id,
    repo: standing === "no-repository" ? "file:import" : `who/${id}`,
    installed: "1.0.0",
    newest: standing === "same" ? "1.0.0" : null,
    standing,
    problem: standing === "unavailable" ? "not there (HTTP 404)" : null,
    channelHeld: null,
    engineHeld: null,
  });

  it("says every ONLY when every mod was really asked", () => {
    expect(upToDateHeadline([r("a", "same"), r("b", "same")])).toBe(
      "Every installed mod is at its repository's newest version.",
    );
  });

  const cases: ReadonlyArray<readonly [string, ModRefresh[]]> = [
    ["one imported mod", [r("a", "no-repository")]],
    ["two imported mods", [r("a", "no-repository"), r("b", "no-repository")]],
    ["one imported beside one checked", [r("a", "no-repository"), r("b", "same")]],
    ["one unreachable beside one checked", [r("a", "unavailable"), r("b", "same")]],
    ["all unreachable", [r("a", "unavailable")]],
    ["imported and unreachable, nothing asked", [r("a", "no-repository"), r("b", "unavailable")]],
  ];
  for (const [what, refreshed] of cases) {
    it(`never says "every ... newest" with ${what}`, () => {
      /* THE CLAIM THIS SCREEN SHIPPED WRONG. A sentence about every installed mod,
       * written after checking only some of them, is the defect - not the layout. */
      expect(upToDateHeadline(refreshed)).not.toMatch(/Every installed mod is at/u);
    });
  }

  it("counts only the mods it asked, not the mods it has", () => {
    const out = upToDateHeadline([r("a", "no-repository"), r("b", "unavailable"), r("c", "same")]);
    expect(out).toBe("1 of 3 are at their repository's newest version.");
  });

  it("distinguishes 'nothing to check' from 'could not check'", () => {
    expect(upToDateHeadline([r("a", "no-repository")])).toMatch(/nothing to check/u);
    expect(upToDateHeadline([r("a", "unavailable")])).toMatch(/None of the installed mods could be checked/u);
    const both = upToDateHeadline([r("a", "no-repository"), r("b", "unavailable")]);
    expect(both).toContain("1 came from a file");
    expect(both).toContain("1 could not be reached");
  });

  it("says so plainly when there are no mods at all", () => {
    expect(upToDateHeadline([])).toBe("No mods are installed yet.");
  });
});

/* ------------------------------------------------------------------ */
/* An update the loader would refuse is not an update                 */
/* ------------------------------------------------------------------ */

describe("the update check does not offer a version this build cannot run", () => {
  /**
   * A fetch that answers the tags API AND each tag's manifest, which the plain
   * `tagsFetch` above deliberately does not: most of this module's behaviour is
   * reachable with one call per mod, and only this part needs a second.
   */
  function net(
    tags: readonly string[],
    manifests: Record<string, Record<string, unknown>>,
  ): { fetch: DiscoverEnv["fetch"]; urls: string[] } {
    const urls: string[] = [];
    const fetch = (url: string): Promise<DiscoverResponse> => {
      urls.push(url);
      if (url.includes("/tags?")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(tags.map((name) => ({ name })))),
        });
      }
      const tag = /refs\/tags\/([^/]+)\//u.exec(url)?.[1] ?? "";
      const body = manifests[tag];
      if (body === undefined) {
        return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(body)),
      });
    };
    return { fetch, urls };
  }

  const code = (engine: string): Record<string, unknown> => ({
    id: "qol",
    name: "Quality of Life",
    version: "9.9.9",
    shape: "content",
    engine,
    modApi: 1,
  });

  it("reports the installed copy as newest when the newer version will not load", async () => {
    /*
     * THE DEFECT THIS CLOSES. A tags call alone sees v0.14.0 and reports "behind",
     * the player takes the update, and the loader then refuses the mod they just
     * installed. The tag being newer was never the question.
     */
    const { fetch } = net(["v0.14.0", "v0.13.0"], {
      "v0.14.0": code(">=0.19.0"),
    });
    const [r] = await refreshInstalledMods([meta("qol", "v0.13.0")], env(fetch));
    expect(r?.standing).toBe("same");
    expect(r?.newest).toBe("v0.13.0");
    expect(r?.engineHeld?.tag).toBe("v0.14.0");
    expect(pendingUpgrades(r ? [r] : [])).toEqual([]);
  });

  it("still offers an update that WILL load", async () => {
    const { fetch } = net(["v0.14.0", "v0.13.0"], {
      "v0.14.0": code(">=0.1.0"),
    });
    const [r] = await refreshInstalledMods([meta("qol", "v0.13.0")], env(fetch));
    expect(r?.standing).toBe("behind");
    expect(r?.newest).toBe("v0.14.0");
    expect(r?.engineHeld).toBeNull();
  });

  it("asks for no manifest at all when nothing newer exists", async () => {
    /* The cost guarantee for the common case: a screen of up-to-date mods still
     * costs one request each, which is what makes this screen affordable. */
    const { fetch, urls } = net(["v0.13.0"], {});
    const [r] = await refreshInstalledMods([meta("qol", "v0.13.0")], env(fetch));
    expect(r?.standing).toBe("same");
    expect(urls.filter((u) => u.includes("manifest.json"))).toEqual([]);
  });

  it("keeps offering the newer tag when its manifest could not be read", async () => {
    /*
     * An unreadable manifest tells nothing either way, and withholding an update
     * over one failed request would be this module's original sin in miniature: a
     * claim about a mod, made without an answer. The install path runs the same
     * walk with a live connection and steps back there if it has to.
     */
    const { fetch } = net(["v0.14.0", "v0.13.0"], {});
    const [r] = await refreshInstalledMods([meta("qol", "v0.13.0")], env(fetch));
    expect(r?.standing).toBe("behind");
    expect(r?.newest).toBe("v0.14.0");
    expect(r?.engineHeld).toBeNull();
  });

  it("says so on the row and in the headline, rather than claiming plain newest", async () => {
    const { fetch } = net(["v0.14.0", "v0.13.0"], {
      "v0.14.0": code(">=0.19.0"),
    });
    const [r] = await refreshInstalledMods([meta("qol", "v0.13.0")], env(fetch));
    if (!r) throw new Error("no result");
    expect(refreshRow(r)).toContain("v0.14.0 needs a newer game");
    /* "Every installed mod is at its repository's newest version" would be false
     * here, and false in a place the player has no way to check. */
    expect(upToDateHeadline([r])).toContain("needs a newer game");
    expect(modUpgradeRowLabel([r], 1)).toContain("need a newer game");
  });
});
