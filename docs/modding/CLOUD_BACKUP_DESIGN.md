# Cloud backup via a player-chosen folder (ticket #133)

**Status, 2026-08-15: engine side DONE, mod side BLOCKED.** Ticket #133 is one
sentence: "QoL: hands-off cloud backup via a player-chosen folder." This
document is the rest of it: what defect it closes, where it lives, and the
seams it needs. `ctx.backupFolder` exists end-to-end (both platforms,
capability-gated, `hooks(ctx)` and `register(ctx)` both see it, `persistSave`
notifies every consenting mod); see §"File-by-file implementation plan" steps
0-5, all DONE.

Two steps are NOT done. **Step 6**, the `neo-angband-mod-qol` menu row that
would let a player actually call `choose()`, cannot be finished small: it is
blocked on a UI-seam gap ("menu row -> runs a mod's own callback") that this
design's §3 assumed existed and does not; see the correction there. That gap is
the same shape as `MOD_REACH.md` gap 21 and is deferred alongside it, so the
alpha could ship before every remaining seam was finished. **Step 7**, the docs,
has not been done either: `MOD_SEAMS.md` has no section for `ctx.backupFolder`
and `docs/modding/README.md` does not mention the `backup:folder` capability, so
the only place an author meets either is `PLUGINS.md` in passing. A capability
an author cannot find is a capability only its first consumer uses.

---

## The gap this closes

`packages/web/src/storage-page.ts:1-26` states the risk this ticket answers, in
the game's own words:

> Everything this game has ever saved lives in browser storage - the roster in
> localStorage, the installed mods in IndexedDB - and on the desktop build that
> is just as true... The consequence is not obvious to anybody who has not been
> told: a routine "clear browsing data", a disk-cleanup tool, or a profile reset
> takes every character AND every installed mod, at once, with no undo and
> nothing on disk to recover from.

Today's answer is **`exportCharacter`** (`packages/web/src/main.ts:10319-10360`):
the player opens the roster, presses a key, and downloads one `.neochar` file for
one character. It is a real safety net and it is entirely manual: a player who
forgets, or who has six characters and exports one, is exactly as exposed as
before. Ticket #133 asks for the same bytes to leave the browser **without the
player doing anything after the first setup**: point the game at a folder once,
and every save after that lands there too, so a sync client the player already
runs (Dropbox, OneDrive, Syncthing, anything watching a folder) carries it
off-machine on its own schedule.

This is not a new file format and not a new transport. It is automating a
button the game already has.

---

## Platform truth, verified against the code rather than assumed

Two claims this design depends on, checked against the source rather than
carried forward from an earlier phase:

**1. A character's save is *not* a real file on either platform.**
`roster.ts:1-13` says it in the header, and `writeSlot` (`roster.ts:157-161`)
proves it: every character's bytes live under `neo-angband-save:<id>` in
`localStorage`, on desktop exactly as in a browser tab. `save-transfer.ts:6-11`
independently confirms this from the export side: *"the desktop build is the
SAME web bundle running inside Electron, and it keeps the roster in localStorage
exactly as a browser tab does... `writeSlot` goes to `localStorage` on both
platforms, and nothing about the desktop host's real-file capability touches the
roster."* So the memory note "saves are NOT real files on desktop" is current
truth as of this reading, not a stale carry-forward.

**2. The desktop shell's real-filesystem bridge cannot be repurposed for this.**
`packages/core/src/host/bridge.ts:59-68` and `packages/core/src/host/io.ts`'s
`HostDir` enumerate exactly the five directories upstream's `init.c` recognises
(`USER`, `SAVE`, `PANIC`, `SCORES`, `ARCHIVE`), and `serveRawFs`
(`bridge.ts:139-193`) refuses any directory that is not one of them
(`isHostDir`, `bridge.ts:60-68`). That is deliberate fidelity to `z-file.c`, not
an oversight, and stretching it to accept an arbitrary player-chosen path would
be widening a faithful port's own security boundary for a feature that is not
upstream's. **This bridge is the wrong tool.** A player-chosen backup folder is
not one of upstream's five ANGBAND_DIR_* constants and must not be made to look
like one.

**3. The right tool is already in the tree, proven, just not writable yet.**
`packages/web/src/mod-folder.ts` is the "Load mod folder" feature: it calls
`showDirectoryPicker()` (the File System Access API), persists the returned
`FileSystemDirectoryHandle` in IndexedDB because *"a directory handle is a live
object, not a path: it cannot be stringified into localStorage"*
(`mod-folder.ts:104-113`), and re-reads the same folder on every later launch
with no re-prompt. `parity/PLATFORM.md:124-147` records that this already works
on **both** shipping front ends, the browser tab and the Electron shell, since
the desktop build is the same Chromium renderer serving the same origin
(`sandbox: true` in `packages/desktop/src/main.ts:1352-1356` does not disable a
web platform API; it disables Node integration, which this API never needed).
Firefox and Safari cannot pick a directory at all, which is exactly what
`folderPickingSupported()` (`mod-folder.ts:90-100`) already exists to detect and
report.

Everything mod-folder.ts does is **read-only** (`mode: "read"`,
`mod-folder.ts:191`). Nothing in the tree opens a handle `"readwrite"` or calls
`getFileHandle(name, { create: true })` / `createWritable()`. That is the one
genuinely new capability this ticket needs, not a new platform mechanism, a new
*mode* on a mechanism already shipping.

**Checked on the real build, and the answer is no.** The claim above was
reasoned rather than measured: that `showDirectoryPicker({ mode: "readwrite" })`
would succeed in the installed desktop shell exactly as the read-mode call
already does, because it is the same Chromium engine, the same origin, the same
API surface, and `sandbox: true` gates Node integration rather than File System
Access. Driven over CDP against the installed build instead of inferred: the
dialog opens, a folder can be chosen, and the underlying promise then **never
resolves**: a second call afterward fails immediately with `NotAllowedError:
"File picker already active"`, proving the first call's internal state never
clears even though the OS-level interaction completed. `packages/desktop/src`
wires no `session.setPermissionRequestHandler` (grepped, confirmed absent), so
Chromium draws the picker but this app never completes the permission grant
behind it, and the call hangs forever. This is exactly the failure §9 step 0
anticipated a possible answer to, and it is the one that happened.

**The fallback, now implemented rather than merely named.** `showDirectoryPicker`
is abandoned for the desktop platform; `BACKUP_CHANNEL`
(`packages/desktop/src/bridge-channel.ts`) is the native replacement:
`dialog.showOpenDialog` for the picker, a small JSON record beside `mods/`
(`packages/desktop/src/backup-folder.ts`) for what a browser handle would have
remembered, `fs.writeFileSync` for the write. It keeps the same trust boundary
`MOD_ZIP_CHANNEL` and the updater's `staged` already established: the chosen
**path** never crosses the channel toward the renderer in either direction:
only a display name and `{ok}` booleans do, and `write` takes a leaf file name
checked the same way `isModZipName` checks one. This happens to make the
capability's own promise ("the mod never learns the folder's real path") true of
the IPC boundary as well as the mod boundary, for free. The browser-tab build is
untouched and keeps `showDirectoryPicker` from `mod-folder.ts`; only the
Electron shell was measured broken, and nothing here says the browser tab is.
§9's step 3 (`mod-backup.ts`) now needs a per-platform `BackupFolder`
implementation rather than one shared one: desktop calls `neoDesktop.backup(op,
arg)`, the browser tab keeps the File System Access path.

---

## The design: qol mod, two small host seams, zero core changes

**This lives entirely in `neo-angband-mod-qol`, and it needs two additions to
`packages/web/src` (not `packages/core`).** Argued in three parts.

**It is not core's**, on the same grounds every other qol feature is excluded:
faithful 4.2.6 has no concept of a backup folder, and a flag-gated version of
one inside core would still be inside core (PORT_PLAN.md decisions 17 and 18).
Nothing here touches gameplay, RNG, or a save's *contents*, only what happens
to the bytes after a save already landed.

**It is not core's *seam*, either, and this is the finer point.** Compare
against the two existing precedents for a host-fired notification:

- `ModHooks.optionsChanged` and `ModHooks.saveNoiseScent`
  (`docs/modding/MOD_SEAMS.md:112-232`) are declared in **core**
  (`packages/core/src/mod/hooks.ts`) and folded by `composeModHooks`, even though
  both are fired from host code (`options.ts`, `session/save.ts`). They earn
  that placement because they are notifications about something **core's own
  `GameState` owns**: option state, the noise/scent heatmaps.
- A backup folder is a concept core has never heard of and never needs to: it is
  a browser API, a directory handle, and bytes the host already produced. Adding
  it to `ModHooks` would put a `FileSystemDirectoryHandle`-shaped idea one
  `import` away from `packages/core/src`, for a feature core cannot exercise
  (core has no DOM).

So the right home is the **same shelf `frontend`, `hud`, `menu`, `screen`, and
`regions` sit on** (`packages/web/src/mod-plugin.ts:262-507`): host-only
`ModPlugin` members, dispatched entirely from `packages/web`, that `packages/core`
never imports and never mentions. This ticket adds **no line to
`packages/core`**, a stronger and more checkable claim than "core is
unaffected," and the file-by-file plan in §9 is written so that claim stays
true.

**The rejected alternative: a new `ModHooks` member, `afterSave`.** It was the
first design considered, on the grounds that persistSave is a "moment
something happened" exactly like the options menu closing. Rejected because it
would require `packages/core/src/mod/hooks.ts` to grow a member whose payload
(save bytes, a suggested filename, a folder handle) is meaningless to core, is
never read by any core call site, and exists solely so a host-side notification
can ride on a core-side bus. That is the flag-gated-fix mistake in a new shape:
the seam would live in core, in service of a mod that isn't core's concern,
forever after the mod that needed it is uninstalled.

---

## What ticket #133 actually needs from the engine

Following `neo-angband-mod-qol`'s own README convention ("it needs N things from
the engine, and all three are general seams rather than anything named after
this mod"): this feature needs **one new `ctx` field**, gated by **one new
capability**, plus **one new command surface reached through capabilities the
mod system already has**. Nothing else.

### 1. `ctx.backupFolder`, the generic folder primitive

Added to `ModPluginContext` (`packages/web/src/mod-plugin.ts:184-252`), built in
`modPluginContext()` (`packages/web/src/mod-context.ts:36-68`) exactly the way
`ctx.prefs` is built there today, as a `session`-supplied override defaulting to
a real implementation, so a test can inject a fake the same way
`ModSessionFacts.prefs` already lets one:

```ts
export interface BackupFolder {
  /** The remembered folder's display name, or null if none is chosen. Never
   *  prompts - a query, like folderPermission's non-request path. */
  name(): Promise<string | null>;
  /** Ask the player to choose (or replace) the folder. MUST be called from a
   *  user gesture - see §3. Null means the player cancelled, which is not an
   *  error and must not be reported as one (mod-folder.ts's own rule). */
  choose(): Promise<string | null>;
  /** Forget the folder. write() becomes a silent no-op until choose() runs again. */
  forget(): Promise<void>;
  /** Write one file into the chosen folder, creating it if absent. False - never
   *  throws - if there is no folder, permission has lapsed, or the write failed. */
  write(name: string, text: string): Promise<boolean>;
  /**
   * Replace this mod's "a save just landed" callback. There is exactly one per
   * mod; calling again replaces it, matching setPrefErrorPolicy's "last call
   * from hooks(ctx) wins" shape. `file` is a COMPLETE, already-encoded transfer
   * file - see §2 - so the mod never touches save bytes directly.
   */
  onSave(fn: (file: { readonly name: string; readonly text: string }) => void): void;
}
```

Present only when the mod's manifest declares the new capability (below) **and**
`folderPickingSupported()`-equivalent is true on this front end; `undefined`
otherwise: the same shape `ctx.assetUrl` and `ctx.prefs` already use for "this
concept exists on every platform, but sometimes there is nothing behind it,"
except here absence is possible for two independent reasons (no consent, no
API) and either one must degrade to `undefined` rather than a facade that throws
on first use. A mod checks `if (!ctx.backupFolder) return;` in `hooks(ctx)`, the
same guard `rememberSettings` already uses for `ctx.core.setPrefErrorPolicy`.

**Why this is a `ctx` field and not a sixth owner-seam member on `ModPlugin`.**
`frontend`/`hud`/`menu`/`screen`/`regions` all exist because something needs to
be **drawn**, and drawing needs a single, well-defined owner (or, for `regions`,
a well-defined stacking order) so two mods cannot paint over each other. Backup
has no such conflict: two mods, each holding their own folder handle, each
writing their own copy after every save, do not collide: there is nothing
shared to fight over. Forcing a single-winner seam onto a feature with no
contention would be solving a problem this feature does not have, purely for
consistency with seams that solved a problem it does *not* share. `ctx.prefs`,
`ctx.assetUrl`, and `ctx.core.setPrefErrorPolicy` are the closer precedents:
each is a **generic primitive**, independently usable by every consenting mod
with no fold rule at all, because nothing about them is single-owner. `onSave`
callbacks are dispatched to **every** mod that registered one, in load order,
which is `optionsChanged`'s ALL-OBSERVE fold translated to a place that isn't
core (§4).

### 2. `backup:folder`, the new capability

Added to `packages/mod-sdk/src/capabilities.ts` alongside `display:replace`,
matching its exact shape: its own `kind`, one fixed action, no domain and no
wildcard, because, like taking the display, there is nothing to range over:

```ts
| { kind: "backup"; action: "folder" }
```

```ts
if (cap === "backup:folder") {
  return { kind: "backup", action: "folder" };
}
```

The doc comment at the top of the file gains one entry in the same prose style
as `display:replace`'s: *"lets the mod write files into a folder the player
picks; the mod never learns the folder's real path (the browser will not say),
only that a write to it succeeded or failed."*

**Why a real capability, and not silent access.** Trusted in-process plugin
code already has the run of every browser global with zero enforcement: a mod
could call `showDirectoryPicker()` today with no manifest entry at all, and
nothing in the runtime would stop it (`docs/modding/PLUGINS.md`: "Plugin code
runs in process, synchronously... it is trusted code... the consent prompt is
the boundary"). That makes the capability a **transparency** device rather than
a hard sandbox wall, exactly like `registry:effect`: the enforcement is that
`ctx.backupFolder` does not *exist* on the object handed to a mod that did not
ask, so a mod that wants it declares it, the player sees the plain-language
sentence at install, and a mod that skipped the declaration gets `undefined`
and a name-and-shame report the same way an undeclared `regions()` does, rather
than a working feature nobody consented to.

### 3. A gesture to call `choose()` from

`showDirectoryPicker` must be called from a live user gesture or it throws
`SecurityError` (`mod-folder.ts:152-155` already anticipates and swallows this
exact exception on the read-only path). The Fixes & tweaks submenu
(`packages/web/src/mods.ts`, `managePatches`) is **toggle-only**:
`PackRule` (`packages/mod-sdk/src/manifest.ts:98`) is `{flag, title,
description, default}`, pure declarative JSON with no attached code, evaluated
generically by `resolveModRules` with no knowledge of which mod owns which
flag. Retrofitting an "action row that runs mod code" into that model breaks
the one property that makes it safe to evaluate generically today, so this
design does not touch it.

**CORRECTION (2026-08-15, verified against the code rather than assumed, the
same discipline this doc's §"Platform truth" already used once): the seam this
section proposed does not exist.** The paragraph below described
`registry:command` as a generic "run this mod code from a menu row" seam. It is
not: `CommandFacade.register(code, action)` takes a `PlayerAction`
(`packages/core/src/game/player-turn.ts:103`: `(state: GameState, cmd:
PlayerCommand) => number`), a real gameplay-turn action that consumes energy
and returns an energy cost. `host.commands.register("qol:choose-backup-folder",
async () => {...})` as written below does not type-check against that
signature, and even forced through, nothing would call it: `core:game-menu`'s
own row selection is resolved by `gameMenuOnce()` (`packages/web/src/main.ts`)
switching on a small CLOSED set of hardcoded action strings, with a `default:`
arm that silently does nothing. A `registry:menu` transformer can add a ROW
(label, semantic tag) but nothing bridges "the player picked a mod's row" to
"run the mod's registered command" for an invented action string, confirmed
by reading `selectFromMenu` (`packages/web/src/overlay.ts:1416-1440`), which
resolves a pick back to the ORIGINAL row's index and, on the faithful-shell
picker path, explicitly keeps re-asking rather than acting on a row with no
source index. No shipped mod (borg, bug-fixes, linoleum) uses
`commands.register`/`menus.register` in production; only test fixtures do.

So the worked example below is aspirational, not built, and building the
missing half (a real "menu row selection dispatches to a mod's own callback"
seam) is itself new UI-seam work of the same kind gap 21 (`MOD_REACH.md`)
already covers and neostryder deferred past alpha on 2026-08-15. This section
is left in place, corrected, as the plan to pick back up when that work
resumes, not as something #133 can still finish small. What ships instead:
`ctx.backupFolder` (§1) end-to-end and capability-gated, with no
player-visible way to invoke `choose()` yet. A future mod update adds the
actual trigger once the menu-dispatch seam exists.

```ts
// ASPIRATIONAL - does not compile against the real CommandFacade, and nothing
// would call it if it did. Kept for shape, not as instructions to implement.
register(host, ctx) {
  host.commands.register("qol:choose-backup-folder", async () => {
    const name = await backup?.choose();
    ctx.log(name ? `Backing up to "${name}".` : "Cancelled.");
  });
  const previous = host.menus.handlerFor("core:game-menu");
  host.menus.register("core:game-menu", (id, rows) => [
    ...(previous ? previous(id, rows) : rows),
    { id: "qol:choose-backup-folder", label: "Choose cloud-backup folder...",
      semantic: { kind: "command", ref: "qol:choose-backup-folder" } },
  ]);
}
```

The gesture-preservation argument below is unaffected by the correction above:
it is still true of `manageModFolder`, it just is not yet reachable from a
generic mod seam. Kept for whoever builds the real dispatch mechanism.

**Why a picker call reached from a resolved menu selection keeps its user
gesture, checked against this codebase's own precedent rather than assumed.**
`manageModFolder` (`packages/web/src/mods.ts:2001-2076`) already does exactly
this shape today, in production: `await selectFromMenu(...)` resolves a row,
and the very next line, still inside the same `async` continuation, calls
`picker.pick()` -> `pickModFolder()` -> `showDirectoryPicker()`
(`mod-folder.ts:184-200`). That is not a hypothetical: it is the live "Choose
a mods folder..." row, and it is proof that a directory picker call reached
from a resolved menu selection in *this* engine keeps its user activation.
Whatever the real dispatch mechanism turns out to be, it should preserve the
same shape (menu selection -> action -> picker, a handful of microtask hops from
the same keypress) for the same reason: Chromium's transient-activation window
is time-bounded, not call-stack-bounded.

---

## Composition with `persistSave`

**Fire point:** `persistSave()` (`packages/web/src/main.ts:5269-5305`), after
`writeSlot` succeeds (`ok === true`), on **every** call: the throttled 3-second
autosave, the forced saves on level change/options-close/`S`/`switchCharacter`/
`closeGameSave`, all of it. Not gated on `deliberate`: a backup that only
updated on a forced save would silently lag behind up to three seconds of real
play between forced points, which for a folder a sync client watches is exactly
the window "hands-off" was meant to close.

**No new throttle is needed.** `autosave()` (`main.ts:5339-5353`) already
limits the *unforced* path to once per three seconds
(`now - lastSaveMs < 3000`); riding on `persistSave`'s existing chokepoint means
the backup notification inherits that cadence for free, without a second timer
disagreeing with the first about when "unchanged" means "skip."

**What is handed to `onSave`:** the **same file `exportCharacter` already
produces**: `encodeTransfer({ meta, save, engine, exportedAt, lineage })`
(`main.ts:10342-10353`), so the file a backup mod writes into the player's
folder is byte-for-byte a `.neochar` transfer file, importable through the
existing Shift-M flow on any other install, today, with no new reader. This is
the single biggest simplification available and it costs nothing: the host
already builds this string on every export; building it on every save instead
of only a manual one is the same function, called from one more place.

**The one deliberate difference from `exportCharacter`'s filename.**
`transferFilename` (`save-transfer.ts:109-113`) bakes the character's level into
the name (`Bilbo-L12.neochar`) because a manual export is a one-shot snapshot a
player names for themselves. An automatic backup is **overwritten in place**:
every save replaces the same file, so it must be named from something that
does **not** change every level: `lineageOf(meta)` (`roster.ts:176-178`), which
is stable for the character's whole life. The backup filename is therefore
`${slug(meta.name)}-${lineage.slice(0, 8)}.neochar`, human-readable in a
Dropbox folder, and stable so the folder gains one file per *character*, not one
per level-up.

**Fault containment.** Closest precedent is `hud`'s per-mod, per-region scoping
rather than `menu`/`screen`'s single-presenter session-wide rule, because, as
in §1 above, there is no single shared resource for a throw to endanger.
**A throw from one mod's `onSave` callback disables *that mod's* backup for the
rest of the session, reported once by name; every other consenting mod's
callback still runs, and the game's own save is completely unaffected**: the
callback runs *after* `writeSlot` already returned `ok`, so nothing about backup
succeeding or failing can change what `persistSave` reports to the player. This
mirrors `lore_save`'s own failure mode (`main.ts:5293-5299`): reported, and never
allowed to fail the save that prompted it.

---

## Composition with the anti-scum rules: inherited, not re-derived

Because the written file is a real `.neochar` transfer file, **the existing
import gate defends against a backup being used to resurrect a dead
character with zero new code.** `save-transfer.ts:29-44` and `roster.ts:193-217`
already establish the mechanism: a death is recorded by `lineage`
(`recordDeath`, `roster.ts:206-217`) independently of the tombstone, and
`transfer-gate.ts` (cited by `save-transfer.ts:40`) refuses any imported file
"from before a death this roster remembers." A backup file written the moment
before a character died is, from the import gate's point of view, indistinguishable
from a manually exported one: it carries the same `lineage`, and the same
refusal applies. This is worth stating plainly because it is exactly the kind
of gap a new feature can reopen silently: an automatic, frequent, filesystem-level
copy of a save is a more tempting scum vector than an occasional manual export,
and it is closed by the same file format doing the same job it already does,
not by new logic this ticket would otherwise have to write and prove.

---

## Fault and edge-case table

| Case | What happens |
|---|---|
| No folder chosen yet | `ctx.backupFolder` exists, `name()` resolves `null`; the mod's `onSave` is a no-op until `choose()` succeeds. Not an error. |
| Permission lapsed (long gap, browser policy) | `write()` resolves `false` without prompting (no gesture available at save time); the mod logs once and the player re-grants via the same `"Choose cloud-backup folder..."` row, which re-picks rather than needing a distinct "reconnect" affordance. |
| Player cancels the picker | `choose()` resolves `null`. Not an error, not reported (mod-folder.ts's own rule, reused). |
| Firefox / Safari | `folderPickingSupported()`-equivalent is false; `ctx.backupFolder` is `undefined`; the mod's manifest-declared capability is simply never usable there. No dead menu row: the row is only added if `ctx.backupFolder` was present at `hooks(ctx)` time. |
| A save fails (`persistSave` returns `false`) | `onSave` is never called: it fires only after `writeSlot`'s own `ok`, matching "fires only when something actually changed." |
| The mod's `onSave` throws | Reported once by name; that mod's backup stops for the session; the save that triggered it is already complete and unaffected; every other mod's `onSave` still runs. |
| A dead character | The last successful backup before death is the last one written, and `persistSave` is not called again for that slot, `markDead` deletes the *local* bytes but never touches the backup folder. Importing that file later is refused by the existing death ledger (§ above). |
| Two mods both hold `backup:folder` | Both run, independently, in load order: no conflict, no fold rule, by design (§1). |

---

## File-by-file implementation plan

Ordered so the one unverified claim (§ Platform truth, point 3) is checked
before anything is built on top of it.

**0. DONE, verified on the installed desktop build over CDP, and it failed.**
`await window.showDirectoryPicker({ mode: "readwrite" })` opens the dialog and
lets a folder be chosen, but the promise never resolves; a second call fails
outright with `NotAllowedError: "File picker already active"`. See "Platform
truth" above for the full trace. The fallback this step named is now built:
`BACKUP_CHANNEL` in `packages/desktop/src/bridge-channel.ts` +
`packages/desktop/src/backup-folder.ts` (the name rule and the persisted-path
record) + the handler in `main.ts` + `neoDesktop.backup(op, arg)` in
`preload.ts`. Both `capabilities.ts` and `capability-describe.ts` are already
updated (steps 1 below and the consent-prompt switch it turned out to share).

**1. DONE, `packages/mod-sdk/src/capabilities.ts`**: the `backup:folder`
capability: the `ParsedCapability` union member, the `parseCapability` arm, the
`grantCovers` arm, and the doc comment entry, plus its
`describeCapability` arm in `packages/web/src/capability-describe.ts` (an
exhaustive switch the compiler caught missing a case for, and the consent-prompt
text this ticket needed anyway).

**2. `packages/web/src/mod-plugin.ts`**: no new `ModPlugin` member (§1's
ruling). `ModPluginContext` (`:184-252`) gains `readonly backupFolder?:
BackupFolder`, with `BackupFolder` defined beside it, doc-commented in the same
style as the surrounding fields.

**3. `packages/web/src/mod-backup.ts`** (new): the real `BackupFolder`
implementation, now **per platform** rather than one shared one (step 0's
finding): on desktop, every method calls `window.neoDesktop.backup(op, arg)`:
`"choose"`/`"name"`/`"forget"`/`"write"` map directly onto `BackupFolder`'s own
four methods, and there is no handle to persist because the main process
already persists the path. On the browser tab, the original plan stands:
`showDirectoryPicker({ mode: "readwrite" })`, an IndexedDB store for the handle
(reusing `idb.ts`'s existing `openDb`/`idbGet`/`idbPut` plumbing
that `mod-folder.ts` already depends on, under its own key rather than
`mod-folder.ts`'s `modsDir`), `queryPermission`/`requestPermission` exactly as
`folderPermission` (`mod-folder.ts:160-175`) already does, and `write()` via
`getFileHandle(name, { create: true }).createWritable()`. This module has no
mod-specific knowledge: one instance is capable of serving any number of
consenting mods, each with its own remembered handle keyed by mod id.

**4. `packages/web/src/mod-context.ts`**: `modPluginContext()` gains a
`session.backupFolder` override slot (mirroring `session.prefs`,
`mod-context.ts:59`) and, when no override is given, constructs the real
`mod-backup.ts` instance **only if** the caller says this mod's capability set
includes `backup:folder` (the same per-mod `CapabilitySet` check that already
gates the `register()` host facade, wired at whichever existing call site
computes that set per mod today, cited exactly once implementation locates it,
not duplicated) **and** `folderPickingSupported()`-equivalent is true.

**5. `packages/web/src/main.ts`**, in `persistSave()` (`:5269-5305`): after `if
(ok) ensureDurableStorage();`, add the backup notification, built from the same
values `exportCharacter` already assembles:

```ts
if (ok) {
  ensureDurableStorage();
  notifyBackupSinks({
    name: backupFilename(metaFromState(id)), // lineage-stable, not level-suffixed
    text: encodeTransfer({
      meta: transferMetaFromState(id),
      save: b64,
      engine: ENGINE_VERSION,
      exportedAt: new Date().toISOString(),
      lineage: lineageOf(metaFromState(id)),
    }),
  });
}
```

`notifyBackupSinks` and `backupFilename` are new, small, host-internal
functions in `mod-backup.ts`: the per-mod `onSave` callback registry and the
lineage-stable naming rule from §"Composition with persistSave," respectively.
`transferMetaFromState` factors the object literal `exportCharacter` already
builds inline (`main.ts:10330-10340`) so both call sites share it rather than
drift.

**6. `neo-angband-mod-qol`** (the mod repository, not this one): **BLOCKED,
2026-08-15, on §3's correction: `registry:command`+`registry:menu` do not
provide "run this mod code from a menu row," and building that dispatch seam
is itself new UI-seam work deferred past alpha alongside `MOD_REACH.md` gap
21.** `hooks(ctx)` keeping the `BackupFolder` reference and calling
`ctx.backupFolder?.onSave(...)` is unaffected and can land any time step 4 has;
it needs no menu, no command, nothing from this step. What is blocked is
only the player-visible TRIGGER:
- `manifest.json`: `"backup:folder"` alone for now; `"registry:command"` and
  `"registry:menu"` wait for the real dispatch mechanism, not this design.
- `plugin.ts`: no `register(host, ctx)` menu row until there is a seam that
  would actually run it.
- README section deferred with it: nothing to name that works yet.

**7. Docs.** `docs/modding/PLUGINS.md` gains a `ctx.backupFolder` entry in the
same table as `ctx.prefs` (`PLUGINS.md`'s "What `ctx` carries" table);
`docs/modding/MOD_SEAMS.md` gains a numbered section (`## 6. ctx.backupFolder -
the folder-write seam`) in the same style as `## 4. GameState.autoDigStep`.
`docs/modding/README.md`'s capability list, if it enumerates them, gains
`backup:folder`.

---

## The tests that would prove it

Following the region-input file's own instrument choice of real fixtures, not
mocks, wherever the existing tests already establish the pattern:

**`packages/mod-sdk/src/capabilities.test.ts`** (existing file, extended):
`parseCapability("backup:folder")` round-trips to `{kind:"backup",
action:"folder"}`; an unknown variant (`"backup:file"`, `"backup:*"`) still
throws `CapabilityError`: there is deliberately no wildcard (§1).

**`packages/web/src/mod-backup.test.ts`** (new, mocked File System Access,
the same style `mod-folder.test.ts:180-277` already uses for
`showDirectoryPicker`/IndexedDB): `write()` creates the file when none exists;
overwrites in place on a second call with the same name (proving the
lineage-stable naming actually produces one file, not one per call); resolves
`false` without throwing when permission is denied; `onSave` set twice keeps
only the second callback (§1's "there is exactly one" contract).

**`packages/web/src/mod-context.test.ts`** (existing file, extended):
`modPluginContext()` supplies `backupFolder` only when both the injected
capability flag and `folderPickingSupported` are true; `undefined` on either
alone: the two independent reasons for absence in the fault table above, each
covered.

**a new `main-backup.test.ts`** (new, in the AST-guard style
`main-region-input.test.ts` and `main-regions.test.ts` already use for "is the
call site actually wired," since a unit test on `mod-backup.ts` cannot see
whether `persistSave` ever asks): asserts `persistSave`'s source contains the
`notifyBackupSinks(` call, positioned after the `writeSlot(` call and inside the
`if (ok)` block: the ordering is the assertion, exactly as `main-region-input.test.ts`
asserts `regionInputAt(` runs before the map-rect test rather than merely
existing somewhere in the file.

**A disk-fixture test proving import composes for free**
(`packages/web/src/save-transfer.test.ts`, extended, or a new sibling): write a
backup file via the real `encodeTransfer`/lineage-stable-name path, then feed it
through the **existing** import gate exactly as a manually exported file would
be, and assert a backup taken before a recorded death is refused on the same
grounds a manual export would be, proving §"anti-scum" is inherited rather
than merely argued.

**Manual verification on the installed desktop build** (per §9 step 0): confirm
`readwrite` mode actually persists a file outside the Electron sandbox, over
CDP, before any of the above is trusted as "done" on that platform.
