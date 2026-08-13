#!/usr/bin/env node
/**
 * #241: photograph a double-height tile, in the shell a player runs.
 *
 * `isDoubleHeightTile` (core visuals/grafmode, the port of is_dh_tile
 * grafmode.c L241) had zero production callers, so both web tile engines
 * squashed a 64x128 Shockbolt tile into one 64x64 cell. The unit tests in
 * `packages/web/src/term.test.ts` cover the dirty-rectangle algebra and were
 * verified to fail with the expansion rules removed - but algebra is not
 * pixels, and this repository's own CLAUDE.md says a rendering claim with no
 * pixels behind it is worse than an admitted gap.
 *
 * THE SUBJECT. Shockbolt's overdraw band is tileset rows 27..31 (list.txt
 * `extra`), so attrs 0x9B..0x9F are tall. Row 27 (0x9B) is where the FIVE TOWN
 * STORE ENTRANCES live:
 *
 *   feat:STORE_BOOK:*:0x9B:0xF4   feat:STORE_ALCHEMY:*:0x9B:0xF5
 *   feat:STORE_MAGIC:*:0x9B:0xF6  feat:STORE_BLACK:*:0x9B:0xF8
 *   feat:HOME:*:0x9B:0xF7
 *
 * That matters because it needs no wizard mode, no summon and no lucky roll:
 * every new character stands in a town that draws five of them on the first
 * frame after birth. The subject is reached deterministically.
 *
 * THE MEASUREMENT IS A DIFFERENCE, NOT A LOOK. A screenshot of the fixed build
 * on its own proves nothing - a tall tile drawn wrongly still looks like a
 * monster. So this runs the SAME seed through TWO bundles and diffs them:
 *
 *   --shot <name>   play the scene and write <name>.png (+ .json metrics)
 *   --diff a.png b.png   compare two shots and report where they differ
 *
 * Run it once against the fix and once against a bundle built from the parent
 * commit. The parent is the negative control: the mechanism is absent, not
 * merely fed inert input. If the two frames are IDENTICAL the fix does nothing
 * in a running game, and this says so.
 *
 * Usage:
 *   node tools/tall-tile-probe.mjs --shot fixed [--port 9334] [--seed 4241]
 *   node tools/tall-tile-probe.mjs --diff shots/fixed.png shots/prefix.png
 *
 * Requires `pnpm --filter ...-web bundle` and the desktop build to have run.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { inflateSync } from "node:zlib";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

/* ------------------------------------------------------------------ PNG ---- */

/**
 * Decode a PNG to {width, height, rgba} with no dependency.
 *
 * Only the shapes Chromium's `Page.captureScreenshot` emits are handled: 8-bit
 * colour type 6 (RGBA) or 2 (RGB), no interlace. Anything else throws rather
 * than being guessed at, because a silently mis-decoded image would make a
 * difference map that means nothing.
 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
        throw new Error(`unsupported PNG: depth ${bitDepth}, colour ${colorType}`);
      }
      if (data[12] !== 0) throw new Error("interlaced PNG unsupported");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      switch (filter) {
        case 0:
          break;
        case 1:
          line[i] = (line[i] + a) & 0xff;
          break;
        case 2:
          line[i] = (line[i] + b) & 0xff;
          break;
        case 3:
          line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
          break;
        case 4: {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          line[i] = (line[i] + pr) & 0xff;
          break;
        }
        default:
          throw new Error(`bad PNG filter ${filter} on row ${y}`);
      }
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { width, height, rgba: out };
}

/* ----------------------------------------------------------------- diff ---- */

function runDiff(aPath, bPath) {
  const a = decodePng(readFileSync(aPath));
  const b = decodePng(readFileSync(bPath));
  if (a.width !== b.width || a.height !== b.height) {
    console.error(`SIZE MISMATCH: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    process.exitCode = 1;
    return;
  }
  /* Per-row change counts. A tall tile that starts drawing upward changes the
   * cell ABOVE its anchor and nothing else, so the differing rows should form
   * bands one cell tall, not a wash across the whole frame. */
  const perRow = new Int32Array(a.height);
  let total = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (
        a.rgba[i] !== b.rgba[i] ||
        a.rgba[i + 1] !== b.rgba[i + 1] ||
        a.rgba[i + 2] !== b.rgba[i + 2]
      ) {
        perRow[y]++;
        total++;
      }
    }
  }
  const bands = [];
  for (let y = 0; y < a.height; y++) {
    if (perRow[y] === 0) continue;
    const start = y;
    let peak = 0;
    while (y < a.height && perRow[y] > 0) {
      peak = Math.max(peak, perRow[y]);
      y++;
    }
    bands.push({ y0: start, y1: y - 1, rows: y - start, peak });
  }
  console.log(`A: ${aPath}`);
  console.log(`B: ${bPath}`);
  console.log(`frame: ${a.width}x${a.height}`);
  console.log(`differing pixels: ${total} (${((100 * total) / (a.width * a.height)).toFixed(3)}%)`);
  console.log(`differing row bands: ${bands.length}`);
  for (const band of bands) {
    console.log(`  rows ${band.y0}-${band.y1} (${band.rows} tall), peak ${band.peak} px/row`);
  }
  if (total === 0) {
    console.error("\nFAILED: the two builds render this scene identically.");
    console.error("The tall-tile path is not reached in a running game.");
    process.exitCode = 1;
  }
}

if (argv.includes("--diff")) {
  const i = argv.indexOf("--diff");
  runDiff(argv[i + 1], argv[i + 2]);
  process.exit(process.exitCode ?? 0);
}

/* ------------------------------------------------------------------ CDP ---- */

const PORT = Number(opt("--port", "9334"));
const SEED = opt("--seed", "4241");
const NAME = opt("--shot", "shot");
const SHOTS = opt("--out", path.join(repoRoot, "tall-tile-shots"));
const PROFILE = path.join(tmpdir(), `neo-tall-probe-${process.pid}`);
mkdirSync(SHOTS, { recursive: true });

const consoleLines = [];
const exceptions = [];

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

  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result?.value;
  }

  async press(key, settleMs) {
    const spec = keySpec(key);
    await this.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...spec });
    if (spec.text) await this.send("Input.dispatchKeyEvent", { type: "char", ...spec });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...spec });
    await sleep(settleMs);
  }

  /**
   * Block until the window has stopped changing, instead of guessing a sleep.
   *
   * A fixed wait is what made an earlier run drive its whole key sequence into
   * a title screen that had not finished booting: every frame came back
   * identical, the keys went nowhere, and the run looked like a logic failure
   * rather than a slow start. Two consecutive identical frames after at least
   * one change is the signal that the shell has settled.
   */
  async waitStable(minMs = 3000, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    await sleep(minMs);
    let last = null;
    let stable = 0;
    while (Date.now() < deadline) {
      const { data } = await this.send("Page.captureScreenshot", { format: "png" });
      const h = createHash("sha256").update(data).digest("hex");
      stable = h === last ? stable + 1 : 0;
      last = h;
      if (stable >= 2) return;
      await sleep(700);
    }
    throw new Error(`window never stopped changing within ${timeoutMs}ms`);
  }

  async shot(label) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    const png = Buffer.from(data, "base64");
    const file = path.join(SHOTS, `${NAME}-${label}.png`);
    writeFileSync(file, png);
    return { file, png, hash: createHash("sha256").update(png).digest("hex").slice(0, 16) };
  }
}

function keySpec(key) {
  const named = {
    Enter: { windowsVirtualKeyCode: 13, key: "Enter", code: "Enter", text: "\r" },
    Escape: { windowsVirtualKeyCode: 27, key: "Escape", code: "Escape" },
  };
  if (named[key]) return named[key];
  /* `^a` = KTRL('A'), how the debug menu is opened (ui-game.c:225). The control
   * CHARACTER is what the game reads, so it goes in `text`; the modifier bit is
   * still set so the event looks like a real Ctrl chord to anything watching. */
  if (key.length === 2 && key[0] === "^") {
    const u = key[1].toUpperCase();
    return {
      windowsVirtualKeyCode: u.charCodeAt(0),
      key: key[1].toLowerCase(),
      code: `Key${u}`,
      modifiers: 2,
      text: String.fromCharCode(u.charCodeAt(0) - 64),
    };
  }
  if (key.length !== 1) throw new Error(`unknown key: ${key}`);
  const upper = key.toUpperCase();
  return {
    windowsVirtualKeyCode: upper.charCodeAt(0),
    key,
    code: /[a-zA-Z]/u.test(key) ? `Key${upper}` : /[0-9]/u.test(key) ? `Digit${key}` : "",
    text: key,
  };
}

/* ------------------------------------------------------------------ main ---- */

const desktopDir = path.join(repoRoot, "packages", "desktop");
const requireFromDesktop = createRequire(path.join(desktopDir, "package.json"));
const electronBin = requireFromDesktop("electron");

const child = spawn(electronBin, [".", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`], {
  cwd: desktopDir,
  stdio: ["ignore", "pipe", "pipe"],
});
let shellOutput = "";
child.stdout.on("data", (d) => (shellOutput += d));
child.stderr.on("data", (d) => (shellOutput += d));

let cdp;
try {
  const page = await findPage();
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await sleep(4000);

  /* Shockbolt Dark (grafID 5, the only shipped band of tall tiles besides its
   * light twin) and a fixed seed, so the two builds get the same town. */
  const base = (await cdp.evaluate("location.origin + location.pathname")) ?? "";
  const target = `${base}?graf=5&new=1&seed=${SEED}`;
  await cdp.send("Page.navigate", { url: target });
  await cdp.waitStable();

  const steps = [
    ["n", 3000, "title"],
    ["@", 3000, "roll"],
    ["Enter", 5000, "accept"],
  ];
  /**
   * `--summon "<monster>"`: after birth, open the debug menu (^A), clear the
   * NOSCORE_DEBUG consent prompt, and summon a named monster next to the player.
   *
   * The town's own tall tiles are the five store entrances, and those are the
   * ONLY five entries in Shockbolt's overdraw band with an empty cell above them
   * - 247 of the 252 band entries have real art up there, the shops do not. So
   * a town-only comparison photographs the one subject that cannot show the
   * difference. A summoned monster is the subject that can.
   */
  const summon = opt("--summon", "");
  if (summon) {
    steps.push(["^a", 2500, "debug-open"]);
    for (const ch of (opt("--gate", "") || "").split("")) {
      steps.push([ch, 1500, `gate-${ch}`]);
    }
    /* Comma-separated so named keys fit: the real sequence is `n` (Summon
     * specific), `y` (player_can_debug_prereq's consent prompt, which comes
     * AFTER the command key, not before), then Enter to clear the
     * "your savefile may become corrupted" warning before the name prompt. */
    for (const ch of (opt("--path", "n,y,Enter") || "").split(",")) {
      steps.push([ch, 1500, `path-${ch}`]);
    }
    const name = summon.split("");
    name.forEach((ch, i) => steps.push([ch, 200, i === name.length - 1 ? "typed" : "type"]));
    steps.push(["Enter", 3000, "summoned"]);
    /* One game turn after the summon. place_new_monster does not itself run the
     * visibility update, so a monster can exist and still not be drawn until
     * something advances the turn; `,` (hold still) is the cheapest way to do
     * that without moving the player off the tile the shot is framed around. */
    steps.push([",", 2500, "after-hold"]);
    steps.push([",", 2500, "after-hold2"]);
  }
  /**
   * `--after "tok|tok|..."`: an arbitrary key sequence appended after
   * everything above, with a labelled screenshot per token. A token of the form
   * `type:TEXT` types TEXT one character at a time (for the debug menu's string
   * prompts); a token of `wait:MS` just settles; anything else is one key.
   *
   * Separated by `|`, not by a comma, because `,` is itself a key worth sending
   * - it is "hold still", the cheapest way to advance one game turn without
   * moving the player off the tile a shot is framed around.
   *
   * This is how a run reaches a state the fixed steps above cannot express -
   * e.g. `^a|E|type:TIMED_INC|Enter|type:60|Enter|type:IMAGE|Enter|...` to
   * inflict hallucination through "Perform an effect".
   */
  for (const tok of (opt("--after", "") || "").split("|").filter(Boolean)) {
    if (tok.startsWith("type:")) {
      const text = tok.slice(5);
      text.split("").forEach((ch, i) =>
        steps.push([ch, 150, i === text.length - 1 ? `typed-${text}` : "type"]),
      );
    } else if (tok.startsWith("wait:")) {
      steps.push([null, Number(tok.slice(5)), `wait-${tok.slice(5)}`]);
    } else {
      steps.push([tok, 1800, `after-${tok}`]);
    }
  }
  const frames = [];
  for (const [key, settle, label] of steps) {
    if (key === null) await sleep(settle);
    else await cdp.press(key, settle);
    if (label !== "type") frames.push({ label, ...(await cdp.shot(label)) });
  }
  await sleep(2500);
  const town = await cdp.shot("town");
  frames.push({ label: "town", ...town });

  const info = await cdp.evaluate(`(() => {
    const c = document.querySelector("canvas");
    return {
      url: location.href,
      canvas: c ? { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight } : null,
      graf: localStorage.getItem("neo-angband:graf"),
      devHook: typeof window.__neo,
      tallProbe: window.__tallProbe ?? null,
    };
  })()`);

  const meta = {
    name: NAME,
    seed: SEED,
    info,
    frames: frames.map((f) => ({ label: f.label, file: path.basename(f.file), hash: f.hash, bytes: f.png.length })),
    exceptions,
    errors: consoleLines.filter((l) => l.level === "error" || l.level === "severe").map((l) => l.text),
  };
  writeFileSync(path.join(SHOTS, `${NAME}.json`), JSON.stringify(meta, null, 2));
  writeFileSync(path.join(SHOTS, `${NAME}.png`), town.png);

  console.log(JSON.stringify(meta, null, 2));
  if (info?.canvas?.w === 0) {
    console.error("\nFAILED: canvas is 0x0 - nothing was composited, so there are no pixels.");
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`tall-tile-probe FAILED: ${err?.message ?? err}`);
  console.error(shellOutput.slice(-3000));
  process.exitCode = 1;
} finally {
  try {
    await cdp?.send("Browser.close");
  } catch {
    /* the window may already be gone */
  }
  child.kill();
}
