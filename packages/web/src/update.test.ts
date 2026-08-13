/**
 * The update check, against the three ways GitHub's API silently says nothing.
 *
 * Every test here is an assertion about a case that FAILS QUIETLY in production:
 * a pre-release invisible to /releases/latest, a draft that must never be
 * offered, a re-uploaded old release that looks newest by date. None of them
 * throw, none of them log; the only symptom is a shimmer that never appears, so
 * they have to be asserted rather than noticed.
 */

import { describe, expect, it, vi } from "vitest";
import { defaultLogLevel } from "@rpgm-tools/neo-angband-core/log";
import {
  CHANNEL_KEY,
  checkForUpdate,
  decideUpdate,
  defaultChannel,
  EDGE_MARKER,
  isEdgeRelease,
  newestRelease,
  parseReleases,
  pickAsset,
  readChannel,
  releasesIn,
  UPDATE_REPO,
  updaterBridge,
  writeChannel,
} from "./update";
import type { Release, ReleaseAsset } from "./update";

const WIN = { platform: "win32", arch: "x64" };
const MAC_ARM = { platform: "darwin", arch: "arm64" };
const MAC_X64 = { platform: "darwin", arch: "x64" };
const LINUX = { platform: "linux", arch: "x64" };

function asset(name: string, sha256: string | null = "a".repeat(64)): ReleaseAsset {
  return { name, url: `https://example.invalid/${name}`, size: 1000, sha256 };
}

/** The eleven files a real release carries, at 0.17.0 naming. */
const ASSETS = [
  "neo-angband-web-0.17.0.zip",
  "Neo.Angband-0.17.0-amd64.deb",
  "Neo.Angband-0.17.0-arm64-mac.dmg",
  "Neo.Angband-0.17.0-arm64-mac.zip",
  "Neo.Angband-0.17.0-portable.exe",
  "Neo.Angband-0.17.0-win.zip",
  "Neo.Angband-0.17.0-x64-mac.dmg",
  "Neo.Angband-0.17.0-x64-mac.zip",
  "Neo.Angband-0.17.0-x64.tar.gz",
  "Neo.Angband-0.17.0-x86_64.AppImage",
  "Neo.Angband.Setup.0.17.0.exe",
].map((n) => asset(n));

function release(over: Partial<Release> = {}): Release {
  return {
    tag: "v0.17.0",
    version: "0.17.0",
    draft: false,
    prerelease: true,
    url: "https://example.invalid/r",
    assets: ASSETS,
    ...over,
  };
}

describe("which file this machine needs", () => {
  it("takes the archive, never the installer or the disk image", () => {
    expect(pickAsset(ASSETS, WIN)?.name).toBe("Neo.Angband-0.17.0-win.zip");
    expect(pickAsset(ASSETS, MAC_ARM)?.name).toBe("Neo.Angband-0.17.0-arm64-mac.zip");
    expect(pickAsset(ASSETS, MAC_X64)?.name).toBe("Neo.Angband-0.17.0-x64-mac.zip");
    expect(pickAsset(ASSETS, LINUX)?.name).toBe("Neo.Angband-0.17.0-x64.tar.gz");
  });

  it("never hands an Apple Silicon Mac the Intel build", () => {
    /* The defect this whole naming pass came from: an unlabelled file that is
     * actually x64. If the arm64 archive is missing, the answer is NOTHING -
     * offering the Intel one is the failure, not the fallback. */
    const noArm = ASSETS.filter((a) => !a.name.includes("arm64"));
    expect(pickAsset(noArm, MAC_ARM)).toBeNull();
  });

  it("reads a pre-0.17.0 release, where the x64 mac zip had no arch in its name", () => {
    const old = [asset("Neo.Angband-0.16.0-arm64-mac.zip"), asset("Neo.Angband-0.16.0-mac.zip")];
    expect(pickAsset(old, MAC_X64)?.name).toBe("Neo.Angband-0.16.0-mac.zip");
    expect(pickAsset(old, MAC_ARM)?.name).toBe("Neo.Angband-0.16.0-arm64-mac.zip");
  });

  it("answers null for a platform we do not ship", () => {
    expect(pickAsset(ASSETS, { platform: "freebsd", arch: "x64" })).toBeNull();
  });

  it("refuses a release that is not this product, however well its names fit", () => {
    /*
     * These are upstream Angband's real asset names, copied from its releases
     * API. Its Windows archive ends in `-win.zip` and its source tarball in
     * `.tar.gz`, exactly like ours - so while the platform test was a bare
     * suffix match, the ONLY thing stopping a foreign release from being
     * unpacked over this game was UPDATE_REPO holding the right string.
     *
     * That is not hypothetical: this feature cannot be exercised end-to-end
     * until a release is published, so verifying it meant pointing the check at
     * upstream, which HAS published releases. The pointer was reverted, but a
     * single constant should not be the whole defence.
     */
    const upstream = [
      "Angband-4.2.6-166-gf0f6bd223-3ds.zip",
      "Angband-4.2.6-166-gf0f6bd223-nds.zip",
      "Angband-4.2.6-166-gf0f6bd223-osx.dmg",
      "Angband-4.2.6-166-gf0f6bd223-win.zip",
      "Angband-4.2.6-166-gf0f6bd223.tar.gz",
    ].map((n) => asset(n));
    for (const machine of [WIN, MAC_ARM, MAC_X64, LINUX]) {
      expect(pickAsset(upstream, machine), machine.platform).toBeNull();
    }
  });

  it("still finds our file when a foreign one sits beside it", () => {
    /* The filter must exclude the impostor, not give up on the whole list. */
    const mixed = [asset("Angband-4.2.6-166-gf0f6bd223-win.zip"), ...ASSETS];
    expect(pickAsset(mixed, WIN)?.name).toBe("Neo.Angband-0.17.0-win.zip");
  });
});

describe("which release is newest", () => {
  it("orders by version, not by the date the assets were touched", () => {
    /* A re-upload to an old release moves its created_at to the top of the list.
     * Sorting by position would offer a DOWNGRADE, and the updater would then
     * bounce between two versions forever. */
    const list = [
      release({ tag: "v0.9.0", version: "0.9.0" }),
      release({ tag: "v0.17.0", version: "0.17.0" }),
      release({ tag: "v0.16.0", version: "0.16.0" }),
    ];
    expect(newestRelease(list)?.version).toBe("0.17.0");
  });

  it("compares numerically, so 0.9.0 does not beat 0.17.0", () => {
    const list = [release({ version: "0.9.0" }), release({ version: "0.17.0" })];
    expect(newestRelease(list)?.version).toBe("0.17.0");
  });

  it("never offers a draft", () => {
    const list = [
      release({ version: "0.99.0", draft: true }),
      release({ version: "0.17.0" }),
    ];
    expect(newestRelease(list)?.version).toBe("0.17.0");
  });

  it("DOES offer a pre-release, which is the only kind this project publishes", () => {
    expect(newestRelease([release({ prerelease: true })])?.version).toBe("0.17.0");
  });

  it("skips a tag it cannot parse rather than treating it as 0.0.0", () => {
    const list = [release({ tag: "nightly", version: "nightly" }), release({ version: "0.17.0" })];
    expect(newestRelease(list)?.version).toBe("0.17.0");
    expect(newestRelease([release({ tag: "nightly", version: "nightly" })])).toBeNull();
  });
});

describe("whether to offer anything at all", () => {
  it("offers a newer version", () => {
    expect(decideUpdate("0.16.0", [release()], WIN, "beta")?.version).toBe("0.17.0");
  });

  it("says nothing when this IS the newest", () => {
    expect(decideUpdate("0.17.0", [release()], WIN, "beta")).toBeNull();
  });

  it("says nothing when the player is somehow ahead", () => {
    /* A development build running against the released feed. Offering 0.17.0 to
     * an 0.18.0-dev machine would be a downgrade dressed as an update. */
    expect(decideUpdate("0.18.0", [release()], WIN, "beta")).toBeNull();
  });

  it("says nothing when the newest release has no archive for this machine", () => {
    /* Better no row than a row that leads to "there is no download for you". */
    const winOnly = release({ assets: [asset("Neo.Angband-0.17.0-win.zip")] });
    expect(decideUpdate("0.16.0", [winOnly], MAC_ARM, "beta")).toBeNull();
    expect(decideUpdate("0.16.0", [winOnly], WIN, "beta")).not.toBeNull();
  });

  it("carries the digest through, since the desktop side refuses to swap without one", () => {
    const got = decideUpdate("0.16.0", [release()], WIN, "beta");
    expect(got?.asset?.sha256).toBe("a".repeat(64));
  });
});

describe("channels", () => {
  const stable = release({ tag: "v1.0.0", version: "1.0.0", prerelease: false });
  const beta = release({ tag: "v1.1.0", version: "1.1.0", prerelease: true });
  const edge = release({
    tag: "v1.1.1-edge.4",
    version: "1.1.1-edge.4",
    prerelease: true,
    assets: [asset("Neo.Angband-1.1.1-edge.4-win.zip")],
  });
  const all = [stable, beta, edge];

  it("is inclusive downward: beta sees stable, early sees everything", () => {
    /* A player on beta must still be offered 1.0.0 when it ships. A channel that
     * hid its own stable releases would strand people on the last pre-release. */
    expect(releasesIn("stable", all).map((r) => r.version)).toEqual(["1.0.0"]);
    expect(releasesIn("beta", all).map((r) => r.version)).toEqual(["1.0.0", "1.1.0"]);
    expect(releasesIn("early", all).map((r) => r.version)).toEqual(["1.0.0", "1.1.0", "1.1.1-edge.4"]);
  });

  it("picks the newest within the channel, not the newest overall", () => {
    expect(decideUpdate("0.9.0", all, WIN, "stable")?.version).toBe("1.0.0");
    expect(decideUpdate("0.9.0", all, WIN, "beta")?.version).toBe("1.1.0");
    expect(decideUpdate("0.9.0", all, WIN, "early")?.version).toBe("1.1.1-edge.4");
  });

  it("orders edge builds by number, so edge.9 does not outrank edge.10", () => {
    /* The comparator bug this feature surfaced. Ten builds in a day is one
     * afternoon, and a string compare stops the updater dead at that point. */
    const nine = release({ tag: "v1.1.1-edge.9", version: "1.1.1-edge.9" });
    const ten = release({ tag: "v1.1.1-edge.10", version: "1.1.1-edge.10" });
    expect(decideUpdate("1.1.1-edge.9", [nine, ten], WIN, "early")?.version).toBe("1.1.1-edge.10");
  });

  it("offers a PATCH on beta, so the minor-bump rule is policy and not a workaround", () => {
    /*
     * docs/RELEASING.md asks for a MINOR whenever a tester should hear about the
     * change, and the reason has to stay a reason: a version number is the only
     * thing a tester can quote back. It is NOT that a patch cannot reach them.
     *
     * The channel filters on the pre-release FLAG, so `0.16.1` published with
     * --prerelease is offered to `0.16.0` exactly like `0.17.0` would be. If this
     * test ever fails, the rule has quietly become a mechanism and the paragraph
     * explaining it is wrong.
     */
    const patch = release({
      tag: "v0.16.1",
      version: "0.16.1",
      prerelease: true,
      assets: [asset("Neo.Angband-0.16.1-win.zip")],
    });
    expect(releasesIn("beta", [patch]).map((r) => r.version)).toEqual(["0.16.1"]);
    expect(decideUpdate("0.16.0", [patch], WIN, "beta")?.version).toBe("0.16.1");
    /* ...and from an edge build too, which is where a tester on `early` sits. */
    expect(decideUpdate("0.16.1-edge.7", [patch], WIN, "beta")?.version).toBe("0.16.1");
  });

  it("recognises an edge build by its version, not by a label somebody can edit", () => {
    expect(isEdgeRelease(edge)).toBe(true);
    expect(isEdgeRelease(beta)).toBe(false);
    expect(EDGE_MARKER).toBe("-edge.");
  });

  it("agrees with the log about which builds are not finished", () => {
    /*
     * Two functions, one fact. `defaultChannel` decides where a fresh install
     * looks for updates and `defaultLogLevel` decides how much that build says
     * about itself, and both are reading "is this a finished release" out of the
     * same version string. They are in different packages and neither imports
     * the other, so nothing but this test stops one being changed at 1.0.0 and
     * the other being noticed a release later.
     *
     * The relationship, stated so it can fail: a build logs quietly ONLY when a
     * fresh install of it would default to `stable` AND it is not a per-commit
     * build. An edge build off a 1.x line is the case that separates them.
     */
    for (const v of ["0.1.0", "0.16.0", "0.16.1-edge.2", "1.0.0", "1.0.1-edge.3", "2.3.4"]) {
      const finished = defaultChannel(v) === "stable" && !v.includes(EDGE_MARKER);
      expect(defaultLogLevel(v), v).toBe(finished ? "warn" : "info");
    }
  });

  it("starts a 0.x install on beta, because stable is empty until 1.0", () => {
    /* Every 0.x release is flagged pre-release, so defaulting to stable would
     * mean a fresh alpha never offers an update and never says why. */
    expect(defaultChannel("0.16.0")).toBe("beta");
    expect(defaultChannel("1.0.0")).toBe("stable");
    expect(defaultChannel("2.3.4")).toBe("stable");
  });

  it("lets someone leave early, even though that means going backwards", () => {
    /* The one case where a lower version is offered: an edge build cannot be
     * reached from stable or beta, so refusing would leave the channel the
     * player just picked reporting "nothing to install" forever. */
    const got = decideUpdate("1.1.1-edge.4", all, WIN, "beta");
    expect(got?.version).toBe("1.1.0");
    expect(got?.older).toBe(true);
  });

  it("still refuses a plain downgrade, which is the older and separate rule", () => {
    expect(decideUpdate("2.0.0", all, WIN, "beta")).toBeNull();
    /* ...and staying ON early does not go backwards either. */
    expect(decideUpdate("1.1.1-edge.9", all, WIN, "early")).toBeNull();
  });

  it("marks a genuine upgrade as not-older, since only that may shimmer", () => {
    expect(decideUpdate("0.9.0", all, WIN, "early")?.older).toBe(false);
  });

  it("remembers a choice and ignores a corrupted one", () => {
    const store = new Map<string, string>();
    const s = {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => void store.set(k, v),
    };
    writeChannel(s, "early");
    expect(readChannel(s, "0.16.0")).toBe("early");
    store.set(CHANNEL_KEY, "nightly");
    expect(readChannel(s, "0.16.0")).toBe("beta");
    expect(readChannel(null, "0.16.0")).toBe("beta");
  });

  it("survives storage that throws outright", () => {
    /* Safari with cookies blocked throws on access rather than returning null. */
    const hostile = {
      getItem: (): string => {
        throw new Error("denied");
      },
      setItem: (): void => {
        throw new Error("denied");
      },
    };
    expect(readChannel(hostile, "0.16.0")).toBe("beta");
    expect(() => {
      writeChannel(hostile, "early");
    }).not.toThrow();
  });
});

describe("reading GitHub's JSON", () => {
  it("strips the leading v and pulls the sha256 out of the digest field", () => {
    const parsed = parseReleases([
      {
        tag_name: "v0.17.0",
        draft: false,
        prerelease: true,
        html_url: "https://example.invalid/r",
        assets: [
          {
            name: "Neo.Angband-0.17.0-win.zip",
            browser_download_url: "https://example.invalid/z",
            size: 42,
            digest: `sha256:${"b".repeat(64)}`,
          },
        ],
      },
    ]);
    expect(parsed[0]?.version).toBe("0.17.0");
    expect(parsed[0]?.assets[0]?.sha256).toBe("b".repeat(64));
    expect(parsed[0]?.assets[0]?.size).toBe(42);
  });

  it("reports a missing or non-sha256 digest as null rather than inventing one", () => {
    const parsed = parseReleases([
      {
        tag_name: "v0.17.0",
        assets: [
          { name: "a.zip", browser_download_url: "u" },
          { name: "b.zip", browser_download_url: "u", digest: "md5:whatever" },
        ],
      },
    ]);
    expect(parsed[0]?.assets[0]?.sha256).toBeNull();
    expect(parsed[0]?.assets[1]?.sha256).toBeNull();
  });

  it("survives junk instead of throwing", () => {
    expect(parseReleases(null)).toEqual([]);
    expect(parseReleases({ nope: 1 })).toEqual([]);
    expect(parseReleases([null, 3, "x", {}])).toEqual([]);
    expect(parseReleases([{ tag_name: "v1.0.0", assets: "not an array" }])[0]?.assets).toEqual([]);
  });
});

describe("finding the updater on the window", () => {
  /*
   * THE DEFECT: the preload exposes TWO globals - `neoHostFs` (z-file.c) and
   * `neoDesktop` (the shell, which carries the updater) - and the first build of
   * this feature read the updater off `detectDesktopBridge()`, which returns
   * `neoHostFs`. Through an optional property, so it was `undefined` rather than
   * an error: the check returned null on every launch and the (U)pdate row could
   * never appear. Sixty unit tests, the typecheck and the build all passed. It
   * took launching the packaged app and looking at the screen.
   */
  it("reads the updater off neoDesktop", () => {
    const scope = { neoDesktop: { update: () => Promise.resolve(null) } };
    expect(updaterBridge(scope)).toBe(scope.neoDesktop);
  });

  it("does NOT accept the host filesystem bridge, which has no updater", () => {
    /* The exact shape the preload produces for the other global. */
    const scope = { neoHostFs: { call: () => undefined, argv: [], termCount: 1, signals: false } };
    expect(updaterBridge(scope)).toBeNull();
  });

  it("returns null in a browser tab, and for a shell too old to have one", () => {
    expect(updaterBridge({})).toBeNull();
    expect(updaterBridge({ neoDesktop: { isDesktop: true } })).toBeNull();
    expect(updaterBridge(null)).toBeNull();
  });
});

describe("the request itself", () => {
  const ok = (body: unknown): Response =>
    ({ ok: true, json: () => Promise.resolve(body) }) as unknown as Response;

  it("asks the LIST endpoint, because /releases/latest cannot see a pre-release", () => {
    const fetch = vi.fn().mockResolvedValue(ok([]));
    void checkForUpdate({ fetch: fetch as unknown as typeof globalThis.fetch, machine: WIN, current: "0.16.0", channel: "beta" });
    const url = String(fetch.mock.calls[0]?.[0]);
    expect(url).toContain(`/repos/${UPDATE_REPO}/releases`);
    expect(url).not.toContain("/releases/latest");
  });

  /*
   * THESE FOUR USED TO ASSERT THE BUG.
   *
   * Each of them said `.resolves.toBeNull()`, and so did the up-to-date case -
   * which is exactly what the update screen then read, printing "This is the
   * newest build on your channel" over a check that had timed out, been refused,
   * or never left the machine. The tests were not wrong about the code; they
   * pinned the collapse in place. What each one asserts now is that its own
   * failure is DISTINGUISHABLE from currency, which is the only property the
   * screen above it needs.
   */
  const failed = (r: Awaited<ReturnType<typeof checkForUpdate>>): string => {
    if (r.ok) throw new Error(`expected a failed check, got ${JSON.stringify(r)}`);
    return r.reason;
  };

  it("says GitHub REFUSED, and does not call that up to date", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const got = await checkForUpdate({ fetch: fetch as unknown as typeof globalThis.fetch, machine: WIN, current: "0.16.0", channel: "beta" });
    expect(failed(got)).toContain("500");
  });

  it("names the rate limit, because an hour's wait is not a permissions problem", async () => {
    /* The unauthenticated limit is sixty an hour per address, and this game
     * ships no credential on purpose - so a player with other GitHub traffic on
     * the same network hits it through no fault of their own. "403" alone reads
     * as "you are not allowed", which is the wrong thing to go and investigate. */
    for (const status of [403, 429]) {
      const fetch = vi.fn().mockResolvedValue({ ok: false, status } as Response);
      const got = await checkForUpdate({ fetch: fetch as unknown as typeof globalThis.fetch, machine: WIN, current: "0.16.0", channel: "beta" });
      expect(failed(got), `status=${String(status)}`).toMatch(/too many requests/iu);
    }
  });

  it("says it could not REACH GitHub when the network throws", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    const got = await checkForUpdate({ fetch: fetch as unknown as typeof globalThis.fetch, machine: WIN, current: "0.16.0", channel: "beta" });
    expect(failed(got)).toMatch(/could not be reached/iu);
  });

  it("aborts rather than hanging the title screen, and says the clock ran out", async () => {
    /*
     * The failure most easily mistaken for currency, and the one with a real
     * shipped cause: this request is issued while the page is still loading mods
     * and tile packs, and the abort timer runs on wall-clock time whether or not
     * the main thread was free to read a response GitHub already sent. A big
     * install can lose a check it won.
     */
    const fetch = vi.fn(
      (_u: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () => {
            rej(new Error("aborted"));
          });
        }),
    );
    const got = await checkForUpdate({
      fetch: fetch as unknown as typeof globalThis.fetch,
      machine: WIN,
      current: "0.16.0",
      channel: "beta",
      timeoutMs: 10,
    });
    expect(failed(got)).toMatch(/in time/iu);
  });

  it("tells a body it cannot parse apart from a network it cannot reach", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("not json")),
    } as unknown as Response);
    const got = await checkForUpdate({ fetch: fetch as unknown as typeof globalThis.fetch, machine: WIN, current: "0.16.0", channel: "beta" });
    expect(failed(got)).toMatch(/could not be read/iu);
  });

  it("answers ok with NO update when the feed is genuinely empty - the case the failures must not imitate", async () => {
    const fetch = vi.fn().mockResolvedValue(ok([]));
    const got = await checkForUpdate({ fetch: fetch as unknown as typeof globalThis.fetch, machine: WIN, current: "0.16.0", channel: "beta" });
    expect(got.ok).toBe(true);
    expect(got.ok && got.update).toBeNull();
  });

  it("end to end: a published 0.17.0 offers the win zip to a Windows machine", async () => {
    const fetch = vi.fn().mockResolvedValue(
      ok([
        { tag_name: "v0.17.0", draft: false, prerelease: true, html_url: "https://example.invalid/r",
          assets: [{ name: "Neo.Angband-0.17.0-win.zip", browser_download_url: "https://example.invalid/z", size: 9, digest: `sha256:${"c".repeat(64)}` }] },
        { tag_name: "v0.18.0", draft: true, prerelease: true, assets: [] },
      ]),
    );
    const got = await checkForUpdate({
      fetch: fetch as unknown as typeof globalThis.fetch,
      machine: WIN,
      current: "0.16.0",
      channel: "beta",
    });
    expect(got.ok).toBe(true);
    expect(got.ok && got.update?.version).toBe("0.17.0");
    expect(got.ok && got.update?.asset?.name).toBe("Neo.Angband-0.17.0-win.zip");
  });
});
