/**
 * Blueprint View - a worked example of `ModPlugin.frontend`.
 *
 * WHAT IT IS FOR. Every other proof that the front-end seam works is a test:
 * a fixture plugin pushes the frames it receives into a global and an assertion
 * reads them back. That proves the frame ARRIVES. It does not prove a mod can
 * put something on the screen with it, and "green tests on one side, nothing on
 * the shipped path" is the failure this repository keeps re-learning. So this
 * one draws, in the installed build, from a folder on disk.
 *
 * WHAT IT DRAWS. A drafting-table blueprint: walls as strokes, known floor as
 * hatch, remembered-but-unseen grids dimmed, and marks for what the player
 * knows is there. Every one of those decisions comes from `cell.visibility`,
 * `cell.terrain` and `cell.overlays[].kind` - the semantic layers. Nothing here
 * reads `cell.visual`, which is the terminal's own projection and the thing an
 * alternate front end is supposed to be free of. Reverse-parsing a `#` would
 * have been shorter and would have proved the opposite of the point.
 *
 * WHERE IT DRAWS, AND WHY THAT IS THE INTERESTING PART. Every frame carries
 * `frame.regions` - the named parts of the screen, in cells and in CSS pixels.
 * This canvas is sized and placed on `regions.map` and nothing else, so the
 * sidebar, the message row and the status line are all still core's and all
 * still readable. Until that shipped (#234) a front end had no way to learn
 * where the map's pixels were - cell size and the letterbox offset were private
 * to the terminal - so this sample covered the whole window, and with it on you
 * could not read your hit points or reach the menu that turns it off.
 *
 * A front end is still ALLOWED to cover the window: an isometric or 3D view may
 * well want to. The point of the regions is that it becomes a decision, taken
 * knowing what is being covered, instead of the only thing a mod could do.
 *
 * AND WHEN IT DOES NOT DRAW. `frame.stack` is every region on screen in paint
 * order, so this canvas can tell that a screen has opened over the map and stand
 * itself down (`coveredUp`). Without that, placing the canvas correctly only
 * moved the covering defect inwards - the inventory, the knowledge browser and
 * the Mods screen were all still being drawn underneath a blueprint of the last
 * dungeon this mod saw.
 *
 * NO IMPORTS, deliberately. A folder plugin gets the engine passed in through
 * `ctx` and nothing else is resolvable from a mods folder.
 */

const PAPER = "#0d2137";
const INK = "#8fc6ff";
const INK_DIM = "#3f6c96";
const MARK_MONSTER = "#ff9d68";
const MARK_OBJECT = "#ffe07a";
const MARK_TRAP = "#ff6b8a";
const MARK_PLAYER = "#ffffff";

/** One mark per overlay kind. Absent kinds simply are not drawn. */
const MARKS = {
  monster: MARK_MONSTER,
  object: MARK_OBJECT,
  trap: MARK_TRAP,
  path: INK_DIM,
};

/**
 * The canvas this front end owns, created once and kept.
 *
 * It starts HIDDEN and with no size. A front end cannot know where to draw
 * until its first frame arrives, and a canvas that defaulted to the whole
 * window for the one repaint before that is a canvas that covers the game every
 * time the region is unavailable. `place()` is what reveals it.
 *
 * `pointer-events: none` matters: input still belongs to the host's input door,
 * and a front end that swallowed clicks would be replacing more than the
 * display. The game's own canvas is left alone underneath - this covers the map
 * rather than clearing it, so handing the map back after a fault (which the
 * host does by resuming its own sink) needs nothing undone here.
 */
function makeSurface(doc) {
  const canvas = doc.createElement("canvas");
  canvas.id = "blueprint-view";
  canvas.style.position = "fixed";
  canvas.style.display = "none";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "50";
  doc.body.appendChild(canvas);
  return canvas;
}

/**
 * Put the canvas exactly on the region the host says is the map.
 *
 * Every frame, not once: the rectangle moves when the window is resized, when
 * the player changes sidebar mode ('=' -> (o)), and when a narrow window makes
 * the game fall back to the compact layout. Reading it from the frame is how
 * this stays right without listening for any of that.
 *
 * Returns the region's size in CSS pixels, or null when the host published no
 * pixel geometry - a headless harness, or a surface that has not been fitted.
 * Null means DRAW NOTHING. Falling back to the window would put this canvas
 * back over the sidebar, which is the whole defect regions exist to end.
 */
function place(canvas, frame) {
  const box = frame.regions && frame.regions.map && frame.regions.map.pixels;
  /* Standing down is a DISPLAY decision, so it belongs here beside the other
   * one: exactly one function decides whether this canvas is on screen, and
   * both of its reasons hide it the same way. */
  if (!box || box.width <= 0 || box.height <= 0 || coveredUp(frame)) {
    canvas.style.display = "none";
    return null;
  }
  canvas.style.display = "block";
  canvas.style.left = `${box.x}px`;
  canvas.style.top = `${box.y}px`;
  canvas.style.width = `${box.width}px`;
  canvas.style.height = `${box.height}px`;
  return box;
}

/**
 * Is anything drawn ABOVE the map covering it?
 *
 * THE DEFECT THIS ENDS, and it is the second half of the one `frame.regions`
 * closed. Placing the canvas on the map region stopped this mod from covering
 * the sidebar, the message row and the menus BESIDE the map. It did nothing
 * about what covers the map ITSELF: a core screen - the inventory, the knowledge
 * browser, the Mods screen you would use to turn this off - repaints the whole
 * terminal underneath this canvas, and repaints it WITHOUT producing a world
 * frame, because a screen redraws from its own key loop. So the last dungeon
 * this mod drew stayed floating over the middle of every screen the player
 * opened, and nothing in the picture said which mod was responsible.
 *
 * `frame.stack` is what makes that answerable. It is every region on screen,
 * bottom to top, so anything AFTER `map` in it is drawn over the map, and the
 * host re-presents the last frame whenever the stack changes - which is how this
 * runs at all when no repaint is coming.
 *
 * THREE ANSWERS, NOT TWO, and the third is the one worth writing down:
 *   - no stack at all -> this host publishes none; nothing is known, so draw.
 *     (`place()` still declines when there is no pixel geometry.)
 *   - a stack with no `map` in it -> DO NOT DRAW. That is a host that has
 *     stopped describing the map, and a front end that read it as "nothing is
 *     covering me" would paint over whatever replaced it, for ever.
 *   - a stack with `map` in it -> overlap decides.
 */
function coveredUp(frame) {
  const stack = frame.stack;
  if (!stack) return false;
  let at = -1;
  for (let i = 0; i < stack.length; i++) {
    if (stack[i].id === "map") { at = i; break; }
  }
  if (at < 0) return true;
  const map = stack[at].cells;
  for (let i = at + 1; i < stack.length; i++) {
    const c = stack[i].cells;
    if (
      c.col < map.col + map.cols &&
      map.col < c.col + c.cols &&
      c.row < map.row + map.rows &&
      map.row < c.row + c.rows
    ) {
      return true;
    }
  }
  return false;
}

/** The terrain codes a plan draws as solid. Names, resolved through core. */
const WALL_CODES = ["SECRET", "MAGMA", "QUARTZ", "MAGMA_K", "QUARTZ_K", "GRANITE", "PERM"];

/**
 * Resolve the wall set once, from `ctx.core.FEAT`.
 *
 * By CODE rather than by the numbers those codes currently have: `FEAT` is
 * generated from `list-terrain.h`, so a pack that adds terrain moves every
 * index after its insertion point, and a mod that had memorised 21 for GRANITE
 * would quietly start drawing something else as wall.
 */
function wallSet(core) {
  const feat = core && core.FEAT;
  const out = new Set();
  if (!feat) return out;
  for (const code of WALL_CODES) {
    const idx = feat[code];
    if (typeof idx === "number") out.add(idx);
  }
  return out;
}

export default {
  api: 1,

  frontend(ctx) {
    const doc = globalThis.document;
    /* No DOM at all is a legitimate host (a headless harness, a test). Decline
     * rather than throw: a throwing factory costs this mod the slot AND is
     * reported as its fault, when the honest answer is "not here". */
    if (!doc || !doc.body) return undefined;

    const canvas = makeSurface(doc);
    const g = canvas.getContext("2d");
    if (!g) return undefined;
    const walls = wallSet(ctx.core);

    ctx.log("blueprint-view: holding the map display");

    return {
      present(frame) {
        const box = place(canvas, frame);
        if (!box) return;
        const dpr = globalThis.devicePixelRatio || 1;
        const w = box.width;
        const h = box.height;
        if (canvas.width !== Math.floor(w * dpr)) canvas.width = Math.floor(w * dpr);
        if (canvas.height !== Math.floor(h * dpr)) canvas.height = Math.floor(h * dpr);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);

        g.fillStyle = PAPER;
        g.fillRect(0, 0, w, h);

        const cols = frame.viewport.size.width || 1;
        const rows = frame.viewport.size.height || 1;
        /* One square cell, letterboxed INSIDE the map region - the aspect ratio
         * of the dungeon is a fact about the dungeon, not about the rectangle
         * it is shown in. A front end is free to use the region's own cell
         * shape instead and land exactly on the terminal cells it replaced. */
        const cell = Math.max(2, Math.min(w / cols, h / rows));
        const ox = (w - cell * cols) / 2;
        const oy = (h - cell * rows) / 2;
        const at = (c) => ({
          x: ox + (c.grid.x - frame.viewport.origin.x) * cell,
          y: oy + (c.grid.y - frame.viewport.origin.y) * cell,
        });

        for (const c of frame.cells) {
          if (c.visibility === "unknown") continue;
          const p = at(c);
          const dim = c.visibility === "remembered";
          if (c.terrain && walls.has(c.terrain.id)) {
            g.fillStyle = dim ? INK_DIM : INK;
            g.fillRect(p.x, p.y, cell, cell);
          } else {
            /* Hatch, not fill: known-and-open has to read differently from
             * known-and-solid at a glance, which is the whole job of a plan. */
            g.strokeStyle = dim ? INK_DIM : INK;
            g.lineWidth = 0.5;
            g.beginPath();
            g.moveTo(p.x, p.y + cell);
            g.lineTo(p.x + cell, p.y);
            g.stroke();
          }
        }

        for (const c of frame.cells) {
          if (c.visibility === "unknown") continue;
          const p = at(c);
          for (const layer of c.overlays) {
            const colour = MARKS[layer.kind];
            if (!colour) continue;
            g.fillStyle = colour;
            g.beginPath();
            g.arc(p.x + cell / 2, p.y + cell / 2, cell * 0.3, 0, Math.PI * 2);
            g.fill();
          }
        }

        if (frame.player) {
          const p = at(frame.player);
          g.strokeStyle = MARK_PLAYER;
          g.lineWidth = 2;
          g.strokeRect(p.x + 1, p.y + 1, cell - 2, cell - 2);
        }

        /* The label is not decoration. A screenshot of an unfamiliar renderer
         * is not self-evidently the mod's rather than a broken game frame, and
         * the frame's own numbers are the part that proves the data arrived -
         * including the region, which is what proves this canvas is where the
         * host said the map is rather than wherever it happened to land. */
        const mapCells = frame.regions.map.cells;
        g.fillStyle = INK;
        g.font = "14px monospace";
        g.fillText(
          `Blueprint View - ${cols}x${rows} from WorldFrame (${frame.cells.length} cells)`,
          12,
          22,
        );
        g.fillText(
          `map region: ${mapCells.cols}x${mapCells.rows} cells at ${mapCells.col},${mapCells.row}`,
          12,
          40,
        );
      },
    };
  },
};
