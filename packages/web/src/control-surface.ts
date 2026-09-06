/** Device-neutral, lifetime-scoped answers to the shell's current question. */
import { clearQueuedUiInputs, dispatchUiInput } from "./input-door";

export interface ControlAction {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean | undefined;
  readonly selected?: boolean;
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

export function keyAction(label: string, key: string, ctrl = false): ControlAction {
  return { id: `${ctrl ? "ctrl:" : "key:"}${key}`, label, run: () => controlKey(key, ctrl) };
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
