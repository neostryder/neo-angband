/**
 * The controller adapter: pad samples in, the shell's own answers out.
 *
 * This module never decides what a command does. It decides which of the
 * questions already on the control surface a button or a stick is answering,
 * and then submits the answer the surface already offers. That is the whole
 * boundary, and it is why a controller does not need a second copy of the
 * command table, the item picker or the target loop.
 *
 * Everything here is driven by an explicit `poll(pads, now)`. Nothing reads the
 * clock or `navigator` on its own, so the repeat timing, the edge detection and
 * the routing are all testable against synthesised pads, which matters because
 * a browser will not report a real one until somebody physically presses a
 * button on it.
 */
import type { AngbandDirection } from "./input-door";
import type { ControlAction, ControlSurface } from "./control-surface";
import { commandName, controlKey, stopControlInput } from "./control-surface";
import { describeCapabilities, padSignature, readPads, type PadCapabilities, type PadSnapshot } from "./gamepad-device";
import { loadBindings, roleOf, type BindingTarget, type GamepadBindings, type GamepadRole } from "./gamepad-bindings";
import {
  DEFAULT_REPEAT, IDLE_HOLD, resolveDirection, resolveHatAxis, stepHold,
  type HoldState, type RepeatOptions,
} from "./gamepad-analog";
import { STANDARD_AXIS, STANDARD_BUTTON } from "./gamepad-device";

/**
 * The controller's own surfaces, which are not the game's and not touch's.
 *
 * The command wheel and the mapping screen are the two things a pad needs that
 * a touchscreen does not, so they are the controller layer's own and the
 * adapter knows them only as "an overlay is open, route to it". Which one is
 * open is the presentation layer's business.
 */
export interface GamepadHost {
  /** True while a controller overlay owns direction, confirm and cancel. */
  overlayOpen(): boolean;
  overlayMove(direction: AngbandDirection): void;
  overlayConfirm(): void;
  overlayCancel(): void;
  overlayPage(delta: number): void;
  toggleWheel(): void;
  /** The legend, which doubles as the mapping screen. */
  toggleLegend(): void;
  /** Interrupt a run, a rest or an autoplayer the way the shell does. */
  stop(): void;
  /** A pad appeared, went away, or had its layout changed. */
  padsChanged(pads: readonly ConnectedPad[]): void;
}

export interface ConnectedPad {
  readonly index: number;
  readonly id: string;
  readonly capabilities: PadCapabilities;
  readonly signature: string;
  bindings: GamepadBindings;
}

interface PadState {
  readonly pad: ConnectedPad;
  pressed: boolean[];
  left: HoldState;
  right: HoldState;
  /** Direction currently held, before the repeat clock is consulted. */
  leftHeld: AngbandDirection | undefined;
  rightHeld: AngbandDirection | undefined;
  layerHeld: boolean;
}

/** Arrow keys, for the contexts where a direction means "move the cursor". */
const ARROW: Partial<Record<AngbandDirection, string>> = {
  8: "ArrowUp", 2: "ArrowDown", 4: "ArrowLeft", 6: "ArrowRight",
};

function dpadVector(pad: PadSnapshot): { x: number; y: number } | undefined {
  if (pad.buttons.length <= STANDARD_BUTTON.dpadRight) return undefined;
  const down = (index: number): number => (pad.buttons[index]?.pressed ? 1 : 0);
  const x = down(STANDARD_BUTTON.dpadRight) - down(STANDARD_BUTTON.dpadLeft);
  const y = down(STANDARD_BUTTON.dpadDown) - down(STANDARD_BUTTON.dpadUp);
  return x === 0 && y === 0 ? undefined : { x, y };
}

/**
 * A d-pad reaches the diagonals by holding two buttons, so it is read as a
 * VECTOR and resolved through the same path as a stick rather than as four
 * separate keys. A roguelike without diagonals is a different game, and a pad
 * that could only walk on the cardinals would be one.
 */
function padDirection(pad: PadSnapshot, capabilities: PadCapabilities, held: AngbandDirection | undefined, bindings: GamepadBindings): AngbandDirection | undefined {
  const cross = dpadVector(pad);
  if (cross) return resolveDirection(cross.x, cross.y, held, { deadZone: { inner: 0, outer: 1 } });
  // Some pads report the cross as a ninth axis instead of four buttons.
  if (!capabilities.dpad && pad.axes.length > 9) {
    const hat = resolveHatAxis(pad.axes[9] ?? 2);
    if (hat) return hat;
  }
  if (capabilities.sticks === 0) return undefined;
  return resolveDirection(
    pad.axes[STANDARD_AXIS.leftX] ?? 0,
    pad.axes[STANDARD_AXIS.leftY] ?? 0,
    held,
    { deadZone: bindings.deadZone },
  );
}

function secondaryDirection(pad: PadSnapshot, capabilities: PadCapabilities, held: AngbandDirection | undefined, bindings: GamepadBindings): AngbandDirection | undefined {
  if (capabilities.sticks < 2) return undefined;
  return resolveDirection(
    pad.axes[STANDARD_AXIS.rightX] ?? 0,
    pad.axes[STANDARD_AXIS.rightY] ?? 0,
    held,
    { deadZone: bindings.deadZone },
  );
}

export interface GamepadAdapterOptions {
  readonly repeat?: RepeatOptions;
}

export class GamepadAdapter {
  private pads = new Map<number, PadState>();
  private capture: ((index: number) => void) | undefined;

  constructor(
    private readonly surface: ControlSurface,
    private readonly host: GamepadHost,
    private readonly options: GamepadAdapterOptions = {},
  ) {}

  connected(): readonly ConnectedPad[] {
    return [...this.pads.values()].map((state) => state.pad);
  }

  /**
   * Swallow the next button press and report which one it was.
   *
   * The mapping screen asks a player to press the button they want to change,
   * because a list of index numbers is not something anyone can match to the
   * pad in their hands. While a capture is armed the press does nothing else,
   * so binding Cancel does not also cancel the screen doing the binding.
   */
  captureButton(report: (index: number) => void): () => void {
    this.capture = report;
    return () => {
      if (this.capture === report) this.capture = undefined;
    };
  }

  capturing(): boolean {
    return this.capture !== undefined;
  }

  /** Replace one pad's bindings, which is what the mapping screen saves. */
  setBindings(index: number, bindings: GamepadBindings): void {
    const state = this.pads.get(index);
    if (state) state.pad.bindings = bindings;
  }

  /** Forget a pad the browser no longer reports. */
  disconnect(index: number): void {
    if (this.pads.delete(index)) this.host.padsChanged(this.connected());
  }

  /**
   * One sample of every connected pad.
   *
   * Sampling rather than events is the API's own model: `navigator.getGamepads`
   * returns a fresh snapshot each call and there is no button event to listen
   * for, so an adapter that did not poll would see nothing at all.
   */
  poll(pads: readonly PadSnapshot[], now: number): void {
    const seen = new Set<number>();
    let changed = false;
    for (const pad of pads) {
      seen.add(pad.index);
      let state = this.pads.get(pad.index);
      if (!state) {
        const capabilities = describeCapabilities(pad);
        const signature = padSignature(capabilities);
        state = {
          pad: { index: pad.index, id: pad.id, capabilities, signature, bindings: loadBindings(signature, capabilities) },
          pressed: [], left: IDLE_HOLD, right: IDLE_HOLD, layerHeld: false,
          leftHeld: undefined, rightHeld: undefined,
        };
        this.pads.set(pad.index, state);
        changed = true;
      }
      this.samplePad(state, pad, now);
    }
    for (const index of [...this.pads.keys()]) {
      if (seen.has(index)) continue;
      this.pads.delete(index);
      changed = true;
    }
    if (changed) this.host.padsChanged(this.connected());
  }

  private samplePad(state: PadState, pad: PadSnapshot, now: number): void {
    const bindings = state.pad.bindings;
    // The modifier is read BEFORE the edges, so pressing it and a face button
    // in the same frame gives the layer's meaning rather than the base one.
    state.layerHeld = pad.buttons.some((button, index) =>
      button.pressed && roleOf(bindings.buttons[index]) === "layer");

    for (let index = 0; index < pad.buttons.length; index++) {
      const down = pad.buttons[index]?.pressed ?? false;
      const was = state.pressed[index] ?? false;
      state.pressed[index] = down;
      if (!down || was) continue;
      if (this.capture) {
        const report = this.capture;
        this.capture = undefined;
        report(index);
        continue;
      }
      const layered = state.layerHeld ? bindings.layer[index] : undefined;
      this.press(layered ?? bindings.buttons[index]);
    }
    state.pressed.length = pad.buttons.length;

    const primary = padDirection(pad, state.pad.capabilities, state.leftHeld, bindings);
    state.leftHeld = primary;
    const step = stepHold(state.left, primary, now, this.options.repeat ?? DEFAULT_REPEAT);
    state.left = step.state;
    if (step.emit !== undefined) this.direction(step.emit, false);

    const secondary = secondaryDirection(pad, state.pad.capabilities, state.rightHeld, bindings);
    state.rightHeld = secondary;
    const rightStep = stepHold(state.right, secondary, now, this.options.repeat ?? DEFAULT_REPEAT);
    state.right = rightStep.state;
    if (rightStep.emit !== undefined) this.direction(rightStep.emit, true);
  }

  private press(target: BindingTarget | undefined): void {
    if (!target) return;
    const role = roleOf(target);
    if (role) {
      this.role(role);
      return;
    }
    if (target.startsWith("key:")) {
      controlKey(target.slice(4));
      return;
    }
    this.command(target.slice(4));
  }

  /**
   * A command binding names its command; it does not press its key.
   *
   * Going through the surface keeps the readiness guard, the confirmation route
   * and the keyset translation that the command table already owns, so a pad
   * cannot start a command inside a prompt and cannot fire the wrong command
   * because the player changed keysets.
   *
   * The name is `commandName`'s, so a row whose only key belongs to the
   * roguelike keyset is bindable under its own label rather than unnameable.
   */
  private command(name: string): void {
    if (!this.surface.canCommand()) return;
    const command = this.surface.commands()
      .find((candidate) => commandName(candidate) === name);
    if (!command) return;
    this.surface.invokeCommand(command.id);
  }

  private role(role: GamepadRole): void {
    if (this.host.overlayOpen()) {
      switch (role) {
        case "confirm": this.host.overlayConfirm(); return;
        case "cancel": this.host.overlayCancel(); return;
        case "commands": this.host.toggleWheel(); return;
        case "legend": this.host.toggleLegend(); return;
        case "page-prev": this.host.overlayPage(-1); return;
        case "page-next": this.host.overlayPage(1); return;
        default: return;
      }
    }
    switch (role) {
      case "layer": return; // Held, never pressed on its own.
      case "commands": this.host.toggleWheel(); return;
      case "legend": this.host.toggleLegend(); return;
      case "stop": this.host.stop(); return;
      case "confirm": this.confirm(); return;
      case "cancel": this.cancel(); return;
      case "wait": this.wait(); return;
      case "page-prev": this.page(-1); return;
      case "page-next": this.page(1); return;
    }
  }

  /** The reply on the current question that answers this action, if any. */
  private reply(match: (action: ControlAction) => boolean): ControlAction | undefined {
    const snapshot = this.surface.current();
    if (!snapshot) return undefined;
    return [...snapshot.context.replies ?? []].find((action) => !action.disabled && match(action));
  }

  private answer(action: ControlAction | undefined): boolean {
    const snapshot = this.surface.current();
    if (!snapshot || !action) return false;
    return this.surface.invoke(snapshot.token, action.id);
  }

  private confirm(): void {
    // A prompt that names its own accepting reply gets it. The target loop is
    // the case that matters: Enter does not take a target there, so a pad that
    // only knew about Enter could aim at a monster and never fire.
    if (this.answer(this.reply((action) => action.role === "accept"))) return;
    // Otherwise Enter, which a menu, an item list and a text field all accept,
    // and which opens the command browser at the game screen. Deliberately not
    // a synonym for Yes on a confirmation: the keyboard's Enter does not mean
    // yes there either, and a controller changes how a command is issued rather
    // than what it does.
    controlKey("Enter");
  }

  private cancel(): void {
    if (this.answer(this.reply((action) => action.role === "cancel"))) return;
    controlKey("Escape");
  }

  private wait(): void {
    if (this.answer(this.reply((action) => action.direction === 5))) return;
    if (!this.surface.current()) controlKey("5");
  }

  private page(delta: number): void {
    const snapshot = this.surface.current();
    // A prompt with its own next and previous wins: the target loop's are how
    // it walks the monsters it considers interesting, which is the fast way to
    // pick one and is not the same thing as scrolling a page.
    const stepped = this.reply((action) => action.role === (delta < 0 ? "previous" : "next"));
    if (this.answer(stepped)) return;
    const sources = snapshot?.context.kind === "item"
      ? (snapshot.context.replies ?? []).filter((action) => action.id.startsWith("source:"))
      : [];
    if (sources.length > 1) {
      const at = sources.findIndex((action) => action.selected);
      // Wrapping, because a pad has no way to see that it has run out of tabs.
      const next = sources[((at < 0 ? 0 : at) + delta + sources.length) % sources.length];
      if (next && !next.disabled && this.answer(next)) return;
    }
    controlKey(delta < 0 ? "PageUp" : "PageDown");
  }

  /**
   * Where a direction goes depends on what is being asked, and only on that.
   *
   * The four prompt shapes the command inventory names each want something
   * different from a stick: the game screen wants a step, a direction or target
   * prompt wants its own reply invoked so the prompt's own cancellation and
   * validity rules run, and a list wants a cursor moved rather than a row
   * chosen. A diagonal is meaningless to a list, so it is dropped there instead
   * of being rounded into a cardinal the player did not ask for.
   */
  private direction(direction: AngbandDirection, secondary: boolean): void {
    if (this.host.overlayOpen()) {
      this.host.overlayMove(direction);
      return;
    }
    const snapshot = this.surface.current();
    const kind = snapshot?.context.kind;
    if (!snapshot) {
      // The game screen. A secondary stick must not also walk the character.
      if (!secondary && this.surface.canCommand()) controlKey(String(direction));
      return;
    }
    if (kind === "direction" || kind === "target") {
      if (this.answer(this.reply((action) => action.direction === direction))) return;
      controlKey(String(direction));
      return;
    }
    if (kind === "text") return; // The text overlay owns its own caret.
    const arrow = ARROW[direction];
    if (arrow) controlKey(arrow);
  }
}

/**
 * Sampling loop and connection lifecycle.
 *
 * There is no button event to listen for. `gamepadconnected` says a pad exists
 * and nothing else, and the state has to be read out of a fresh
 * `navigator.getGamepads()` snapshot every frame, so the connection event is
 * used to START the loop rather than to carry any input.
 *
 * A pad is also invisible until the player presses something on it, which is a
 * fingerprinting defence rather than an oversight, so there is genuinely
 * nothing to sample before then. That would make the event the whole
 * lifecycle, except that Chromium has been reported not to deliver it
 * dependably, and a controller that stays dead until the page is reloaded is
 * indistinguishable to a player from no controller support at all. So the loop
 * runs at animation rate only while a pad is present, and falls back to a
 * once-a-second check when none is, which costs nothing measurable and does not
 * depend on the event arriving.
 */
export interface GamepadRuntime {
  readonly adapter: GamepadAdapter;
  stop(): void;
}

export interface RuntimeEnvironment {
  readonly target?: Pick<Window, "addEventListener" | "removeEventListener">;
  readonly frame?: (callback: (now: number) => void) => number;
  readonly cancelFrame?: (handle: number) => void;
  readonly timer?: (callback: () => void, delayMs: number) => number;
  readonly cancelTimer?: (handle: number) => void;
  readonly now?: () => number;
  readonly source?: Pick<Navigator, "getGamepads">;
}

/** How often a page with no pad attached looks for one. */
export const IDLE_POLL_MS = 1000;

export function startGamepadRuntime(
  surface: ControlSurface,
  host: GamepadHost,
  environment: RuntimeEnvironment = {},
  options?: GamepadAdapterOptions,
): GamepadRuntime {
  const adapter = new GamepadAdapter(surface, host, options);
  const target = environment.target ?? (typeof window === "undefined" ? undefined : window);
  const frame = environment.frame
    ?? (typeof requestAnimationFrame === "undefined" ? undefined : requestAnimationFrame);
  const cancelFrame = environment.cancelFrame
    ?? (typeof cancelAnimationFrame === "undefined" ? undefined : cancelAnimationFrame);
  const timer = environment.timer ?? ((callback, delay) => setTimeout(callback, delay) as unknown as number);
  const cancelTimer = environment.cancelTimer ?? ((handle: number) => clearTimeout(handle));
  const now = environment.now ?? (() => (typeof performance === "undefined" ? Date.now() : performance.now()));
  let frameHandle: number | undefined;
  let timerHandle: number | undefined;
  let stopped = false;
  let fast = false;

  const tick = (): void => {
    if (stopped) return;
    frameHandle = undefined;
    timerHandle = undefined;
    const pads = readPads(environment.source);
    adapter.poll(pads, now());
    schedule(pads.length > 0);
  };
  function schedule(active: boolean): void {
    if (stopped) return;
    fast = active;
    if (active) frameHandle = frame?.(tick);
    else timerHandle = timer(tick, IDLE_POLL_MS);
  }
  const wake = (): void => {
    if (stopped || fast) return;
    if (timerHandle !== undefined) cancelTimer(timerHandle);
    timerHandle = undefined;
    tick();
  };
  target?.addEventListener("gamepadconnected", wake);
  target?.addEventListener("gamepaddisconnected", wake);
  tick();

  return {
    adapter,
    stop: () => {
      stopped = true;
      if (frameHandle !== undefined) cancelFrame?.(frameHandle);
      if (timerHandle !== undefined) cancelTimer(timerHandle);
      frameHandle = undefined;
      timerHandle = undefined;
      target?.removeEventListener("gamepadconnected", wake);
      target?.removeEventListener("gamepaddisconnected", wake);
    },
  };
}

/** The shell's interrupt route, shared with the touch controls. */
export const stopGamepadInput = stopControlInput;
