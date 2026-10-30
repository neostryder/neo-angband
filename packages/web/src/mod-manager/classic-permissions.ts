import { needsGameplayNoscoreWarning, decidableCapabilities, undecidedCapabilities, unreviewedNoticeDue } from "./state-rules";
export { needsGameplayNoscoreWarning, decidableCapabilities, undecidedCapabilities, unreviewedNoticeDue };
import { classicManager, permissionCore, confirmationMod, catalogCore } from "./classic-service";
import { createModManagerService, type CoreModManager } from "./service";
import { permissionConfirmation } from "./confirmation";
import { type CatalogMod, type ConsentRecord, ModStore, buildCatalog } from "../mod-store";
import { type GridSurface, type GridPointerInput } from "../term";
import { showTextScreen, selectFromMenu, type MenuItem } from "../overlay";
import { t } from "@rpgm-tools/neo-angband-core";
import { C_WARN, C_FG, C_TITLE, C_DIM, C_DANGER, C_ENABLED } from "./classic-colors";
import { type ScreenView, freezeView, linesScreen, SCREEN_FOOTER } from "../screen-view";
import { describeCapabilities, capabilityWithoutIt, describeCapability, hasElevatedCapability } from "../capability-describe";
import { type TierRefusal, playerHeld, needsOwnConfirmation, canRunWithout, assignTier } from "../mod-tier";
import { isTruthCapability, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { type ModManagerDeps } from "./classic-types";


/** Run the one-time warning only for the transition that trips the ratchet. */
export async function confirmGameplayNoscore(
  m: CatalogMod,
  modNoscore: boolean,
  confirm: () => Promise<boolean>,
): Promise<boolean> {
  return needsGameplayNoscoreWarning(m, modNoscore) ? confirm() : true;
}

export async function gameplayNoscorePrompt(term: GridSurface & GridPointerInput, m: CatalogMod): Promise<boolean> {
  await showTextScreen(
    term,
    t("modsScreen.noscore.title", "Non-scoring save - {name}", { name: m.name }),
    [
      {
        text: t("modsScreen.noscore.body1", "This mod changes core gameplay behavior."),
        color: C_WARN,
      },
      {
        text: t(
          "modsScreen.noscore.body2",
          "Your save will be permanently marked as non-scoring.",
        ),
        color: C_WARN,
      },
    ],
    consentFooter(),
  );
  const pick = await selectFromMenu(
    term,
    "core:mod-enable-gameplay",
    t("modsScreen.noscore.confirm", 'Enable gameplay-changing mod "{name}"?', { name: m.name }),
    [
      {
        label: t("modsScreen.noscore.yes", "Yes, enable and mark save non-scoring"),
        color: C_WARN,
      },
      { label: t("modsScreen.common.no.cancel", "No, cancel"), color: C_FG },
    ],
    t("modsScreen.common.footer.abTapEsc", "[ a/b or tap; ESC cancels ]"),
  );
  return pick === 0;
}

/**
 * The footer under the consent read, before the Yes/No pick that follows it.
 *
 * A FUNCTION, not a constant: see gameMenuFooter's comment in game-menu.ts - a
 * locale can change mid-session, so nothing translatable may be frozen at
 * import time.
 */
export function consentFooter(): string {
  return t("modsScreen.consent.footer", "[ Press ESC to review, then choose ]");
}

/**
 * The capability consent gate as a document: what is being asked for, as a LIST.
 *
 * `describeCapabilities` already answers `{ cap, text, elevated }` per grant, and
 * the screen was flattening all three into `  - <text>   [elevated]`. So the one
 * fact this screen exists to make impossible to miss - which grants are the
 * powerful ones - was recoverable only by looking for a word in a sentence. Each
 * grant is now a row: `elevated` is a boolean on `semantic.data`, `cap` is the raw
 * capability string on `semantic.ref`, and a presenter draws the flag as whatever
 * a warning looks like in its own vocabulary.
 *
 * The bullet is a CELL rather than the table's own `tagged` prefix, which would
 * write `a) ` - a lettered row the player cannot choose, three columns wide by
 * coincidence. As a cell it is the marker, and a presenter replaces it with an icon.
 *
 * The sentences around the list are prose and stay `lines`; the warnings use prose
 * blocks so a warning itself cannot be cut off on the terminal.
 */
export function capabilityConsentScreen(
  requested: CatalogMod | readonly CatalogMod[],
  pending?: ReadonlyMap<string, readonly string[]>,
): ScreenView {
  const mods = Array.isArray(requested) ? requested : [requested];
  const one = mods.length === 1;
  const m = mods[0];
  if (!m) throw new Error("capability consent needs at least one mod");
  const asked = (mod: CatalogMod): readonly string[] => pending?.get(mod.id) ?? decidableCapabilities(mod);
  const capabilities = mods.flatMap((mod) =>
    describeCapabilities(asked(mod)).map((detail) => ({ mod, detail })),
  );
  const tierRefused = mods.flatMap((mod) => (mod.tierRefused ?? []).map((refusal: TierRefusal) => ({ mod, refusal })));
  const withoutIt = (cap: string): string => {
    const text = capabilityWithoutIt(cap);
    return text === null ? "" : ` ${t("modsScreen.consent.withoutIt", "Without it: {text}", { text })}`;
  };
  return freezeView({
    id: "core:mod-capabilities",
    title: one
      ? t("modsScreen.consent.title", "Consent - {name}", { name: m.name })
      : t("modsScreen.consent.batchTitle", "Capability approval"),
    footer: consentFooter(),
    blocks: [
      {
        kind: "lines",
        lines: [
          {
            text: one
              ? t("modsScreen.consent.requests", '"{name}" requests these capabilities:', {
                  name: m.name,
                })
              : t("modsScreen.consent.batchRequests", "These mods request these capabilities:"),
            color: C_TITLE,
          },
          { text: "", color: C_FG },
        ],
      },
      {
        kind: "table",
        key: "capabilities",
        tagged: false,
        columns: [
          { key: "bullet", width: 3, align: "right" },
          /* A capability blurb runs to 200 characters (registry:*). It consumes
           * the room left by the bullet and flag, then continues below them. */
          { key: "text", wrap: true },
          /* Three columns of space before the flag, as the column's own gap rather
           * than as three spaces on the front of the cell - a row with no flag then
           * ends where it always did, because the renderer cuts the trailing run. */
          { key: "elevated", gap: 3, pad: false },
        ],
        rows: capabilities.map(({ mod, detail }) => ({
          id: `${mod.id}:${detail.cap}`,
          semantic: {
            kind: "capability",
            ref: detail.cap,
            data: one ? { elevated: detail.elevated } : { modId: mod.id, elevated: detail.elevated },
          },
          color: detail.elevated ? C_WARN : C_FG,
          cells: {
            bullet: { text: "-" },
            text: { text: `${one ? detail.text : `${mod.name}: ${detail.text}`}.${withoutIt(detail.cap)}` },
            elevated: { text: detail.elevated ? t("modsScreen.consent.elevatedTag", "[elevated]") : "" },
          },
        })),
      },
      { kind: "lines", lines: [{ text: "", color: C_FG }] },
      ...(tierRefused.length > 0
        ? [
            {
              kind: "lines" as const,
              lines: [
                {
                  text: t(
                    "modsScreen.consent.tierHeader",
                    "The game does not give this mod these, whatever you choose:",
                  ),
                  color: C_WARN,
                },
                ...tierRefused.map(({ mod, refusal }) => ({
                  text: `  - ${one ? "" : `${mod.name}: `}${describeCapability(refusal.capability).text} (${refusal.why})`,
                  color: C_DIM,
                })),
                { text: "", color: C_FG },
              ],
            },
          ]
        : []),
      ...(capabilities.some(({ detail }) => isTruthCapability(detail.cap))
        ? [
            {
              kind: "text" as const,
              paragraphs: [
                [
                  {
                    text: t(
                      "modsScreen.consent.truthWarning",
                      "Seeing the real map shows this mod things your character has not found yet.",
                    ),
                  },
                  /* Only a mod whose first-party entry says so marks the save (mod-tier.ts marksSave). */
                  ...(capabilities.some(
                    ({ mod, detail }) => isTruthCapability(detail.cap) && mod.tier?.marksSave.includes(detail.cap) === true,
                  )
                    ? [
                        {
                          text: ` ${t(
                            "modsScreen.consent.truthMarks",
                            "Every character you play while it is allowed is marked the way debug mode marks it, and the mark never comes off.",
                          )}`,
                        },
                      ]
                    : []),
                ],
              ],
              color: C_DANGER,
            },
          ]
        : []),
      /* THE IN-PROCESS LINE IS ABOUT THE CODE, NOT ABOUT THE LIST above it.
       * A plugin receives `ctx.core`, `ctx.state` and `ctx.registries` without a
       * capability check, so declared capabilities say what it intends to
       * override, not what its code can reach. Any mod that ships code gets this
       * warning; a validated content pack does not. */
      ...(mods.some((mod) => mod.kind !== "content" || hasElevatedCapability(mod.capabilities))
        ? [
            {
              kind: "text" as const,
              paragraphs: [
                [
                  {
                    text: t(
                      "modsScreen.consent.runsCode",
                      "This mod runs its own code inside the game and can change how the game behaves. Only enable mods you trust.",
                    ),
                  },
                ],
              ],
              color: C_DANGER,
            },
          ]
        : []),
      ...(mods.some((mod) => mod.nondeterministic)
        ? [
            {
              kind: "text" as const,
              paragraphs: [
                [
                  {
                    text: t(
                      "modsScreen.consent.nonReproducible",
                      one
                        ? "It also marks your save permanently non-reproducible."
                        : "One or more of these mods mark your save permanently non-reproducible.",
                    ),
                  },
                ],
              ],
              color: C_WARN,
            },
          ]
        : []),
      {
        kind: "lines",
        lines: [
          { text: "", color: C_FG },
        ],
      },
    ],
  });
}



/** One mod and the capabilities to ask about for it. */
export interface PermissionAsk {
  readonly mod: CatalogMod;
  readonly caps: readonly string[];
}

/** A capability nobody has decided about starts on, except the real map, which starts off. */
export function onByDefault(cap: string): boolean {
  return !isTruthCapability(cap);
}

/**
 * Ask about each capability in `asks`, one decision per capability.
 *
 * The read screen lists every capability with what stops working without it,
 * then the player allows the defaults (everything but the real map), chooses
 * one by one, or cancels. Every screen and menu here is Core-drawn
 * (core-drawn.ts). Returns the decisions per mod id, or null on cancel.
 */
export async function decidePermissions(
  term: GridSurface & GridPointerInput,
  asks: readonly PermissionAsk[],
  opts?: { readonly oneByOne?: boolean; readonly current?: (id: string) => ConsentRecord; readonly core?: CoreModManager },
): Promise<Map<string, ConsentRecord> | null> {
  const core = opts?.core ?? (asks[0] ? catalogCore(asks[0].mod) : undefined) ?? createModManagerService({ store: new ModStore(null), listCatalog: () => asks.map((ask) => ask.mod) }).core;
  return core.drawConfirmation({
    operation: "permissions",
    mods: asks.map((ask) => confirmationMod(ask.mod)),
    permissions: asks.flatMap((ask) => ask.caps.map((cap) => permissionConfirmation(ask.mod.id, cap))),
  }, () => drawPermissionChoices(term, asks, opts));
}

async function drawPermissionChoices(
  term: GridSurface & GridPointerInput,
  asks: readonly PermissionAsk[],
  opts?: { readonly oneByOne?: boolean; readonly current?: (id: string) => ConsentRecord },
): Promise<Map<string, ConsentRecord> | null> {
  const live = asks.filter((ask) => ask.caps.length > 0);
  const out = new Map<string, ConsentRecord>();
  if (live.length === 0) return out;
  const first = live[0] as PermissionAsk;
  const one = live.length === 1;
  const on = new Map<string, boolean>();
  const key = (id: string, cap: string): string => `${id}\u0000${cap}`;
  for (const { mod, caps } of live) {
    const current = opts?.current?.(mod.id);
    for (const cap of caps) {
      const value = current?.granted.includes(cap)
        ? true
        : current?.refused.includes(cap)
          ? false
          : onByDefault(cap);
      on.set(key(mod.id, cap), value);
    }
  }
  const normalize = (): void => {
    for (const { mod, caps } of live) {
      const granted = caps.filter((cap) => on.get(key(mod.id, cap)) === true);
      const refused = caps.filter((cap) => on.get(key(mod.id, cap)) !== true);
      const held = playerHeld(caps, { granted, refused }).held;
      for (const cap of granted) on.set(key(mod.id, cap), held.includes(cap));
    }
  };
  normalize();
  /* A capability SEAM_POLICY marks for its own confirmation (one that can
   * install or turn on other code) is asked about again, on its own, before
   * it is granted. */
  const collect = async (): Promise<Map<string, ConsentRecord>> => {
    for (const { mod, caps } of live) {
      for (const cap of caps) {
        const k = key(mod.id, cap);
        if (on.get(k) !== true || !needsOwnConfirmation(cap)) continue;
        if (opts?.current?.(mod.id).granted.includes(cap) === true) continue;
        const pick = await selectFromMenu(
          term,
          "core:mod-manage-confirm",
          t("modsScreen.manage.title", "{name}: {permission}?", {
            name: mod.name,
            permission: describeCapability(cap).text,
          }),
          [
            {
              label: t("modsScreen.manage.yes", "Allow it"),
              color: C_WARN,
              hint: t(
                "modsScreen.manage.yesHint",
                "This can install or turn on other code, so the game asks about it on its own.",
              ),
            },
            {
              label: t("modsScreen.manage.no", "Leave it off"),
              color: C_FG,
              hint: t("modsScreen.manage.noHint", "The mod runs without it."),
            },
          ],
          t("modsScreen.common.footer.abTapEsc", "[ a/b or tap; ESC cancels ]"),
        );
        if (pick !== 0) on.set(k, false);
      }
      out.set(mod.id, {
        granted: caps.filter((cap) => on.get(key(mod.id, cap)) === true),
        refused: caps.filter((cap) => on.get(key(mod.id, cap)) !== true),
      });
    }
    return out;
  };

  if (opts?.oneByOne !== true) {
    await showTextScreen(
      term,
      capabilityConsentScreen(
        live.map((ask) => ask.mod),
        new Map(live.map((ask) => [ask.mod.id, ask.caps])),
      ),
    );
    const truthAsked = live.some((ask) => ask.caps.some((cap) => isTruthCapability(cap)));
    const pick = await selectFromMenu(
      term,
      "core:mod-capability-consent",
      t("modsScreen.consent.allowTitle", "Allow what {name} asks for?", {
        name: one ? first.mod.name : t("modsScreen.consent.theseMods", "these mods"),
      }),
      [
        {
          label: t("modsScreen.consent.allowDefaults", "Allow these"),
          color: C_ENABLED,
          hint: truthAsked
            ? t(
                "modsScreen.consent.allowDefaultsHintTruth",
                "Allows all but what reads the game's real state, such as the real map or exact monster numbers. Those stay off unless you pick them one by one.",
              )
            : t("modsScreen.consent.allowDefaultsHint", "Allows everything listed."),
        },
        {
          label: t("modsScreen.consent.chooseEach", "Choose one by one"),
          color: C_FG,
          hint: t(
            "modsScreen.consent.chooseEachHint",
            "Turn each permission on or off. The mod runs without the ones you turn off, and only the parts that need them stop working.",
          ),
        },
        { label: t("modsScreen.common.no.cancel", "No, cancel"), color: C_FG },
      ],
      t("modsScreen.consent.footer", "[ a/b/c or tap; ESC cancels ]"),
    );
    if (pick === 0) return await collect();
    if (pick !== 1) return null;
  }

  const rows = live.flatMap(({ mod, caps }) => caps.map((cap) => ({ mod, cap })));
  let cursor = 0;
  for (;;) {
    const items: MenuItem[] = rows.map(({ mod, cap }) => {
      const allowed = on.get(key(mod.id, cap)) === true;
      const d = describeCapability(cap);
      const without = capabilityWithoutIt(cap);
      const needed = canRunWithout(cap) ? "" : ` ${t("modsScreen.permissions.needed", "The mod cannot start without this.")}`;
      return {
        label: `${allowed ? "[on] " : "[off]"} ${one ? "" : `${mod.name}: `}${d.text}`,
        color: allowed ? (d.elevated ? C_WARN : C_ENABLED) : C_DIM,
        hint: `${without === null ? "" : t("modsScreen.consent.withoutIt", "Without it: {text}", { text: without })}${needed}`,
      };
    });
    items.push({
      label: t("modsScreen.permissions.done", "Done"),
      color: C_ENABLED,
      hint: t("modsScreen.permissions.doneHint", "Save these choices and turn the mod on."),
    });
    items.push({ label: t("modsScreen.common.no.cancel", "No, cancel"), color: C_FG });
    const pick = await selectFromMenu(
      term,
      "core:mod-permission-choice",
      t("modsScreen.permissions.title", "Permissions for {name}", {
        name: one ? first.mod.name : t("modsScreen.consent.theseMods", "these mods"),
      }),
      items,
      t("modsScreen.permissions.footer", "[ choose a row to switch it; ESC cancels ]"),
      {
        initialCursor: cursor,
        onHighlight: (i) => {
          cursor = i;
        },
      },
    );
    if (pick === null || pick === rows.length + 1) return null;
    if (pick === rows.length) return await collect();
    const row = rows[pick];
    if (!row) return null;
    const k = key(row.mod.id, row.cap);
    on.set(k, on.get(k) !== true);
    normalize();
    cursor = pick;
  }
}

/** Record each mod's decisions at its current version. */
export function saveDecisions(
  deps: ModManagerDeps,
  mods: readonly CatalogMod[],
  decided: ReadonlyMap<string, ConsentRecord>,
): void {
  for (const mod of mods) {
    const record = decided.get(mod.id);
    if (record) classicManager(deps).core.recordConsent(mod.id, record, mod.version);
  }
}

/**
 * The notice Core shows once, before an unreviewed mod that runs code is first
 * turned on. Returns true to go ahead: the player said yes, or has read it before.
 */
export function unreviewedNoticeScreen(m: CatalogMod): ScreenView {
  return freezeView({
    id: "core:mod-unreviewed",
    title: t("modsScreen.unreviewed.title", "Unreviewed mod: {name}", { name: m.name }),
    footer: consentFooter(),
    blocks: [
      {
        kind: "text",
        paragraphs: [
          [
            {
              text: t(
                "modsScreen.unreviewed.who",
                "Nobody has reviewed the code in {name}. It did not come from the game's own list of mods, so no one has checked what it does.",
                { name: m.name },
              ),
            },
          ],
        ],
        color: C_DANGER,
      },
      {
        kind: "text",
        paragraphs: [
          [
            {
              text: t(
                "modsScreen.unreviewed.what",
                "A mod that runs code inside the game can change how the game plays and can read and change your saved characters and settings. The permissions on the next screen limit what the game hands it, but its code can reach past them. Only turn it on if you trust whoever made it.",
              ),
            },
          ],
          [
            {
              text: t(
                "modsScreen.unreviewed.off",
                "To turn it off later, switch it off on the Mods screen. If the game will not start with it on, hold Shift while the game starts, or start the desktop app with --safe-mode, and every mod stays off for that session.",
              ),
            },
          ],
        ],
        color: C_FG,
      },
    ],
  });
}


/** Show the unreviewed notice for each mod that needs it. False when the player leaves one off. */
export async function confirmUnreviewed(
  term: GridSurface & GridPointerInput,
  deps: Pick<ModManagerDeps, "store">,
  mods: readonly CatalogMod[],
): Promise<boolean> {
  const core = permissionCore(deps, mods);
  for (const m of mods) {
    if (!unreviewedNoticeDue(m, deps.store)) continue;
    const accepted = await core.drawConfirmation({ operation: "enable", mods: [confirmationMod(m)] }, async () => {
      await showTextScreen(term, unreviewedNoticeScreen(m));
      const pick = await selectFromMenu(
        term,
        "core:mod-unreviewed-confirm",
        t("modsScreen.unreviewed.confirm", "Turn on {name} anyway?", { name: m.name }),
        [
          { label: t("modsScreen.unreviewed.yes", "Turn it on"), color: C_WARN },
          { label: t("modsScreen.unreviewed.no", "Leave it off"), color: C_FG },
        ],
        t("modsScreen.common.footer.abTapEsc", "[ a/b or tap; ESC cancels ]"),
      );
      return pick === 0;
    });
    if (!accepted) return false;
    core.markUnreviewedNotice(m.id, m.version);
  }
  return true;
}

/** Session choices must not become standing grants for an installed copy. */
export async function consentSessionMod(
  term: GridSurface & GridPointerInput,
  manifest: PackManifest,
): Promise<ConsentRecord | null> {
  const tier = assignTier({ id: manifest.id, source: "session", execution: manifest.runtime === "worker" ? "worker" : "in-process" });
  const row = buildCatalog({ content: [], sandbox: [], trusted: [manifest], enabled: [], consents: {}, tierOf: () => tier })[0];
  if (!row) return null;
  if (!(await confirmUnreviewed(term, { store: new ModStore(null) }, [row]))) return null;
  const decisions = await decidePermissions(term, [{ mod: row, caps: decidableCapabilities(row) }]);
  return decisions?.get(row.id) ?? (decisions ? { granted: [], refused: [] } : null);
}

/**
 * Allow what a mod has STARTED asking for since it was turned on.
 *
 * A grant is written once, at enable, and `enableModById` returns early on a mod
 * that is already enabled, so nothing revisits it. A mod that adds a capability
 * in a later version and is then updated in place therefore keeps a grant that no
 * longer covers its manifest, and the loader drops its code onto the not-a-fault
 * list and carries on. Nothing was broken, nothing was reported, and every rule
 * the mod declares still rendered and still took clicks, because the options rows
 * are built from manifests rather than from loaded code. The measured case was a
 * mod whose capability list grew at four consecutive releases; an install that
 * consented before the last two lost all thirteen of its rules at once.
 *
 * This screen shows ONLY what is new. The player already decided about the rest,
 * and re-reading the whole list is what hides the part that changed.
 *
 * Declining does not return the mod to a silent skip. The state is stated in
 * full, and turning the mod off is offered, because a mod that is switched on and
 * contributing nothing is the condition this whole path exists to end - leaving
 * it that way with no comment would reproduce the bug one screen later.
 */
export async function regrantConsent(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  m: CatalogMod,
  tileModsAtEntry: Set<string>,
): Promise<boolean> {
  const pending = undecidedCapabilities(m);
  if (pending.length === 0) return false;

  await showTextScreen(term, {
    ...linesScreen(
      t("modsScreen.regrant.title", "{name} v{version}", { name: m.name, version: m.version }),
      [
    {
      text: t("modsScreen.regrant.headline", "This version asks for something new."),
      color: C_FG,
    },
    { text: "", color: C_FG },
    {
      text: t(
        "modsScreen.regrant.why",
        "You allowed an earlier version. This one wants more, so its code is",
      ),
      color: C_FG,
    },
    {
      text: t("modsScreen.regrant.why2", "not running until you say yes to the rest:"),
      color: C_FG,
    },
    { text: "", color: C_FG },
    ...describeCapabilities(pending).flatMap((d) => [
      {
        text: `  - ${d.text}${d.elevated ? `  ${t("modsScreen.detail.elevatedTag", "[powerful]")}` : ""}`,
        color: d.elevated ? C_WARN : C_FG,
      },
    ]),
    { text: "", color: C_FG },
    {
      text: t(
        "modsScreen.regrant.alreadyAllowed",
        "What you allowed before is unchanged. Only the above is new.",
      ),
      color: C_DIM,
    },
      ],
      SCREEN_FOOTER,
    ),
    id: "core:mod-capability-regrant",
  });

  const decided = await decidePermissions(term, [{ mod: m, caps: pending }], { core: classicManager(deps).core });
  if (decided) {
    saveDecisions(deps, [m], decided);
    return true;
  }

  /* NOT A SILENT SKIP. The mod is switched on and inert either way; the only
   * question is whether the player knows. Offer the switch, and take no for an
   * answer without pretending the state is fine. */
  const off = await selectFromMenu(
    term,
    "core:mod-capability-regrant-declined",
    t("modsScreen.regrantOff.title", "{name} stays switched on and does nothing.", { name: m.name }),
    [
      {
        label: t("modsScreen.regrantOff.disable", "Turn it off"),
        color: C_WARN,
        hint: t("modsScreen.regrantOff.disableHint", "So the list matches what is actually running."),
      },
      {
        label: t("modsScreen.regrantOff.leave", "Leave it on"),
        color: C_DIM,
        hint: t("modsScreen.regrantOff.leaveHint", "You can allow it later from this screen."),
      },
    ],
    t("modsScreen.common.footer.abTapEsc", "[ a/b or tap; ESC leaves it on ]"),
  );
  if (off === 0) {
    classicManager(deps).core.setEnabled(m.id, false);
    tileModsAtEntry.delete(m.id);
    return true;
  }
  return false;
}
