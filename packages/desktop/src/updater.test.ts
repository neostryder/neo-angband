/**
 * The updater's disk-touching half.
 *
 * The pure decisions live in update-plan.test.ts. What is asserted here is the
 * part that could install something it should not: where a download is allowed
 * to come from, that an unverifiable archive is deleted rather than extracted,
 * and that extraction really produces a tree - run against a real archive and a
 * real `tar`, because "the command looks right" is the assertion that misses a
 * platform whose tar cannot read the format.
 */

import { afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  downloadArchive,
  extractCommand,
  isAllowedAssetUrl,
  isWritable,
  sha256File,
  shapeOf,
  stageArchive,
  workDir,
} from "./updater";

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
    /* GitHub redirects asset downloads to this host. */
    expect(isAllowedAssetUrl("https://objects.githubusercontent.com/x/y", REPO)).toBe(true);
  });

  it("refuses another repository's assets", () => {
    /* The catalogue is fetched over the network, so it is input. A digest proves
     * the bytes match what the API SAID; it cannot tell you the API was ours. */
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
     * the one that decides whether we speak to a stranger at all. */
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
});

describe("hashing and extracting real files", () => {
  it("hashes a file the way sha256sum does", async () => {
    const f = path.join(scratch, "hash-me.txt");
    fs.writeFileSync(f, "neo angband\n");
    const want = createHash("sha256").update("neo angband\n").digest("hex");
    await expect(sha256File(f)).resolves.toBe(want);
  });

  it("uses ditto on macOS, because a zip library breaks a signed bundle", () => {
    /* ditto is the only one of these that preserves the extended attributes and
     * symlinks a .app needs; a naively unzipped bundle looks right and will not
     * launch. */
    expect(extractCommand("/x/a.zip", "/y", "darwin").cmd).toBe("ditto");
    expect(extractCommand("/x/a.zip", "/y", "win32").cmd).toBe("tar");
    expect(extractCommand("/x/a.tar.gz", "/y", "linux").args).toContain("-xzf");
  });

  it("really extracts a real archive into a staging tree", async () => {
    /* tar.gz on every platform: GNU tar cannot read zip, so asserting the zip
     * path here would pass on Windows and fail in CI for a reason that has
     * nothing to do with this code. Windows takes the zip branch in production
     * and bsdtar handles it. */
    const src = path.join(scratch, "src");
    fs.mkdirSync(path.join(src, "locales"), { recursive: true });
    fs.writeFileSync(path.join(src, "Neo Angband.exe"), "pretend binary");
    fs.writeFileSync(path.join(src, "locales", "en-US.pak"), "pak");
    const archive = path.join(scratch, "payload.tar.gz");
    const { spawnSync } = await import("node:child_process");
    const tar = spawnSync("tar", ["-czf", archive, "-C", src, "."], { stdio: "ignore" });
    expect(tar.status, "tar is required for this test").toBe(0);

    const root = path.join(scratch, "install");
    fs.mkdirSync(root, { recursive: true });
    const staging = await stageArchive(archive, root, "linux");
    expect(fs.existsSync(path.join(staging, "Neo Angband.exe"))).toBe(true);
    expect(fs.existsSync(path.join(staging, "locales", "en-US.pak"))).toBe(true);
    /* And it staged INSIDE the work directory, not over the install. */
    expect(staging.startsWith(workDir(root, "linux"))).toBe(true);
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
