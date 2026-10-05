# Headless mod runner

The headless runner boots the game under Node with one or more mods, plays a short scripted session, and writes a JSON report of what each mod did. It loads mods through the same loader the game uses at boot, so a mod meets the same manifest, engine, ABI and capability gates it meets in a real install. It needs no browser and no network.

**WARNING: The runner imports mod code with the full privileges of the host process. It is not a sandbox. Untrusted mods must only run inside an ephemeral OS sandbox that restricts filesystem, network and process access.**

## Running it

From the repository root, after `pnpm install` and `pnpm build`:

```sh
pnpm mod-runner path/to/your-mod [more folders] [--seed 20260715] [--enable id,id] [--out report.json]
```

Each folder is either one mod (it holds `manifest.json`) or a directory of mod folders, such as a staged payload directory. A mod is listed under the id in its manifest, whatever its folder is called. Every mod found is turned on unless `--enable` names the ones to use, in load order. The report goes to standard output, or to the file named by `--out`, and anything the game or a mod logs goes to standard error. The exit status is 0 when the run passed, 1 when it did not, and 2 for a usage error.

Code that wants the report as data calls `runHeadless({ source: nodeModsSource([folder]) })` from `packages/web/src/mod-runner/`. The loader uses `import.meta.glob`, so the module has to run under Vite or vitest. The command-line script imports it through Vite's module runner.

Each run creates a fresh module graph for the mods and their dependencies. An injected `importer` owns its own module state. Library calls must finish one run before starting another because the game host uses shared registries and stores.

## The session

The runner plays the same session twice from the same seed: first with every mod off, then with the mods on. Each session starts a new character at dungeon level 1, waits five turns, takes the stairs down, waits two more, and drinks a potion from the pack. It then tears the mods down, saves, reads the save back, loads it, registers the mods again, waits three turns, and tears them down a last time.

Each mod is granted the capabilities its manifest asks for, so a refused capability means the mod used one it does not declare. Every call into a mod goes through the game's health monitor with switch-off turned on, and the monitor holds each mod to the `budget.msPerTurn` in its manifest, or 50 ms per turn when there is none (500 ms at most).

Plugin imports and registration follow the enabled load order. Character storage reads and writes the current game's save bags, including after reload. Teardown runs even when a session step fails, and cleanup failures have their own phase outcome. The runner observes promise failures from before imports through a one-second completion period after the session. A returned callback promise still pending at that deadline fails the run. Detached work scheduled beyond that period is outside the check.

## The report

The report is a `neo-angband/mod/headless-run` document, schema version 1, defined in `packages/mod-sdk/src/json/headless-run.ts` and exported from the SDK as `headlessRunFormat`. Its `data` holds:

| Field | What it holds |
| --- | --- |
| `passed` | True when both sessions booted, no phase failed, no promise rejection was unattributed, no finding is `serious` or `block`, and every check above a note ran. Directory failures and requested candidates with invalid manifests fail the run. A Worker host must return an explicit result for every requested Worker. |
| `booted`, `engine`, `seed` | Whether the game started with the mods on, the engine version and the seed. |
| `mods` | Each mod's id, version, runtime (`data`, `in-process` or `worker`) and whether the loader accepted it. |
| `phases` | Each step of the session with mods on: `load`, `boot`, `register`, `turns`, `level-change`, `inventory`, `save-reload`, `teardown`, `parity` and `worker`, each `passed`, `failed`, `skipped` or `could-not-check`. |
| `health` | Per mod: its budget, calls, CPU time, worst call and where it was, faults, turns over budget, ceiling breaches, whether it was switched off, refused capabilities and rejected promises. |
| `parity` | The save digests with mods off and on, and whether they `match`, show `drift`, are `not-applicable` or `could-not-check`. |
| `events` | Events the game emitted while mods were registered, and how many reached a listener the runner adds after every mod's. |
| `unattributedRejections` | Promise failures that no stack could trace to a mod; any such failure prevents a passing verdict. The CLI observes process rejections; library callers opt in with `watchProcess: true`. |
| `reports` | One `ModFindingReport` per mod (`packages/mod-sdk/src/mod-findings.ts`), with source tool `headless-runner`. |

The findings use these rule ids:

| Rule | When |
| --- | --- |
| `runner/load-problem` | The loader reported a problem with the mod: a manifest that will not validate, a ref that resolves to nothing, code that will not import. |
| `runner/not-found` | `--enable` names an id no folder provides. |
| `runner/boot-failed`, `runner/session-failed` | A step of the session threw with the mods on and not with them off. |
| `runner/listener-fault`, `runner/hook-fault`, `runner/register-fault`, `runner/teardown-fault` | The mod threw from an event listener, a hook, `register()` or `uninstall()`. Repeats of one fault are counted in one finding. |
| `runner/unhandled-rejection` | A promise from the mod rejected and nothing handled it. |
| `runner/async-unfinished` | A returned callback promise did not settle before the completion deadline. |
| `runner/capability-refused` | The mod used a capability its manifest does not grant. |
| `runner/switched-off` | Three faults within 200 turns switched the mod off for the session. |
| `runner/over-budget` | The mod went over its time budget in a turn. Past the 500 ms ceiling, the finding is serious. |
| `runner/event-isolation` | An event stopped before reaching every listener, which happens when a mod adds a throwing listener to `ctx.state.events` instead of `ctx.events`. |
| `runner/parity-drift` | The save differs with the mods on and no mod declares `affectsGameplay`. |
| `runner/parity-unchecked` | A mod declares `nondeterministic`, so the saves were not compared. |
| `runner/worker-unsupported` | A Worker-tier mod, reported as "Could not check: Worker tier not supported headless yet." |

The parity digest covers the game world in the save. It leaves out the message log and the blocks that describe the mod set (`manifest`, `mods`, `sectionBirth`, `orphans`), so a mod that only rewords messages still matches.

## What it cannot check yet

- Worker-tier mods load as far as the loader's checks and are then reported as not checked. The runner takes a `workerHost` option for a host that can start them under Node.
- Nothing is drawn, so the runner does not test panels, front ends or tile packs, and it sends no key or pointer input.
- A plugin's module is imported once per run, so any state it keeps at module level carries across the save and reload.
- Saved data migration (`migrateBag`) does not run.
- An in-process call that never returns cannot be stopped, and the run hangs with it.
