/**
 * THE RATCHET on which user directory a dump lands in.
 *
 * The defect this file exists to stop: every screen that wrote a user file -
 * the character dump, the equipment dump, the screen dump, the spoilers, the
 * wizard level map - imported userdir.ts directly. userdir.ts is localStorage,
 * so under the desktop shell, where makeDesktopHost installs a RawFsHost over
 * real node:fs, all five wrote into localStorage anyway. The host seam existed,
 * was correct, was tested, and the screens went around it. Only prefs-ui.ts went
 * through it, which is why pref files were the one kind of user file that worked
 * on both platforms.
 *
 * That is "shipped is not reachable" from the other side: the reachable code was
 * the wrong copy. A test of userdir.ts cannot see it - userdir.ts was never
 * broken - and neither can a test of the host, so the check has to be about the
 * WIRING. Hence two kinds of assertion here:
 *
 *   1. behavioural: with a real-files host installed, a write lands in THAT host
 *      and localStorage stays empty;
 *   2. structural: no module outside the three that implement the directory may
 *      import the user-directory ACCESS functions from userdir.ts. That one also
 *      covers a file that does not exist yet, which is the only way to catch the
 *      next screen that needs a dump.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { HostDir, MemoryHost, NULL_HOST, setHost } from "@rpgm-tools/neo-angband-core";

import { BrowserHost } from "./host-browser";
import { setUserStorage } from "./userdir";
import type { UserStorage } from "./userdir";
import {
  FileType,
  exportUserFile,
  userExists,
  userPath,
  userRead,
  userTextLinesToFile,
  userWrite,
  userWriteChecked,
} from "./user-io";

const SRC = path.dirname(fileURLToPath(import.meta.url));

/** localStorage, as a Map, so a stray write into it is visible. */
function fakeStorage(): UserStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

let store: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  store = fakeStorage();
  setUserStorage(store);
});

afterEach(() => {
  setUserStorage(null);
  setHost(NULL_HOST);
});

describe("the user directory a dump lands in is the HOST's", () => {
  it("writes into a real-files host, and NOT into localStorage", () => {
    /* The regression, stated as directly as it can be. A MemoryHost reports
     * realFiles: true, exactly as RawFsHost does under the desktop shell; if any
     * of these calls reached userdir.ts, the file would appear in `store` and be
     * absent from the host - which is what the desktop build did. */
    const mem = new MemoryHost();
    setHost(mem);

    expect(userWrite("dump.txt", "body")).toBe(true);
    expect(userTextLinesToFile("staged.txt", "lines")).toBe(0);

    expect(mem.read(HostDir.USER, "dump.txt")).toBe("body");
    expect(mem.read(HostDir.USER, "staged.txt")).toBe("lines");
    expect(store.map.size).toBe(0);
  });

  it("writes into localStorage when the host is the browser's", () => {
    /* The other half: the web build must be UNCHANGED by the rerouting, which is
     * true by construction because BrowserHost delegates HostDir.USER to
     * userdir.ts - and this is the test that says so. */
    setHost(new BrowserHost(store));
    expect(userWrite("dump.txt", "body")).toBe(true);
    expect(store.map.get("neo-angband-user:dump.txt")).toBe("body");
    expect(userRead("dump.txt")).toBe("body");
    expect(userExists("dump.txt")).toBe(true);
  });

  it("reports the host's own path in prompts and messages", () => {
    /* get_file prints "Saving as %s." and html_screenshot embeds the path in the
     * page it writes. On a real filesystem that is a path the player can open,
     * so it has to come from the host rather than being hardcoded "user/x". */
    setHost({
      ...NULL_HOST,
      displayPath: (dir, name) => `C:\\Games\\Neo Angband\\${dir}\\${name}`,
    });
    expect(userPath("dump.txt")).toBe("C:\\Games\\Neo Angband\\user\\dump.txt");
  });

  it("keeps file_open's two failure modes apart", () => {
    /* wiz-spoil.c prints "Cannot create spoiler file." for one and "Cannot close
     * spoiler file." for the other at the same call site, so collapsing them to a
     * boolean here would delete one of upstream's messages. */
    setHost(new MemoryHost({ failWrites: ["a.txt"], truncateWrites: ["b.txt"] }));
    expect(userWriteChecked("a.txt", "x")).toBe("create-failed");
    expect(userWriteChecked("b.txt", "x")).toBe("close-failed");
    expect(userWriteChecked("c.txt", "x")).toBe("ok");
  });

  it("passes FTYPE_HTML through to the host", () => {
    /* Upstream tags the screen dump and the level map FTYPE_HTML at file_open.
     * The port used to drop it, because writeUserFile had nowhere to put it. */
    const seen: FileType[] = [];
    setHost({ ...NULL_HOST, write: (_d, _n, _t, _m, ftype) => (seen.push(ftype ?? FileType.TEXT), "ok") });
    userWrite("dump.html", "<html>", FileType.HTML);
    userWrite("dump.txt", "text");
    expect(seen).toEqual([FileType.HTML, FileType.TEXT]);
  });

  it("offers a download only where the file cannot otherwise be reached", () => {
    /* Upstream has no download at all: it writes into a directory the player
     * already has open. A second copy in Downloads on a platform that has the
     * real file is an invented stand-in, and an invented stand-in FILLS the slot
     * so neither census can see the divergence. */
    setHost(new MemoryHost());
    expect(exportUserFile("dump.txt", "body")).toBe(false);

    /* On the browser it is the only way out, so it is attempted. No DOM here, so
     * downloadUserFile's own catch reports the failure rather than throwing -
     * what is asserted is that the attempt was MADE, not that a tab downloaded. */
    setHost(new BrowserHost(store));
    expect(() => exportUserFile("dump.txt", "body")).not.toThrow();
  });
});

describe("no screen may go around the host seam", () => {
  /**
   * The user-directory accessors. These are the localStorage IMPLEMENTATION of
   * HostDir.USER; importing one outside the three modules that implement the
   * directory pins that screen to localStorage on every platform.
   *
   * downloadUserFile, pickTextFile, setUserStorage, UserStorage and USER_DIR are
   * deliberately absent: those are browser affordances with no host equivalent,
   * and user-io.ts's exportUserFile is a thin gate over the first.
   */
  const FORBIDDEN = [
    "userPath",
    "userFileExists",
    "readUserFile",
    "writeUserFile",
    "writeUserFileChecked",
    "deleteUserFile",
    "listUserFiles",
    "textLinesToFile",
  ];

  /** The three modules that ARE the directory, plus the tests that drive them. */
  const ALLOWED = new Set(["userdir.ts", "host-browser.ts", "user-io.ts"]);

  it("imports no user-directory accessor from userdir.ts", () => {
    const offenders: string[] = [];
    for (const name of fs.readdirSync(SRC)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts") || ALLOWED.has(name)) continue;
      const body = fs.readFileSync(path.join(SRC, name), "utf8");
      /* Every `import ... from "./userdir"`, braces and newlines included. */
      for (const m of body.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"\.\/userdir"/gu)) {
        for (const raw of (m[1] ?? "").split(",")) {
          const sym = raw.trim().split(/\s+as\s+/u)[0]?.trim();
          if (sym && FORBIDDEN.includes(sym)) offenders.push(`${name}: ${sym}`);
        }
      }
    }
    expect(
      offenders,
      `these bypass the host seam and write to localStorage on every platform; import from ./user-io instead:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("has a forbidden list that userdir.ts still exports", () => {
    /* Otherwise a rename silently empties the check above - a guard that cannot
     * fire, satisfied by the symbol it names no longer existing. */
    const body = fs.readFileSync(path.join(SRC, "userdir.ts"), "utf8");
    for (const sym of FORBIDDEN) {
      expect(body, sym).toMatch(new RegExp(`export function ${sym}\\b`, "u"));
    }
  });
});
