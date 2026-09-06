/**
 * Turning a continuous stick into one of the game's nine discrete answers.
 *
 * The game has never had an analog input. Every direction it accepts is a
 * keypad digit, so the only question an adapter can ask a stick is "which of
 * the eight, or none". Everything here answers that and nothing else: no
 * command meaning, no device knowledge, no timers of its own. The caller owns
 * the clock and passes a timestamp in, which is what makes the repeat and
 * hysteresis behaviour testable without waiting for it.
 *
 * Screen coordinates throughout: +x right, +y down, matching `UiDirection` in
 * `input-door.ts`. A stick pushed away from the player reports a NEGATIVE y on
 * every pad the Gamepad API describes, and that is north.
 */
import type { AngbandDirection } from "./input-door";

/**
 * Sector centres, in the order `Math.atan2(y, x)` produces them.
 *
 * Index k covers the wedge centred on k * 45 degrees clockwise from east, so
 * the table reads E, SE, S, SW, W, NW, N, NE. The values are keypad digits
 * because that is the alphabet the command layer already speaks.
 */
const SECTOR: readonly AngbandDirection[] = [6, 3, 2, 1, 4, 7, 8, 9];

const SECTOR_RADIANS = Math.PI / 4;
const TAU = Math.PI * 2;

/**
 * The same eight directions read clockwise from north.
 *
 * Two unrelated things need this order and neither can use `SECTOR`: a hat
 * switch encodes its positions this way, and a radial menu's wedges are read
 * this way because that is the order a person names them in.
 */
export const CLOCKWISE_FROM_NORTH: readonly AngbandDirection[] = [8, 9, 6, 3, 2, 1, 4, 7];

/** Unit vectors for the nine keypad answers, screen coordinates. */
const VECTOR: Record<AngbandDirection, readonly [number, number]> = {
  1: [-Math.SQRT1_2, Math.SQRT1_2], 2: [0, 1], 3: [Math.SQRT1_2, Math.SQRT1_2],
  4: [-1, 0], 5: [0, 0], 6: [1, 0],
  7: [-Math.SQRT1_2, -Math.SQRT1_2], 8: [0, -1], 9: [Math.SQRT1_2, -Math.SQRT1_2],
};

export function directionVector(direction: AngbandDirection): readonly [number, number] {
  return VECTOR[direction];
}

export interface DeadZone {
  /** Below this magnitude the stick reads as centred. */
  readonly inner: number;
  /** At and above this magnitude the stick reads as fully deflected. */
  readonly outer: number;
}

export const DEFAULT_DEAD_ZONE: DeadZone = { inner: 0.3, outer: 0.9 };

export interface StickReading {
  readonly x: number;
  readonly y: number;
  /** 0 inside the dead zone, rising to 1 at the outer edge. */
  readonly magnitude: number;
}

const CENTRED: StickReading = { x: 0, y: 0, magnitude: 0 };

/**
 * Scaled radial dead zone.
 *
 * The naive alternative is to test each axis on its own, which is what makes a
 * cheap pad feel like it snaps to the cardinals: with an axial dead zone of
 * 0.3, a stick held exactly north-east at 40% deflection has x = y = 0.28 and
 * reads as centred, while the same stick at 45% suddenly reads as a clean
 * diagonal. Measuring the vector's length instead makes the dead zone a circle,
 * and rescaling what is left of the range restores a full 0-to-1 response above
 * it, so the first movement past the threshold is not a jump.
 *
 * `outer` below 1 is deliberate rather than a rounding allowance. Worn sticks
 * do not reach the corners, and a control that needs the last five percent of
 * the hardware's travel is a control some players cannot reach at all.
 */
export function applyDeadZone(x: number, y: number, zone: DeadZone = DEFAULT_DEAD_ZONE): StickReading {
  const raw = Math.hypot(x, y);
  if (!Number.isFinite(raw) || raw <= zone.inner) return CENTRED;
  const span = Math.max(zone.outer - zone.inner, Number.EPSILON);
  const magnitude = Math.min(1, (raw - zone.inner) / span);
  return { x: (x / raw) * magnitude, y: (y / raw) * magnitude, magnitude };
}

/** Clockwise from east, normalised to [0, 2pi). */
function angleOf(x: number, y: number): number {
  const angle = Math.atan2(y, x);
  return angle < 0 ? angle + TAU : angle;
}

/** Signed separation between two angles, in [-pi, pi]. */
function angleDelta(a: number, b: number): number {
  const delta = ((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return delta;
}

export interface DirectionOptions {
  readonly deadZone?: DeadZone;
  /**
   * How far past its own wedge the currently held direction keeps the stick.
   *
   * Without this, a stick resting near a boundary alternates between two
   * neighbouring directions as the hardware jitters, and the player watching
   * the map sees a character that will not commit. Widening only the direction
   * already held costs nothing to a player who is deliberately turning, because
   * their stick crosses the whole widened wedge in one motion.
   */
  readonly hysteresisRadians?: number;
  /**
   * How much of the dead zone a direction already held has to fall back
   * through before it is released.
   *
   * The same reasoning as the angular widening, applied to length instead of
   * angle: a stick resting near the threshold otherwise starts and stops on
   * hardware noise, and a player holding a direction sees their character
   * stutter. Engaging is harder than staying engaged, which is the way round
   * that cannot produce a step nobody asked for.
   */
  readonly releaseFactor?: number;
}

export const DEFAULT_HYSTERESIS_RADIANS = (12 * Math.PI) / 180;
export const DEFAULT_RELEASE_FACTOR = 0.6;

/**
 * The stick's current answer, or undefined for centred.
 *
 * `held` is the answer this same stick gave last time. Passing it in is what
 * separates "the player is still holding north-east" from "the player has
 * turned", and it is the caller's business to keep because the caller is the
 * one that knows which stick this is.
 */
export function resolveDirection(
  x: number,
  y: number,
  held?: AngbandDirection,
  options: DirectionOptions = {},
): AngbandDirection | undefined {
  const zone = options.deadZone ?? DEFAULT_DEAD_ZONE;
  const reading = applyDeadZone(x, y, held === undefined
    ? zone
    : { inner: zone.inner * (options.releaseFactor ?? DEFAULT_RELEASE_FACTOR), outer: zone.outer });
  if (reading.magnitude === 0) return undefined;
  const angle = angleOf(reading.x, reading.y);
  if (held !== undefined && held !== 5) {
    const heldSector = SECTOR.indexOf(held);
    if (heldSector >= 0) {
      const widened = SECTOR_RADIANS / 2 + (options.hysteresisRadians ?? DEFAULT_HYSTERESIS_RADIANS);
      if (Math.abs(angleDelta(angle, heldSector * SECTOR_RADIANS)) <= widened) return held;
    }
  }
  const sector = Math.round(angle / SECTOR_RADIANS) % SECTOR.length;
  return SECTOR[sector];
}

/**
 * A hat switch is a ninth AXIS, not four buttons.
 *
 * Only pads the browser could not fit to the standard mapping report a cross
 * this way, and the encoding is eight positions spaced 2/7 apart from -1, with
 * a centre sentinel deliberately outside that range. Firefox has been observed
 * reporting a PlayStation 5 pad's cross on axis 9 at -1, -0.42857, 0.14286 and
 * 0.71429 with a neutral value of 1.28571, which is exactly that encoding
 * (Mozilla bug 1922925). The same axis has also been seen returning values in
 * the hundreds of millions, so the range check below is a guard against a
 * browser defect rather than against an unusual pad.
 *
 * Position 0 is north and they run clockwise, which is the conventional HID hat
 * order. That ordering has not been confirmed against a physical pad here; a
 * player whose cross reads rotated has a working mapping screen, which is the
 * reason the fallback exists rather than a reason to guess harder.
 */
export function resolveHatAxis(value: number): AngbandDirection | undefined {
  if (!Number.isFinite(value) || value < -1.001 || value > 1.001) return undefined;
  const position = Math.round(((value + 1) * 7) / 2);
  if (position < 0 || position > 7) return undefined;
  return CLOCKWISE_FROM_NORTH[position];
}

export interface RepeatOptions {
  /** Silence between the first answer and the second, so a nudge is one step. */
  readonly initialDelayMs?: number;
  /** Spacing of every answer after that. */
  readonly intervalMs?: number;
}

/**
 * Hold-to-repeat timings.
 *
 * A held direction has to behave like a held key: one step, a pause long enough
 * that a deliberate single step is never two, then a steady rate. The desktop
 * text-typing default of half a second is tuned for a keyboard and reads as
 * hesitation on a stick; the shorter figures games use read as responsive. This
 * sits at the slow end of that range on purpose, because a repeat here is a
 * game turn and an extra one can be a step into a trap.
 */
export const DEFAULT_REPEAT: Required<RepeatOptions> = { initialDelayMs: 250, intervalMs: 120 };

export interface HoldState {
  readonly direction?: AngbandDirection;
  /** Seen once, not yet answered. See `stepHold`. */
  readonly pending?: AngbandDirection;
  /** When the current direction was first answered. */
  readonly since: number;
  /** When it was last answered. */
  readonly last: number;
  readonly repeated: boolean;
}

export const IDLE_HOLD: HoldState = { since: 0, last: 0, repeated: false };

export interface HoldStep {
  readonly state: HoldState;
  /** The answer to emit now, if any. */
  readonly emit?: AngbandDirection;
}

/**
 * One tick of a held direction.
 *
 * Pure, and given the time rather than reading it: the whole point of the
 * initial delay is that it is hard to observe by hand, and a test that has to
 * sleep to see it is a test nobody runs.
 *
 * A NEW direction has to survive a second sample before it is answered. A
 * released stick springs past centre and reports the opposite direction for a
 * frame or two, and without this the last thing a player does before letting go
 * is take a step backwards. One frame of latency is not perceptible; a step in
 * the wrong direction in a game where a step can be fatal is.
 */
export function stepHold(
  state: HoldState,
  direction: AngbandDirection | undefined,
  now: number,
  options: RepeatOptions = {},
): HoldStep {
  if (direction === undefined) return { state: IDLE_HOLD };
  if (state.direction !== direction) {
    if (state.pending !== direction) return { state: { ...state, pending: direction } };
    return { state: { direction, since: now, last: now, repeated: false }, emit: direction };
  }
  const initial = options.initialDelayMs ?? DEFAULT_REPEAT.initialDelayMs;
  const interval = options.intervalMs ?? DEFAULT_REPEAT.intervalMs;
  const due = state.repeated ? interval : initial;
  if (now - state.last < due) return { state: { ...state, pending: direction } };
  return { state: { ...state, pending: direction, last: now, repeated: true }, emit: direction };
}
