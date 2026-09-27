/**
 * The (P)rofile title-screen row's screen (neo-angband#163): list existing
 * profiles, create or rename or delete one, and switch which is active.
 *
 * Pure UI over profiles.ts's ProfileStore, the same split mods.ts keeps from
 * mod-store.ts: this module never touches storage directly except through the
 * store and the ScopedStorage handed in via ProfileScreenDeps.
 *
 * SWITCHING ALWAYS RELOADS. Every per-profile module (roster.ts, mod-store.ts,
 * userdir.ts, mod-prefs.ts) is pointed at its scoped storage once, at boot, by
 * main.ts's composition root - the same reason a mod-loadout change reloads.
 * deps.reload is called only after the store's active id is already updated,
 * so the reboot reads the new profile from the first line.
 */

import { getCheck, promptText, selectFromMenu, showTextScreen, type MenuItem, type ScreenLine } from "./overlay";
import type { GridPointerInput, GridSurface } from "./term";
import type { ProfileMeta, ProfileStore } from "./profiles";
import { scopedStorage, type ScopedStorage } from "./profile-scope";
import { UI_BAD, UI_DIM, UI_GOLD, UI_GOOD, UI_TEXT } from "./ui-colors";
import { t, ENGINE_VERSION } from "@rpgm-tools/neo-angband-core";
import {
  lineageOf,
  listDeaths,
  listRoster,
  newCharId,
  readLivingRosterFrom,
  readSlotSaveFrom,
  writeSlot,
} from "./roster";
import { decideImport } from "./transfer-gate";
import type { TransferFile } from "./save-transfer";
import { TRANSFER_MAGIC, TRANSFER_VERSION } from "./save-transfer";
import {
  addOrphanedSaves,
  listOrphanedSaves,
  removeOrphanedSave,
  type OrphanedSave,
} from "./orphan-saves";

/** What the screen needs from the host beyond the metadata store itself. */
export interface ProfileScreenDeps {
  /**
   * The real, unscoped storage game data lives in - needed to copy a profile's
   * data into a new one, or wipe a removed profile's. Null on a host with no
   * storage at all (private mode with it refused, or no DOM): every profile
   * but the default is then unreachable, so the "New profile..." row disables
   * itself and says why rather than failing silently.
   */
  realStorage: ScopedStorage | null;
  /** Apply a profile switch by reloading. Called after the store already
   * recorded the new active id, so the reboot reads it from the first line. */
  reload: () => void;
}

const FOOTER = "[ Enter to choose, ESC to go back ]";

function profileRowLabel(p: ProfileMeta, activeId: string | null): string {
  return `${p.id === activeId ? "* " : "  "}${p.name}`;
}

/** The top-level list: every profile, plus "New profile...". */
export async function runProfileScreen(
  term: GridSurface & GridPointerInput,
  store: ProfileStore,
  deps: ProfileScreenDeps,
): Promise<void> {
  for (;;) {
    const profiles = store.list();
    const activeId = store.activeId();
    const orphanCount = deps.realStorage ? listOrphanedSaves(deps.realStorage).length : 0;
    const items: MenuItem[] = profiles.map((p) => ({
      label: profileRowLabel(p, activeId),
      color: p.id === activeId ? UI_GOOD : UI_TEXT,
      hint:
        p.id === activeId
          ? t("profilesScreen.row.active", "This profile is active right now.")
          : p.id === null
            ? t("profilesScreen.row.inactiveDefault", "Switch to it, or rename it.")
            : t("profilesScreen.row.inactive", "Switch to it, rename it, or delete it."),
    }));
    items.push({
      label: t("profilesScreen.newRow", "New profile..."),
      color: deps.realStorage ? UI_GOLD : UI_DIM,
      disabled: !deps.realStorage,
      hint: deps.realStorage
        ? t(
            "profilesScreen.newRow.hint",
            "Its own options, mod loadout, and saves - separate from every other profile.",
          )
        : t(
            "profilesScreen.newRow.unavailable",
            "Storage is unavailable here, so a new profile cannot be created.",
          ),
    });
    if (orphanCount > 0) {
      items.push({
        label: t("profilesScreen.reclaimRow", "Reclaim saves... ({count})", { count: orphanCount }),
        color: UI_GOLD,
        hint: t(
          "profilesScreen.reclaimRow.hint",
          "Living characters kept from a profile that was deleted.",
        ),
      });
    }
    const pick = await selectFromMenu(
      term,
      "core:profiles",
      t("profilesScreen.title", "Profiles"),
      items,
      FOOTER,
    );
    if (pick === null) return;
    if (pick === profiles.length) {
      if (deps.realStorage) await createProfileFlow(term, store, deps, activeId);
      continue;
    }
    if (orphanCount > 0 && pick === profiles.length + 1) {
      if (deps.realStorage) await runReclaimScreen(term, deps.realStorage);
      continue;
    }
    const chosen = profiles[pick];
    if (chosen) await profileRowActions(term, store, deps, chosen, activeId);
  }
}

/** Switch / Rename / Delete for one row, picked from the list above. */
async function profileRowActions(
  term: GridSurface & GridPointerInput,
  store: ProfileStore,
  deps: ProfileScreenDeps,
  p: ProfileMeta,
  activeId: string | null,
): Promise<void> {
  const isActive = p.id === activeId;
  const isDefault = p.id === null;
  type RowAction = "switch" | "rename" | "delete";
  const actions: { kind: RowAction; item: MenuItem }[] = [];
  if (!isActive) {
    actions.push({
      kind: "switch",
      item: {
        label: t("profilesScreen.action.switch", "Switch to this profile"),
        color: UI_GOOD,
        hint: t("profilesScreen.action.switch.hint", "Reloads the game."),
      },
    });
  }
  actions.push({
    kind: "rename",
    item: { label: t("profilesScreen.action.rename", "Rename"), color: UI_TEXT },
  });
  if (!isDefault) {
    actions.push({
      kind: "delete",
      item: {
        label: t("profilesScreen.action.delete", "Delete"),
        color: UI_BAD,
        hint: t(
          "profilesScreen.action.delete.hint",
          "Erases its options and mod loadout; its living characters can be kept.",
        ),
      },
    });
  }
  const pick = await selectFromMenu(
    term,
    "core:profiles:row",
    p.name,
    actions.map((a) => a.item),
    FOOTER,
  );
  if (pick === null) return;
  const action = actions[pick]?.kind;
  if (action === "switch") await switchProfile(term, store, deps, p);
  else if (action === "rename") await renameProfile(term, store, p);
  else if (action === "delete" && p.id !== null) await deleteProfile(term, store, deps, p.id, p.name);
}

async function switchProfile(
  term: GridSurface & GridPointerInput,
  store: ProfileStore,
  deps: ProfileScreenDeps,
  p: ProfileMeta,
): Promise<void> {
  const ok = await getCheck(
    term,
    t("profilesScreen.switch.confirm", 'Switch to "{name}"? This reloads the game. ', {
      name: p.name,
    }),
  );
  if (!ok) return;
  store.switchTo(p.id);
  deps.reload();
}

async function renameProfile(
  term: GridSurface & GridPointerInput,
  store: ProfileStore,
  p: ProfileMeta,
): Promise<void> {
  const name = await promptText(
    term,
    t("profilesScreen.rename.title", "Rename this profile"),
    p.name,
    40,
  );
  if (name === null || name.trim() === "") return;
  store.rename(p.id, name.trim());
}

/**
 * Delete a profile, with an explicit choice for its saves (neo-angband#163):
 * discard them along with everything else, or lift its living characters out
 * to orphan-saves.ts's holding pool first, reclaimable later from any
 * profile. Tombstones are never kept - see orphan-saves.ts's header for why.
 */
async function deleteProfile(
  term: GridSurface & GridPointerInput,
  store: ProfileStore,
  deps: ProfileScreenDeps,
  id: string,
  name: string,
): Promise<void> {
  const ok = await getCheck(
    term,
    t(
      "profilesScreen.delete.confirm",
      'Delete "{name}"? This erases its options and mod loadout. ',
      { name },
    ),
  );
  if (!ok || !deps.realStorage) return;
  const keepSaves = await getCheck(
    term,
    t(
      "profilesScreen.delete.keepSaves.confirm",
      "Keep its living characters, reclaimable later from any profile? Answering no discards them too. ",
    ),
  );
  if (keepSaves) {
    const scoped = scopedStorage(deps.realStorage, id);
    const entries = readLivingRosterFrom(scoped).reduce<OrphanedSave[]>((out, c) => {
      const save = readSlotSaveFrom(scoped, c.id);
      if (save !== null) {
        out.push({ id: newCharId(), fromProfileName: name, removedAt: Date.now(), lineage: lineageOf(c), meta: c, save });
      }
      return out;
    }, []);
    if (entries.length > 0) addOrphanedSaves(deps.realStorage, entries);
  }
  const wasActive = store.activeId() === id;
  store.remove(id, deps.realStorage);
  if (wasActive) deps.reload();
}

function orphanRowLabel(o: OrphanedSave): string {
  return `${o.meta.name || "(unnamed)"} the ${o.meta.race} ${o.meta.cls} (L${String(o.meta.level)})`;
}

/** The reclaim screen: pick one orphaned character to fold into whichever
 * profile is active right now, through the same lineage gate an imported
 * character file goes through (transfer-gate.ts). */
async function runReclaimScreen(
  term: GridSurface & GridPointerInput,
  realStorage: ScopedStorage,
): Promise<void> {
  for (;;) {
    const orphans = listOrphanedSaves(realStorage);
    if (orphans.length === 0) return;
    const items: MenuItem[] = orphans.map((o) => ({
      label: orphanRowLabel(o),
      color: UI_TEXT,
      hint: t('profilesScreen.reclaim.row.hint', 'From "{name}", removed {when}.', {
        name: o.fromProfileName,
        when: new Date(o.removedAt).toLocaleDateString(),
      }),
    }));
    const pick = await selectFromMenu(
      term,
      "core:profiles:reclaim",
      t("profilesScreen.reclaim.listTitle", "Reclaim a save"),
      items,
      FOOTER,
    );
    if (pick === null) return;
    const chosen = orphans[pick];
    if (chosen) await reclaimOne(term, realStorage, chosen);
  }
}

async function reclaimOne(
  term: GridSurface & GridPointerInput,
  realStorage: ScopedStorage,
  o: OrphanedSave,
): Promise<void> {
  const file: TransferFile = {
    magic: TRANSFER_MAGIC,
    version: TRANSFER_VERSION,
    engine: ENGINE_VERSION,
    exportedAt: new Date(o.removedAt).toISOString(),
    lineage: o.lineage,
    meta: {
      name: o.meta.name,
      race: o.meta.race,
      cls: o.meta.cls,
      sex: o.meta.sex,
      level: o.meta.level,
      depth: o.meta.depth,
      maxDepth: o.meta.maxDepth,
      turn: o.meta.turn,
      alive: o.meta.alive,
    },
    save: o.save,
  };
  const decision = decideImport(file, listRoster(), listDeaths());
  const displayName = o.meta.name || "(unnamed)";
  if (decision.kind === "refused") {
    const lines: ScreenLine[] = [
      { text: t("profilesScreen.reclaim.notReclaimed", "{name} was not reclaimed.", { name: displayName }), color: UI_BAD },
      { text: "", color: UI_TEXT },
      ...decision.why.map((text) => ({ text, color: text === "" ? UI_TEXT : UI_DIM })),
    ];
    await showTextScreen(term, t("profilesScreen.reclaim.screenTitle", "Reclaim a save"), lines);
    return;
  }
  const id = decision.kind === "replace" ? decision.id : newCharId();
  const ok = writeSlot(id, o.save, {
    id,
    lineage: o.lineage,
    name: o.meta.name,
    race: o.meta.race,
    cls: o.meta.cls,
    sex: o.meta.sex,
    level: o.meta.level,
    depth: o.meta.depth,
    maxDepth: o.meta.maxDepth,
    turn: o.meta.turn,
    alive: o.meta.alive,
    updatedAt: Date.now(),
  });
  if (ok) removeOrphanedSave(realStorage, o.id);
  const lines: ScreenLine[] = [
    ok
      ? { text: t("profilesScreen.reclaim.ok", "{name} is now in your roster.", { name: displayName }), color: UI_GOOD }
      : { text: t("profilesScreen.reclaim.failed", "This browser would not store the character."), color: UI_BAD },
  ];
  await showTextScreen(term, t("profilesScreen.reclaim.screenTitle", "Reclaim a save"), lines);
}

/**
 * Creating a profile beyond the default (neo-angband#163, decision 6):
 *
 * 1. If the default has never been named, offer to name it first - it "isn't
 *    really a profile" until a second one exists, so this is the one moment
 *    that fact stops being true and the player's first chance to give it a
 *    name of its own rather than staying "Default" forever.
 * 2. Name the new profile.
 * 3. Start it from the current profile's settings, or fully reset.
 * 4. Offer to switch to it immediately (which reloads); staying put is just as
 *    valid, since the new profile now exists and can be switched to later.
 */
async function createProfileFlow(
  term: GridSurface & GridPointerInput,
  store: ProfileStore,
  deps: ProfileScreenDeps,
  activeId: string | null,
): Promise<void> {
  const realStorage = deps.realStorage;
  if (!realStorage) return;
  if (!store.isDefaultNamed()) {
    const wantsName = await getCheck(
      term,
      t(
        "profilesScreen.create.nameDefault.confirm",
        "Give your current settings a profile name before creating a new one? ",
      ),
    );
    if (wantsName) {
      const current = store.list().find((p) => p.id === null)?.name ?? "";
      const name = await promptText(
        term,
        t("profilesScreen.create.nameDefault.title", "Name your current profile"),
        current,
        40,
      );
      if (name !== null && name.trim() !== "") store.rename(null, name.trim());
    }
  }
  const newName = await promptText(
    term,
    t("profilesScreen.create.title", "Name the new profile"),
    "",
    40,
  );
  if (newName === null || newName.trim() === "") return;
  const copy = await getCheck(
    term,
    t(
      "profilesScreen.create.copy.confirm",
      "Start this profile from the current one's settings? Answering no resets everything instead. ",
    ),
  );
  const trimmed = newName.trim();
  const id = copy
    ? store.create(trimmed, { copyFrom: activeId, realStorage })
    : store.create(trimmed, { realStorage });
  const switchNow = await getCheck(
    term,
    t("profilesScreen.create.switch.confirm", 'Switch to "{name}" now? This reloads the game. ', {
      name: trimmed,
    }),
  );
  if (switchNow) {
    store.switchTo(id);
    deps.reload();
  }
}
