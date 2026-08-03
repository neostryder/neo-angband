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
