/**
 * Who may put REAL DOM on the player's page, and what the host keeps hold of
 * when they do.
 *
 * THE SIXTH UI SEAM, and the first one that is not made of character cells.
 * `frontend` draws the dungeon, `hud` draws the vitals, `menu` asks the
 * questions, `screen` shows the full views, `regions` adds a rectangle of the
 * grid - five seams, one drawing surface, seven methods. This one hands a mod a
 * shadow root and gets out of the way, because a form with fields, a scrolling
 * list and a sortable table is a shape that surface cannot carry without
 * reimplementing a caret and a tab order inside a text terminal.
 *
 * WHAT THE CAPABILITY IS, STATED PLAINLY, BECAUSE THE ALTERNATIVE IS A CLAIM
 * THAT IS NOT TRUE. `ui:panel.mount` is not a fence around the DOM. A plugin's
 * code runs in the page's own realm - it is fetched as a module and imported -
 * so `document` is ambient to it and always has been, and a mod holding no
 * capabilities at all can append a div to the body today. Every containment
 * story available here has a one-line bypass sitting next to it, and this
 * repository has shipped enough seams with nothing behind them. So the honest
 * account of what the grant buys is three things, none of them isolation:
 *
 *  1. A SENTENCE THE PLAYER READS FIRST. `capability-describe.ts` says that a
 *     mod holding this can draw something that looks exactly like the game and
 *     read what is typed into it. Without the capability the mod can still do
 *     it; the difference is whether anybody was told.
 *  2. A CONTAINER THE HOST OWNS. The mod never supplies the element - it asks
 *     for one and is given a shadow root inside it. So the host, not the mod,
 *     decides where in the document it sits, what it is stacked above, whether
 *     it swallows the pointer, and when it comes down. That closes a whole class
 *     of accident by construction rather than by a check: there is no "register
 *     this node of mine" call, so there is nothing to hand `document.body` to.
 *  3. THE KEYBOARD, HANDED OVER AND HANDED BACK.
 *
 * AND THE THIRD ONE IS A REAL NEW PRIVILEGE, which is the thing to be careful
 * about. Everything else on that list a mod could already do. Standing the
 * game's input door down is not: a mod without this grant can draw a convincing
 * panel and its focused field still cannot be typed into, because the keystroke
 * is read as a game command. With the grant, keystrokes can be withheld from the
 * game - and a panel that withholds them and then does nothing with them is a
 * game that has stopped responding to the keyboard for no reason the player can
 * see. So the privilege is built to be REVOCABLE and to FAIL OPEN, and that is
 * what most of the code below is:
 *
 *  - Only the TOPMOST panel can withhold a key. A panel underneath another is
 *    inert, so a mod cannot hold focus in a hidden panel while the player looks
 *    at a visible one.
 *  - Four invariants are checked on the keystroke itself, not at mount: the
 *    container is still in the document, it is still a child of the layer the
 *    host put it in, it does not contain the surface the game draws on, and it
 *    is the top of the stack. A container that fails any of them is CLOSED and
 *    the key goes to the game. Failing open is the whole point - a suppression
 *    path that errs towards suppressing is an unresponsive game.
 *  - Escape closes the topmost panel, and it is asked BEFORE ownership, so it
 *    works when focus has drifted to the canvas or the body and the panel would
 *    not have claimed the key at all.
 *  - Every modal panel carries a close control the host draws, outside the mod's
 *    shadow root. Escape is not enough on its own: this game is played on
 *    touch, and a phone has no Escape key.
 *  - A panel the PLAYER dismissed puts that mod on a short cooldown, so
 *    `closed.then(reopen)` cannot outrun the key that closes it.
 *
 * THE LIMIT, SAID OUT LOUD RATHER THAN IMPLIED. All of that defends the player
 * against a panel that is BROKEN. None of it defends against one that is
 * hostile, and none of it could: in-process code can add its own capture-phase
 * listener on `window` and never ask this module for anything. What makes the
 * hostile case bearable is the same thing that makes it bearable everywhere else
 * in this system - a mod is code the player installed and switched on, and the
 * boundary is that decision (docs/modding/PLUGINS.md, "What a capability gates").
 *
 * AND WHY NOT AN IFRAME. A sandboxed iframe is the shape that would fence
 * something real: with `allow-scripts` and no `allow-same-origin` its document
 * is opaque-origin, and code inside it reaches neither the parent's DOM nor its
 * storage nor its module graph. That is a genuine boundary and it is around the
 * wrong half. The mod's game-facing code stays in the page realm holding
 * `ctx.core` either way, so what would be isolated is the part that draws a
 * form, while the part that can rewrite the game is untouched. It also costs the
 * seam its only customer: a mod whose UI is a form over the game's own registries
 * has to draw and read in one flow, and splitting that across `postMessage`
 * turns one authoring tool into two programs and a protocol. Last, an iframe
 * takes the keyboard out of the parent's reach entirely - which looks like a
 * free answer to the problem above and is really the same property that makes
 * the escape hatch unimplementable, since keystrokes inside an iframe never
 * reach the parent's listener. An iframe becomes the right answer on the day
 * there is a UI tier that does not hold the engine; it is not that day, and
 * pretending otherwise would describe a boundary that is not there.
 *
 * A SHADOW ROOT IS STILL WORTH HAVING, for what it actually does. Styles do not
 * cross it in either direction, so a mod's `#title` cannot collide with anything
 * and its stylesheet cannot restyle the accessibility live-regions or the touch
 * bar by accident. CLOSED rather than open, which is a small real difference
 * rather than a boundary: the owning mod holds the root it was handed, and
 * another mod cannot pick a panel's contents out of `element.shadowRoot` and
 * read what the player is typing into somebody else's form. It does not stop a
 * mod that means to - a global key listener does that with no shadow root
 * involved - and nothing here should be read as saying it does.
 *
 * CLEANUP IS THE PAGE, AS EVERYWHERE ELSE. Disabling a mod re-composes the page,
 * and a panel not mounted on the way back up is not mounted. What this module
 * adds is the same thing `mod-teardown.ts` adds for `uninstall()`: order. The
 * panel layer is REVOKED first, so no mod can open one during teardown; then the
 * mods' own `uninstall()` runs, with their panels still up, because reading what
 * the player typed is exactly what a last moment is for; then the panels come
 * down, before the save, so nobody is left looking at a mod's interface over a
 * game that is reloading.
 */

import type { ModPanel, ModPanelSpec, ModUi } from "./mod-plugin";
import { setDomKeyboardOwner, type DomKeyboardOwner } from "./input-door";

/** What a mod must hold in its manifest before it may mount DOM of its own. */
export const PANEL_CAPABILITY = "ui:panel.mount";

/**
 * How many panels may be open at once, across every mod.
 *
 * A CEILING RATHER THAN A STYLE RULE. Escape closes one panel, so the number of
 * panels is the number of times a player might have to press it to get back to
 * the game - and an unbounded number is an unbounded number of presses. Eight is
 * more nesting than an authoring tool has any use for and few enough to press
 * through. A mod that wants a ninth gets a refusal naming this, which is a bug
 * report rather than a stuck player.
 */
export const MAX_OPEN_PANELS = 8;

/**
 * How long a mod must wait for another panel after the PLAYER closed one.
 *
 * THE ESCAPE HATCH IS A RACE, and without this the mod wins it. Nothing stops a
 * panel's `closed` continuation from opening a replacement, so a mod that does
 * that in a loop turns the one key that gets the player out into a key that
 * flickers the panel and changes nothing. A pause after a player-initiated close
 * decides the race in the player's favour without taking anything from a mod
 * that reopens a panel because the player asked it to a second later.
 *
 * NOT A SESSION LOCKOUT, deliberately, and the reason is what the hatch is for.
 * Latching a mod out until it is let back in through host UI would defend
 * against a mod that reopens on purpose - and a mod that means harm needs none
 * of this API to hold the keyboard, so the lockout would cost the honest
 * authoring tool its ordinary open-close-open flow to inconvenience an adversary
 * who is not using the door. The pause is aimed at what is actually reachable
 * this way: a loop, or a bug.
 */
export const PLAYER_CLOSE_COOLDOWN_MS = 1500;

/**
 * Where the panel layer sits.
 *
 * Above the touch action bar (`zIndex: 10`, main.ts) so a modal panel is not
 * mixed in with the game's own buttons, and far below the crash screen
 * (2147483647, crash-screen.ts) which must be able to draw over anything
 * including a mod that has gone wrong - the same reasoning that reserves the
 * region stack's `system` band to the host.
 */
const PANEL_Z_BASE = 1000;

/**
 * The host's close control, in three colours that are NOT terminal cells.
 *
 * Palette-exempt on the same grounds crash-screen.ts is, and the grounds matter:
 * the ported z-color table describes what a glyph on the character grid may be,
 * and this is a browser affordance drawn beside one - a button, with a border and
 * a hover target, on a DOM overlay that has no grid in it. Borrowing a palette
 * entry would not make it faithful, it would make it a coincidence.
 *
 * Chosen to read as the game's chrome rather than as a mod's: dark, flat, and
 * quiet enough that it is the mod's panel the player is looking at.
 */
const CLOSE_INK = "#e8e8f0"; // palette-exempt: DOM affordance, not a terminal cell
const CLOSE_FILL = "#26262e"; // palette-exempt
const CLOSE_EDGE = "#52525e"; // palette-exempt

interface LivePanel {
  readonly modId: string;
  readonly id: string;
  /** The host's own element. The mod is never handed this. */
  readonly container: HTMLElement;
  /** Whether it took the screen, which decides Escape and the pointer. */
  readonly modal: boolean;
  readonly finish: () => void;
}

/** Open panels, topmost last. Module-level, because there is one page. */
const panels: LivePanel[] = [];

/** Mod id to the earliest time it may open another panel. */
const cooldowns = new Map<string, number>();

/** True once teardown has begun: no mod may open a panel after that. */
let revoked = false;

/**
 * The element the GAME draws on, when the host has said which it is.
 *
 * Consulted on every keystroke, and twice: once as a containment invariant (a
 * panel that has the game's surface inside it is not a panel), and once as the
 * nearest-owner test on the event's own path. A mod moving the canvas under its
 * container is something in-process code can do, and it would otherwise have
 * turned every game keystroke into a panel keystroke.
 *
 * Undefined in a test that never booted a terminal, which simply means no
 * keystroke is the game's by position and no container can fail that invariant.
 */
let gameSurface: Element | undefined;

/** Tell the panel layer which element the game itself draws on. */
export function setPanelGameSurface(element: Element | undefined): void {
  gameSurface = element;
}

/**
 * Why this panel may no longer withhold a keystroke, or undefined when it may.
 *
 * FOUR INVARIANTS, CHECKED PER KEYSTROKE rather than at mount, because every one
 * of them is about a thing that can change afterwards. A mod holds its shadow
 * root, so it holds `root.host`, so it can detach the container, move it
 * somewhere else, or put the game's own canvas inside it - and a check that ran
 * once at mount would have been true at the only moment it was asked.
 *
 * Returning a REASON rather than a boolean, because the panel is about to be
 * closed for it and the author needs to know which one they tripped.
 */
function panelInvariantFault(panel: LivePanel, index: number): string | undefined {
  if (!panel.container.isConnected) {
    return `its container was removed from the page without close(); the panel is gone`;
  }
  /* THE LAYER IS THE HOST'S. A container that has been moved out of the body is
   * no longer the thing the host mounted, and its position, its stacking and its
   * relationship to the game are all now somebody else's answer. */
  if (panel.container.parentNode !== panel.container.ownerDocument.body) {
    return `its container was moved out of the panel layer, so the game has taken the keyboard back`;
  }
  /* THE DECISIVE ONE. With the game's surface inside the container, every
   * keystroke aimed at the game is on a path that runs through this panel, and
   * the nearest-owner test cannot save the player because the panel IS nearer. */
  if (gameSurface !== undefined && panel.container.contains(gameSurface)) {
    return `its container was made a parent of the game's own display, which would have taken every keystroke`;
  }
  /* ONLY THE TOP PANEL. Otherwise a mod holds focus in a panel underneath a
   * visible one and the player is typing into something they cannot see. */
  if (index !== panels.length - 1) return undefined;
  return undefined;
}

/**
 * The topmost panel, after reaping anything that has stopped being one.
 *
 * FAILS OPEN. Every path out of here that is not "a healthy panel is on top"
 * ends with the keystroke going to the game, which is the safe direction: a
 * suppression path that errs towards suppressing is a game that has stopped
 * responding, and the player has no way to tell that from a crash.
 */
function topPanel(): LivePanel | undefined {
  for (let i = panels.length - 1; i >= 0; i--) {
    const panel = panels[i];
    if (!panel) continue;
    const fault = panelInvariantFault(panel, i);
    if (fault === undefined) return panel;
    /* Closed rather than skipped. A container that broke an invariant is not
     * going to mend, and leaving it in the list would leave the next keystroke
     * asking the same question again. */
    removePanel(panel, "invariant");
  }
  return undefined;
}

/**
 * The panel a keydown belongs to, or undefined when it is the game's.
 *
 * READ OFF THE COMPOSED PATH, not off `event.target`. A shadow root retargets
 * the event as it crosses the boundary, so by the time the window listener sees
 * it, `target` is the host element and the field the player is typing into is
 * not visible from outside - which is exactly what a closed root is for.
 * `composedPath()` still carries the way OUT, and walking it from the innermost
 * node means the NEAREST owner wins, which is what makes the `gameSurface`
 * comparison mean anything at all.
 *
 * MEASURED in the shipping desktop build over CDP, 2026-08-21, because all three
 * of these are browser semantics rather than anything this code decides, and a
 * wrong assumption about any of them would have taken the whole seam with it:
 *
 *  - The path from a keydown inside a CLOSED root reads `[div, container, body,
 *    html, document, window]`, so the container IS on it and this test works.
 *  - The inner field is NOT on it, and `event.target` at window is the shadow
 *    host. That rules out the narrower guard somebody will suggest - "own the key
 *    only when the target is an `<input>`" - because from outside a closed root
 *    there is no way to see whether it is one. Ownership has to be by container,
 *    which is why the ceiling, the top-only rule and the escape hatch carry the
 *    weight they do instead.
 *  - With the door exactly as it ships, a listener on a focused `<input>` never
 *    fires at all: the game's window capture handler calls
 *    `stopImmediatePropagation`, so the event never descends to the field. That
 *    is the whole problem, measured rather than reasoned about, and it is also
 *    the confirmation that this door is genuinely first in line - which is what
 *    the escape hatch's ordering argument rests on.
 */
function panelForEvent(event: KeyboardEvent): LivePanel | undefined {
  const top = topPanel();
  if (!top) return undefined;
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  const nodes: readonly EventTarget[] =
    path.length > 0 ? path : event.target ? [event.target] : [];
  for (const node of nodes) {
    if (gameSurface !== undefined && node === gameSurface) return undefined;
    if (node === top.container) return top;
  }
  return undefined;
}

/**
 * Close the topmost panel on the player's behalf. False when there was nothing
 * to close, so the caller can give the key back rather than swallow it.
 */
export function closeTopModPanel(): boolean {
  const top = topPanel();
  if (!top) return false;
  removePanel(top, "player");
  return true;
}

/**
 * Stop accepting new panels. Called at the START of teardown, before the mods'
 * own `uninstall()` - see this module's header for why the panels themselves
 * stay up until after it.
 */
export function revokeModPanels(): void {
  revoked = true;
}

/** Take every panel down. Returns how many there were. */
export function closeAllModPanels(): number {
  let count = 0;
  while (panels.length > 0) {
    const panel = panels[panels.length - 1];
    if (!panel) break;
    removePanel(panel, "host");
    count++;
  }
  return count;
}

/** Let the layer accept panels again (tests; a real page is torn down once). */
export function resetModPanels(): void {
  closeAllModPanels();
  cooldowns.clear();
  revoked = false;
}

/**
 * Whether a MODAL panel is currently holding the screen.
 *
 * Exported for one caller and a real reason: the game's own prompts are painted
 * on the character grid, which a modal panel is sitting on top of. So a host
 * path that needs to ASK the player something - the debug confirmation is the
 * first - has to know that the question would be posed underneath a mod's
 * interface, where nobody can read it and the keyboard belongs to the panel.
 * Better to refuse with a sentence naming the panel than to deadlock on a prompt
 * the player cannot see.
 */
export function modalModPanelOpen(): boolean {
  const top = topPanel();
  return top !== undefined && top.modal;
}

/** This mod's open panel ids, topmost last. */
function openPanelsFor(modId: string): readonly string[] {
  topPanel(); // reaps anything that has stopped being a panel
  return panels.filter((panel) => panel.modId === modId).map((panel) => panel.id);
}

function removePanel(panel: LivePanel, by: "player" | "host" | "mod" | "invariant"): void {
  const index = panels.indexOf(panel);
  if (index >= 0) panels.splice(index, 1);
  /* THE PAUSE IS ONLY FOR A CLOSE THE PLAYER ASKED FOR. A mod closing its own
   * panel and opening the next one is an ordinary wizard step, and charging it
   * for that would make the seam unusable for the tool it exists for. */
  if (by === "player") {
    cooldowns.set(panel.modId, Date.now() + PLAYER_CLOSE_COOLDOWN_MS);
  }
  try {
    panel.container.remove();
  } catch {
    /* Already gone, or a document that will not have it removed. The entry is
     * out of the list either way, which is the part that decides ownership. */
  }
  /* FOCUS GOES TO THE GAME, never back to whatever the panel had focused. The
   * player pressed the key that means "let me out", and returning focus into a
   * subtree that is being deleted is how that key stops working the second time
   * it is pressed. The canvas carries tabindex="0" (a11y.ts), so this is a real
   * focus target rather than a hopeful one. */
  const surface = gameSurface as HTMLElement | undefined;
  if (surface && typeof surface.focus === "function") {
    try {
      surface.focus();
    } catch {
      /* Focusing is a courtesy; a document that refuses it changes nothing about
       * the panel being gone. */
    }
  }
  /* RESOLVED LAST, after the node is out of the document and out of the list, so
   * a continuation that opens another panel cannot find the old one still on top
   * or still owning the keyboard. */
  panel.finish();
}

/**
 * Why this spec cannot be mounted, or undefined when it can.
 *
 * NAMED AS A FAULT rather than returned as a boolean, the same choice
 * `regionDeclarationFault` makes and for the same reason: "invalid panel" is not
 * something an author can act on, and "the game prefixes your mod id already" is.
 */
export function panelSpecFault(spec: unknown): string | undefined {
  if (typeof spec !== "object" || spec === null) {
    return `openPanel(${String(spec)}) was given something that is not a panel spec`;
  }
  const s = spec as { readonly [K in keyof ModPanelSpec]?: unknown };
  if (typeof s.id !== "string" || s.id.length === 0) {
    return `a panel has no id; give each one a short name of your own ("editor", "preview")`;
  }
  if (s.id.includes(":")) {
    return `panel "${s.id}" has a ":" in its id; the game prefixes your mod id already, so name it "${s.id.replace(/:/gu, "-")}"`;
  }
  if (s.modal !== undefined && typeof s.modal !== "boolean") {
    return `panel "${s.id}" has a modal that is not a boolean`;
  }
  if (s.label !== undefined && typeof s.label !== "string") {
    return `panel "${s.id}" has a label that is not a string`;
  }
  return undefined;
}

/**
 * Build the `ctx.ui` a consenting mod is handed. Scoped by the id it was loaded
 * under, so `openPanels` answers about that mod and a namespaced panel id cannot
 * be spoofed - the same scoping `ctx.assetUrl` and `ctx.prefs` use.
 */
export function createModUi(
  modId: string,
  doc: Document | undefined = globalThis.document,
): ModUi {
  return {
    openPanel: (spec: ModPanelSpec): ModPanel => mountPanel(modId, spec, doc),
    get openPanels(): readonly string[] {
      return openPanelsFor(modId);
    },
  };
}

function mountPanel(
  modId: string,
  spec: ModPanelSpec,
  doc: Document | undefined,
): ModPanel {
  const fault = panelSpecFault(spec);
  /* THROWN, not returned as a dead handle. A handle whose `root` was a detached
   * node would let a mod build its whole interface into nothing and report
   * success, which is the failure mode this seam exists to remove rather than to
   * introduce. Same argument `installRegions` makes for refusing a bad
   * declaration loudly. */
  if (fault !== undefined) throw new Error(fault);
  if (revoked) {
    throw new Error(
      `panel "${spec.id}": the mod set is changing and the page is about to re-compose, so no new panels are ` +
        `accepted; mount it again from register() on the way back up`,
    );
  }
  if (!doc?.body) {
    throw new Error(
      `panel "${spec.id}": this front end has no page to mount a panel on; draw with regions() instead`,
    );
  }
  const until = cooldowns.get(modId) ?? 0;
  if (Date.now() < until) {
    throw new Error(
      `panel "${spec.id}": the player just closed one of this mod's panels, so another cannot open for ` +
        `${PLAYER_CLOSE_COOLDOWN_MS}ms - reopening immediately would take back the key they used to get out`,
    );
  }
  topPanel(); // reap before counting, so a forgotten panel is not holding a slot
  if (panels.length >= MAX_OPEN_PANELS) {
    throw new Error(
      `panel "${spec.id}": ${MAX_OPEN_PANELS} panels are already open, which is the ceiling - ` +
        `Escape closes one at a time and the player has to be able to press their way back to the game`,
    );
  }
  const id = `${modId}:${spec.id}`;
  if (panels.some((panel) => panel.id === id)) {
    throw new Error(
      `panel "${spec.id}" is already open; close it before opening it again, because the live layer is ` +
        `addressed by name and two entries under one name make "which one is on top" ambiguous`,
    );
  }

  const modal = spec.modal === true;
  const container = doc.createElement("div");
  container.dataset["modPanel"] = id;
  /* Inline styles rather than a class, because there is no stylesheet in this
   * application to put a class in - the page is a canvas and one inline <style>
   * block (index.html) - and because the two other DOM overlays the host mounts,
   * the touch action bar and the crash screen, both style themselves this way.
   * Palette-exempt for the same reason crash-screen.ts is: these are DOM
   * overlays, not terminal cells. */
  Object.assign(container.style, {
    position: "fixed",
    inset: "0",
    zIndex: String(PANEL_Z_BASE + panels.length),
    /* A NON-MODAL CONTAINER TAKES NO POINTER EVENTS. It is a full-viewport
     * rectangle, so anything else would be an invisible layer eating every tap
     * meant for the dungeon underneath - which is exactly what the game's own
     * touch action bar avoids the same way, `none` on the bar and `auto` on each
     * button. The mod styles `pointer-events: auto` onto what it wants clicked. */
    pointerEvents: modal ? "auto" : "none",
    /* Set by the host so a panel behaves the same in every mod: taps act, and
     * the browser does not hold one back to see whether it starts a zoom. */
    touchAction: "manipulation",
  } satisfies Partial<CSSStyleDeclaration>);
  container.setAttribute("role", modal ? "dialog" : "group");
  if (modal) container.setAttribute("aria-modal", "true");
  /* The live id is a poor label and a present one. A panel is the first thing in
   * this game assistive technology can read at all, everything else being pixels
   * on a canvas, so an unlabelled region costs more here than it would in an
   * ordinary page. */
  container.setAttribute("aria-label", spec.label ?? id);
  container.tabIndex = -1;

  /* TWO ELEMENTS, and the split is what lets the host draw a close control the
   * mod's stylesheet cannot restyle and its markup cannot cover: `mount` carries
   * the shadow root and everything the mod builds, and the button is the
   * container's own child beside it. A single element would have had to put the
   * button INSIDE the shadow root, where the mod's first `replaceChildren` would
   * have deleted the player's way out. */
  const mount = doc.createElement("div");
  Object.assign(mount.style, {
    position: "absolute",
    inset: "0",
  } satisfies Partial<CSSStyleDeclaration>);
  /* CLOSED. The mod holds the root it is handed; nobody else can pick a panel's
   * contents out of `element.shadowRoot` and read what is being typed into
   * somebody else's form. A small real difference, and not a boundary - see the
   * header. */
  const root = mount.attachShadow({ mode: "closed" });
  container.appendChild(mount);

  let open = true;
  let settle: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const live: LivePanel = {
    modId,
    id,
    container,
    modal,
    finish: () => {
      if (!open) return;
      open = false;
      settle();
    },
  };

  /* THE HOST'S CLOSE CONTROL, on a modal panel only, and it is not decoration.
   * Escape is the answer on a keyboard and there is no Escape key on a phone -
   * and this game ships a touch action bar precisely because it is played on
   * one. A modal panel with no way out but a key that does not exist is a
   * player who has to reload the page. */
  if (modal) {
    const close = doc.createElement("button");
    close.type = "button";
    close.textContent = "Close  (Esc)";
    close.setAttribute("aria-label", `Close ${spec.label ?? id}`);
    Object.assign(close.style, {
      position: "absolute",
      top: "max(8px, env(safe-area-inset-top))",
      right: "max(8px, env(safe-area-inset-right))",
      zIndex: "1",
      font: "13px ui-monospace, monospace",
      padding: "6px 10px",
      color: CLOSE_INK, // palette-exempt: see the constants
      background: CLOSE_FILL, // palette-exempt
      border: `1px solid ${CLOSE_EDGE}`, // palette-exempt
      borderRadius: "4px",
      cursor: "pointer",
      pointerEvents: "auto",
    } satisfies Partial<CSSStyleDeclaration>);
    close.addEventListener("click", () => {
      /* Counted as the PLAYER closing it, because it is: same cooldown as
       * Escape, for the same reason. */
      removePanel(live, "player");
    });
    container.appendChild(close);
  }

  doc.body.appendChild(container);
  panels.push(live);

  /* A MODAL PANEL IS FOCUSED ON MOUNT, a non-modal one is not, and that single
   * line is what makes `modal` mean something for the keyboard as well as for
   * the pointer. Focus is what decides whose keystroke it is, so focusing the
   * CONTAINER is how a panel that means to be typed into starts being able to
   * be - and deliberately not a field of the mod's, because a virtual keyboard
   * springing up on a phone the moment a panel opens is its own kind of rude. */
  if (modal) {
    try {
      container.focus();
    } catch {
      /* A document that will not focus is a document that will not, and the
       * panel is mounted either way. */
    }
  }

  return {
    id,
    root,
    get open(): boolean {
      return open;
    },
    closed,
    close: (): void => {
      if (!open) return; // idempotent, per the ABI
      removePanel(live, "mod");
    },
  };
}

/**
 * The input door's view of the panel layer.
 *
 * ESCAPE IS ASKED FIRST AND SEPARATELY FROM OWNERSHIP, which is the difference
 * between a promise and a promise that holds. If the hatch only worked on a
 * keystroke the panel already owned, then focus drifting to the canvas or to the
 * body - which one stray click does - would take the way out away at exactly the
 * moment the player reached for it.
 *
 * Three conditions on it, each of them a way the key would otherwise be worth
 * less than it looks:
 *
 *  - `isTrusted`. A mod can synthesise a `KeyboardEvent` and dispatch it, and a
 *    host-global action driven by a mod-authored event is the mod pressing the
 *    player's key. The real keyboard is the only thing that closes a panel.
 *  - not `repeat`. A held Escape would otherwise close the whole stack and then
 *    leak the rest of the presses into the game, so leaving a panel would also
 *    dismiss whatever prompt was underneath it.
 *  - not `isComposing`. Mid-composition, Escape means "cancel what I am typing"
 *    to every IME there is, and taking it to close the panel would make text
 *    entry in another script strictly worse than in English. The first Escape is
 *    the composition's, the next one is the panel's.
 *
 * And the ownership half is narrower than the hatch on purpose: only a MODAL
 * panel takes an unowned Escape. A decorative panel beside the map has not asked
 * for the screen, so Escape there is still the game's, the way it is when no mod
 * is loaded at all.
 */
export const panelKeyboardOwner: DomKeyboardOwner = {
  owns: (event: KeyboardEvent): boolean => panelForEvent(event) !== undefined,
  escape: (event: KeyboardEvent): boolean => {
    if (!event.isTrusted || event.repeat || event.isComposing) return false;
    const top = topPanel();
    if (!top) return false;
    if (!top.modal && panelForEvent(event) === undefined) return false;
    return closeTopModPanel();
  },
};

/** Hand the input door the panel layer. Called once, from the boot path. */
export function installPanelKeyboardOwner(): void {
  setDomKeyboardOwner(panelKeyboardOwner);
}
