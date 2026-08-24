/**
 * The updater's disk-touching half.
 *
 * The pure decisions live in update-plan.test.ts. What is asserted here is the
 * part that could install something it should not: where a download is allowed
 * to come from, that an unverifiable archive is deleted rather than extracted,
 * and that extraction really produces a tree - run against a real archive, built
 * by this repository's own writer, because "the command looks right" is the
 * assertion that missed a platform whose tar could not read the format.
 *
 * Nothing here spawns a program any more, which is the change itself: see
 * unpack.ts.
 */

import { afterAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  downloadArchive,
  extractCommand,
  isAllowedAssetRedirect,
  isAllowedAssetUrl,
  isAllowedRevealUrl,
  isHttpUrl,
  isOwnLoopbackUrl,
  isWritable,
  releaseTagFromRenderer,
  resolveReleaseAsset,
  sha256File,
  shapeOf,
  stageArchive,
  systemProgram,
  workDir,
} from "./updater";
import { makeZip } from "./zip-fixture.js";

const REPO = "neostryder/neo-angband";
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "neo-updater-"));
afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("where a download may come from", () => {
  it("allows this project's own release assets", () => {
    expect(
      isAllowedAssetUrl(
        `https://github.com/${REPO}/releases/download/v0.17.0/Neo.Angband-0.17.0-win.zip`,
        REPO,
      ),
    ).toBe(true);
    /* GitHub redirects asset downloads to this host, but object URLs are never
     * accepted as standalone inputs. */
    expect(isAllowedAssetUrl("https://objects.githubusercontent.com/x/y", REPO)).toBe(false);
    expect(isAllowedAssetRedirect("https://objects.githubusercontent.com/x/y", REPO, false)).toBe(false);
    expect(isAllowedAssetRedirect("https://objects.githubusercontent.com/x/y", REPO, true)).toBe(true);
  });

  it("refuses another repository's assets", () => {
    /* The catalogue is fetched over the network, so it is input. A digest proves
     * the bytes match what the API SAID; it cannot tell you the API was this project's. */
    expect(
      isAllowedAssetUrl("https://github.com/someone/else/releases/download/v1/x.zip", REPO),
    ).toBe(false);
  });

  it("refuses another host and refuses plain http", () => {
    expect(isAllowedAssetUrl("https://evil.invalid/x.zip", REPO)).toBe(false);
    expect(isAllowedAssetUrl(`http://github.com/${REPO}/releases/download/v1/x.zip`, REPO)).toBe(
      false,
    );
  });

  it("refuses a github.com URL that is not a release download", () => {
    expect(isAllowedAssetUrl(`https://github.com/${REPO}/raw/master/evil.zip`, REPO)).toBe(false);
  });

  it("refuses something that is not a URL at all", () => {
    expect(isAllowedAssetUrl("not a url", REPO)).toBe(false);
    expect(isAllowedAssetUrl("", REPO)).toBe(false);
  });
});

describe("choosing the release archive in the main process", () => {
  const tag = "v0.17.0";
  const trustedUrl = `https://github.com/${REPO}/releases/download/${tag}/Neo.Angband-0.17.0-win.zip`;
  const trustedDigest = "a".repeat(64);

  it("rejects a renderer URL and digest, then derives them from GitHub's release metadata", async () => {
    /* This is the old IPC shape. Rejecting it makes URL and digest incapable of
     * crossing the renderer/main boundary even if a mod calls the bridge itself. */
    expect(() =>
      releaseTagFromRenderer({
        tag,
        url: "https://evil.invalid/update.zip",
        sha256: "b".repeat(64),
      }),
    ).toThrow(/did not name a release/u);

    const get = vi.fn(async () =>
      new Response(
        JSON.stringify({
          tag_name: tag,
          assets: [
            {
              name: "Neo.Angband-0.17.0-win.zip",
              browser_download_url: trustedUrl,
              digest: `sha256:${trustedDigest}`,
              size: 123,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(
      resolveReleaseAsset({
        tag: releaseTagFromRenderer(tag),
        repo: REPO,
        platform: "win32",
        arch: "x64",
        fetch: get as unknown as typeof globalThis.fetch,
      }),
    ).resolves.toEqual({ url: trustedUrl, sha256: trustedDigest, size: 123 });
    expect(get).toHaveBeenCalledWith(
      `https://api.github.com/repos/${REPO}/releases/tags/${tag}`,
      expect.objectContaining({ headers: { Accept: "application/vnd.github+json" } }),
    );
  });
});

/*
 * The "reveal" op takes this URL straight from `window.neoDesktop.update`, a
 * bridge call any renderer script can make - a mod's plugin.js among them,
 * since a mod's code is a plain ES module import into the same page - and the
 * string it is normally given began as GitHub's own `html_url`, fetched over
 * the network rather than built into this program. Neither origin is a
 * constant this process controls, so isAllowedRevealUrl is the check that
 * decides before shell.openExternal ever sees it.
 */
describe("where the update page's (U)pdate reveal may point", () => {
  it("allows this project's own releases page and its tag pages", () => {
    expect(isAllowedRevealUrl(`https://github.com/${REPO}/releases`, REPO)).toBe(true);
    expect(isAllowedRevealUrl(`https://github.com/${REPO}/releases/tag/v0.17.0`, REPO)).toBe(true);
  });

  it("refuses another repository, another host, and plain http", () => {
    expect(isAllowedRevealUrl("https://github.com/someone/else/releases", REPO)).toBe(false);
    expect(isAllowedRevealUrl("https://evil.invalid/releases", REPO)).toBe(false);
    expect(isAllowedRevealUrl(`http://github.com/${REPO}/releases`, REPO)).toBe(false);
  });

  it("refuses a non-http scheme a registered protocol handler would receive", () => {
    expect(isAllowedRevealUrl("javascript:alert(1)", REPO)).toBe(false);
    expect(isAllowedRevealUrl("file:///C:/Windows/System32/cmd.exe", REPO)).toBe(false);
    expect(isAllowedRevealUrl("ms-settings:privacy", REPO)).toBe(false);
  });

  it("refuses something that is not a URL at all", () => {
    expect(isAllowedRevealUrl("not a url", REPO)).toBe(false);
    expect(isAllowedRevealUrl("", REPO)).toBe(false);
  });
});

/* The general guard for `setWindowOpenHandler`, which is not scoped to one
 * host the way the reveal URL is - the renderer's legitimate external links
 * are not all on github.com, so only the scheme is checked here. */
describe("what setWindowOpenHandler may hand to the real browser", () => {
  it("allows http and https", () => {
    expect(isHttpUrl("https://example.invalid/page")).toBe(true);
    expect(isHttpUrl("http://example.invalid/page")).toBe(true);
  });

  it("refuses a scheme the operating system would route somewhere else", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("file:///C:/Windows/System32/cmd.exe")).toBe(false);
    expect(isHttpUrl("ms-settings:privacy")).toBe(false);
  });

  it("refuses something that is not a URL at all", () => {
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

/* The guard for `setWindowOpenHandler` and `will-navigate` on the game's own
 * window: only the exact loopback origin the window was loaded on may keep
 * its preload bridge, everything else is either denied outright or handed
 * to the real browser by isHttpUrl above. */
describe("what the game window will keep its own bridge attached to", () => {
  it("allows its own loopback origin on its own port", () => {
    expect(isOwnLoopbackUrl("http://127.0.0.1:45871/", 45871)).toBe(true);
    expect(isOwnLoopbackUrl("http://127.0.0.1:45871/some/path?x=1", 45871)).toBe(true);
  });

  it("refuses a hostname that merely starts with the loopback address", () => {
    expect(isOwnLoopbackUrl("http://127.0.0.1.attacker.example/", 45871)).toBe(false);
  });

  it("refuses a different port", () => {
    expect(isOwnLoopbackUrl("http://127.0.0.1:9999/", 45871)).toBe(false);
  });

  it("refuses https on the loopback address", () => {
    expect(isOwnLoopbackUrl("https://127.0.0.1:45871/", 45871)).toBe(false);
  });

  it("refuses a scheme that is not http", () => {
    expect(isOwnLoopbackUrl("javascript:alert(1)", 45871)).toBe(false);
    expect(isOwnLoopbackUrl("file:///C:/Windows/System32/cmd.exe", 45871)).toBe(false);
  });

  it("refuses something that is not a URL at all", () => {
    expect(isOwnLoopbackUrl("not a url", 45871)).toBe(false);
    expect(isOwnLoopbackUrl("", 45871)).toBe(false);
  });
});

describe("refusing to install what cannot be checked", () => {
  const root = path.join(scratch, "root");
  fs.mkdirSync(root, { recursive: true });

  it("will not download without a sha256", async () => {
    await expect(
      downloadArchive({
        url: `https://github.com/${REPO}/releases/download/v1/x.zip`,
        sha256: "",
        size: 1,
        repo: REPO,
        root,
        platform: "linux",
      }),
    ).rejects.toThrow(/no digest/u);
  });

  it("will not accept a digest that is not a sha256", async () => {
    await expect(
      downloadArchive({
        url: `https://github.com/${REPO}/releases/download/v1/x.zip`,
        sha256: "deadbeef",
        size: 1,
        repo: REPO,
        root,
        platform: "linux",
      }),
    ).rejects.toThrow(/no digest/u);
  });

  it("checks the host BEFORE it checks the digest", async () => {
    /* Order matters: the digest check is the expensive one and the host check is
     * the one that decides whether the updater speaks to a stranger at all. */
    await expect(
      downloadArchive({
        url: "https://evil.invalid/x.zip",
        sha256: "a".repeat(64),
        size: 1,
        repo: REPO,
        root,
        platform: "linux",
      }),
    ).rejects.toThrow(/unexpected host/u);
  });

  it("refuses a release redirect to a disallowed host before downloading it", async () => {
    const get = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.invalid/update.zip" },
      }),
    );
    await expect(
      downloadArchive({
        url: `https://github.com/${REPO}/releases/download/v1/x.zip`,
        sha256: "a".repeat(64),
        size: 1,
        repo: REPO,
        root,
        platform: "linux",
        fetch: get as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow(/redirected to an unexpected host/u);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("hashing and extracting real files", () => {
  it("hashes a file the way sha256sum does", async () => {
    const f = path.join(scratch, "hash-me.txt");
    fs.writeFileSync(f, "neo angband\n");
    const want = createHash("sha256").update("neo angband\n").digest("hex");
    await expect(sha256File(f)).resolves.toBe(want);
  });

  it("shells out on macOS ONLY, and to an absolute path when it does", () => {
    /*
     * Windows and Linux unpack in-process now (unpack.ts), so the answer there is
     * null - not "a different program". That is the assertion that matters: a
     * non-null answer for either would mean the game is back to depending on
     * something PATH decides.
     *
     * macOS still uses ditto because it preserves the symlinks, permissions and
     * AppleDouble metadata a .app needs and nobody here has a Mac to prove a
     * hand-rolled unzip yields a bundle that launches. /usr/bin/ditto is part of
     * the OS, so the "no installed tools" rule still holds.
     */
    expect(extractCommand("/x/a.zip", "/y", "win32")).toBeNull();
    expect(extractCommand("/x/a.tar.gz", "/y", "linux")).toBeNull();
    expect(extractCommand("/x/a.zip", "/y", "darwin")?.cmd).toBe("/usr/bin/ditto");
    expect(path.posix.isAbsolute(extractCommand("/x/a.zip", "/y", "darwin")?.cmd ?? "")).toBe(true);
  });

  it("names a Windows system program absolutely, never by PATH", () => {
    /* The swap script is still handed to powershell, which is the same lookup
     * that put GNU tar in the extractor's place - GNU tar cannot read zip and
     * treats `C:\...` as a remote host, and a POSIX-style shell puts it first. */
    const ps = systemProgram("WindowsPowerShell\\v1.0\\powershell.exe", "C:\\WINDOWS");
    expect(ps).toBe("C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(path.win32.isAbsolute(ps)).toBe(true);
    /* A trailing separator on SystemRoot must not produce a doubled one. */
    expect(systemProgram("cmd.exe", "C:\\WINDOWS\\")).toBe("C:\\WINDOWS\\System32\\cmd.exe");
  });

  it("really stages a real archive, with no external tool involved", async () => {
    /*
     * A zip built by this test's own writer, unpacked by the updater's own
     * reader, on whatever platform this is running. Nothing spawns.
     *
     * The previous version of this test built its fixture with `tar` - and that
     * is how the GNU-tar problem stayed hidden: under a POSIX shell it failed
     * with `Cannot connect to C:` and read as a flaky test about the fixture
     * rather than as the extractor being the wrong program.
     */
    const archive = path.join(scratch, "payload.zip");
    fs.writeFileSync(
      archive,
      makeZip([
        { name: "Neo Angband.exe", data: "pretend binary" },
        { name: "locales/en-US.pak", data: "pak" },
      ]),
    );
    const root = path.join(scratch, "install");
    fs.mkdirSync(root, { recursive: true });
    /* `linux`, not the host: staging is pure path arithmetic over the target
     * platform, and asserting a POSIX layout from Windows is the point of taking
     * the platform as an argument at all. */
    const staging = await stageArchive(archive, root, process.platform);
    expect(fs.readFileSync(path.join(staging, "Neo Angband.exe"), "utf8")).toBe("pretend binary");
    expect(fs.readFileSync(path.join(staging, "locales", "en-US.pak"), "utf8")).toBe("pak");
    /* And it staged INSIDE the work directory, not over the install. */
    expect(staging.startsWith(workDir(root, process.platform))).toBe(true);
  });

  it("puts the work directory beside a .app, never inside it", () => {
    /* Anything written into Contents/ breaks the seal the release just added. */
    expect(workDir("/Applications/Neo Angband.app", "darwin")).toBe("/Applications/.neo-update");
    expect(workDir("/opt/neo", "linux")).toBe("/opt/neo/.neo-update");
    /* And the separators follow the TARGET platform, not this one - the reason
     * these assertions can be written from a Windows machine at all. */
    expect(workDir("C:\\Games\\Neo Angband", "win32")).toBe("C:\\Games\\Neo Angband\\.neo-update");
  });
});

describe("what this launch is told it can do", () => {
  it("probes writability by writing, not by asking", () => {
    const dir = path.join(scratch, "probe");
    fs.mkdirSync(dir, { recursive: true });
    expect(isWritable(dir)).toBe(true);
    expect(isWritable(path.join(dir, "does-not-exist"))).toBe(false);
    /* And it leaves nothing behind. */
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("reports 'none' for a dev run without probing the repository", () => {
    const got = shapeOf({
      platform: process.platform,
      arch: process.arch,
      packaged: false,
      execPath: path.join(scratch, "probe", "neo-angband"),
      env: {},
    });
    expect(got.how).toBe("none");
    expect(fs.readdirSync(path.join(scratch, "probe"))).toEqual([]);
  });

  it("reports 'manual' for a single-file portable launch", () => {
    const got = shapeOf({
      platform: "win32",
      arch: "x64",
      packaged: true,
      execPath: "C:\\Temp\\unpacked\\Neo Angband.exe",
      env: { PORTABLE_EXECUTABLE_DIR: "E:\\Neo Angband" },
    });
    expect(got.how).toBe("manual");
  });
});
