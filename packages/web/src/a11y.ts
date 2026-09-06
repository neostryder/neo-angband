/**
 * Accessibility bridge for the canvas game surface.
 *
 * The game renders to a single <canvas>, which is opaque to assistive
 * technology: a screen reader sees nothing there. This module gives the app a
 * parallel, non-visual channel so it is playable with a screen reader and
 * keyboard, on every surface (web / PWA / desktop):
 *
 * - a POLITE live region (role="log") that mirrors the game's message stream,
 *   so a screen reader announces what just happened (hits, pickups, messages);
 * - an ASSERTIVE live region (role="alert") for the few things that must
 *   interrupt (death, "you die");
 * - a semantic label + role on the canvas and a visually-hidden instructions
 *   block, so the app announces what it is and how to start.
 *
 * It is UI-only and additive: nothing here touches game state, and the regions
 * are visually hidden (the .a11y-sr class), so sighted play is unchanged. The
 * game already drives entirely from the keyboard, so keyboard access is inherent;
 * this fills the missing screen-reader half.
 */

/** The live announcer handed back to the host to mirror messages. */
export interface A11y {
  /** Announce a game message (polite: queued, never interrupts). */
  announce(text: string): void;
  /** Announce something urgent (assertive: interrupts, e.g. death). */
  alert(text: string): void;
  /** Update the terse status summary (depth / HP), read on demand. */
  setStatus(text: string): void;
}

/** How many recent messages to keep in the live log (SR reads new children). */
const LOG_KEEP = 40;

const SR_CSS = `
.a11y-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
`;

function el(
  tag: string,
  attrs: Record<string, string>,
  text?: string,
): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Install the accessibility DOM (live regions + canvas semantics + an sr-only
 * instructions block) and return the announcer. Safe to call once at boot,
 * after the canvas exists. In a non-DOM host it is a no-op returning stubs.
 */
export function initA11y(canvas: HTMLElement | null): A11y {
  if (typeof document === "undefined" || !document.body) {
    return { announce: () => {}, alert: () => {}, setStatus: () => {} };
  }

  const style = document.createElement("style");
  style.textContent = SR_CSS;
  document.head.appendChild(style);

  // Canvas semantics: an interactive application the user drives by keyboard.
  if (canvas) {
    canvas.setAttribute("role", "application");
    canvas.setAttribute(
      "aria-label",
      "Neo Angband, a keyboard-driven roguelike dungeon crawler. " +
        "Game messages are announced as they happen. Press ? for help and the key list.",
    );
    if (!canvas.hasAttribute("tabindex")) canvas.setAttribute("tabindex", "0");
  }

  // A visually-hidden instructions block, first in reading order.
  const instructions = el(
    "div",
    { class: "a11y-sr", id: "a11y-instructions" },
    "Neo Angband. Play with the keyboard: arrow keys or numpad to move, " +
      "press ? at any time for the full command list and help. Game messages " +
      "are announced automatically. This is a faithful port of Angband 4.2.6.",
  );

  const status = el("div", {
    class: "a11y-sr",
    id: "a11y-status",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
  });

  const log = el("div", {
    class: "a11y-sr",
    id: "a11y-log",
    role: "log",
    "aria-live": "polite",
    "aria-relevant": "additions",
  });

  const alertRegion = el("div", {
    class: "a11y-sr",
    id: "a11y-alert",
    role: "alert",
    "aria-live": "assertive",
  });

  document.body.prepend(instructions, status, log, alertRegion);

  const trimLog = (): void => {
    while (log.childElementCount > LOG_KEEP && log.firstChild) {
      log.removeChild(log.firstChild);
    }
  };

  return {
    announce(text: string): void {
      if (!text) return;
      log.appendChild(el("div", {}, text));
      trimLog();
    },
    alert(text: string): void {
      if (!text) return;
      // Reassign textContent so identical repeated alerts still fire.
      alertRegion.textContent = "";
      alertRegion.textContent = text;
    },
    setStatus(text: string): void {
      status.textContent = text;
    },
  };
}
