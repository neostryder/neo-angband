/** Device-neutral, lifetime-scoped answers to the shell's current question. */
import { clearQueuedUiInputs, dispatchUiInput, type AngbandDirection } from "./input-door";

/**
 * What an action MEANS, for an adapter that cannot read its label.
 *
 * A touchscreen renders every reply as a labelled button and the player reads
 * which one is Cancel. A controller has no such luxury: it has to know which
 * reply the Cancel button answers and which reply a stick pushed north-east
 * answers, before it can draw anything at all. Both facts were previously
 * recoverable only by parsing the action's id back into the key it wraps, which
 * is a second definition of the same thing and one that goes stale silently.
 * They are declared here instead: derived by the helper where the key already
 * settles the answer, and stated by the caller where it does not. `t` accepts a
 * target in the target loop and takes off a ring at the game screen, so no
 * amount of looking at the key alone can tell an adapter which one it is.
 */
export type ControlRole = "cancel" | "accept" | "next" | "previous";

export interface ControlAction {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean | undefined;
  readonly selected?: boolean;
  readonly role?: ControlRole;
  /** The keypad direction this action answers, where it answers one. */
  readonly direction?: AngbandDirection;
  readonly run: () => void;
}

export interface ControlContext {
  readonly kind: "menu" | "item" | "direction" | "target" | "text" | "check" | "key";
  readonly label: string;
  readonly detail?: string | undefined;
  readonly rows?: readonly ControlAction[];
  readonly replies?: readonly ControlAction[];
  readonly text?: {
    readonly value: string;
    readonly maxLength: number;
    readonly submit: (value: string) => void;
  };
}

export interface ControlCommand extends ControlAction {
  readonly category: string;
  /**
   * The command's key in the ORIGINAL keyset, where it has one.
   *
   * A stable name for the command rather than an instruction to press it. A
   * saved controller binding needs to survive the roguelike-keyset option being
   * turned on, and the row's own ordinal is an upstream table position that
   * says nothing to a player reading a mapping screen.
   */
  readonly key?: string;
}

/**
 * The stable NAME of a command, for anything that has to refer to one later.
 *
 * A saved controller binding, a wheel group's membership list and a mapping
 * screen's row all name a command rather than pressing a key, so the name has
 * to survive the roguelike-keyset option being turned on and has to exist for
 * every command. `key` covers most of them and is preferred because it is the
 * shortest thing that is stable. It is UNDEFINED for two kinds of row: the
 * eleven root commands that live outside the cached keypress registry, and the
 * one table row whose only key belongs to the roguelike keyset (Center map,
 * `o: null, r: "@"`). Those fall back to the command's own label.
 *
 * The two cannot collide. A key is one character or a caret pair; a label is
 * words. So `cmd:g` and `cmd:Center map` name different commands and always
 * will, and a row with no original-keyset key is bindable rather than filtered
 * off the mapping screen for lacking a name.
 */
export function commandName(command: { readonly key?: string; readonly label: string }): string {
  return command.key ?? command.label;
}

export interface ControlSnapshot {
  readonly token: number;
  readonly context: ControlContext;
}

export class ControlSurface {
  private stack: Array<{ snapshot: ControlSnapshot }> = [];
  private listeners = new Set<() => void>();
  private serial = 0;
  private commandsReady = false;
  private commandSource?: { available: () => boolean; list: () => readonly ControlCommand[] };

  setCommands(available: () => boolean, list: () => readonly ControlCommand[]): void {
    this.commandSource = { available, list };
    this.refreshCommands();
  }

  refreshCommands(): void {
    const ready = this.canCommand();
    if (ready === this.commandsReady) return;
    this.commandsReady = ready;
    this.changed();
  }

  canCommand(): boolean {
    return !this.current() && (this.commandSource?.available() ?? false);
  }

  commands(): readonly ControlCommand[] {
    return this.commandSource?.list() ?? [];
  }

  invokeCommand(id: string): boolean {
    if (!this.canCommand()) return false;
    const command = this.commands().find((candidate) => candidate.id === id);
    if (!command || command.disabled) return false;
    command.run();
    return true;
  }

  current(): ControlSnapshot | undefined {
    return this.stack.at(-1)?.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  push(context: ControlContext): { update: (next: ControlContext) => void; dispose: () => void } {
    const entry = { snapshot: { token: ++this.serial, context } };
    this.stack.push(entry);
    this.changed();
    return {
      update: (next) => {
        if (!this.stack.includes(entry)) return;
        entry.snapshot = { token: ++this.serial, context: next };
        this.changed();
      },
      dispose: () => {
        const index = this.stack.indexOf(entry);
        if (index < 0) return;
        this.stack.splice(index, 1);
        // Restoring a parent is a new question lifetime for an input adapter.
        const parent = this.stack.at(-1);
        if (parent) parent.snapshot = { ...parent.snapshot, token: ++this.serial };
        this.changed();
      },
    };
  }

  invoke(token: number, id: string): boolean {
    const current = this.current();
    if (current?.token !== token) return false;
    const action = [...current.context.rows ?? [], ...current.context.replies ?? []]
      .find((candidate) => candidate.id === id);
    if (!action || action.disabled) return false;
    action.run();
    return true;
  }

  submit(token: number, value: string): boolean {
    const current = this.current();
    if (current?.token !== token || !current.context.text) return false;
    current.context.text.submit(value.slice(0, current.context.text.maxLength));
    return true;
  }
}

export const controlSurface = new ControlSurface();

/** One literal reply, never a player macro or a speculative reply sequence. */
export function controlKey(key: string, ctrl = false): void {
  dispatchUiInput({ key: {
    key, modifiers: { ctrl, shift: key.length === 1 && key !== key.toLowerCase(), alt: false, meta: false },
    repeat: false,
  } }, undefined, true);
}

export function keyAction(label: string, key: string, ctrl = false, role?: ControlRole): ControlAction {
  // A direction and a cancel are derived rather than passed in: the key IS the
  // meaning for those two, so a caller that had to restate it could restate it
  // wrongly. Anything else has to be said.
  const direction = !ctrl && /^[1-9]$/.test(key) ? (Number(key) as AngbandDirection) : undefined;
  const settled: ControlRole | undefined = role ?? (!ctrl && key === "Escape" ? "cancel" : undefined);
  return {
    id: `${ctrl ? "ctrl:" : "key:"}${key}`, label,
    ...(direction ? { direction } : {}), ...(settled ? { role: settled } : {}),
    run: () => controlKey(key, ctrl),
  };
}

export const cancelAction = (): ControlAction => keyAction("Cancel", "Escape");

export function directionActions(): ControlAction[] {
  return [["NW", "7"], ["N", "8"], ["NE", "9"], ["W", "4"],
    ["E", "6"], ["SW", "1"], ["S", "2"], ["SE", "3"]]
    .map(([label, key]) => keyAction(label!, key!));
}

/** The interrupt route consumes Escape in the active run/rest owner. */
export function stopControlInput(): void {
  clearQueuedUiInputs();
  controlKey("Escape");
}
