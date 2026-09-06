const values = () => {
  const viewport = globalThis.visualViewport;
  if (!viewport) return "Visual viewport: unavailable";
  return `Visual viewport: ${Math.round(viewport.width)} x ${Math.round(viewport.height)} at ${Math.round(viewport.offsetLeft)},${Math.round(viewport.offsetTop)}`;
};

export default {
  api: 1,

  register(_host, ctx) {
    if (!ctx.ui) return;
    const panel = ctx.ui.openPanel({ id: "editor", modal: true, label: "Viewport panel" });
    panel.root.innerHTML = `
      <style>
        :host { all: initial; }
        main { box-sizing: border-box; height: 100%; overflow: auto; padding: 56px 16px 16px; color: #e8e8f0; background: #18181f; font: 16px/1.4 system-ui, sans-serif; }
        label { display: grid; gap: 8px; max-width: 42rem; }
        textarea { box-sizing: border-box; min-height: 10rem; width: 100%; resize: vertical; font: inherit; }
        output { display: block; margin: 12px 0; color: #b8c7e8; }
      </style>
      <main>
        <h1>Viewport panel</h1>
        <output id="viewport"></output>
        <label>Notes<textarea id="notes" placeholder="Tap here to open the keyboard"></textarea></label>
      </main>`;
    const output = panel.root.getElementById("viewport");
    const notes = panel.root.getElementById("notes");
    const update = () => {
      if (output) output.textContent = values();
    };
    globalThis.visualViewport?.addEventListener("resize", update);
    globalThis.visualViewport?.addEventListener("scroll", update);
    notes?.addEventListener("focus", () => notes.scrollIntoView({ block: "center" }));
    panel.closed.finally(() => {
      globalThis.visualViewport?.removeEventListener("resize", update);
      globalThis.visualViewport?.removeEventListener("scroll", update);
    });
    update();
  },
};
