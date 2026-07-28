/**
 * do_cmd_try_borg (cmd-misc.c:118-145): the Borg's activation gate.
 *
 * Upstream guards the borg commands the same way it guards the debug ones -
 * warn, confirm once, and mark the savefile NOSCORE_BORG so the character can
 * never be scored again. It is a SEPARATE function from do_cmd_try_debug, and
 * the port's census had it written off as "the Borg ships as a mod, so there is
 * no gate to pass". That was wrong twice: the gate is what SETS NOSCORE_BORG (so
 * without it a Borg-driven character stays eligible for the high scores), and
 * shipping as a mod is a statement about where the code lives, not about whether
 * the behaviour exists.
 *
 * It lives here rather than in core because the whole Borg does (decision 31,
 * Borg is a bundled mod on the perceive/act API). The host supplies the message
 * and confirm sinks; core already carries NOSCORE.BORG and enterScore already
 * reports it, so the only missing piece was this.
 *
 * The gate is deliberately NOT wired into a key here: the Borg mod is not yet
 * mounted in the web shell, and binding a key from inside the mod package would
 * be the shell's job anyway. Whatever mounts the Borg calls this first - see the
 * `borgActivate` contract below.
 */

/** The two warnings, verbatim (cmd-misc.c:131-132). */
export const BORG_CONFIRM_MSG_1 =
  "You are about to use the dangerous, unsupported, borg commands!";
export const BORG_CONFIRM_MSG_2 =
  "Your machine may crash, and your savefile may become corrupted!";

/** get_check's prompt (cmd-misc.c:136), trailing space included. */
export const BORG_CONFIRM =
  "Are you sure you want to use the borg commands? ";

/** NOSCORE_BORG (player.h). Mirrors core's NOSCORE.BORG; kept local so the mod
 * does not need a core import for one bit. */
export const NOSCORE_BORG = 0x0020;

/** What the gate needs from its host. */
export interface BorgActivateHost {
  /** The player's noscore bitfield (player->noscore). */
  noscore: number;
  /** msg(): the two warnings. */
  msg: (text: string) => void;
  /** get_check(): y/Y only, anything else is No. */
  confirm: (prompt: string) => boolean | Promise<boolean>;
  /**
   * event_signal(EVENT_MESSAGE_FLUSH) (cmd-misc.c:133): show the warnings before
   * the prompt blocks on them. Optional - a host with no pager can omit it.
   */
  flush?: () => void;
  /** player->noscore |= NOSCORE_BORG, and mark the save dirty. */
  setNoscoreBorg: () => void;
}

/**
 * Ask, once per character, before handing control to the Borg. Returns whether
 * the Borg may run.
 *
 * On the first acceptance this sets NOSCORE_BORG, which is permanent: upstream
 * never clears it, and enterScore (score/score.ts) refuses a score for it.
 * Declining leaves the flag alone, so the next attempt asks again.
 */
export async function borgActivate(host: BorgActivateHost): Promise<boolean> {
  /* Ask first time (cmd-misc.c:127). */
  if (host.noscore & NOSCORE_BORG) return true;

  /* Mention effects. */
  host.msg(BORG_CONFIRM_MSG_1);
  host.msg(BORG_CONFIRM_MSG_2);
  host.flush?.();

  /* Verify request. */
  if (!(await host.confirm(BORG_CONFIRM))) return false;

  /* Mark savefile. */
  host.setNoscoreBorg();
  return true;
}
