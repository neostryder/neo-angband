/**
 * The front end's single input door.
 *
 * Browser keyboard events, queued keymap output, and future controller/touch
 * adapters enter here.  Screens still use KeyboardEvent-compatible callbacks
 * during the Phase-2 migration, but there is only one DOM registration and the
 * value crossing the door is a device-neutral UiInput.
 */

export type AngbandDirection = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface UiModifiers {
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
}

export interface UiKey {
  readonly key: string;
  readonly modifiers: UiModifiers;
  readonly repeat: boolean;
}

/** Screen coordinates: +x right, +y down; angle is clockwise from +x. */
export interface UiDirection {
  readonly x: number;
  readonly y: number;
  readonly magnitude: number;
  readonly angleRadians: number;
  /** Present only when this is an unambiguous Angband keypad direction. */
  readonly discrete?: AngbandDirection;
}

export interface UiInput {
  readonly sequence: number;
  readonly timestamp: number;
  readonly key?: UiKey;
  readonly direction?: UiDirection;
}

export type UiInputDraft = Omit<UiInput, "sequence" | "timestamp">;

export type UiInputEvent = KeyboardEvent & { readonly uiInput: UiInput };

type KeydownListener = (event: UiInputEvent) => void;
type Entry = { readonly listener: KeydownListener; readonly capture: boolean };
type AuxiliaryInputType = "paste" | "compositionstart" | "compositionend";
type AuxiliaryListener = (event: Event) => void;
type AuxiliaryEntry = {
  readonly type: AuxiliaryInputType;
  readonly listener: AuxiliaryListener;
  readonly capture: boolean;
};
type KeymapResolver = (input: UiInput) => readonly UiInputDraft[] | null;
type KeyTarget = Pick<Window, "addEventListener" | "removeEventListener">;

/** Host-owned conditions that make a player keymap ineligible for this input. */
export interface KeymapResolverOptions {
  /**
   * The root game screen is not always the input owner: a modal, score page,
   * or run-interrupt loop must see the literal key before a keymap can expand
   * it. This predicate preserves that ownership boundary.
   */
  readonly enabled?: () => boolean;
  /** Called for the literal trigger immediately before its expansion is queued. */
  readonly onExpanded?: (input: UiInput) => void;
}

/**
 * A host-owned piece of REAL DOM that a keystroke may belong to instead of the
 * game.
 *
 * WHY THIS HOOK IS HERE AND NOT ANYWHERE ELSE. `browserKeydown` below is the
 * only DOM keyboard registration in the package: one listener, on `window`, in
 * the capture phase, installed when this module is imported. Every screen in the
 * game reaches the keyboard through it, and every modal handler on the far side
 * of it opens with `preventDefault()` and `stopImmediatePropagation()`. So a
 * real `<input>` anywhere on the page is unusable by construction - with a modal
 * open the keystrokes drive the modal, and with none open they are read as game
 * commands, which means typing a name walks the character across the level.
 *
 * That is the whole of the problem and this is the whole of the fix. One guard,
 * at the one door, asked before anything is dispatched.
 *
 * ESCAPE IS PART OF THE CONTRACT, not a courtesy. The owner is asked to handle
 * it, and the ordering is what makes the answer worth something: this listener
 * is on `window` at capture, registered at import time, which is before any mod
 * code exists and above every node a mod can attach a handler to. So a panel
 * that has stopped responding cannot also have taken away the key that closes
 * it. Note the honest limit - this defends the player against a mod that is
 * BROKEN, not against one that is hostile. In-process code can reach `window`
 * itself, and nothing here changes that.
 */
export interface DomKeyboardOwner {
  /** True when this keydown belongs to mounted DOM rather than to the game. */
  owns(event: KeyboardEvent): boolean;
  /**
   * The player's one way out. True when the key was consumed.
   *
   * Asked BEFORE `owns`, and about every Escape rather than only the ones the
   * owner would have claimed. If the hatch worked only on a key the mounted DOM
   * already owned, then focus drifting back to the game - which one stray click
   * does - would take the way out away at exactly the moment it was needed.
   */
  escape(event: KeyboardEvent): boolean;
}

let domKeyboardOwner: DomKeyboardOwner | undefined;

/**
 * Install (or clear, with `undefined`) the DOM keyboard owner. One at a time:
 * there is one page, and an owner that had to be consulted in an order would be
 * a second place for "who has the keyboard" to be decided.
 */
export function setDomKeyboardOwner(owner: DomKeyboardOwner | undefined): void {
  domKeyboardOwner = owner;
}

const entries: Entry[] = [];
const auxiliaryEntries: AuxiliaryEntry[] = [];
let nextSequence = 1;
let keymapResolver: KeymapResolver | undefined;
let keymapResolverOptions: KeymapResolverOptions | undefined;
let browserWindow: KeyTarget | undefined;

function directionForKey(key: string): UiDirection | undefined {
  const directions: Record<string, readonly [number, number, AngbandDirection]> = {
    ArrowLeft: [-1, 0, 4], ArrowRight: [1, 0, 6], ArrowUp: [0, -1, 8], ArrowDown: [0, 1, 2],
    "1": [-Math.SQRT1_2, Math.SQRT1_2, 1], "2": [0, 1, 2], "3": [Math.SQRT1_2, Math.SQRT1_2, 3],
    "4": [-1, 0, 4], "6": [1, 0, 6], "7": [-Math.SQRT1_2, -Math.SQRT1_2, 7],
    "8": [0, -1, 8], "9": [Math.SQRT1_2, -Math.SQRT1_2, 9],
  };
  const value = directions[key];
  if (!value) return undefined;
  const [x, y, discrete] = value;
  return { x, y, magnitude: 1, angleRadians: Math.atan2(y, x) < 0 ? Math.atan2(y, x) + 2 * Math.PI : Math.atan2(y, x), discrete };
}

function stamp(draft: UiInputDraft): UiInput {
  return {
    ...draft,
    sequence: nextSequence++,
    timestamp: typeof performance === "undefined" ? Date.now() : performance.now(),
  };
}

function fromKeyboard(event: KeyboardEvent): UiInputDraft {
  const direction = directionForKey(event.key);
  return {
    key: { key: event.key, modifiers: { ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey }, repeat: event.repeat },
    ...(direction ? { direction } : {}),
  };
}

function compatEvent(input: UiInput, original?: KeyboardEvent): UiInputEvent {
  if (original) {
    Object.defineProperty(original, "uiInput", { configurable: true, value: input });
    return original as UiInputEvent;
  }
  const key = input.key;
  const event = new Event("keydown", { cancelable: true }) as KeyboardEvent;
  Object.assign(event as object, {
    key: key?.key ?? "", ctrlKey: key?.modifiers.ctrl ?? false, shiftKey: key?.modifiers.shift ?? false,
    altKey: key?.modifiers.alt ?? false, metaKey: key?.modifiers.meta ?? false, repeat: key?.repeat ?? false,
    uiInput: input,
  });
  return event as UiInputEvent;
}

function deliver(input: UiInput, original?: KeyboardEvent): void {
  const event = compatEvent(input, original);
  let stopped = false;
  const proxy = new Proxy(event, {
    get(target, prop) {
      if (prop === "stopImmediatePropagation") return () => { stopped = true; target.stopImmediatePropagation(); };
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as UiInputEvent;
  for (const capture of [true, false]) {
    for (const entry of [...entries]) {
      // Match EventTarget: an entry removed by an earlier listener is not
      // invoked, and an entry added while dispatching waits for the next input.
      if (entry.capture === capture && entries.includes(entry)) entry.listener(proxy);
      if (stopped) return;
    }
  }
}

function deliverAuxiliary(type: AuxiliaryInputType, event: Event): void {
  let stopped = false;
  const proxy = new Proxy(event, {
    get(target, prop) {
      if (prop === "stopImmediatePropagation") {
        return () => {
          stopped = true;
          target.stopImmediatePropagation();
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  for (const capture of [true, false]) {
    for (const entry of [...auxiliaryEntries]) {
      if (entry.type === type && entry.capture === capture && auxiliaryEntries.includes(entry)) {
        entry.listener(proxy);
      }
      if (stopped) return;
    }
  }
}

/** Register a legacy screen callback with the one dispatcher, never window. */
export function onKeydown(listener: KeydownListener, capture = false): void {
  // EventTarget ignores a duplicate listener with the same capture flag.
  if (entries.some((entry) => entry.listener === listener && entry.capture === capture)) return;
  entries.push({ listener, capture });
}

/** Remove a legacy screen callback from the dispatcher. */
export function offKeydown(listener: KeydownListener, capture = false): void {
  const index = entries.findIndex((entry) => entry.listener === listener && entry.capture === capture);
  if (index >= 0) entries.splice(index, 1);
}

function onAuxiliary(
  type: AuxiliaryInputType,
  listener: AuxiliaryListener,
  capture = false,
): void {
  if (auxiliaryEntries.some((entry) => entry.type === type && entry.listener === listener && entry.capture === capture)) return;
  auxiliaryEntries.push({ type, listener, capture });
}

function offAuxiliary(
  type: AuxiliaryInputType,
  listener: AuxiliaryListener,
  capture = false,
): void {
  const index = auxiliaryEntries.findIndex(
    (entry) => entry.type === type && entry.listener === listener && entry.capture === capture,
  );
  if (index >= 0) auxiliaryEntries.splice(index, 1);
}

function installBrowserAdapter(target: KeyTarget): void {
  if (browserWindow === target) return;
  if (browserWindow) {
    browserWindow.removeEventListener("keydown", browserKeydown, true);
    browserWindow.removeEventListener("paste", browserPaste, true);
    browserWindow.removeEventListener("compositionstart", browserCompositionStart, true);
    browserWindow.removeEventListener("compositionend", browserCompositionEnd, true);
    // A different global window is a different document/session (this is also
    // how the lightweight UI tests isolate their fake browser). No screen from
    // the old document may receive input in the new one.
    entries.length = 0;
    auxiliaryEntries.length = 0;
    clearQueuedUiInputs();
  }
  target.addEventListener("keydown", browserKeydown, true);
  target.addEventListener("paste", browserPaste, true);
  target.addEventListener("compositionstart", browserCompositionStart, true);
  target.addEventListener("compositionend", browserCompositionEnd, true);
  browserWindow = target;
}

function browserKeydown(event: Event): void {
  const key = event as KeyboardEvent;
  const owner = domKeyboardOwner;
  if (owner) {
    /* ESCAPE FIRST, and asked whether or not the mounted DOM would have claimed
     * this key. `preventDefault` only when it was actually consumed: an owner
     * with nothing to close gives the key back rather than swallowing it, so the
     * browser's own meaning of Escape is not quietly taken by DOM that is no
     * longer there. */
    if (key.key === "Escape" && owner.escape(key)) {
      key.preventDefault();
      return;
    }
    if (owner.owns(key)) {
      /* Not dispatched, and not cancelled either. The event carries on to the
       * element the player is typing into, which is the entire point - the game
       * standing down is what lets a real field behave like a real field. */
      return;
    }
  }
  dispatchUiInput(fromKeyboard(key), key);
}

function browserPaste(event: Event): void {
  deliverAuxiliary("paste", event);
}

function browserCompositionStart(event: Event): void {
  deliverAuxiliary("compositionstart", event);
}

function browserCompositionEnd(event: Event): void {
  deliverAuxiliary("compositionend", event);
}

function addInputEventListener(type: "keydown", listener: KeydownListener, capture?: boolean): void;
function addInputEventListener(type: "paste", listener: (event: ClipboardEvent) => void, capture?: boolean): void;
function addInputEventListener(
  type: "compositionstart" | "compositionend",
  listener: (event: CompositionEvent) => void,
  capture?: boolean,
): void;
function addInputEventListener(type: string, listener: (event: never) => void, capture?: boolean): void {
  if (typeof listener !== "function") throw new Error(`input door does not handle ${type}`);
  // Unit tests install a tiny fake window after modules load. Install the
  // door there too; never attach this screen callback directly to it.
  if (typeof window !== "undefined") installBrowserAdapter(window);
  if (type === "keydown") {
    onKeydown(listener as KeydownListener, capture);
    return;
  }
  if (type === "paste" || type === "compositionstart" || type === "compositionend") {
    onAuxiliary(type, listener as AuxiliaryListener, capture);
    return;
  }
  throw new Error(`input door does not handle ${type}`);
}

function removeInputEventListener(type: "keydown", listener: KeydownListener, capture?: boolean): void;
function removeInputEventListener(type: "paste", listener: (event: ClipboardEvent) => void, capture?: boolean): void;
function removeInputEventListener(
  type: "compositionstart" | "compositionend",
  listener: (event: CompositionEvent) => void,
  capture?: boolean,
): void;
function removeInputEventListener(type: string, listener: (event: never) => void, capture?: boolean): void {
  if (type === "keydown") {
    offKeydown(listener as KeydownListener, capture);
  } else if (type === "paste" || type === "compositionstart" || type === "compositionend") {
    offAuxiliary(type, listener as AuxiliaryListener, capture);
  }
}

/** Compatibility facade used while individual screens still have onKey handlers. */
export const inputEvents = {
  addEventListener: addInputEventListener,
  removeEventListener: removeInputEventListener,
};

/** Player keymaps are resolved before registered (including mod) input consumers. */
export function setKeymapResolver(
  resolver: KeymapResolver | undefined,
  options?: KeymapResolverOptions,
): void {
  keymapResolver = resolver;
  keymapResolverOptions = options;
}

/** Route a semantic input sample through the same door as browser input. */
export function dispatchUiInput(draft: UiInputDraft, original?: KeyboardEvent, bypassKeymap = false): void {
  const input = stamp(draft);
  const expansion = !bypassKeymap && (keymapResolverOptions?.enabled?.() ?? true)
    ? keymapResolver?.(input)
    : null;
  if (expansion) {
    // The old root handler logged a keymap's trigger before it returned to
    // queue the expansion. The root no longer sees this input, so preserve
    // that observable ordering at the door.
    keymapResolverOptions?.onExpanded?.(input);
    original?.preventDefault();
    enqueueUiInputs(expansion);
    return;
  }
  deliver(input, original);
}

const queue: UiInputDraft[] = [];
let pumping = false;

/** Preserve upstream keymap timing: one queued semantic input per macrotask. */
export function enqueueUiInputs(inputs: readonly UiInputDraft[]): void {
  if (inputs.length === 0) return;
  queue.push(...inputs);
  if (pumping) return;
  pumping = true;
  setTimeout(function pump() {
    const input = queue.shift();
    if (input) dispatchUiInput(input, undefined, true);
    if (queue.length > 0) setTimeout(pump, 0);
    else pumping = false;
  }, 0);
}

/** Drop pending generated input without disturbing active screen subscriptions. */
export function clearQueuedUiInputs(): void {
  queue.length = 0;
  pumping = false;
}

/** Test hook: remove registrations and queued input between isolated tests. */
export function clearInputDoor(): void {
  entries.length = 0;
  auxiliaryEntries.length = 0;
  clearQueuedUiInputs();
  keymapResolver = undefined;
  keymapResolverOptions = undefined;
  domKeyboardOwner = undefined;
  nextSequence = 1;
  if (browserWindow) {
    browserWindow.removeEventListener("keydown", browserKeydown, true);
    browserWindow.removeEventListener("paste", browserPaste, true);
    browserWindow.removeEventListener("compositionstart", browserCompositionStart, true);
    browserWindow.removeEventListener("compositionend", browserCompositionEnd, true);
  }
  browserWindow = undefined;
}

if (typeof window !== "undefined") {
  installBrowserAdapter(window);
}
