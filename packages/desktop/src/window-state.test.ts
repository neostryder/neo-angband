/**
 * sdlinit.txt's Fullscreen line, round-tripped and parsed as leniently as the C.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WINDOW_FILE, readWindowState, writeWindowState } from "./window-state";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "neo-window-"));
}

describe("window state (main-sdl.c sdlinit.txt)", () => {
  it("defaults to windowed when there is no file", () => {
    expect(readWindowState(path.join(tmp(), "user"))).toEqual({ fullscreen: false });
  });

  it("round-trips both states", () => {
    const dir = path.join(tmp(), "user");
    writeWindowState(dir, { fullscreen: true });
    expect(readWindowState(dir)).toEqual({ fullscreen: true });
    writeWindowState(dir, { fullscreen: false });
    expect(readWindowState(dir)).toEqual({ fullscreen: false });
  });

  it("reads upstream's own spacing and ignores comments", () => {
    const dir = tmp();
    fs.writeFileSync(
      path.join(dir, WINDOW_FILE),
      "# a comment\nResolution = 1200x800\nFullscreen = 1\nGraphics = 0\n",
    );
    expect(readWindowState(dir)).toEqual({ fullscreen: true });
  });

  it("treats an unparseable value as windowed rather than throwing", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, WINDOW_FILE), "Fullscreen = yes please\n");
    expect(readWindowState(dir)).toEqual({ fullscreen: false });
  });

  it("survives a file it cannot read", () => {
    /* A directory where the file should be: readFileSync throws EISDIR. */
    const dir = tmp();
    fs.mkdirSync(path.join(dir, WINDOW_FILE));
    expect(readWindowState(dir)).toEqual({ fullscreen: false });
  });
});
