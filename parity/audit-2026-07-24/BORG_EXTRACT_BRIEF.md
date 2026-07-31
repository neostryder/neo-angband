# Borg Extraction Brief (Grok writer)

neostryder's directive (2026-07-25): "I intended Borg to be extracted during the port and handled
as a standalone mod. It should never have made it into the main code. This needs to be
reversed. The mod framework *should* be included in the initial port, but remain unused
until the mods come along."

The port = the ORIGINAL GAME ONLY. The Borg is not in original Angband 4.2.x, so no Borg
code may be reachable from the game shell.

## Goal
Remove the Borg from the game (web shell + its package graph) WITHOUT deleting
`packages/borg` from the repo. The Borg becomes a standalone mod in a later phase.

## Do
1. `packages/web/src/main.ts`
   - Remove the import at L185: `import { createBorg, makeCoreResolvers } from "@rpgm-tools/neo-angband-borg";`
   - Remove the Borg construction/usage around L6013-6060 (the `agentId === "borg"` branch,
     `createBorg({ resolvers: makeCoreResolvers({...}) })`, and the borg-specific
     configurable-speed handling that exists only to serve it).
   - Leave the GENERIC agent/automation seam intact if one exists independent of the Borg
     (the mod-facing perceive/act seam must survive) -- only the Borg-specific wiring goes.
     If removing the Borg branch leaves an agent registry with no entries, that is FINE and
     correct: no built-in agents belong in the port.
   - Remove any now-dead imports/vars/types this creates. Do not leave unused code.
2. `packages/web/package.json` - remove the `@rpgm-tools/neo-angband-borg` workspace dependency.
3. Search the WHOLE repo for any other non-test reference reaching borg from game code
   (`grep -rn "@rpgm-tools/neo-angband-borg" packages --include=*.ts --include=*.json`, excluding
   `packages/borg/**`) and remove those too.
4. DO NOT touch `packages/borg/**` itself -- it stays in the repo, untouched, for the later
   mod phase.
5. DO NOT touch the mod framework: `packages/core/src/mod/**` and `packages/mod-sdk/**`
   STAY in the port (present but unused until mods arrive). Do not remove or gut them.
6. Do not change any parity/game-logic behavior. This is a decoupling change only.

## Verify (chunked; NEVER run a monolithic `pnpm test`)
`packages/borg/src/think.test.ts` and `foundation.test.ts` HANG (pre-existing infinite loop,
unrelated to this work) -- so exclude packages/borg from test runs. Run:
```
pnpm typecheck
timeout 600 pnpm vitest run packages/web --testTimeout=20000
timeout 600 pnpm vitest run packages/core/src/game packages/core/src/session --testTimeout=20000
```
Check the vitest exit status (124 = hang/timeout). If a web test exists ONLY to test the
borg wiring in the shell, removing/adjusting it is correct -- say which and why.

## Report (stdout)
Files changed, what was removed, confirmation that packages/borg and the mod framework were
left intact, and the typecheck + test results. End with: `BORG EXTRACTED tests <pass|fail>`.
Do NOT commit or push; leave changes in the working tree. ASCII only.
