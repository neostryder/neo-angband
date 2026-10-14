import { isTruthCapability, resolveSettingValue, sortModOrder, type DeclaredConflict, type SortResult } from "@rpgm-tools/neo-angband-mod-sdk";
import { declaredConflicts, undecidedCapabilities, unreviewedNoticeDue, needsGameplayNoscoreWarning } from "./state-rules";
import { CONSENT_DISCLAIMER, type ModOrigin } from "../mod-consent";
import { needsOwnConfirmation, playerHeld, tierRefusal, UNKNOWN_TIER } from "../mod-tier";
import type { CatalogMod, ConsentRecord } from "../mod-store";
import type { DiscoveredMod } from "../mod-discover";
import type { InstalledModMeta, InstallProgress, InstallResult } from "../mod-install";
import type { RepoRef } from "../mod-source";
import type { BrowseEntry } from "./browse-types";
import { immutable, permissionConfirmation, refused } from "./confirmation";
import { resolveInstallPlan } from "./install-plans";
import type {
  ConfirmationDecision, ConfirmationMod, Immutable, InstallPlan, ManagementOperation,
  ManagerResult, ManagerState, ModManagerEnvironment, PendingConfirmation, PermissionConfirmation,
} from "./types";

export interface CoreConfirmationRequest {
  readonly operation: ManagementOperation;
  readonly mods?: readonly ConfirmationMod[];
  readonly permissions?: readonly PermissionConfirmation[];
  readonly riskNotice?: readonly string[];
  readonly conflicts?: readonly DeclaredConflict[];
  readonly requestedBy?: string | null;
}

export interface CoreModManager {
  readonly resolveConfirmation: (id: number, decision: ConfirmationDecision) => Promise<ManagerResult<unknown>>;
  readonly drawConfirmation: <T>(request: CoreConfirmationRequest, draw: () => Promise<T>) => Promise<T>;
  readonly setEnabled: (id: string, on: boolean) => void;
  readonly setOrder: (ids: readonly string[]) => void;
  readonly moveEnabled: (id: string, delta: number) => void;
  readonly recordConsent: (id: string, decisions: ConsentRecord, version: string) => void;
  readonly markUnreviewedNotice: (id: string, version: string) => void;
  readonly setRuleChoice: (flag: string, on: boolean) => void;
  readonly setSectionChoice: (id: string, section: string, on: boolean) => void;
  readonly setSettingValue: (id: string, setting: string, value: number) => void;
  readonly writeThirdPartyConsent: (allow: boolean) => boolean;
  readonly installConfirmed: (mod: DiscoveredMod, origin: ModOrigin, progress: (p: InstallProgress) => void) => Promise<InstallResult>;
  readonly removeConfirmed: (id: string) => Promise<boolean>;
}

export class ModManagerService {
  #env: ModManagerEnvironment;
  #state!: Immutable<ManagerState>;
  #revision = 0;
  #nextId = 0;
  #metadata: readonly InstalledModMeta[] = [];
  #catalog: ManagerState["catalog"] = { curated: [], community: [], sideloads: [], problems: [] };
  #updates: ManagerState["updates"] = [];
  #plans = new Map<number, InstallPlan>();
  #pending: PendingConfirmation | null = null;
  #pendingAction: ((decision: ConfirmationDecision) => Promise<ManagerResult<unknown>>) | null = null;
  #busy = false;
  #listeners = new Set<(state: Immutable<ManagerState>) => void>();

  private constructor(env: ModManagerEnvironment) {
    this.#env = env;
    this.#publish();
  }

  static create(env: ModManagerEnvironment): { readonly service: ModManagerService; readonly core: CoreModManager } {
    const service = new ModManagerService(env);
    const mutate = (body: () => void): void => { body(); service.#publish(); };
    const core = Object.freeze<CoreModManager>({
      resolveConfirmation: (id, decision) => service.#resolve(id, decision),
      drawConfirmation: async <T>(request: CoreConfirmationRequest, draw: () => Promise<T>): Promise<T> => {
        const prior = service.#pending;
        service.#pending = service.#confirmation(request);
        service.#publish();
        try { return await draw(); }
        finally { service.#pending = prior; service.#publish(); }
      },
      setEnabled: (id, on) => mutate(() => env.store.setModEnabled(id, on)),
      setOrder: (ids) => mutate(() => env.store.setEnabled(ids)),
      moveEnabled: (id, delta) => mutate(() => env.store.moveEnabled(id, delta)),
      recordConsent: (id, decisions, version) => mutate(() => env.store.setDecisions(id, decisions, version)),
      markUnreviewedNotice: (id, version) => mutate(() => env.store.markUnreviewedNotice(id, version)),
      setRuleChoice: (flag, on) => mutate(() => env.store.setRuleChoice(flag, on)),
      setSectionChoice: (id, section, on) => mutate(() => env.store.setSectionChoice(id, section, on)),
      setSettingValue: (id, setting, value) => mutate(() => { env.store.setSettingValue(id, setting, value); env.look?.recordSetting(id, setting, value); }),
      writeThirdPartyConsent: (allow) => { const result = env.consent?.write(allow) ?? false; service.#publish(); return result; },
      installConfirmed: async (mod, origin, progress) => {
        const result = env.install ? await env.install(mod, origin, progress) : { ok: false as const, problem: "The host cannot install mods." };
        if (result.ok) service.#metadata = [...service.#metadata.filter((m) => m.id !== mod.id), result.meta];
        service.#publish();
        return result;
      },
      removeConfirmed: async (id) => {
        const removed = await env.uninstall?.(id) ?? false;
        if (removed) service.#metadata = service.#metadata.filter((m) => m.id !== id);
        service.#publish();
        return removed;
      },
    });
    return { service, core };
  }

  get state(): Immutable<ManagerState> { return this.#state; }

  subscribe(listener: (state: Immutable<ManagerState>) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  refreshState(): ManagerResult<Immutable<ManagerState>> {
    this.#publish();
    return { status: "ok", value: this.#state };
  }

  async refresh(): Promise<ManagerResult<Immutable<ManagerState>>> {
    return this.#guard(async () => {
      await this.#env.rediscover?.();
      if (this.#env.installedMetadata) this.#metadata = await this.#env.installedMetadata();
      if (this.#env.refreshUpdates) this.#updates = await this.#env.refreshUpdates();
      this.#publish();
      return { status: "ok", value: this.#state };
    });
  }

  async browse(): Promise<ManagerResult<Immutable<ManagerState["catalog"]>>> {
    return this.#guard(async () => {
      if (!this.#env.curated || !this.#env.discover) return refused("unavailable", "The host cannot browse mods.");
      const { registry, problem } = await this.#env.curated();
      if (!registry) return refused("catalog", problem ?? "The mod catalog could not be read.");
      const curated = await Promise.all(registry.mods.map((ref) => this.#env.discover!(ref)));
      const vouched = new Set(registry.mods.map((ref) => ref.repo.toLowerCase()));
      const community = await Promise.all(registry.community.filter((ref) => !vouched.has(ref.repo.toLowerCase())).map((ref) => this.#env.discover!(ref)));
      this.#catalog = { ...this.#catalog, curated, community, problems: registry.problems };
      this.#publish();
      return { status: "ok", value: this.#state.catalog };
    });
  }

  search(query: string): ManagerResult<readonly Immutable<BrowseEntry>[]> {
    const words = query.trim().toLowerCase().split(/\s+/u);
    const entries = [...this.#state.catalog.curated, ...this.#state.catalog.community, ...this.#state.catalog.sideloads];
    return { status: "ok", value: entries.filter((entry) => {
      const text = entry.ok ? `${entry.mod.name} ${entry.mod.description ?? ""} ${entry.mod.repo}` : `${entry.ref.repo} ${entry.problem}`;
      return words.every((word) => text.toLowerCase().includes(word));
    }) };
  }

  async discover(ref: RepoRef): Promise<ManagerResult<BrowseEntry>> {
    return this.#guard(async () => {
      if (!this.#env.discover) return refused("unavailable", "The host cannot browse mods.");
      const entry = await this.#env.discover(ref);
      this.#catalog = { ...this.#catalog, sideloads: [...this.#catalog.sideloads.filter((e) => e.ref.repo !== ref.repo), entry] };
      this.#publish();
      return { status: "ok", value: immutable(entry) };
    });
  }

  async planInstall(refs: readonly { readonly ref: RepoRef; readonly origin: ModOrigin }[], operation: InstallPlan["operation"] = "install"): Promise<ManagerResult<InstallPlan>> {
    return this.#guard(async () => {
      if (!this.#env.discover || !this.#env.install) return refused("unavailable", "The host cannot install mods.");
      if (this.#pending || this.#busy) return refused("busy", "A mod operation is already waiting for confirmation.");
      if (this.#env.installedMetadata) this.#metadata = await this.#env.installedMetadata();
      const roots = await Promise.all(refs.map(async ({ ref, origin }) => ({ entry: await this.#env.discover!(ref), origin })));
      const result = await resolveInstallPlan(this.#env, roots, this.#env.listCatalog(), this.#metadata, ++this.#nextId, operation);
      if (result.status === "ok") {
        const plan = immutable(result.value);
        this.#plans.set(plan.id, plan);
        this.#publish();
        return { status: "ok", value: plan };
      }
      return result;
    });
  }

  async planCatalogInstall(refs: readonly RepoRef[]): Promise<ManagerResult<InstallPlan>> {
    return this.#guard(async () => {
      const { registry } = await this.#env.curated?.() ?? { registry: null };
      const vouched = new Set((registry?.mods ?? []).map((ref) => ref.repo.toLowerCase()));
      return this.planInstall(refs.map((ref) => ({ ref, origin: vouched.has(ref.repo.toLowerCase()) ? "curated" : "third-party" })));
    });
  }

  applyPlan(id: number, requestedBy: string | null = null): ManagerResult<unknown> {
    const plan = this.#plans.get(id);
    if (!plan) return refused("plan", "This mod plan is no longer available.");
    return this.#request({
      operation: plan.operation, requestedBy,
      mods: plan.downloads.map(({ mod }) => this.#subject(mod)),
      permissions: plan.newGrants, conflicts: plan.conflicts,
      riskNotice: plan.downloads.some((d) => d.origin === "third-party") ? CONSENT_DISCLAIMER : [],
    }, async (decision) => {
      const results: InstallResult[] = [];
      // Consent and origin pins can change while a confirmation is open.
      const check = await resolveInstallPlan(this.#env, plan.downloads.map((d) => ({ entry: { ok: true as const, ref: { repo: d.mod.repo, tag: d.mod.tag }, mod: d.mod }, origin: d.origin })), this.#env.listCatalog(), this.#metadata, plan.id, plan.operation);
      if (check.status !== "ok") return check;
      if (JSON.stringify(check.value) !== JSON.stringify(plan)) return refused("stale-plan", "The mod plan changed. Review it again.");
      for (const download of plan.downloads) {
        const result = await this.#env.install!(download.mod, download.origin, () => {});
        results.push(result);
        if (!result.ok) return refused("install", result.problem);
        this.#metadata = [...this.#metadata.filter((m) => m.id !== result.meta.id), result.meta];
      }
      await this.#env.rediscover?.();
      for (const download of plan.downloads) {
        const choices = decision.permissions?.[download.mod.id];
        if (!choices) continue;
        const result = this.#writeConsent(download.mod.id, choices);
        if (result.status !== "ok") return result;
      }
      this.#plans.delete(id);
      return { status: "ok", value: immutable(results) };
    });
  }

  recordConsent(id: string, decisions: ConsentRecord, requestedBy: string | null = null): ManagerResult<unknown> {
    const mod = this.#find(id);
    if (!mod) return this.#missing();
    const invalid = this.#consentRefusal(mod, decisions);
    if (invalid) return invalid;
    const grants = decisions.granted.filter((cap) => !this.#env.store.getConsent(id).includes(cap));
    if (grants.length === 0) return this.#writeConsent(id, decisions);
    const copy = immutable(decisions);
    return this.#request({ operation: "permissions", requestedBy, mods: [this.#subject(mod)], permissions: grants.map((cap) => permissionConfirmation(id, cap)) }, async () => this.#writeConsent(id, copy));
  }

  enable(id: string, requestedBy: string | null = null): ManagerResult<unknown> {
    const mod = this.#find(id);
    if (!mod) return this.#missing();
    if (mod.session) return refused("session", "Session mods are controlled by their session host.");
    if (mod.enabled) return { status: "ok", value: null };
    const decided = this.#env.store.getDecisions(id);
    const pending = undecidedCapabilities(mod);
    const conflicts = declaredConflicts([...this.#env.listCatalog().filter((m) => m.enabled).map((m) => m.manifest), mod.manifest]);
    const noticeDue = unreviewedNoticeDue(mod, this.#env.store);
    const sensitive = decided.granted.filter((cap) => isTruthCapability(cap) || needsOwnConfirmation(cap));
    const scoring = needsGameplayNoscoreWarning(mod, this.#env.isModNoscore?.() ?? false);
    const apply = async (decision: ConfirmationDecision): Promise<ManagerResult> => {
      if (pending.length > 0) {
        const choices = decision.permissions?.[id];
        if (!choices || pending.some((cap) => !choices.granted.includes(cap) && !choices.refused.includes(cap))) {
          return refused("permissions", "Choose each new permission before enabling this mod.");
        }
        const result = this.#writeConsent(id, choices);
        if (result.status !== "ok") return result;
      }
      const current = this.#find(id);
      if (!current || current.version !== mod.version) return refused("stale-mod", "The mod changed. Review it again.");
      if (noticeDue) this.#env.store.markUnreviewedNotice(id, mod.version);
      this.#env.advanceSaveRatchets?.(current);
      this.#env.store.setModEnabled(id, true);
      return { status: "ok", value: null };
    };
    if (pending.length || noticeDue || sensitive.length || conflicts.length || scoring || requestedBy !== null) {
      return this.#request({ operation: "enable", requestedBy, mods: [this.#subject(mod)], permissions: [...new Set([...pending, ...sensitive])].map((cap) => permissionConfirmation(id, cap)), conflicts, riskNotice: noticeDue ? CONSENT_DISCLAIMER : [] }, apply);
    }
    this.#env.advanceSaveRatchets?.(mod);
    this.#env.store.setModEnabled(id, true);
    this.#publish();
    return { status: "ok", value: null };
  }

  disable(id: string): ManagerResult {
    const mod = this.#find(id);
    if (!mod) return this.#missing();
    if (mod.session) return refused("session", "Session mods are controlled by their session host.");
    this.#env.store.setModEnabled(id, false);
    this.#publish();
    return { status: "ok", value: null };
  }

  async update(id: string, requestedBy: string | null = null): Promise<ManagerResult<unknown>> {
    return this.#updateSet([id], requestedBy);
  }

  async updateAll(requestedBy: string | null = null): Promise<ManagerResult<unknown>> {
    return this.#updateSet(null, requestedBy);
  }

  remove(id: string, requestedBy: string | null = null): Promise<ManagerResult<unknown>> {
    return this.#guard(async () => {
      const mod = this.#find(id);
      if (!mod) return this.#missing();
      if (!this.#env.uninstall) return refused("unavailable", "The host cannot remove mods.");
      const apply = async (): Promise<ManagerResult> => {
        if (!(await this.#env.uninstall!(id))) return refused("remove", "The mod could not be removed.");
        this.#metadata = this.#metadata.filter((m) => m.id !== id);
        await this.#env.rediscover?.();
        return { status: "ok", value: null };
      };
      if (requestedBy !== null || this.#env.saveReferences?.(id)) {
        return this.#request({ operation: "remove", requestedBy, mods: [this.#subject(mod)] }, apply);
      }
      const result = await apply();
      this.#publish();
      return result;
    });
  }

  restoreModList(entries: readonly { readonly id: string; readonly enabled: boolean; readonly flags?: Readonly<Record<string, boolean>> }[], replace: boolean, requestedBy: string | null = null): ManagerResult<unknown> {
    const rows = immutable(entries);
    const mods = rows.map((row) => this.#find(row.id));
    if (mods.some((mod) => !mod)) return this.#missing();
    const pending = mods.flatMap((mod) => mod!.capabilities.filter((cap) => {
      const decided = this.#env.store.getDecisions(mod!.id);
      return !decided.granted.includes(cap) && !decided.refused.includes(cap) && !(mod!.tierRefused ?? []).some((r) => r.capability === cap);
    }).map((cap) => permissionConfirmation(mod!.id, cap)));
    return this.#request({ operation: "restore", requestedBy, mods: mods.map((mod) => this.#subject(mod!)), permissions: pending }, async (decision) => {
      for (const row of rows.filter((r) => r.enabled)) {
        const mod = this.#find(row.id);
        if (!mod) return this.#missing();
        const choices = decision.permissions?.[row.id];
        if (pending.some((p) => p.modId === row.id && !choices?.granted.includes(p.capability) && !choices?.refused.includes(p.capability))) {
          return refused("permissions", "Choose each new permission before enabling this mod.");
        }
        if (choices) {
          const invalid = this.#consentRefusal(mod, choices);
          if (invalid) return invalid;
        }
      }
      if (replace) {
        for (const id of this.#env.store.getEnabled()) {
          if (!rows.some((row) => row.id === id && row.enabled)) this.#env.store.setModEnabled(id, false);
        }
      }
      for (const row of rows) {
        const mod = this.#find(row.id)!;
        const choices = decision.permissions?.[row.id];
        if (choices && row.enabled) this.#writeConsent(row.id, choices);
        if (row.enabled) this.#env.advanceSaveRatchets?.(mod);
        this.#env.store.setModEnabled(row.id, row.enabled);
        this.#applyFlags(mod, row.flags ?? {});
      }
      return { status: "ok", value: null };
    });
  }

  async rollback(id: string, requestedBy: string | null = null): Promise<ManagerResult<unknown>> {
    return this.#guard(async () => {
      const previous = await this.#env.previousVersion?.(id);
      if (!previous) return refused("previous-version", "No previous version is available.");
      if (!previous.ok) return refused("discovery", previous.problem);
      const plan = await this.planInstall([{ ref: { repo: previous.mod.repo, tag: previous.mod.tag }, origin: "third-party" }], "rollback");
      return plan.status === "ok" ? this.applyPlan(plan.value.id, requestedBy) : plan;
    });
  }

  reorder(ids: readonly string[]): ManagerResult {
    const current = this.#env.store.getEnabled();
    if (new Set(ids).size !== ids.length || ids.length !== current.length || ids.some((id) => !current.includes(id))) {
      return refused("order", "The load order must name each enabled mod exactly once.");
    }
    for (const pin of this.#env.store.getPins()) {
      const index = ids.indexOf(pin.id);
      if (index < 0) continue;
      if ((pin.before ?? []).some((other) => ids.includes(other) && index > ids.indexOf(other)) ||
          (pin.after ?? []).some((other) => ids.includes(other) && index < ids.indexOf(other))) {
        return refused("pins", "The load order would move a pinned mod.");
      }
    }
    this.#env.store.setEnabled(ids);
    this.#publish();
    return { status: "ok", value: null };
  }

  moveEnabled(id: string, delta: number): ManagerResult {
    if (!this.#env.store.isEnabled(id)) return refused("order", "Only enabled mods can be reordered.");
    this.#env.store.moveEnabled(id, delta);
    this.#publish();
    return { status: "ok", value: null };
  }

  proposeOrder(): ManagerResult<SortResult> {
    const current = this.#env.store.getEnabled();
    const catalog = this.#env.listCatalog();
    this.#env.look?.complete(catalog.find((mod) => mod.id === "anybandui" && mod.enabled)?.manifest);
    const manifests = current.flatMap((id) => { const mod = catalog.find((m) => m.id === id && !m.missing); return mod ? [mod.manifest] : []; });
    return { status: "ok", value: immutable(sortModOrder(manifests, { pins: this.#env.store.getPins(), current })) };
  }

  setConflictOverride(slot: string, winner: string | null): ManagerResult {
    if (!this.#env.conflictOverrides) return refused("unavailable", "The host cannot store conflict overrides.");
    if (winner !== null && !this.#find(winner)) return this.#missing();
    if (!this.#env.conflictOverrides.write(slot, winner)) return refused("storage", "The conflict override could not be saved.");
    this.#publish();
    return { status: "ok", value: null };
  }

  setSectionChoice(id: string, section: string, on: boolean): ManagerResult {
    const mod = this.#find(id);
    if (!mod?.manifest.sections?.some((s) => s.id === section)) return refused("section", "This mod section does not exist.");
    this.#env.store.setSectionChoice(id, section, on);
    this.#publish();
    return { status: "ok", value: null };
  }

  setSettingValue(id: string, settingId: string, value: number): ManagerResult {
    const setting = this.#find(id)?.manifest.settings?.find((s) => s.id === settingId);
    if (!setting || !Number.isFinite(value)) return refused("setting", "This mod setting is not valid.");
    this.#env.store.setSettingValue(id, settingId, resolveSettingValue(setting, value));
    this.#env.look?.recordSetting(id, settingId, resolveSettingValue(setting, value));
    if (!setting.requiresReload) this.#env.applySettingLive?.(id, settingId);
    this.#publish();
    return { status: "ok", value: null };
  }

  setThirdPartyConsent(allow: boolean, requestedBy: string | null = null): ManagerResult<unknown> {
    if (!this.#env.consent) return refused("unavailable", "The host cannot save third-party consent.");
    const apply = (): ManagerResult => this.#env.consent!.write(allow) ? { status: "ok", value: null } : refused("storage", "Third-party consent could not be saved.");
    if (allow && !this.#env.consent.read()) return this.#request({ operation: "third-party", requestedBy, riskNotice: CONSENT_DISCLAIMER }, async () => apply());
    const result = apply();
    this.#publish();
    return result;
  }

  #find(id: string): CatalogMod | undefined { return this.#env.listCatalog().find((m) => m.id === id && !m.missing); }
  #missing(): ManagerResult<never> { return refused("missing", "This mod is not installed."); }

  #consentRefusal(mod: CatalogMod, decisions: ConsentRecord): ManagerResult<never> | null {
    for (const cap of [...decisions.granted, ...decisions.refused]) {
      if (!mod.capabilities.includes(cap)) return refused("permission", "This mod did not request that permission.");
      if (decisions.granted.includes(cap)) {
        const why = tierRefusal(cap, mod.tier ?? UNKNOWN_TIER);
        if (why) return refused("tier", why);
      }
    }
    return null;
  }

  #writeConsent(id: string, decisions: ConsentRecord): ManagerResult {
    const mod = this.#find(id);
    if (!mod) return this.#missing();
    const invalid = this.#consentRefusal(mod, decisions);
    if (invalid) return invalid;
    const held = playerHeld(mod.capabilities, { granted: [...this.#env.store.getConsent(id).filter((cap) => !decisions.refused.includes(cap)), ...decisions.granted], refused: decisions.refused });
    this.#env.store.setDecisions(id, { granted: decisions.granted.filter((cap) => held.held.includes(cap)), refused: decisions.refused }, mod.version);
    this.#publish();
    return { status: "ok", value: null };
  }

  #applyFlags(mod: CatalogMod, flags: Readonly<Record<string, boolean>>): void {
    for (const [flag, on] of Object.entries(flags)) {
      if (mod.manifest.rules?.some((rule) => rule.flag === flag)) this.#env.store.setRuleChoice(flag, on);
      else {
        const section = mod.manifest.sections?.find((s) => (s.flag ?? s.id) === flag);
        if (section) this.#env.store.setSectionChoice(mod.id, section.id, on);
      }
    }
  }

  async #updateSet(ids: readonly string[] | null, requestedBy: string | null): Promise<ManagerResult<unknown>> {
    return this.#guard(async () => {
      if (ids?.some((id) => !this.#find(id))) return this.#missing();
      if (!this.#env.refreshUpdates || !this.#env.curated) return refused("unavailable", "The host cannot check mod updates.");
      this.#updates = await this.#env.refreshUpdates();
      this.#publish();
      const selected = this.#updates.filter((u) => u.standing === "behind" && u.newest !== null && (ids === null || ids.includes(u.id)));
      if (!selected.length) return { status: "ok", value: null };
      const { registry } = await this.#env.curated();
      const vouched = new Set((registry?.mods ?? []).map((r) => r.repo.toLowerCase()));
      const plan = await this.planInstall(selected.map((u) => ({ ref: { repo: u.repo, tag: u.newest! }, origin: vouched.has(u.repo.toLowerCase()) ? "curated" as const : "third-party" as const })), "update");
      return plan.status === "ok" ? this.applyPlan(plan.value.id, requestedBy) : plan;
    });
  }

  #subject(mod: Pick<CatalogMod, "id" | "name" | "version"> | DiscoveredMod): ConfirmationMod {
    const meta = this.#metadata.find((m) => m.id === mod.id);
    return { id: mod.id, name: mod.name, version: mod.version, repository: "repo" in mod ? mod.repo : meta?.repo ?? null, commit: "repo" in mod ? mod.sha ?? null : meta?.sha ?? null, digests: "repo" in mod ? null : meta?.digests ?? null };
  }

  #confirmation(request: CoreConfirmationRequest): PendingConfirmation {
    return immutable({ id: ++this.#nextId, operation: request.operation, requestedBy: request.requestedBy ?? null, mods: request.mods ?? [], permissions: request.permissions ?? [], riskNotice: request.riskNotice ?? [], conflicts: request.conflicts ?? [] });
  }

  #request(request: CoreConfirmationRequest, action: (decision: ConfirmationDecision) => Promise<ManagerResult<unknown>>): ManagerResult<unknown> {
    if (this.#pending || this.#busy) return refused("busy", "A mod operation is already waiting for confirmation.");
    this.#pending = this.#confirmation(request);
    this.#pendingAction = action;
    this.#publish();
    return { status: "confirmation", confirmation: this.#pending };
  }

  async #resolve(id: number, decision: ConfirmationDecision): Promise<ManagerResult<unknown>> {
    if (!this.#pending || this.#pending.id !== id || !this.#pendingAction) return refused("confirmation", "This confirmation is no longer pending.");
    const action = this.#pendingAction;
    this.#pending = null;
    this.#pendingAction = null;
    this.#busy = true;
    try {
      if (!decision.accepted) return refused("cancelled", "The mod operation was cancelled.");
      return await this.#guard(() => action(immutable(decision)));
    } finally { this.#busy = false; this.#publish(); }
  }

  async #guard<T>(body: () => Promise<ManagerResult<T>>): Promise<ManagerResult<T>> {
    try { return await body(); }
    catch (error) { this.#publish(); return refused("host", error instanceof Error ? error.message : String(error)); }
  }

  #publish(): void {
    const store = this.#env.store;
    const order = store.getEnabled();
    const pins = store.getPins();
    const sections = store.getSectionChoices();
    const settings = store.getSettingValues();
    const catalog = this.#env.listCatalog();
    this.#state = immutable({
      revision: ++this.#revision,
      installed: catalog.map((mod) => {
        const meta = this.#metadata.find((m) => m.id === mod.id);
        return { id: mod.id, name: mod.name, version: mod.version, repository: meta?.repo ?? null, commit: meta?.sha ?? null, digests: meta?.digests ?? null, tier: mod.tier ?? null, enabled: mod.enabled, loadOrder: order.includes(mod.id) ? order.indexOf(mod.id) : null, pins: pins.filter((p) => p.id === mod.id), sectionChoices: sections[mod.id] ?? {}, settings: settings[mod.id] ?? {}, consent: store.getDecisions(mod.id), consentVersion: store.getConsentVersion(mod.id) ?? null, catalogMod: mod };
      }),
      loadOrder: order, orderPins: pins, conflictOverrides: this.#env.conflictOverrides?.read() ?? {}, ruleChoices: store.getRuleChoices(), catalog: this.#catalog,
      pendingPlans: [...this.#plans.values()], pendingConfirmation: this.#pending, updates: this.#updates,
      thirdPartyAllowed: this.#env.consent?.read() ?? false, safeMode: this.#env.safeMode?.() ?? false, profile: this.#env.profile?.() ?? null,
      modList: catalog.map((m) => ({ id: m.id, version: m.version, enabled: m.enabled })),
    });
    for (const listener of this.#listeners) listener(this.#state);
  }
}

export function createModManagerService(env: ModManagerEnvironment): { readonly service: ModManagerService; readonly core: CoreModManager } {
  return ModManagerService.create(env);
}
