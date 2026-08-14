/**
 * Mod-supplied MESSAGE TYPES, appended after the 153 compiled-in MSG_ slots.
 *
 * WHY THIS IS A CRASH, NOT A MISSING FEATURE. `checkMsgt` (mon/bind.ts:607) and
 * the projection binder (world/projection.ts:182) both THROW
 * `PARSE_ERROR_INVALID_MESSAGE` for a `msgt:` naming anything outside
 * `MESSAGE_ENTRIES`. Composition merges a record by key, so a mod's monster
 * spell / blow method / summon / projection arrives at the binder intact and
 * takes the whole bind down with it. That is the same failure `bindProjections`
 * had before 2026-08-08 - "the one content change that did" (MOD_REACH.md:306-313) -
 * and it gets the same answer: append after the compiled slots.
 *
 * NOT #159's handler-registry shape, because there is no handler to register. A
 * message type is a NAME plus the `sound.prf` name it plays; the only thing the
 * game does with it is look it up. So this is a name table with a fixed
 * compiled prefix, and `messageLookupByName` (sound/engine.ts) is the single
 * chokepoint every consumer already goes through:
 *
 *   - `checkMsgt`                         mon/bind.ts:609   (4 callers)
 *   - the projection `msgt:` check        world/projection.ts:182
 *   - `SoundEngine.loadPrefs`             sound/engine.ts:295
 *   - `message-color:` in pref files      visuals/prefs.ts:391
 *
 * One widening reaches all four. `message-types.test.ts` asserts that with
 * nothing registered every one of them answers exactly as before.
 *
 * NO SAVE IMPACT. `checkMsgt` returns the NAME and every consumer keeps it as a
 * string (`MonsterSpell.msgt`, `BlowMethod.msgt`, `ProjectionInfo.msgt` are all
 * `string`), resolving to a number only at message time in `Messages.msgt`.
 * Nothing indexes by MSG number in a save block, so a mod's message type at
 * index 154 cannot renumber anything a save already holds - and disabling the
 * mod cannot corrupt one. `message-types.test.ts` pins the string-ness.
 *
 * THREE REFUSALS, each the analogue of one `bindProjections` keeps:
 *  1. A name that already exists compiled-in (case-INSENSITIVELY, because
 *     `message_lookup_by_name` compares with `my_stricmp`) is refused. The
 *     compiled scan runs first, so such a registration would be silently dead
 *     rather than an override; a mod that means to re-point a message's SOUND
 *     does that through the sound-pref registry, which is the thing that
 *     composes.
 *  2. A name that `strtoul` consumes - "5", " -3 ", "+12" - is refused. The
 *     numeric path in `message_lookup_by_name` runs BEFORE any name scan, so
 *     such a name would resolve to a message INDEX and never reach this table.
 *     This is the `code: "constructor"` refusal in the message domain: a name
 *     that resolves somewhere other than where the author thinks it does.
 *  3. A duplicate mod-supplied name is refused, matching
 *     `projection: duplicate code X`.
 */

import { MESSAGE_ENTRIES } from "../generated/message.js";

/** One mod-supplied MSG_ entry - the same shape as a `MESSAGE_ENTRIES` row. */
export interface MessageTypeEntry {
  /** The MSG_ name, as a `msgt:` directive would spell it. */
  readonly name: string;
  /** The `sound.prf` name, i.e. what a `sound:` directive keys on. May be "". */
  readonly sound: string;
  /** The mod that registered it, or null for an unattributed host call. */
  readonly owner: string | null;
}

/** The structural target `RegistryTargets.messages` accepts. */
export interface MessageTypeRegistryTarget {
  /** Declare a message type; returns the MSG index it was appended at. */
  add(name: string, sound?: string, owner?: string): number;
  /** The MSG index for a registered name (case-insensitive), or -1. */
  lookup(name: string): number;
  /** Everything registered so far, in registration order. */
  added(): readonly MessageTypeEntry[];
}

/** The first index a mod-supplied message type can occupy (== MSG.MAX + 1). */
export const FIRST_MOD_MESSAGE_INDEX = MESSAGE_ENTRIES.length;

/**
 * `strtoul`-consumable check, matching `strtoul10` in sound/engine.ts. Kept
 * here as its own predicate so the refusal cannot drift from the parser it
 * guards; `message-types.test.ts` cross-checks the two on the same inputs.
 */
function parsesAsNumber(name: string): boolean {
  return /^[ \t\n\v\f\r]*[+-]?[0-9]+/.test(name);
}

const COMPILED_NAMES: ReadonlySet<string> = new Set(
  MESSAGE_ENTRIES.map((e) => e.name.toLowerCase()),
);

export class MessageTypeRegistry implements MessageTypeRegistryTarget {
  readonly #entries: MessageTypeEntry[] = [];
  readonly #byName = new Map<string, number>();

  add(name: string, sound = "", owner?: string): number {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("message type: name must be a non-empty string");
    }
    if (typeof sound !== "string") {
      throw new Error(`message type: ${name}: sound must be a string`);
    }
    const lower = name.toLowerCase();
    if (COMPILED_NAMES.has(lower)) {
      throw new Error(
        `message type: ${name} is already a compiled-in MSG_ ` +
          `(message_lookup_by_name is case-insensitive, so this registration ` +
          `could never be reached) - to re-point its sound, register a sound pref`,
      );
    }
    if (parsesAsNumber(name)) {
      throw new Error(
        `message type: ${name} parses as a decimal number, and ` +
          `message_lookup_by_name resolves a numeric name to that MSG index ` +
          `before any name is compared - it could never reach this table`,
      );
    }
    if (this.#byName.has(lower)) {
      throw new Error(`message type: duplicate name ${name}`);
    }
    const index = FIRST_MOD_MESSAGE_INDEX + this.#entries.length;
    this.#entries.push({ name, sound, owner: owner ?? null });
    this.#byName.set(lower, index);
    return index;
  }

  lookup(name: string): number {
    return this.#byName.get(name.toLowerCase()) ?? -1;
  }

  /** The entry at a MSG index, or null when it is not a mod-supplied one. */
  entryAt(index: number): MessageTypeEntry | null {
    return this.#entries[index - FIRST_MOD_MESSAGE_INDEX] ?? null;
  }

  added(): readonly MessageTypeEntry[] {
    return [...this.#entries];
  }

  /** How many message types have been appended. */
  get size(): number {
    return this.#entries.length;
  }

  /** Bind attribution to one mod, the way `MenuRegistry.forOwner` does. */
  forOwner(owner: string): MessageTypeRegistryTarget {
    return {
      add: (name, sound): number => this.add(name, sound, owner),
      lookup: (name): number => this.lookup(name),
      added: (): readonly MessageTypeEntry[] => this.added(),
    };
  }

  /** Test / session teardown: no installed mod means no message type survives. */
  clear(): void {
    this.#entries.length = 0;
    this.#byName.clear();
  }
}

/**
 * The live message-type door. Module-level for the same reason the sound
 * registry is: `messageLookupByName` is a free function every binder calls, and
 * a bind runs before any game exists.
 */
export const messageTypes = new MessageTypeRegistry();
