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

const entries: Entry[] = [];
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

function installBrowserAdapter(target: KeyTarget): void {
  if (browserWindow === target) return;
  if (browserWindow) {
    browserWindow.removeEventListener("keydown", browserKeydown, true);
    // A different global window is a different document/session (this is also
    // how the lightweight UI tests isolate their fake browser). No screen from
    // the old document may receive input in the new one.
    entries.length = 0;
    clearQueuedUiInputs();
  }
  target.addEventListener("keydown", browserKeydown, true);
  browserWindow = target;
}

function browserKeydown(event: Event): void {
  dispatchUiInput(fromKeyboard(event as KeyboardEvent), event as KeyboardEvent);
}

/** Compatibility facade used while individual screens still have onKey handlers. */
export const inputEvents = {
  addEventListener(type: string, listener: KeydownListener, capture?: boolean): void {
    if (type !== "keydown" || typeof listener !== "function") throw new Error(`input door does not handle ${type}`);
    // Unit tests install a tiny fake window after modules load. Install the
    // door there too; never attach this screen callback directly to it.
    if (typeof window !== "undefined") installBrowserAdapter(window);
    onKeydown(listener as KeydownListener, capture);
  },
  removeEventListener(type: string, listener: KeydownListener, capture?: boolean): void {
    if (type === "keydown") offKeydown(listener, capture);
  },
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
  clearQueuedUiInputs();
  keymapResolver = undefined;
  keymapResolverOptions = undefined;
  nextSequence = 1;
  if (browserWindow) browserWindow.removeEventListener("keydown", browserKeydown, true);
  browserWindow = undefined;
}

if (typeof window !== "undefined") {
  installBrowserAdapter(window);
}
