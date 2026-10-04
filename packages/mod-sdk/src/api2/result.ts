/**
 * What every API 2 call answers with.
 *
 * A call never throws for an ordinary refusal. The player may refuse any one
 * permission a mod asks for, and a call that needs it answers `not-granted`
 * naming the permission, so a mod can switch off the one feature that needs it
 * and keep the rest working.
 */

/**
 * A permission string, such as `state:monsters.read`, `event:message` or
 * `input:intent`. The strings are the ones manifests declare today; this alias
 * is the one place to point at the shared capability vocabulary once it lands.
 */
export type Api2Capability = string;

/** The call worked. */
export interface Api2Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** The player has not granted the permission this call needs. */
export interface Api2NotGranted {
  readonly ok: false;
  readonly reason: "not-granted";
  readonly capability: Api2Capability;
  readonly message: string;
}

/**
 * Nothing can answer right now: no game is running yet, or this front end has
 * no such feature. Asking again later may work.
 */
export interface Api2Unavailable {
  readonly ok: false;
  readonly reason: "unavailable";
  readonly message: string;
}

/** The host understood the call and turned it down, for the reason given. */
export interface Api2Refused {
  readonly ok: false;
  readonly reason: "refused";
  readonly code: string;
  readonly message: string;
}

/** Any answer that is not a success. */
export type Api2Failure = Api2NotGranted | Api2Unavailable | Api2Refused;

/** The answer to an API 2 call. */
export type Api2Result<T> = Api2Ok<T> | Api2Failure;

/** What every API 2 method returns: the same promise for in-process and Worker mods. */
export type Api2Call<T> = Promise<Api2Result<T>>;

/** A success holding `value`. */
export function api2Ok<T>(value: T): Api2Ok<T> {
  return Object.freeze({ ok: true, value });
}

/** The answer for a call whose permission the player has not granted. */
export function api2NotGranted(capability: Api2Capability): Api2NotGranted {
  return Object.freeze({
    ok: false,
    reason: "not-granted",
    capability,
    message: `this needs the "${capability}" permission, which the player has not granted`,
  });
}

/** The answer when nothing can serve the call right now. */
export function api2Unavailable(message: string): Api2Unavailable {
  return Object.freeze({ ok: false, reason: "unavailable", message });
}

/** The answer when the host turned the call down. */
export function api2Refused(code: string, message: string): Api2Refused {
  return Object.freeze({ ok: false, reason: "refused", code, message });
}

/** True for the `not-granted` answer. */
export function isNotGranted(result: Api2Result<unknown>): result is Api2NotGranted {
  return !result.ok && result.reason === "not-granted";
}
