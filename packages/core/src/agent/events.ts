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
 */

import type { GameEventHandler, GameEvents, GameEventType } from "../events";
import { AgentCapabilityError } from "./types";
import type { AgentCapabilities } from "./types";

/** A capability-gated view of the event bus handed to a mod. */
export interface AgentEventSubscription {
  /** Subscribe to an event, if "event:<type>" is granted (else throws). */
  on<K extends GameEventType>(type: K, fn: GameEventHandler<K>): void;
  /** Unsubscribe a handler (always allowed - dropping a hook needs no grant). */
  off<K extends GameEventType>(type: K, fn: GameEventHandler<K>): void;
}

/**
 * Build a capability-gated subscription over `bus`. `on` throws
 * AgentCapabilityError unless "event:<type>" is granted; absent caps grants all.
 */
export function subscribeEvents(
  bus: GameEvents,
  caps?: AgentCapabilities,
): AgentEventSubscription {
  return {
    on: (type, fn) => {
      if (caps && !caps.has(`event:${type}`)) {
        throw new AgentCapabilityError(
          `agent events: capability "event:${type}" is not granted`,
        );
      }
      bus.on(type, fn);
    },
    off: (type, fn) => {
      bus.off(type, fn);
    },
  };
}
