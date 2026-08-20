/**
 * Tutorial 5: the smallest mod that runs code.
 *
 * A mod that ships behaviour default-exports one object. `hooks(ctx)` returns a
 * ModHooks - a plain object whose keys are the behaviour points core will ask
 * about. Here that is exactly one key, and everything else in the game is
 * untouched.
 *
 * `messageText` is handed every player-visible message on its way to the message
 * line, and returns the text to show. Core's rule for this hook is worth knowing
 * before you use it: a message hook may RESTATE a message, never change what it
 * means. "Congratulations!" in front of a level-up is a restatement. Turning
 * "You are poisoned." into "You feel fine." would not be, and would make the game
 * lie to the player.
 */
export default {
  api: 1,

  hooks() {
    return {
      messageText: (raw) =>
        raw.startsWith("Welcome to level ") ? `Congratulations! ${raw}` : raw,
    };
  },
};
