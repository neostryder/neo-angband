#!/usr/bin/env node
/**
 * Play the built game, in the real shell, and fail if it does not work.
 *
 * WHY THIS EXISTS. On 2026-08-06, `0b2c72530` gave core the known-state twin and
 * `char-sheet.ts` began reading `state.actor.knownCombat` and `state.runeEnv`.
 * The birth screens preview a character sheet before a game exists, so
 * `previewState()` hand-builds a partial GameState and casts it with
 * `as unknown as GameState`. It supplied neither field. The cast silenced the
 * compiler, so choosing (N)ew game threw "Cannot read properties of undefined"
 * and stopped at the crash reporter - **for five days on the early channel, past
 * a green suite and green CI**.
 *
 * It survived because every one of the 46 birth tests omits `opts.deps`, and
 * `buildPreview` returns before constructing the state when deps are absent. The
 * one path that builds a GameState was never executed by anything. A unit suite
 * cannot see that: it is green precisely because it does not go there.
 *
 * So this is the check that only running the game can make. It boots the desktop
 * shell over the Chrome DevTools Protocol, plays through the paths a player takes
 * in their first minute - title, birth, the character sheet, town, a staircase,
 * the dungeon, the item menus - and fails on any uncaught exception or
 * error-level log.
 *
 * THE ASSERTION THAT MATTERS IS NOT "NO EXCEPTIONS". A game that renders a title
 * screen and then ignores every keystroke throws nothing at all, and a smoke test
 * that only watches for errors would call that a pass - which would be worse than
 * no test, because it would be a green light over a dead game. So this also
 * requires the screen to CHANGE at each step, by hashing the framebuffer: if a
 * keypress does not alter a single pixel, the input path is broken and this
 * fails, loudly, saying which step stopped moving.
 *
 * It drives the PRODUCTION bundle deliberately. The dev bundle exposes
 * `window.__neo` with a readable glyph grid, which would make every assertion
 * here easier and would test a bundle no player ever runs. Vite strips that hook
 * from the shipped artifact, so this reads pixels instead.
 *
 * Usage:
 *   node tools/play-smoke.mjs [--keep] [--shots <dir>] [--port <n>]
 *
 * Requires `pnpm --dir packages/web bundle` and the desktop build to have run,
 * and a display - on a Linux runner, `xvfb-run -a node tools/play-smoke.mjs`.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT = Number(opt("--port", "9334"));
const SHOTS = opt("--shots", path.join(repoRoot, "smoke-shots"));
/* Its own profile, never the developer's: this launches with a real user-data
 * directory and a character gets created. Pointing that at a normal install
 * would put a throwaway smoke character beside somebody's real ones. */
const PROFILE = path.join(tmpdir(), `neo-smoke-profile-${process.pid}`);

mkdirSync(SHOTS, { recursive: true });

/** Everything the page said or threw, in arrival order. */
const consoleLines = [];
const exceptions = [];

/* ------------------------------------------------------------------ CDP ---- */

async function findPage(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page" && /127\.0\.0\.1/u.test(t.url ?? ""));
      if (page?.webSocketDebuggerUrl) return page;
      last = `targets: ${targets.map((t) => `${t.type}:${t.url}`).join(", ") || "none"}`;
    } catch (err) {
      last = String(err?.message ?? err);
    }
    await sleep(500);
  }
  throw new Error(`no game window on :${PORT} after ${timeoutMs}ms (${last})`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => this.#onMessage(JSON.parse(ev.data)));
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("devtools socket failed")), {
        once: true,
      });
    });
    const cdp = new Cdp(ws);
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Page.enable");
    return cdp;
  }

  #onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      consoleLines.push({
        level: msg.params.type,
        text: (msg.params.args ?? [])
          .map((a) => a.value ?? a.description ?? a.unserializableValue ?? "")
          .join(" "),
      });
    } else if (msg.method === "Log.entryAdded") {
      consoleLines.push({ level: msg.params.entry.level, text: msg.params.entry.text });
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      exceptions.push(d.exception?.description ?? d.text ?? JSON.stringify(d).slice(0, 400));
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 30_000);
    });
  }

  async press(key, settleMs) {
    const spec = keySpec(key);
    await this.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...spec });
    if (spec.text) await this.send("Input.dispatchKeyEvent", { type: "char", ...spec });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...spec });
    await sleep(settleMs);
  }

  /** The window's pixels, as {png, hash, blank}. */
  async frame() {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    const png = Buffer.from(data, "base64");
    return {
      png,
      hash: createHash("sha256").update(png).digest("hex").slice(0, 16),
      bytes: png.length,
    };
  }
}

/** CDP key parameters for a key name or one printable character. */
function keySpec(key) {
  const named = {
    Enter: { windowsVirtualKeyCode: 13, key: "Enter", code: "Enter", text: "\r" },
    Escape: { windowsVirtualKeyCode: 27, key: "Escape", code: "Escape" },
    ArrowUp: { windowsVirtualKeyCode: 38, key: "ArrowUp", code: "ArrowUp" },
    ArrowDown: { windowsVirtualKeyCode: 40, key: "ArrowDown", code: "ArrowDown" },
    ArrowLeft: { windowsVirtualKeyCode: 37, key: "ArrowLeft", code: "ArrowLeft" },
    ArrowRight: { windowsVirtualKeyCode: 39, key: "ArrowRight", code: "ArrowRight" },
  };
  if (named[key]) return named[key];
  if (key.length !== 1) throw new Error(`unknown key: ${key}`);
  const upper = key.toUpperCase();
  return {
    windowsVirtualKeyCode: upper.charCodeAt(0),
    key,
    code: /[a-zA-Z]/u.test(key) ? `Key${upper}` : /[0-9]/u.test(key) ? `Digit${key}` : "",
    text: key,
  };
}

/* ---------------------------------------------------------------- script ---- */

/**
 * A player's first minute. `mustChange` is the whole point: a step that leaves
 * the framebuffer identical means the keystroke did nothing, and a game that
 * ignores input must not pass a test called "play".
 *
 * The two `Escape` steps are the exceptions - closing a menu can land back on a
 * screen that looks like the one before it opened, so they are not required to
 * differ from their own predecessor.
 */
const SCRIPT = [
  { key: "n", label: "new-game", settle: 2500, mustChange: true },
  { key: "@", label: "random-character", settle: 2500, mustChange: true },
  { key: "Enter", label: "accept-character", settle: 3000, mustChange: true },
  { key: ">", label: "descend", settle: 2500, mustChange: true },
  { key: "Enter", label: "dismiss-more", settle: 3000, mustChange: true },
  { key: "ArrowRight", label: "walk", settle: 1200, mustChange: false },
  { key: "i", label: "inventory", settle: 1500, mustChange: true },
  { key: "Escape", label: "close-inventory", settle: 1200, mustChange: false },
  { key: "C", label: "character-sheet", settle: 1800, mustChange: true },
  { key: "Escape", label: "close-sheet", settle: 1200, mustChange: false },
];

function fail(message) {
  console.error(`\nplay-smoke FAILED: ${message}`);
  dumpDiagnostics();
  process.exitCode = 1;
}

function dumpDiagnostics() {
  if (exceptions.length) {
    console.error(`\n--- ${exceptions.length} uncaught exception(s) ---`);
    for (const e of exceptions) console.error(e);
  }
  const errors = consoleLines.filter(isErrorLine);
  if (errors.length) {
    console.error(`\n--- ${errors.length} error-level log line(s) ---`);
    for (const e of errors) console.error(`[${e.level}] ${e.text}`);
  }
  console.error(`\n--- last 30 console lines ---`);
  for (const c of consoleLines.slice(-30)) console.error(`[${c.level}] ${c.text}`);
  console.error(`\nScreenshots: ${SHOTS}`);
}

/**
 * Electron's own security warnings are `error`-level and are about the dev
 * launch, not the game; they are the only thing filtered, by exact subject, so
 * that a real error can never hide behind a loose pattern.
 */
function isErrorLine(line) {
  if (line.level !== "error" && line.level !== "severe") return false;
  return !/Electron Security Warning/u.test(line.text);
}

/* ------------------------------------------------------------------ main ---- */

/* The `electron` package exports the path to its binary when it is required
 * from Node rather than from inside Electron. Resolved from the desktop
 * package, because this is a pnpm workspace: electron is that package's
 * dependency and there is no hoisted copy at the repo root. Guessing
 * `node_modules/.bin/electron` finds nothing here, which is how the first
 * version of this file failed. */
const desktopDir = path.join(repoRoot, "packages", "desktop");
const requireFromDesktop = createRequire(path.join(desktopDir, "package.json"));
const electronBin = requireFromDesktop("electron");

/* No `shell: true`. The arguments carry a filesystem path that can contain
 * spaces, and a shell would re-split it - as well as being a needless
 * concatenation of unescaped arguments. */
const electronArgs = [".", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`];
/* Chromium's setuid sandbox is unavailable on most CI images, where the window
 * would otherwise fail to open at all. Opt-in rather than automatic: a developer
 * running this on their own machine should keep the sandbox. */
if (flag("--no-sandbox")) electronArgs.push("--no-sandbox");

const child = spawn(electronBin, electronArgs, {
  cwd: desktopDir,
  stdio: ["ignore", "pipe", "pipe"],
});
let shellOutput = "";
child.stdout.on("data", (d) => (shellOutput += d));
child.stderr.on("data", (d) => (shellOutput += d));
child.on("exit", (code) => {
  if (code !== 0 && code !== null) {
    console.error(`the game shell exited with ${code}\n${shellOutput.slice(-4000)}`);
  }
});

let cdp;
try {
  const page = await findPage();
  console.log(`attached to ${page.url}`);
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);

  /* Let the title screen settle before the first frame, so the baseline is the
   * finished title and not a half-painted one - which would make step 1 "change"
   * for the wrong reason. */
  await sleep(3000);

  let prev = await cdp.frame();
  writeFileSync(path.join(SHOTS, "00-title.png"), prev.png);
  console.log(`00-title            ${prev.hash}  ${prev.bytes} bytes`);

  /* A window that is painting nothing produces a tiny, uniform PNG. This is a
   * crude floor and it is here because the alternative - trusting that a
   * screenshot means a rendered game - is how a blank window passes a smoke
   * test. */
  if (prev.bytes < 2000) {
    fail(`the title screen encodes to ${prev.bytes} bytes; the window is probably blank`);
  }

  let step = 0;
  for (const s of SCRIPT) {
    step += 1;
    await cdp.press(s.key, s.settle);
    const now = await cdp.frame();
    const tag = `${String(step).padStart(2, "0")}-${s.label}`;
    writeFileSync(path.join(SHOTS, `${tag}.png`), now.png);
    const moved = now.hash !== prev.hash;
    console.log(`${tag.padEnd(20)}${now.hash}  ${moved ? "changed" : "same"}`);
    if (s.mustChange && !moved) {
      fail(
        `pressing '${s.key}' (${s.label}) changed nothing on screen. ` +
          `The game is running but not responding to input, which no exception would reveal.`,
      );
      break;
    }
    prev = now;
  }

  if (exceptions.length) fail(`${exceptions.length} uncaught exception(s) while playing`);
  const errors = consoleLines.filter(isErrorLine);
  if (errors.length) fail(`${errors.length} error-level log line(s) while playing`);

  if (!process.exitCode) {
    console.log(`\nplay-smoke OK: played ${SCRIPT.length} steps, no exceptions, no error logs`);
    console.log(`Screenshots: ${SHOTS}`);
  }
} catch (err) {
  fail(String(err?.stack ?? err));
} finally {
  cdp?.ws.close();
  child.kill();
  await sleep(500);
  if (!flag("--keep")) {
    try {
      rmSync(PROFILE, { recursive: true, force: true });
    } catch {
      /* a profile left behind in the temp dir is not worth failing a run over */
    }
  }
}

process.exit(process.exitCode ?? 0);
