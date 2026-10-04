/**
 * The capability-gated event-subscription seam (W1.6): a mod subscribes to the
 * game event bus (events.ts) to react to what happens - turn/level changes,
 * messages, sound, monster events - the "hooks" half of behavioral modding.
 *
 * A subscription wraps a GameEvents bus and checks "event:<name>" (the
 * capability-model vocabulary, capabilities.ts) before honoring an `on`; an
 * ungranted event throws AgentCapabilityError, exactly like the perceive/act
 * facades (W1.4). With no AgentCapabilities (a trusted in-process host) every
 * event is granted. The bus itself is core's faithful game-event.c port; this
 * only adds the consent gate a sandboxed plugin (W2.1) needs.
 *
 * Every listener added here also runs on its own guard (neostryder/neo-angband#371).
 * The bus's emit loops over its handlers with no guard, as game-event.c does, so
 * one mod listener that throws would end the loop and every listener after it would
 * miss the event. The guard sits here, where a mod subscribes, rather than in
 * emit: the bus also carries the front end's own handlers, and those keep the
 * port's behaviour.
 */

import type { GameEventHandler, GameEvents, GameEventType } from "../events.js";
import { AgentCapabilityError } from "./types.js";
import type { AgentCapabilities } from "./types.js";

/** A capability-gated view of the event bus handed to a mod. */
export interface AgentEventSubscription {
  /** Subscribe to an event, if "event:<type>" is granted (else throws). */
  on<K extends GameEventType>(type: K, fn: GameEventHandler<K>): void;
  /** Unsubscribe a handler (always allowed - dropping a hook needs no grant). */
  off<K extends GameEventType>(type: K, fn: GameEventHandler<K>): void;
}

/** Who owns a subscription's listeners, and where their failures go. */
export interface EventSubscriptionOptions {
  /** The owner of every listener added through this subscription, such as a mod id. */
  readonly owner?: string;
  /**
   * Told when a listener added here throws, or returns a promise that rejects.
   * Without it, the error is rethrown on a later microtask, so it still reaches
   * the console without stopping the other listeners.
   */
  readonly onFault?: (
    type: GameEventType,
    error: unknown,
    owner: string | undefined,
  ) => void;
}

/**
 * Build a capability-gated subscription over `bus`. `on` throws
 * AgentCapabilityError unless "event:<type>" is granted; absent caps grants all.
 * Each listener runs on its own guard, so a throw or a rejected promise is
 * reported through `options.onFault` and the event still reaches the listeners
 * after it.
 */
export function subscribeEvents(
  bus: GameEvents,
  caps?: AgentCapabilities,
  options: EventSubscriptionOptions = {},
): AgentEventSubscription {
  const rethrowLater = (error: unknown): void => {
    queueMicrotask(() => {
      throw error;
    });
  };
  const fault = (type: GameEventType, error: unknown): void => {
    if (!options.onFault) {
      rethrowLater(error);
      return;
    }
    /* The reporter runs inside the same emit loop, so its own failure must not
     * end the loop either. */
    try {
      options.onFault(type, error, options.owner);
    } catch (reportError) {
      rethrowLater(reportError);
    }
  };
  /* The guarded copy the bus holds, per event type and per original listener, so
   * `off` with the function the mod passed to `on` removes the right one. A list,
   * because adding the same function twice registers it twice on the bus. */
  const guarded = new Map<
    GameEventType,
    Map<GameEventHandler<GameEventType>, GameEventHandler<GameEventType>[]>
  >();
  return {
    on: (type, fn) => {
      if (caps && !caps.has(`event:${type}`)) {
        throw new AgentCapabilityError(
          `agent events: capability "event:${type}" is not granted`,
        );
      }
      const original = fn as GameEventHandler<GameEventType>;
      const guard: GameEventHandler<GameEventType> = (t, data) => {
        try {
          const result: unknown = original(t, data);
          /* A handler is typed to return nothing, but an async function still
           * satisfies that type, and its failure arrives as a rejected promise. */
          if (
            (typeof result === "object" || typeof result === "function") &&
            result !== null &&
            typeof (result as PromiseLike<unknown>).then === "function"
          ) {
            (result as PromiseLike<unknown>).then(undefined, (error: unknown) => {
              fault(t, error);
            });
          }
        } catch (error) {
          fault(t, error);
        }
      };
      let byFn = guarded.get(type);
      if (!byFn) {
        byFn = new Map();
        guarded.set(type, byFn);
      }
      bus.on(type, guard as GameEventHandler<typeof type>);
      const copies = byFn.get(original) ?? [];
      copies.push(guard);
      byFn.set(original, copies);
    },
    off: (type, fn) => {
      const original = fn as GameEventHandler<GameEventType>;
      const byFn = guarded.get(type);
      const copies = byFn?.get(original);
      const guard = copies?.pop();
      if (!guard) return;
      if (copies?.length === 0) {
        byFn?.delete(original);
        if (byFn?.size === 0) guarded.delete(type);
      }
      bus.off(type, guard as GameEventHandler<typeof type>);
    },
  };
}
