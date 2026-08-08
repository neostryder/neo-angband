/**
 * A whole mod, assembled and checked before it is ever written to disk.
 *
 * WHY A BUILDER AND NOT A TEMPLATE REPOSITORY. "Copy this folder and edit it"
 * is the usual answer, and it fails the same way every time: the copy goes
 * stale, the author edits the parts they understand and leaves the parts they
 * do not, and nothing checks the result until the game quietly ignores it.
 * A builder can do the three things a template cannot - fill in what core's own
 * data says is typical, run the REAL composition pipeline over the result, and
 * name every remaining way the mod will not work.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not touch the filesystem. This
 * package is imported at runtime by the web build, where there is no
 * filesystem, and a builder that returned paths and contents is equally usable
 * from a CLI, from a test, and from an in-game mod editor. `emit()` hands back
 * the bytes; writing them is the caller's business.
 *
 * THE CHECK RUNS ON THE COMPOSED RESULT, not on the draft. A mod's own records
 * are not what the game sees - the game sees core's records with the mod's
 * patches applied - so checking the draft would miss exactly the class of
 * mistake patching introduces. `build(core)` composes through
 * `composeContentPacks`, the same function the host calls, and checks what
 * comes out of it.
 */

import { checkRecords } from "./authoring.js";
import type { AuthoringFinding } from "./authoring.js";
import type { JsonRecord } from "./compose.js";
import type { FieldDecl } from "./fields.js";
import { composeContentPacks } from "./loader.js";
import type { LoadedPack } from "./loader.js";
import { validateManifest } from "./manifest.js";
import type { PackManifest } from "./manifest.js";
import type { FieldOp } from "./patch.js";
import { recordRefKeys } from "./record-key.js";

/** The key half of a `<pack>:<key>` ref. */
function refKey(ref: string): string {
  const at = ref.indexOf(":");
  return at === -1 ? ref : ref.slice(at + 1);
}

/** One file the mod folder should contain. */
export interface EmittedFile {
  /** Path within the mod folder, e.g. "manifest.json", "object.json". */
  readonly path: string;
  /** The file's contents, JSON with a trailing newline. */
  readonly contents: string;
}

/** Everything a build produced: the bytes, and every reason not to ship them. */
export interface ProjectBuild {
  /** The validated manifest. */
  readonly manifest: PackManifest;
  /** The mod folder, ready to write. */
  readonly files: readonly EmittedFile[];
  /** What the composed result still gets wrong, worst first. */
  readonly findings: readonly AuthoringFinding[];
  /** Composition's own refusals: a patch that hit nothing, a field undeclared. */
  readonly problems: readonly string[];
  /**
   * Whether anything at the `error` level survived.
   *
   * A convenience with a deliberate rule behind it: WARNINGS DO NOT BLOCK. Every
   * warning this produces is something core's own data does somewhere, so a
   * builder that refused on them would refuse to build Angband.
   */
  readonly ok: boolean;
}

/**
 * A mod under construction.
 *
 * Every mutator returns `this`, so a whole mod is one expression:
 *
 *   modProject({ id: "sludge", name: "Sludge", version: "1.0.0", shape: "content",
 *                author: "...", repository: "...", engine: ">=0.19.0" })
 *     .declareField({ name: "sludge", files: ["object"], type: "object" })
 *     .add("object", sludgeDagger)
 *     .patchFields("object", "core:dagger", [{ op: "set", path: "sludge:sludge", value: {...} }])
 *     .build(corePack)
 */
export class ModProject {
  readonly #manifest: PackManifest;
  readonly #records = new Map<string, JsonRecord[]>();
  readonly #fieldPatches = new Map<string, Map<string, FieldOp[]>>();
  readonly #replaces = new Map<string, Map<string, JsonRecord>>();
  readonly #removes = new Map<string, string[]>();
  readonly #fields: FieldDecl[] = [];

  /** Throws ManifestError if the manifest could not work. */
  constructor(manifest: unknown) {
    this.#manifest = validateManifest(manifest);
    if (this.#manifest.fields !== undefined) this.#fields.push(...this.#manifest.fields);
  }

  /** The mod's id, which is also the namespace its fields must carry. */
  get id(): string {
    return this.#manifest.id;
  }

  /**
   * Declare a field this mod introduces onto core's records.
   *
   * The name is BARE here and namespaced everywhere else: the mod owns
   * `<id>:<name>` and `qualify` is how to write it. Declaring it twice keeps the
   * first, matching declaredFields.
   */
  declareField(field: FieldDecl): this {
    if (!this.#fields.some((f) => f.name === field.name)) this.#fields.push(field);
    return this;
  }

  /** `<this mod's id>:<name>` - how a declared field is written in JSON. */
  qualify(name: string): string {
    return `${this.#manifest.id}:${name}`;
  }

  /** Add whole records to a file. */
  add(file: string, ...records: JsonRecord[]): this {
    const list = this.#records.get(file) ?? [];
    list.push(...records);
    this.#records.set(file, list);
    return this;
  }

  /** Apply field operations to an existing record, by ref. */
  patchFields(file: string, ref: string, ops: readonly FieldOp[]): this {
    const perFile = this.#fieldPatches.get(file) ?? new Map<string, FieldOp[]>();
    perFile.set(ref, [...(perFile.get(ref) ?? []), ...ops]);
    this.#fieldPatches.set(file, perFile);
    return this;
  }

  /** Replace an existing record wholesale, by ref. */
  replace(file: string, ref: string, record: JsonRecord): this {
    const perFile = this.#replaces.get(file) ?? new Map<string, JsonRecord>();
    perFile.set(ref, record);
    this.#replaces.set(file, perFile);
    return this;
  }

  /** Remove an existing record, by ref. */
  remove(file: string, ref: string): this {
    this.#removes.set(file, [...(this.#removes.get(file) ?? []), ref]);
    return this;
  }

  /** The manifest as it now stands, including every declared field. */
  manifest(): PackManifest {
    const out: PackManifest = { ...this.#manifest };
    if (this.#fields.length > 0) out.fields = [...this.#fields];
    return out;
  }

  /** This mod as the loader sees it, so it can be composed with core. */
  toPack(): LoadedPack {
    const files: Record<string, Record<string, unknown>> = {};
    const touch = (file: string): Record<string, unknown> => (files[file] ??= {});
    for (const [file, records] of this.#records) touch(file)["records"] = records;
    for (const [file, perRef] of this.#fieldPatches) {
      touch(file)["fieldPatches"] = Object.fromEntries(perRef);
    }
    for (const [file, perRef] of this.#replaces) {
      touch(file)["replaces"] = Object.fromEntries(perRef);
    }
    for (const [file, refs] of this.#removes) touch(file)["removes"] = refs;
    return { manifest: this.manifest(), files } as unknown as LoadedPack;
  }

  /**
   * The mod folder, ready to write: `manifest.json` plus one file per record
   * file, exactly as the folder reader expects to find them.
   */
  emit(): EmittedFile[] {
    const pack = this.toPack() as unknown as {
      files: Record<string, unknown>;
    };
    const out: EmittedFile[] = [
      { path: "manifest.json", contents: `${JSON.stringify(this.manifest(), null, 2)}\n` },
    ];
    for (const file of Object.keys(pack.files).sort()) {
      out.push({
        path: `${file}.json`,
        contents: `${JSON.stringify(pack.files[file], null, 2)}\n`,
      });
    }
    return out;
  }

  /**
   * Compose this mod on top of `core` and check what comes out.
   *
   * `core` is the base game as a LoadedPack - `{manifest, files: {object:
   * {records: [...]}, ...}}`, which is what every host already builds. Without
   * it the mod is checked ALONE, which is honest but much weaker: every
   * reference to a core record reads as dangling, so `build()` with no core
   * says so in a finding rather than pretending the result means anything.
   */
  build(core?: LoadedPack): ProjectBuild {
    const mine = this.toPack();
    const packs = core === undefined ? [mine] : [core, mine];
    /* REPORT, NEVER THROW. resolveLoadOrder throws on a missing dependency or a
     * cycle, and both are things a mod under construction routinely has - a mod
     * that depends on core, built before core is passed in, is the first thing
     * anyone tries. A builder whose response to an ordinary authoring mistake
     * is a stack trace is a builder people stop using. */
    let composed;
    try {
      composed = composeContentPacks(packs);
    } catch (error) {
      return {
        manifest: this.manifest(),
        files: this.emit(),
        findings: [
          {
            level: "error",
            file: "(project)",
            record: this.#manifest.id,
            rule: "project/unloadable",
            message:
              `could not be composed: ${error instanceof Error ? error.message : String(error)}. ` +
              "A dependency this mod declares must be passed to build() alongside it.",
          },
        ],
        problems: [],
        ok: false,
      };
    }

    const all: Record<string, readonly JsonRecord[]> = {};
    for (const [file, records] of Object.entries(composed.records)) {
      all[file] = records.filter(
        (r): r is JsonRecord => r !== null && typeof r === "object" && !Array.isArray(r),
      );
    }

    /* The SUBJECT is every record this mod is answerable for, as it came OUT of
     * composition rather than as it was drafted - a record this mod added and
     * then patched is one record by the time the game sees it, and checking the
     * draft would check something that never runs.
     *
     * Membership is decided with recordRefKeys, the same identity composition
     * itself uses, rather than by matching on `name`: fourteen of the record
     * files have no `name`, and a hand-rolled slug here would be a second
     * spelling of an identity that already has one. A patch ref is
     * `<pack>:<key>`, so only the key half is compared - which pack OWNS the
     * record is not the question; whether this mod touched it is. */
    const wantedKeys = new Map<string, Set<string>>();
    const want = (file: string, key: string): void => {
      const set = wantedKeys.get(file) ?? new Set<string>();
      set.add(key);
      wantedKeys.set(file, set);
    };
    for (const [file, records] of this.#records) {
      for (const r of records) for (const k of recordRefKeys(file, r)) want(file, k);
    }
    for (const [file, perRef] of this.#fieldPatches) {
      for (const ref of perRef.keys()) want(file, refKey(ref));
    }
    for (const [file, perRef] of this.#replaces) {
      for (const ref of perRef.keys()) want(file, refKey(ref));
    }

    const subject: Record<string, readonly JsonRecord[]> = {};
    for (const [file, keys] of wantedKeys) {
      subject[file] = (all[file] ?? []).filter((r) =>
        recordRefKeys(file, r).some((k) => keys.has(k)),
      );
    }
    /* A file whose records composition dropped entirely still gets checked, on
     * the drafts, so a mod is never silently unexamined. */
    for (const [file, records] of this.#records) {
      if ((subject[file] ?? []).length === 0) subject[file] = records;
    }

    const findings: AuthoringFinding[] = checkRecords(subject, all);

    /* THE ONE THAT COSTS THE WHOLE GAME, PROMOTED TO AN ERROR. Three record
     * files - object, ego_item and vault - ship names that slug to the same ref
     * ("Acquirement" and "*Acquirement*"), so composition classifies them as
     * whole-file and a mod that ADDS one record to them replaces core's entire
     * file. The loader already says so in `problems`, but a line in a list is
     * not proportionate to deleting all 375 of the game's objects, and a
     * builder whose `ok` is true for that is lying. Detected off the loader's
     * own report rather than by re-deriving the classification here, so the two
     * cannot disagree about which files are affected. */
    const mineId = this.#manifest.id;
    for (const problem of composed.problems) {
      if (!problem.startsWith(`${mineId}: `) || !problem.includes("replaces the whole file")) {
        continue;
      }
      findings.unshift({
        level: "error",
        file: problem.slice(mineId.length + 2).split(" ")[0] ?? "(unknown)",
        record: mineId,
        rule: "file/whole-file-replacement",
        message:
          `${problem}. Adding a record to this file is not possible today ` +
          "without shipping the whole file: use `patchFields` to change existing " +
          "records, and track the gap rather than shipping a mod that deletes " +
          "the base game's data.",
      });
    }

    if (core === undefined) {
      findings.unshift({
        level: "hint",
        file: "(project)",
        record: this.#manifest.id,
        rule: "project/no-core",
        message:
          "built without the base game, so every reference into core's records " +
          "reads as unresolved. Pass the core pack to build() for a real answer.",
      });
    }

    return {
      manifest: this.manifest(),
      files: this.emit(),
      findings,
      problems: composed.problems,
      ok: !findings.some((f) => f.level === "error"),
    };
  }
}

/** Start a mod. Throws ManifestError if the manifest could not work. */
export function modProject(manifest: unknown): ModProject {
  return new ModProject(manifest);
}
