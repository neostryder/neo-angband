/**
 * A pack's own MESSAGE TYPES, declared as DATA so they exist before the binder
 * that needs them - the ordering half of gap rows 20/21 (#266).
 *
 * WHAT WAS MEASURED, rather than read. `registry:message` gave a plugin
 * `messages.define(...)`, and the only door to that facade is the
 * `ModRegistryHost` a host builds for `register()`. Instrumenting a live boot
 * (a monster spell carrying `msgt: PROBE_FLARE`, `messageTypes.lookup`
 * wrapped to capture its caller) puts the resolution here:
 *
 *     messageLookupByName   sound/engine.ts:92
 *     checkMsgt             mon/bind.ts:609
 *     bindSpells            mon/bind.ts:459
 *     new MonsterRegistry   mon/bind.ts:646
 *     bindMonsters          mon/bind.ts:907
 *     bindCore              session/boot.ts:159
 *     startGame             session/game.ts:3042
 *
 * and `startGame` did not return - it threw
 * `mon: spell SHRIEK: invalid msgt PROBE_FLARE (PARSE_ERROR_INVALID_MESSAGE)`.
 * On the web host that call is top-level statement 182 of `main.ts`
 * (`const game = bootGame()`, :1094); the earliest `register()` is top-level
 * statement 561 (`installTrusted`, :10870 -> :10828) and the folder-plugin loop
 * is 566 (:11015 -> :11039). Both are direct children of the module, so ES
 * evaluation order settles it: **the bind is statement 182 and the earliest
 * declaration is statement 561** - 379 top-level statements apart, 384 for the
 * folder-plugin loop. A message type declared in `register()` is declared
 * after every record that could have named it, and the mod's own spell / blow
 * method / summon / projection takes the whole boot down on the way past.
 *
 * SO THE DECLARATION HAS TO BE DATA, and this is the same answer
 * `bindProjections` already gives: a mod's new PROJ code works because
 * `projection.json` is a pack file that arrives through composition, not a
 * plugin call. `MESSAGE_ENTRIES` is generated from upstream's `list-message.h`
 * and stays compiled (core adds nothing), so a mod-supplied file is APPENDED
 * after it exactly as `MessageTypeRegistry` already appends after slot 153.
 *
 * WHAT THIS BUYS THAT THE FACADE COULD NOT. A pack with no `plugin.js` has no
 * `register()` at all, so before this the message-type capability was not
 * merely late for a content mod - it was unreachable. That is why the sound
 * samples ride the same record: a content-only sound pack that could name a
 * message type and never bind a sample to it would be half a capability.
 *
 * AND IT WAS HALF A CAPABILITY UNTIL 2026-08-14, because the samples were
 * registered inside the branch that COINED a type. So a pack could bind samples
 * to a message it had invented and to none of upstream's 153 - a sound pack
 * that cannot re-point MSG_HIT. `bindSounds` below is that branch lifted out;
 * the type declaration's own outcome is unchanged.
 *
 * NO CAPABILITY GATE, deliberately. `registry:*` gates trusted in-process CODE.
 * These are records, and a content pack can already add a projection, a
 * monster, an artifact and an ego item with no capability at all; gating one
 * record file and not the other twenty would be a fence with no wall attached.
 *
 * NOTHING HERE THROWS. A refusal loses one declaration and reports it; the
 * point of the exercise is that a message type must never be what stops a game
 * from booting, and a function called from inside `bindCore` that threw would
 * be the same crash one layer up. Every refusal is also a name that already
 * resolves somewhere (a compiled-in MSG_, a numeric index, an earlier pack's
 * declaration) or one that can never resolve at all, so the record that names
 * it binds or fails on its own merits either way.
 */

import { messageLookupByName } from "../sound/engine.js";
import { messageTypes } from "../sound/message-types.js";
import type { MessageTypeRegistryTarget } from "../sound/message-types.js";
import { soundPrefRegistry } from "../sound/sound-registry.js";
import type { SoundPrefRegistryTarget } from "../sound/sound-registry.js";
import { provenanceOf } from "./extension.js";

/**
 * One record of a pack's `message_type` file.
 *
 * `sound` is the `sound.prf` KEY the type plays under - what a `sound:`
 * directive names - and matches `MESSAGE_ENTRIES`' own field. `sounds` is the
 * space-separated list of sample base-names bound to it, i.e. the right-hand
 * side of a `sound:` line. They are different things and a pack usually wants
 * both: `{ "name": "SOULFIRE", "sound": "soulfire", "sounds": "sf1 sf2" }`.
 */
export interface MessageTypeRecordJson {
  /** The MSG_ name a `msgt:` directive spells, bare and without the MSG_ prefix. */
  name: string;
  /** The `sound.prf` entry name. Optional; "" means the type plays nothing. */
  sound?: string;
  /** Space-separated sample base-names to bind, as a `sound:` line's value. */
  sounds?: string;
}

/** A type this pass appended, with the MSG index it landed at. */
export interface DeclaredMessageType {
  readonly name: string;
  readonly at: number;
  /** The pack that defined the record, or null when it carried no provenance. */
  readonly owner: string | null;
}

/** A name that already resolved before this pass, and where. */
export interface ExistingMessageType {
  readonly name: string;
  readonly at: number;
}

/** A declaration that was dropped, and why - never thrown. */
export interface RefusedMessageType {
  readonly name: string;
  readonly owner: string | null;
  readonly why: string;
}

/** What one `declareModMessageTypes` pass did. */
export interface MessageDeclarationResult {
  readonly declared: readonly DeclaredMessageType[];
  /**
   * Names that already resolved - a second bind in the same process, or a
   * second pack declaring a name the first one already did. The TYPE is not
   * appended again; the record's `sounds` still bind, once per (owner, type),
   * which is the whole of the sound-pack door - see `bindSounds`.
   */
  readonly already: readonly ExistingMessageType[];
  readonly refused: readonly RefusedMessageType[];
}

/** Where the declarations land; both default to core's module-level singletons. */
export interface MessageDeclarationTargets {
  messages?: MessageTypeRegistryTarget;
  sounds?: SoundPrefRegistryTarget;
}

const EMPTY: MessageDeclarationResult = { declared: [], already: [], refused: [] };

/**
 * The (owner, type) pairs whose samples this process has already registered.
 *
 * MODULE SCOPE, matching the registry it guards. `soundPrefRegistry` is
 * module-level because the sound engine is per FRONT END and outlives every
 * game, and `bindCore` runs on BOTH the new-game and the load path - so without
 * this a player starting a second character re-registers every pack's samples,
 * and `message_sound_define` CLEARS a message's list before assigning
 * (sound-core.c:190). The growth would be harmless; the re-pointing would not.
 *
 * KEYED BY OWNER AS WELL AS TYPE, so that two packs binding the SAME message
 * both land and load order decides the winner - which is upstream's own answer
 * for a second `sound:HIT:` line and the reason a sound pack works at all. A
 * key of type alone would silently hand the message to whichever pack loaded
 * first, i.e. exactly backwards.
 *
 * The cost of the owner in the key: one pack listing the same type twice with
 * different samples in one file gets its FIRST list, where upstream's two prf
 * lines would give the second. That is a pack contradicting itself in one file,
 * and taking the first is at least stable; the cross-pack case is the one a
 * player can actually assemble.
 *
 * Nothing in production clears this - a reload is a new module instance. Tests
 * that clear `soundPrefRegistry` must call `resetModSoundBindings` with it, or
 * the guard outlives the registry it is guarding and the next test sees a
 * silent skip.
 */
const boundSounds = new Set<string>();

/** Test / session teardown, paired with `soundPrefRegistry.clear()`. */
export function resetModSoundBindings(): void {
  boundSounds.clear();
}

/**
 * Register a record's `sounds` list, whatever became of its type DECLARATION.
 *
 * THIS IS THE SOUND-PACK DOOR, and until 2026-08-14 it was inside the branch
 * that coined a new type - so a pack could bind samples to a message it had
 * invented and to nothing else, which is the opposite of what a sound pack is.
 * The two branches that dropped it are the only two a sound pack ever takes:
 * naming one of upstream's 153 (`messages.add` throws, the record lands in
 * `refused`) and naming a type an earlier pack coined (the `already` path).
 *
 * The type declaration's outcome is left exactly as it was. A record naming
 * `HIT` is still `refused`, because the thing being refused is real - a pack
 * cannot change a compiled message's `sound.prf` KEY - and callers already
 * report on that list. What changes is only that its samples are no longer
 * thrown away with it.
 *
 * A NAME THAT RESOLVES NOWHERE IS STILL DROPPED. `loadPrefs` would drop such an
 * entry anyway (engine.ts: `if (idx < 0) continue`), so registering it would be
 * dead weight carried through every `allSoundPrefEntries()` call. Resolution
 * goes through the injected `messages` target FIRST so a caller-supplied
 * registry is honoured, then through `messageLookupByName`, which is the single
 * chokepoint that sees the compiled 153, the numeric path and the mod table.
 *
 * The key's separator is `|` rather than the NUL a pair-key usually gets: a mod
 * id is a slug and a MSG_ name is an identifier, so neither can contain one,
 * and a NUL in a source file makes git classify it as BINARY - which is the
 * `i/-text` defect CLAUDE.md's line-endings rule is about.
 */
function bindSounds(
  rec: MessageTypeRecordJson,
  owner: string | null,
  messages: MessageTypeRegistryTarget,
  sounds: SoundPrefRegistryTarget,
  refused: RefusedMessageType[],
): void {
  if (typeof rec.sounds !== "string" || rec.sounds.length === 0) return;
  if (messages.lookup(rec.name) < 0 && messageLookupByName(rec.name) < 0) return;
  const key = `${owner ?? ""}|${rec.name.toLowerCase()}`;
  if (boundSounds.has(key)) return;
  try {
    sounds.add([{ type: rec.name, sounds: rec.sounds }], owner ?? undefined);
  } catch (err) {
    refused.push({
      name: rec.name,
      owner,
      why: `message_type: ${rec.name}: sounds rejected: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    return;
  }
  boundSounds.add(key);
}

/**
 * Append a pack's declared message types, before anything binds a record that
 * names one.
 *
 * IDEMPOTENT, because `bindCore` runs on both the new-game and the load paths
 * and a host is free to call this at either. A name that already resolves is
 * reported as `already` and touched no further.
 *
 * Attribution comes from the composer's `$from` stamp on the record, the same
 * way `attachExt` reads it, so the conflict report can say which pack coined a
 * name without the host having to thread an owner through.
 */
export function declareModMessageTypes(
  records: readonly unknown[] | undefined | null,
  targets: MessageDeclarationTargets = {},
): MessageDeclarationResult {
  if (records === undefined || records === null) return EMPTY;
  const messages = targets.messages ?? messageTypes;
  const sounds = targets.sounds ?? soundPrefRegistry;
  const declared: DeclaredMessageType[] = [];
  const already: ExistingMessageType[] = [];
  const refused: RefusedMessageType[] = [];
  if (!Array.isArray(records)) {
    refused.push({
      name: "<file>",
      owner: null,
      why: "message_type: the file's records must be an array",
    });
    return { declared, already, refused };
  }
  for (const raw of records) {
    if (typeof raw !== "object" || raw === null) {
      refused.push({
        name: "<record>",
        owner: null,
        why: "message_type: each record must be an object",
      });
      continue;
    }
    const rec = raw as MessageTypeRecordJson;
    const owner = provenanceOf(raw)?.owner ?? null;
    if (typeof rec.name !== "string" || rec.name.length === 0) {
      refused.push({
        name: "<unnamed>",
        owner,
        why: "message_type: name must be a non-empty string",
      });
      continue;
    }
    const seen = messages.lookup(rec.name);
    if (seen >= 0) {
      already.push({ name: rec.name, at: seen });
      bindSounds(rec, owner, messages, sounds, refused);
      continue;
    }
    let at: number;
    try {
      at = messages.add(rec.name, rec.sound ?? "", owner ?? undefined);
    } catch (err) {
      refused.push({
        name: rec.name,
        owner,
        why: err instanceof Error ? err.message : String(err),
      });
      bindSounds(rec, owner, messages, sounds, refused);
      continue;
    }
    declared.push({ name: rec.name, at, owner });
    /* The `sound:` half. `soundPrefRegistry.onAdd` is what carries a batch
     * registered after the engine was installed, so this half never had the
     * ordering problem the type declaration had - what it had was a branch. */
    bindSounds(rec, owner, messages, sounds, refused);
  }
  return { declared, already, refused };
}
