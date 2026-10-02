/**
 * The rules for a key pressed while a mod's autoplayer drives
 * (neostryder/neo-angband#334).
 *
 * Escape and Ctrl-Z are fixed here rather than left to the mod, so a mod stuck
 * answering keep cannot trap the player. Bare modifiers are ignored because
 * Alt-Tab and the Windows key start with one, and switching windows should
 * leave an unattended run going. The module is pure so the rules can be tested
 * without the shell.
 */
import type { ControllerKeyAnswer, ControllerKeyPress } from "./mod-plugin";

/**
 * Keys that change other keys, toggle a lock or an input mode, or belong to an
 * input method composing a character; never a command on their own.
 */
const BARE_KEYS: ReadonlySet<string> = new Set([
  "Shift", "Control", "Alt", "AltGraph", "Meta", "OS", "Super", "Hyper", "Fn", "FnLock",
  "CapsLock", "NumLock", "ScrollLock", "Symbol", "SymbolLock",
  "Dead", "Process", "Unidentified", "Compose", "HangulMode", "HanjaMode", "KanaMode",
  "KanjiMode", "Hiragana", "Katakana", "HiraganaKatakana", "Zenkaku", "Hankaku", "ZenkakuHankaku",
  "Eisu", "Alphanumeric", "Convert", "NonConvert", "ModeChange",
]);

/** Window switching and the system's own shortcuts: Alt-Tab, and anything held with the Windows key. */
function isSystemShortcut(press: ControllerKeyPress): boolean {
  return press.meta || (press.alt && press.key === "Tab");
}

export type AutoplayerKeyOutcome = {
  /** Nothing happens; the key is not the game's either. */
  readonly kind: "ignore";
} | {
  readonly kind: "keep";
  readonly message?: string;
} | {
  readonly kind: "release";
  /** For the log: what gave the keyboard back. */
  readonly source: string;
  /** Shown in place of the usual line, when the mod gave one. */
  readonly reason?: string;
  /** Set when the mod's handler failed; the host reports it as a fault. */
  readonly fault?: string;
};

export function keyPressOf(event: KeyboardEvent): ControllerKeyPress {
  return {
    key: event.key,
    ctrl: event.ctrlKey === true,
    alt: event.altKey === true,
    shift: event.shiftKey === true,
    meta: event.metaKey === true,
    repeat: event.repeat === true,
  };
}

/** "Ctrl-Z", "Escape", "a": the key as the log names it. */
export function describeKeyPress(press: ControllerKeyPress): string {
  const name = press.key === " " ? "Space" : press.key;
  return [press.ctrl ? "Ctrl" : "", press.alt ? "Alt" : "", press.shift ? "Shift" : "", press.meta ? "Meta" : "", name]
    .filter((part) => part !== "").join("-");
}

function isAnswer(value: unknown): value is ControllerKeyAnswer {
  if (typeof value !== "object" || value === null) return false;
  const answer = value as { kind?: unknown; message?: unknown; reason?: unknown };
  if (answer.kind === "keep") return answer.message === undefined || typeof answer.message === "string";
  if (answer.kind === "release") return answer.reason === undefined || typeof answer.reason === "string";
  return false;
}

export function decideAutoplayerKey(
  press: ControllerKeyPress,
  onKey: ((press: ControllerKeyPress) => ControllerKeyAnswer) | undefined,
  composing = false,
): AutoplayerKeyOutcome {
  if (composing || BARE_KEYS.has(press.key) || isSystemShortcut(press)) return { kind: "ignore" };
  const source = `key ${describeKeyPress(press)}`;
  const ctrlZ = press.ctrl && !press.alt && !press.meta && press.key.toLowerCase() === "z";
  if (press.key === "Escape" || ctrlZ || onKey === undefined) return { kind: "release", source };
  let answer: unknown;
  try {
    answer = onKey(press);
  } catch (err) {
    return { kind: "release", source, fault: `its key handler failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!isAnswer(answer)) {
    return { kind: "release", source, fault: "its key handler gave an answer that is neither keep nor release" };
  }
  if (answer.kind === "keep") return answer.message === undefined ? { kind: "keep" } : { kind: "keep", message: answer.message };
  return {
    kind: "release",
    source: `${source}, released by the mod`,
    ...(answer.reason !== undefined ? { reason: answer.reason } : {}),
  };
}
