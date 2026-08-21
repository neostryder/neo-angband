/**
 * Tutorial 6: the same mod as Tutorial 5, with a switch the player controls.
 *
 * The switch is declared in manifest.json under `rules`, and the host resolves it
 * before your code runs: `ctx.flags` maps every flag you declared to the player's
 * choice, defaulting to the `default` in the manifest. So reading it is a plain
 * property read - there is no settings API to learn, and no storage to manage.
 *
 * Note where the check goes. It is in `hooks`, around whether the hook is
 * SUPPLIED at all - not inside `messageText`, returning `raw` unchanged. Both look
 * identical to the player, but only this one leaves core running its own untouched
 * path when the option is off, instead of running core's message through a
 * function of this mod's on every single message.
 */
export default {
  api: 1,

  hooks(ctx) {
    if (ctx.flags["tutorial-06-add-an-option.congratulate"] !== true) return {};
    return {
      messageText: (raw) =>
        raw.startsWith("Welcome to level ") ? `Congratulations! ${raw}` : raw,
    };
  },
};
