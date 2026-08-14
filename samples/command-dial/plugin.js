/**
 * Command Dial - a worked example of `ModPlugin.menu`.
 *
 * WHAT IT IS FOR. `samples/blueprint-view` reimagines the MAP and
 * `samples/vitals-panel` reimagines one HUD region. Both of those are DRAWN. A
 * menu is ASKED, and that is a different kind of seam: taking a question means
 * taking its input too, and answering it. This sample exists to show that the
 * whole round trip works from a mod folder - a question arrives, the mod draws
 * it its own way, the player chooses, and the game acts on the choice.
 *
 * IT TAKES ONE QUESTION AND DECLINES THE REST, which is the point rather than a
 * limitation. `ask` returns `undefined` for every menu id but `core:game-menu`,
 * so the inventory picker, the spell list, the mod manager and the birth screens
 * are all still the game's own - and still work. A presenter is offered every
 * menu precisely so it can be choosy: a dial is a good shape for six verbs and a
 * terrible one for a thirty-mod list.
 *
 * WHAT IT READS. `question.choices[].id` and `.label`, and `choice.semantic` for
 * what a choice MEANS (`{kind: "command", ref: "quit"}`) so the wedge for
 * quitting can be coloured as the dangerous one without matching on the English
 * word "Quit". It answers by NAMING AN ID - never an index - because a dial's
 * order is its own and the game would not recognise a position from it.
 *
 * INPUT IS ITS OWN, and legitimately so: when a presenter takes a question the
 * host does not attach its menu keydown listener at all, so there is nothing to
 * fight with. That is exactly what "taking a question means taking its input"
 * buys, and it is why the listener below can be a plain one.
 *
 * WHAT THIS SEAM CANNOT DO YET, said plainly because a sample is where a limit
 * gets discovered. A menu has no published REGION: `regions.ts` names the four
 * parts of the screen that tile it, and a dial floating over the map is by
 * definition one that overlaps. So this positions itself over the whole window
 * and reads `question.style` to know whether the game would have cleared the
 * screen. Overlapping, ordered, mod-created regions are the next increment of
 * MOD_REACH gap 21, and a dial superimposed on a still-visible dungeon needs
 * them.
 *
 * NO IMPORTS, deliberately. A folder plugin gets the engine passed in through
 * `ctx` and nothing else is resolvable from a mods folder.
 */

/** The one question this sample has a better way to ask. */
const TAKES = "core:game-menu";

const BACKDROP = "rgba(8, 10, 16, 0.82)";
const WEDGE = "#1d2433";
const WEDGE_ON = "#3a5680";
const EDGE = "#4a5570";
const INK = "#d7dde8";
const INK_DIM = "#78829a";
const INK_DANGER = "#e0806a";

/**
 * The wedge colour for one choice.
 *
 * From `semantic.ref`, not from the label: "Quit to desktop" is English, and the
 * ref is what a translated build and a renamed row both keep.
 */
function inkFor(choice, selected) {
  if (choice.disabled) return INK_DIM;
  if (choice.semantic && (choice.semantic.ref === "quit" || choice.semantic.ref === "save-quit")) {
    return INK_DANGER;
  }
  return selected ? "#ffffff" : INK;
}

function makeSurface(doc) {
  const canvas = doc.createElement("canvas");
  canvas.id = "command-dial";
  canvas.style.position = "fixed";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.display = "none";
  canvas.style.zIndex = "60";
  /* Input arrives through this mod's own listener, not through the canvas: a
   * surface that swallowed clicks would take more than the drawing of a menu. */
  canvas.style.pointerEvents = "none";
  doc.body.appendChild(canvas);
  return canvas;
}

export default {
  api: 1,

  menu(ctx) {
    const doc = globalThis.document;
    /* No DOM at all is a legitimate host (a headless harness, a test). Decline
     * rather than throw: a throwing factory costs this mod the menus for the
     * whole session, when the honest answer is "not here". */
    if (!doc || !doc.body) return undefined;
    const canvas = makeSurface(doc);
    const g = canvas.getContext("2d");
    if (!g) return undefined;

    ctx.log(`command-dial: presenting "${TAKES}"`);

    const draw = (question, cursor) => {
      const w = globalThis.innerWidth || 800;
      const h = globalThis.innerHeight || 600;
      const dpr = globalThis.devicePixelRatio || 1;
      canvas.style.display = "block";
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (canvas.width !== Math.floor(w * dpr)) canvas.width = Math.floor(w * dpr);
      if (canvas.height !== Math.floor(h * dpr)) canvas.height = Math.floor(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      /* `style` is what the question says about the game's own intent: it would
       * have CLEARED the terminal for this one, so a full backdrop is honest.
       * An "overlay" question is one the game would have drawn a box over the
       * map for, and covering the dungeon there would be worse than the list. */
      g.fillStyle = question.style === "screen" ? BACKDROP : "rgba(8, 10, 16, 0.4)";
      g.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.max(60, Math.min(w, h) * 0.32);
      const n = question.choices.length || 1;
      const slice = (Math.PI * 2) / n;

      g.font = "600 15px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      for (let i = 0; i < question.choices.length; i++) {
        const choice = question.choices[i];
        const selected = i === cursor;
        const mid = -Math.PI / 2 + slice * i;
        g.beginPath();
        g.moveTo(cx, cy);
        g.arc(cx, cy, radius, mid - slice / 2, mid + slice / 2);
        g.closePath();
        g.fillStyle = selected ? WEDGE_ON : WEDGE;
        g.fill();
        g.strokeStyle = EDGE;
        g.lineWidth = 1;
        g.stroke();
        g.fillStyle = inkFor(choice, selected);
        g.fillText(choice.label, cx + Math.cos(mid) * radius * 0.62, cy + Math.sin(mid) * radius * 0.62);
      }

      g.font = "600 17px sans-serif";
      g.fillStyle = INK;
      g.fillText(question.title, cx, cy - 8);
      g.font = "13px sans-serif";
      g.fillStyle = INK_DIM;
      g.fillText("arrows, Enter, Esc", cx, cy + 12);
    };

    /** One step round the dial, skipping choices that cannot be chosen. */
    const step = (question, from, dir) => {
      const n = question.choices.length;
      let i = from;
      for (let tried = 0; tried < n; tried++) {
        i = (i + dir + n) % n;
        if (!question.choices[i].disabled) return i;
      }
      return from;
    };

    return {
      ask(question) {
        if (question.id !== TAKES) return undefined;
        let cursor = question.cursor;
        draw(question, cursor);
        return new Promise((resolve) => {
          const done = (answer) => {
            doc.removeEventListener("keydown", onKey, true);
            canvas.style.display = "none";
            resolve(answer);
          };
          const onKey = (ev) => {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            if (ev.key === "Escape") return done({ kind: "cancel" });
            if (ev.key === "Enter") {
              const choice = question.choices[cursor];
              /* A disabled choice is shown and refused - answering with one
               * would be reported and cost this menu, so the dial declines to
               * make that mistake rather than relying on the host to catch it. */
              if (!choice || choice.disabled) return undefined;
              return done({ kind: "choose", choice: choice.id });
            }
            if (ev.key === "ArrowRight" || ev.key === "ArrowDown") {
              cursor = step(question, cursor, 1);
              draw(question, cursor);
              return undefined;
            }
            if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
              cursor = step(question, cursor, -1);
              draw(question, cursor);
              return undefined;
            }
            return undefined;
          };
          doc.addEventListener("keydown", onKey, true);
        });
      },
    };
  },
};
