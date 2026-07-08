/**
 * Neo Angband web front end.
 *
 * Boots the glyph terminal and wires input/output through the two engine
 * seams: commands go in via CommandQueue, state comes out via GameEvents.
 * Until the world kernel lands this drives a small demo scene so the
 * whole surface (rendering, keymap, seams) is exercised end to end.
 */

import {
  CommandQueue,
  GameEvents,
  cmdGetArg,
  cmdSetArg,
  makeCommand,
  DDX,
  DDY,
} from "@neo-angband/core";
import { GlyphTerm } from "./term";
import { resolveKey } from "./keymap";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const term = new GlyphTerm(canvas);
const events = new GameEvents();
const queue = new CommandQueue();

// Demo scene: a walled room the player can walk around.
const MAP_W = 40;
const MAP_H = 16;
let px = 5;
let py = 5;
// Original keyset (numpad + arrows) is the default, matching upstream's
// rogue_like_commands = false. Flip to enable hjkl movement.
const roguelikeKeys = false;
let message =
  "Welcome to Neo Angband. Numpad or arrow keys to move.";

function isWall(x: number, y: number): boolean {
  return x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;
}

queue.register("walk", (cmd) => {
  const dirArg = cmdGetArg(cmd, "direction", "direction");
  if (!dirArg) return;
  const dir = dirArg.value;
  const nx = px + (DDX[dir] ?? 0);
  const ny = py + (DDY[dir] ?? 0);
  if (isWall(nx, ny)) {
    events.emit("message", { msg: "There is a wall in the way.", type: 0 });
    return;
  }
  px = nx;
  py = ny;
  events.emit("map", { x: px, y: py });
  events.signal("playermoved");
});

events.on("message", (_t, data) => {
  message = data.msg;
  render();
});
events.on("playermoved", () => render());

window.addEventListener("keydown", (ev) => {
  const binding = resolveKey(ev, roguelikeKeys);
  if (!binding) return;
  ev.preventDefault();
  const cmd = makeCommand(binding.kind === "run" ? "run" : "walk", "game");
  cmdSetArg(cmd, "direction", { type: "direction", value: binding.dir });
  if (binding.kind === "run") {
    // Demo: run behaves like walk until the engine's running code lands.
    cmd.code = "walk";
  }
  queue.pushCopy(cmd);
  queue.execute("game");
});

function render(): void {
  const { cols, rows } = term.size();
  term.clear();
  const ox = Math.max(0, Math.floor((cols - MAP_W) / 2));
  const oy = Math.max(1, Math.floor((rows - MAP_H) / 2));
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (isWall(x, y)) {
        term.put(ox + x, oy + y, { ch: "#", fg: "#8d8d97" });
      } else {
        term.put(ox + x, oy + y, { ch: ".", fg: "#4a4a55" });
      }
    }
  }
  term.put(ox + px, oy + py, { ch: "@", fg: "#e8e8f0" });
  term.print(1, 0, message.slice(0, cols - 2), "#c8c8d4");
  term.print(
    1,
    rows - 1,
    "Neo Angband (engine port in progress)",
    "#5a5a66",
  );
}

term.onResize = () => render();
render();
