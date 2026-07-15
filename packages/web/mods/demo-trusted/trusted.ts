/**
 * A bundled TRUSTED in-process plugin that overrides game SYSTEMS (W2.2), the
 * counterpart to the untrusted Worker demo (mods/demo-sandbox). Where the
 * sandbox demo can only perceive and act, this plugin reaches into the four
 * runtime registries through the capability-gated ModRegistryHost and changes
 * how the game itself behaves:
 *
 * - monsters: installs a monster-AI turn hook that freezes every monster
 *   (stasis) - a TOTAL replacement of the ported mon-move.c decision, the most
 *   visible proof that AI logic (not just data) is moddable.
 * - effects:  registers a brand-new effect code (the mod extension surface).
 * - rooms:    registers a new level builder, referenceable from a modded
 *   dungeon profile.
 * - commands: registers a new player-command action.
 *
 * It declares all four registry:* capabilities in its manifest; the host builds
 * a CapabilitySet from that and each facade is gated by it (drop a capability
 * from the manifest and the matching call throws). Being in-process and trusted,
 * it imports core symbols directly - there is no serialization boundary.
 *
 * Enable with ?trusted=demo-trusted (disabled by default).
 */

import { defineTrustedPlugin } from "../../src/agents/trusted/runtime";

export default defineTrustedPlugin({
  register(host, ctx) {
    // Monster AI override: return true to consume the whole turn before any AI
    // RNG is drawn, so every monster simply stands still. This wholly replaces
    // the ported movement/attack AI - logic, not data. The counter + one-time
    // message make it observable that the hook is actually consulted by the live
    // turn loop (a DEV verification aid).
    let hookCalls = 0;
    host.monsters.setTurnHook((_mon, s) => {
      hookCalls += 1;
      if (hookCalls === 1) {
        s.msg("[demo-trusted] monster AI override active: monsters are frozen");
      }
      (globalThis as { __trustedHookCalls?: number }).__trustedHookCalls = hookCalls;
      return true;
    });
    ctx.log("monster AI overridden: every monster is frozen (stasis)");

    // A brand-new effect code (the mod extension surface for effect logic).
    host.effects.register("demo:pulse", {
      handler: () => true,
      desc: "a harmless demo pulse",
    });
    ctx.log(`effect "demo:pulse" registered=${host.effects.isRegistered("demo:pulse")}`);

    // A new room/level builder, referenceable from a (modded) dungeon profile.
    host.rooms.register("demo:void", () => false);
    ctx.log('room builder "demo:void" registered');

    // A brand-new player-command action: pushing { code: "demo-wave" } runs this
    // in the real turn loop (processPlayer looks it up in the same registry the
    // core commands live in). It emits a message so the override is observable.
    host.commands.register("demo-wave", (s) => {
      s.msg("[demo-trusted] new command 'demo-wave' executed by the mod");
      return 0;
    });
    ctx.log(`command "demo-wave" registered=${host.commands.has("demo-wave")}`);

    ctx.log("all four registry facades exercised under their capability gates");
  },
});
