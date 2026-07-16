/**
 * Node ESM resolve hook: append ".js" / "/index.js" to extensionless relative
 * imports.
 *
 * @neo-angband/core is a bundler-target package (tsconfig moduleResolution
 * "bundler"): its compiled dist keeps extensionless imports ("./rng"), which
 * Vite/vitest resolve but plain Node ESM does not. Rather than rewrite core
 * (out of scope, and it is only ever bundled or run under vitest elsewhere),
 * the CLI harness runs under this hook so `node dist/main-stats.js` and the
 * npm scripts work with pure Node tooling and no extra dependencies.
 *
 * The hook only ever ADDS a suffix after the default resolver has already
 * failed, so it changes nothing for correctly-specified imports.
 */

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err && err.code !== "ERR_MODULE_NOT_FOUND" && err.code !== "ERR_UNSUPPORTED_DIR_IMPORT") {
      throw err;
    }
    for (const suffix of [".js", "/index.js"]) {
      try {
        return await nextResolve(specifier + suffix, context);
      } catch {
        /* try the next candidate */
      }
    }
    throw err;
  }
}
