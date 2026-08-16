/**
 * VISIBLE AGENT MODE: `NEO_ANGBAND_AGENT=<id>` starts the desktop build with an
 * agent driving the game in the window you are watching.
 *
 * The renderer already grows this path from a `?agent=` URL parameter (the web
 * package's main.ts, the DEMO_AGENTS block): it installs the agent controller,
 * latches it to one command per tick and lets the normal render loop draw every
 * step. It was reachable in a browser and not from the desktop shell, which is
 * the one place you would actually sit and watch a run.
 *
 * AN ENVIRONMENT VARIABLE AND NOT A COMMAND-LINE SWITCH, deliberately. The
 * shell's argv goes through core's `parseLaunchArgs` (host/args.ts), a port of
 * main.c's option loop down to a usage text copied verbatim from main.c:461-489.
 * A new switch there would have to either corrupt that text or be a switch the
 * usage text does not mention - and this is a port extension, not something
 * upstream has. Chromium's own `--`-prefixed switches are stripped before the
 * game sees them (commandLine() in main.ts), so a `--agent` would have been
 * eaten in any case.
 *
 * WHAT THIS IS NOT. It does not let the MCP server drive this window. That
 * server owns its own headless game (docs/MCP.md, "What it does not do"), and
 * sharing one session between an agent socket and a human needs the in-process
 * host that document already names as unbuilt. This makes an agent WATCHABLE; it
 * does not make a running game ATTACHABLE.
 *
 * The determinism ratchet applies exactly as everywhere else: the renderer
 * installs the controller with `nondeterministic: true`, so a character an agent
 * has driven is flagged for as long as it exists. There is no switch here to
 * avoid that - which is worth saying out loud before someone points this at a
 * character they care about.
 *
 * In its own module rather than in main.ts because main.ts imports `electron`
 * and cannot be loaded by a test.
 */

/**
 * The query string to append to the renderer URL: `?agent=<id>`, or `""` when
 * no agent was asked for.
 */
export function agentQuery(env: NodeJS.ProcessEnv = process.env): string {
  const id = env["NEO_ANGBAND_AGENT"]?.trim();
  if (!id) return "";
  /* Encoded rather than interpolated: this value comes from the environment and
   * is about to become part of a URL. The renderer looks the id up in a fixed
   * table and ignores anything it does not know, so an unknown id is inert - but
   * an unencoded `&` would still be able to add a second parameter. */
  return `?agent=${encodeURIComponent(id)}`;
}
