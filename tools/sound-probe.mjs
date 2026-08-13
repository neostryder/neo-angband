#!/usr/bin/env node
/**
 * #239: did a sound actually PLAY, in the shell a player runs?
 *
 * The reporter's claim was "I'm not sure I heard the full sound". That is not a
 * testable statement - "I did not hear it" and "it did not fire" are different
 * claims - so this measures the last hop instead of listening: every call to
 * `HTMLMediaElement.prototype.play`, with the sample's filename and whether the
 * returned promise rejected.
 *
 * WHY THAT HOOK AND NOT A GAME HOOK. `window.__neo` is stripped from production
 * bundles (import.meta.env.DEV), and the installed desktop build is a production
 * bundle - so there is no game-side handle to instrument. `play()` needs none:
 * it is a DOM method, it is where packages/web/src/sound.ts ends, and patching
 * it through `Page.addScriptToEvaluateOnNewDocument` puts the instrument in
 * place before the first module of the bundle evaluates.
 *
 * A REJECTED PROMISE IS NOT A MISSING CALL. Chromium's autoplay policy can
 * refuse a play() that the game correctly asked for; sound.ts swallows exactly
 * that rejection. Recording the call AND the rejection keeps the two apart, so
 * "the engine never asked" cannot be confused with "the browser said no".
 *
 * THE CONTROL IS MANDATORY. A run that records nothing proves nothing on its
 * own - sound is OFF by default (use_sound, upstream's shipped default), the
 * pack may be missing, the option toggle may have failed. So the sequence below
 * always fires a KNOWN-GOOD sound first, through a DIFFERENT route: MSG_DROP is
 * emitted by `state.sound` directly from obj-pile's onDrop, with no message sink
 * involved at all. If the drop sample plays and the subject's does not, the
 * channel is live and the subject's own path is what is broken.
 *
 * Usage:
 *   node tools/sound-probe.mjs --name before
 *   node tools/sound-probe.mjs --name after --port 9335
 *
 * Writes <out>/<name>.json (every play, grouped by mark) and one PNG per mark.
 * Requires `pnpm --filter ...-web bundle` and the desktop build to have run.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT = Number(opt("--port", "9336"));
const SEED = opt("--seed", "4239");
const NAME = opt("--name", "sound");
const SHOTS = opt("--out", path.join(repoRoot, "sound-shots"));
const PROFILE = path.join(tmpdir(), `neo-sound-probe-${process.pid}`);
mkdirSync(SHOTS, { recursive: true });

const consoleLines = [];
const exceptions = [];

/**
 * The instrument, installed on every new document before the bundle runs.
 *
 * `src` is read at call time rather than at construction because sound.ts
 * assigns it once and reuses the element for every replay; the filename is what
 * identifies which MSG_ type was asked for, via SOUND_PREF_ENTRIES.
 */
const INSTRUMENT = `
(() => {
  const probe = { plays: [], patched: false };
  window.__soundProbe = probe;
  const proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  if (!proto || !proto.play) return;
  const orig = proto.play;
  proto.play = function () {
    const src = String(this.src || this.currentSrc || "");
    const rec = {
      file: src.split("/").pop() || "(no src)",
      at: Date.now(),
      rejected: null,
    };
    probe.plays.push(rec);
    let p;
    try {
      p = orig.apply(this, arguments);
    } catch (e) {
      rec.rejected = "throw: " + String((e && e.name) || e);
      throw e;
    }
    if (p && typeof p.catch === "function") {
      p.catch((e) => { rec.rejected = String((e && e.name) || e); });
    }
    return p;
  };
  probe.patched = true;
})();
`;

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
    writeFileSync(path.join(SHOTS, `${NAME}-${label}.png`), png);
    return png.length;
  }
}

function keySpec(key) {
  const named = {
    Enter: { windowsVirtualKeyCode: 13, key: "Enter", code: "Enter", text: "\r" },
    Escape: { windowsVirtualKeyCode: 27, key: "Escape", code: "Escape" },
  };
  if (named[key]) return named[key];
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

/* ------------------------------------------------------------- sequence ---- */

/** `type:TEXT` types a string; `mark:LABEL` snapshots; anything else is a key. */
function expand(tokens) {
  const steps = [];
  for (const tok of tokens) {
    if (tok.startsWith("mark:")) {
      steps.push({ mark: tok.slice(5) });
    } else if (tok.startsWith("type:")) {
      for (const ch of tok.slice(5)) steps.push({ key: ch, settle: 150 });
    } else if (tok.startsWith("wait:")) {
      steps.push({ settle: Number(tok.slice(5)) });
    } else {
      steps.push({ key: tok, settle: 1400 });
    }
  }
  return steps;
}

/**
 * "Perform an effect" prompts in order (wizard.ts runPerformEffect, mirroring
 * cmd-wizard.c L1540-1570): effect name, damage dice, subtype, then the four
 * get_quantity parameters, each defaulted so a bare Enter accepts it.
 *
 * TIMED_SET takes the VALUE from the dice string and the timed effect from the
 * subtype, so `TIMED_SET / 10000 / FOOD` is "set nourishment to 10000".
 *
 * TEN THOUSAND, NOT A HUNDRED. player_timed.txt writes the FOOD grades as
 * 1/4/8/15/90/100, which reads like a percentage, but player-timed.c:263 scales
 * that one effect's maxima by z_info->food_value (100 in the stock pack) - so
 * Full is 10000 and the sidebar's "89 %" is raw 8900. Setting 100 put the
 * character on 1% and printed "You are starving!!" instead, which is a
 * different grade transition carrying the same msgt and would have proved the
 * point by accident rather than by design.
 */
const VERBOSE = argv.includes("--verbose");
/** In verbose mode every prompt gets its own screenshot, to find a desync. */
const step = (tag, ...keys) => (VERBOSE ? [...keys, `mark:${tag}`] : keys);

const effect = (tag, dice, subtype) => [
  ...step(`${tag}-menu`, "^a"),
  ...step(`${tag}-prompt`, "E"),
  ...step(`${tag}-name`, `type:TIMED_SET`, "Enter"),
  ...step(`${tag}-dice-typed`, `type:${dice}`),
  ...step(`${tag}-dice`, "Enter"),
  ...step(`${tag}-sub`, `type:${subtype}`, "Enter"),
  ...step(`${tag}-radius`, "Enter"),
  ...step(`${tag}-other`, "Enter"),
  ...step(`${tag}-y`, "Enter"),
  ...step(`${tag}-x`, "Enter"),
];

const SEQUENCE = [
  /* Birth: title -> reroll -> accept. */
  "n",
  "@",
  "Enter",
  "wait:2500",
  "mark:born",

  /* Two options, and BOTH before anything that emits a message.
   *
   * use_sound is OFF by default (upstream's own shipped default), so nothing
   * can play until it is on. auto_more is off too, and that one desynced the
   * first run of this probe: the control drop printed "You drop a Holy Book of
   * Prayers (a). -more-", the next four keystrokes went into dismissing the
   * pager instead of opening the debug menu, and the run ended in the ENTER
   * command browser with food still at 89. A key sequence driven blind has to
   * remove the pager, not step around it.
   *
   * '=' Options -> 'a' User interface options -> a TOGGLE_TAGS letter jumps to
   * a row and 'y' sets it. TOGGLE_TAGS is "abcdefgimopquvwzABC...", indexed
   * against the INTERFACE rows of OPTION_ENTRIES in table order, so 'c' is
   * use_sound (row 2) and 'B' is auto_more (row 17). */
  "=",
  "a",
  "c",
  "y",
  "B",
  "y",
  "Escape",
  "Escape",
  "wait:1500",
  "mark:sound-on",

  /* Prime the debug consent BEFORE the measured steps.
   *
   * player_can_debug_prereq asks once per savefile, and the prompt arrives
   * AFTER the command letter, not before - so a consent `y` folded into a
   * measured step would be typed into that step's own prompt if the consent had
   * already been given. Spending it here on 'w' (wizard light level, which only
   * lights the town) leaves every later `^a` landing straight on its prompt.
   *
   * No Enter after the consent: the "your machine may crash" line is a MESSAGE,
   * and auto_more is already on by this point, so nothing waits on it. An Enter
   * here reaches the map instead and opens the ENTER command browser, which is
   * what swallowed the control drop on the second run of this probe. */
  "^a",
  "w",
  "y",
  "wait:1500",
  "mark:debug-ready",

  /* THE CONTROL, and it comes before the subject on purpose. 'd' drops an item;
   * obj-pile's onDrop calls state.sound(MSG_DROP) directly, with no message sink
   * in the path. A drop sample here proves the option, the pack, the engine, the
   * event bus and HTMLAudioElement all work in this run. */
  "d",
  "a",
  "wait:2000",
  "mark:control-drop",

  /* THE SUBJECT, ascending: Fed (raw 8900) -> Full, "You are full!" */
  ...effect("up", "10000", "FOOD"),
  "wait:2000",
  "mark:full",

  /* THE SUBJECT, descending: Full -> Fed, "You are no longer full." */
  ...effect("down", "5000", "FOOD"),
  "wait:2000",
  "mark:no-longer-full",

  /* The message history (^P), because the status line alone is circumstantial.
   * runPerformEffect prints "Identified!" after the effect returns, which
   * overwrites the transition message on the top line - so the only place the
   * two lines survive is the log. A silent subject is only a defect if the
   * message it is attached to actually printed; this is where that is read. */
  "^p",
  "wait:1200",
  "mark:messages",
];

/* ------------------------------------------------------------------ main ---- */

const desktopDir = path.join(repoRoot, "packages", "desktop");
const requireFromDesktop = createRequire(path.join(desktopDir, "package.json"));
const electronBin = requireFromDesktop("electron");

const child = spawn(
  electronBin,
  [".", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`],
  { cwd: desktopDir, stdio: ["ignore", "pipe", "pipe"] },
);
let shellOutput = "";
child.stdout.on("data", (d) => (shellOutput += d));
child.stderr.on("data", (d) => (shellOutput += d));

let cdp;
try {
  const page = await findPage();
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await sleep(4000);

  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
  const base = (await cdp.evaluate("location.origin + location.pathname")) ?? "";
  await cdp.send("Page.navigate", { url: `${base}?new=1&seed=${SEED}` });
  await cdp.waitStable();

  const patched = await cdp.evaluate("window.__soundProbe && window.__soundProbe.patched");
  if (!patched) throw new Error("the play() instrument did not install");

  const marks = [];
  let seen = 0;
  for (const step of expand(SEQUENCE)) {
    if (step.mark) {
      const plays = await cdp.evaluate("window.__soundProbe.plays");
      await cdp.shot(step.mark);
      marks.push({ mark: step.mark, plays: plays.slice(seen) });
      seen = plays.length;
      continue;
    }
    if (step.key) await cdp.press(step.key, step.settle);
    else await sleep(step.settle);
  }

  const all = await cdp.evaluate("window.__soundProbe.plays");
  const meta = {
    name: NAME,
    seed: SEED,
    totalPlays: all.length,
    marks,
    exceptions,
    errors: consoleLines.filter((l) => l.level === "error" || l.level === "severe").map((l) => l.text),
  };
  writeFileSync(path.join(SHOTS, `${NAME}.json`), JSON.stringify(meta, null, 2));

  for (const m of marks) {
    const files = m.plays.map((p) => `${p.file}${p.rejected ? ` [rejected: ${p.rejected}]` : ""}`);
    console.log(`${m.mark.padEnd(18)} ${files.length ? files.join(", ") : "(silence)"}`);
  }
  console.log(`\ntotal play() calls: ${all.length}`);

  /* THE CONTROL IS READ FIRST, and its failure is INCONCLUSIVE rather than a
   * pass or a fail. A run where nothing at all played cannot tell a fixed build
   * from a broken one. */
  const control = marks.find((m) => m.mark === "control-drop");
  if (!control?.plays.length) {
    console.error(
      "\nINCONCLUSIVE: the control fired no sound, so a silent subject means nothing.\n" +
        "Fix the control (use_sound, the pack, the drop) before reading the result.",
    );
    process.exitCode = 1;
  } else {
    /* sound-prefs-data.ts maps type HUNGRY -> pls_man_sob, matching
     * reference/lib/customize/sound.prf:201. Both FOOD grade transitions carry
     * player_timed.txt's `msgt:HUNGRY`, so both marks must show it. */
    const missing = ["full", "no-longer-full"].filter(
      (name) =>
        !marks
          .find((m) => m.mark === name)
          ?.plays.some((p) => p.file.startsWith("pls_man_sob")),
    );
    if (missing.length) {
      console.error(
        `\nFAILED (#239): no MSG_HUNGRY sample on ${missing.join(" or ")}, ` +
          "while the control played.\nA typed message is not reaching its sound: " +
          "check the host's msg sink (web/src/main.ts) still calls messageSound.",
      );
      process.exitCode = 1;
    } else {
      console.log("\nPASS: both FOOD grade transitions played MSG_HUNGRY, and the control sounded.");
    }
  }
} catch (err) {
  console.error(`sound-probe FAILED: ${err?.message ?? err}`);
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
