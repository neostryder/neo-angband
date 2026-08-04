# Working in this repository

Notes for an AI assistant working on Neo Angband. Short on purpose — everything
here is a rule that has already been learned the expensive way at least once.

## Verifying that something RENDERS

Neo Angband draws to a `<canvas>`. Three different instruments claim to tell you
what is on it, and two of them are lying:

| Instrument | What it actually proves |
|---|---|
| `window.__neo.screen()` | the cell **grid**. A fully populated grid can sit behind a blank canvas. It is also **absent from production builds** — `import.meta.env.DEV` strips it. |
| A headless / non-compositing browser | nothing. A page that is never painted reports `canvas.width === 0` and `visibilityState === "hidden"`, and no amount of reloading changes that. |
| The installed desktop build over CDP | the pixels. This is the one. |

**So: verify rendering by driving the installed Electron build.**

```
"Neo Angband.exe" --remote-debugging-port=9333
# then GET http://127.0.0.1:9333/json/list for the page target's webSocketDebuggerUrl
```

Chromium consumes `--remote-debugging-port` before the app's own argument parser
sees it, so this is supported rather than lucky. Node has a global `WebSocket`,
so CDP needs no dependency: `Runtime.evaluate` and `Page.captureScreenshot` are
the whole toolkit.

Four things that will otherwise cost you an hour each:

1. **`Input.dispatchKeyEvent` is silently dropped** (`rejected by interface
   blink.mojom.WidgetHost`). Dispatch a synthetic `KeyboardEvent` on `#game`
   through `Runtime.evaluate` instead, with `bubbles: true`.
2. **A "did my key land" listener reads zero even when the key worked** — the
   game registers a capture-phase listener at startup and calls
   `stopImmediatePropagation`. Trust the screenshot and the lit-pixel count.
3. **Allow 3–4 seconds after launch** before evaluating anything. Earlier than
   that, `document.body` can still be null and a screenshot photographs the
   *previous* build's last frame.
4. **Menu letters are positional** and shift as mods are installed. Screenshot
   the menu before choosing a letter, or arrow to the row.

If the harness cannot produce pixels, say so and stop. A rendering claim with no
pixels behind it is worse than an admitted gap.

## Versions

`node tools/version.mjs` is the only supported way to bump. It refuses anything
that is not a legal semver successor, refuses `1.0.0` without `--release`, and
covers every site that spells the version out — including prose in
`CHANGELOG.md` and the example tag in `docs/RELEASING.md`.

A version written in a comment is not kept in sync by the comment saying so. If
two places must agree, derive one from the other or write the test that fails
when they part.

## Tags

**Never `git push --tags` or `--follow-tags` here.** This history descends from
Angband's, so around 1,442 upstream tags are genuine ancestors of `master` and
those flags will push all of them. Push the one tag by name:

```
git push origin master v0.18.0
```

## Releases

`docs/RELEASING.md` is the runbook. Two things about it that are easy to get
wrong:

- A **draft** release is invisible to `gh release view` and to
  `gh api .../releases/tags/<tag>` — both 404. That is the same mechanism that
  hides a draft from the in-game updater. Read a draft's assets from
  `gh api .../releases` and filter on `tag_name`.
- Smoke the **release artifact**, not a local build, and unpack it to a **short
  path** — Chromium fails to create its disk cache past MAX_PATH and the error
  looks like a broken build. Deep temp directories are out for that reason, so
  scratch installs go in **`C:\Temp\na\`** (`dev\` for a working copy, `smoke\`
  for an unpacked artifact) and nowhere else. Never at the drive root: four
  `C:\na-*` folders accumulated there before this was written down.

## Mods

- Core stays a faithful reproduction of Angband 4.2.6. Fixes go in the
  `bug-fixes` mod, conveniences in `qol`. A flag-gated fix inside core is still
  inside core.
- A plugin's `hooks(ctx)` **never** receives `ctx.state`. The host composes every
  mod's hooks *before* `startGame`, because the composed `ModHooks` is an
  argument to it. Only `register(host, ctx)` runs with a live game. See
  `docs/modding/PLUGINS.md`.
- Catalogue entries are pinned by digest. Fetch the file from
  `raw.githubusercontent.com` **at the tag** and hash the bytes on disk —
  `printf '%s' "$body" | sha256sum` strips the trailing newline and produces a
  hash that is wrong by one byte.

## Tests

- A test that constructs the object production code will receive is an
  *assertion about the producer*, and an unchecked one. Where it matters, derive
  the fixture from the real producer or add one test that runs it.
- `MOD_CANARY=1 pnpm --dir packages/web exec vitest run src/mod-canary.test.ts`
  is the only test that runs the bytes a player downloads.
