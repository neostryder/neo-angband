/**
 * `neo-angband-mod-build`: the transform every mod repository runs, and the three
 * rules it enforces.
 *
 * WHAT THIS EXISTS TO CATCH. The builder used to live in the engine repository and was
 * tested only against the two mods that were bundled there - both of them correct. So
 * every assertion was on the passing path, and one of the three guarantees turned out
 * to be unfirable: a VALUE import of the engine was RESOLVED and inlined rather than
 * caught, because nothing was marked external. Measured, before the fix: a plugin.ts
 * doing `import { TMD } from "@rpgm-tools/neo-angband-core"` built clean at exit 0 and
 * shipped a private copy of the timed-effect table inside plugin.js.
 *
 * So the fixtures include mods that must FAIL, and the assertions are on the exit code
 * and on the message an author would actually read. A guard is only known to work when
 * something has been seen to trip it.
 *
 * It shells out rather than importing the builder: a test that reimplements the build
 * proves the reimplementation.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const PKG = join(import.meta.dirname, "..");
const BIN = join(PKG, "bin", "neo-angband-mod-build.mjs");
const FIXTURES = join(PKG, "test-fixtures");

const temps: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "neo-mod-build-"));
  temps.push(d);
  return d;
}
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

interface Run {
  readonly code: number;
  readonly out: string;
}

/** Run the builder over one fixture. Never throws, so a failure is a value to assert on. */
function run(fixture: string, extra: readonly string[] = []): Run {
  const args = [BIN, "--root", join(FIXTURES, fixture), ...extra];
  try {
    const out = execFileSync(process.execPath, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    /* stdout AND stderr: the tool notes progress on one and reports refusals on the
     * other, and a test that read only one would assert against half the output. */
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("a well-formed mod builds", () => {
  it("writes plugin.js beside the manifest when --root IS the mod folder", () => {
    /* The mod-repository case, and the reason --out defaults to the folder itself:
     * plugin.js is a committed artefact there, next to the manifest.json it ships
     * with. Writing it elsewhere by default would leave the repo's own copy stale. */
    const out = tempDir();
    const r = run("ok-mod", ["--out", out]);
    expect(r.code, r.out).toBe(0);
    expect(existsSync(join(out, "ok-mod", "plugin.js")), r.out).toBe(true);
    /* The manifest travels with it: a folder without one is not a mod. */
    const manifest = JSON.parse(readFileSync(join(out, "ok-mod", "manifest.json"), "utf8")) as {
      id: string;
    };
    expect(manifest.id).toBe("ok-mod");
  });

  it("bundles the mod's own modules IN, rather than importing them", () => {
    const out = tempDir();
    expect(run("ok-mod", ["--out", out]).code).toBe(0);
    const js = readFileSync(join(out, "ok-mod", "plugin.js"), "utf8");
    expect(js).toContain("ok-mod-helper-was-bundled");
    expect(js).not.toMatch(/from\s*["']\.\//u);
  });

  it("leaves no non-relative import at all, and erases the type-only one", () => {
    const out = tempDir();
    expect(run("ok-mod", ["--out", out]).code).toBe(0);
    const js = readFileSync(join(out, "ok-mod", "plugin.js"), "utf8");
    /* The invariant is "no non-relative import", not "not this package name". An
     * earlier version of this assertion matched the engine's name spelled out, and a
     * scope rename left it matching a string nothing writes any more. */
    expect(js).not.toMatch(/(?:^|[\s;}])(?:import|export)[\s\S]{0,200}?from\s*["'][^."'][^"']*["']/u);
    expect(js).not.toMatch(/import\s*\(\s*["'][^."'][^"']*["']\s*\)/u);
    expect(js).not.toContain("neo-angband-core");
  });

  it("--check verifies and writes NOTHING", () => {
    const out = tempDir();
    const r = run("ok-mod", ["--out", out, "--check"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("ok");
    expect(existsSync(join(out, "ok-mod", "plugin.js"))).toBe(false);
  });
});

describe("--check catches a STALE committed plugin.js", () => {
  /**
   * The failure nothing else in the chain can see. In a mod repository plugin.js is
   * committed, because that is the file the catalogue fetches at a tag and hashes - so
   * the digest is taken FROM the artefact and matches a stale one perfectly. Every other
   * guarantee in the builder is about the file it just produced; this is the only one
   * about the file that is actually going to be served.
   */
  function stagedCopy(): string {
    const dir = tempDir();
    const mod = join(dir, "ok-mod");
    mkdirSync(mod, { recursive: true });
    for (const f of ["manifest.json", "plugin.ts", "helper.ts"]) {
      writeFileSync(join(mod, f), readFileSync(join(FIXTURES, "ok-mod", f), "utf8"));
    }
    return mod;
  }

  function checkIn(mod: string): Run {
    try {
      return {
        code: 0,
        out: execFileSync(process.execPath, [BIN, "--root", mod, "--check"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  }

  it("passes when the committed artefact is a fresh build of the source", () => {
    const mod = stagedCopy();
    expect(
      execFileSync(process.execPath, [BIN, "--root", mod], { encoding: "utf8" }),
    ).toContain("wrote");
    const r = checkIn(mod);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("is current");
  });

  it("fails when the source moved on and the artefact did not", () => {
    const mod = stagedCopy();
    execFileSync(process.execPath, [BIN, "--root", mod], { encoding: "utf8" });
    /* Edit the SOURCE, leave the artefact. This is exactly what a forgotten rebuild
     * looks like in a diff, and it is invisible to every digest. */
    writeFileSync(
      join(mod, "helper.ts"),
      'export const FIXTURE_MARKER = "ok-mod-helper-CHANGED";\n',
    );
    const r = checkIn(mod);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("does not match its source");
    /* And it says the thing that makes it urgent, rather than just "out of date". */
    expect(r.out).toContain("digest");
  });

  it("says 'is current' only when it actually compared something", () => {
    /* Guards the guard: with no committed artefact there is nothing to compare, and a
     * message claiming currency would be a claim about a file that does not exist. */
    const mod = stagedCopy();
    const r = checkIn(mod);
    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toContain("is current");
  });
});

describe("a mod that imports the engine as a VALUE is refused", () => {
  /**
   * The regression this pins. It is not "a bare import survives into the output" - it
   * is that the import must survive at all. esbuild resolves the engine happily from a
   * mod repo's node_modules, so unless every package specifier is marked external the
   * bytes get inlined and the scan below has nothing to find.
   */
  const r = run("value-import-mod", ["--check"]);

  it("exits non-zero", () => {
    expect(r.code, r.out).not.toBe(0);
  });

  it("names the offending specifier and the fix, not just 'build failed'", () => {
    expect(r.out).toContain("@rpgm-tools/neo-angband-core");
    expect(r.out).toContain("ctx.core");
    /* The second half of the reason. A message that said only "cannot resolve" would
     * invite the author to make it resolve, which is precisely the wrong repair. */
    expect(r.out).toMatch(/own copy of that module's state/u);
    expect(r.out).toContain("import type");
  });

  it("does not write a plugin.js for it", () => {
    const out = tempDir();
    expect(run("value-import-mod", ["--out", out]).code).not.toBe(0);
    expect(existsSync(join(out, "value-import-mod", "plugin.js"))).toBe(false);
  });
});

describe("a bare import that RESOLVES is refused rather than inlined", () => {
  /**
   * The fixture above is not enough on its own, and finding that out is the point.
   *
   * `value-import-mod` imports the engine, and the engine is not installed in THIS
   * package - so esbuild fails to resolve it and the build errors for the wrong reason.
   * Removing the external-specifier plugin still left that fixture failing, just with a
   * different message: the mutation was killed by one assertion instead of three, which
   * is what exposed the gap.
   *
   * The danger only exists where the import RESOLVES: a mod repository has the engine
   * as a devDependency, so it is right there in node_modules, and esbuild will happily
   * copy it into plugin.js. So this builds that situation - a mod folder next to a
   * node_modules holding a package that resolves - and asserts the tool refuses it.
   * With the plugin removed, this test fails by SUCCEEDING, and the bundle contains the
   * package's module state.
   */
  const root = tempDir();
  const mod = join(root, "inlining-mod");
  mkdirSync(mod, { recursive: true });
  mkdirSync(join(root, "node_modules", "pretend-engine"), { recursive: true });
  writeFileSync(
    join(root, "node_modules", "pretend-engine", "package.json"),
    JSON.stringify({ name: "pretend-engine", version: "1.0.0", type: "module", main: "index.js" }),
  );
  /* Module STATE, not a constant: this is the thing a second copy of ruins. */
  writeFileSync(
    join(root, "node_modules", "pretend-engine", "index.js"),
    "export const REGISTRY = { entries: [] };\n",
  );
  writeFileSync(
    join(mod, "manifest.json"),
    JSON.stringify({
      id: "inlining-mod",
      name: "Inlining Mod",
      version: "0.10.0",
      shape: "content",
      facets: ["plugin"],
      modApi: 1,
      author: "neostryder (RPGM Tools)",
      license: "GPL-2.0-only",
      description: "A fixture whose bare import resolves, so the builder has to refuse it.",
    }),
  );
  writeFileSync(
    join(mod, "plugin.ts"),
    'import { REGISTRY } from "pretend-engine";\n' +
      "export default { api: 1, hooks: () => ({ n: REGISTRY.entries.length }) };\n",
  );

  const r = (() => {
    try {
      return {
        code: 0,
        out: execFileSync(process.execPath, [BIN, "--root", mod, "--out", join(root, "out")], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  })();

  it("refuses it, naming the package", () => {
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("pretend-engine");
  });

  it("writes nothing, so no bundle with a duplicated module can exist", () => {
    expect(existsSync(join(root, "out", "inlining-mod", "plugin.js")), r.out).toBe(false);
  });

  it("and the resolvable package's source is nowhere in the output", () => {
    /* The assertion that fails loudest under the mutation: without the external plugin
     * this file exists and contains `REGISTRY = { entries: [] }` - a private copy of
     * another module's state, inside the mod. */
    const built = join(root, "out", "inlining-mod", "plugin.js");
    if (existsSync(built)) {
      expect(readFileSync(built, "utf8")).not.toContain("REGISTRY");
    }
    expect(existsSync(built)).toBe(false);
  });
});

describe("a mod that default-exports nothing is refused", () => {
  const r = run("no-default-mod", ["--check"]);

  it("exits non-zero and says which half of the contract is missing", () => {
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("no default export");
  });
});

describe("the builder's own arguments", () => {
  it("refuses a --mods id that does not exist, naming what does", () => {
    /* A typo'd id used to build nothing and exit 0, which is indistinguishable from
     * success in a CI log. */
    const r = (() => {
      try {
        return {
          code: 0,
          out: execFileSync(process.execPath, [BIN, "--root", FIXTURES, "--mods", "no-such-mod"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          }),
        };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
      }
    })();
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("no-such-mod");
    expect(r.out).toContain("ok-mod");
  });

  it("builds every mod folder under a directory of them", () => {
    /* The engine-repository case: --root is a folder OF mod folders. Two of these
     * three must fail, so this also pins that one bad mod does not stop the others
     * from being reported. */
    const r = (() => {
      try {
        return {
          code: 0,
          out: execFileSync(process.execPath, [BIN, "--root", FIXTURES, "--check"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          }),
        };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
      }
    })();
    expect(r.out).toContain("checking 3");
    expect(r.out).toContain("ok-mod: ok");
    expect(r.out).toContain("value-import-mod:");
    expect(r.out).toContain("no-default-mod:");
    /* Non-zero, because two of the three are broken - and it got to the third. */
    expect(r.code).not.toBe(0);
  });
});
