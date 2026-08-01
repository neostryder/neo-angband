/**
 * Read the one entry `npm pack --json` describes, whichever shape this npm reports.
 *
 * npm 11 answers with an ARRAY of one object. npm 12 answers with an OBJECT keyed
 * by package name. `tools/check-npm-package.mjs` destructured the array, so on
 * npm 12 every package failed with `object is not iterable` - identically for
 * `core`, which had been packing green in CI for months. The break was never
 * about the package being checked; it was about which npm was doing the packing,
 * and CI only ever ran the checker on the npm Node 24 happens to bundle (11.16.0)
 * while the release path installed npm@latest. Measured on npm 12.0.2.
 *
 * Both shapes are accepted rather than pinning a version. This script exists to
 * find out what npm actually ships, so it must not be the thing that dictates
 * which npm you may run it with.
 *
 * It lives in its own module for the same reason `publishable.mjs` does: the
 * checker is a top-level script that packs real tarballs when you import it, so
 * a function inside it cannot be tested. See the shape tests in
 * packages/core/src/npm-publish.test.ts - a fix with no test is a fix that gets
 * to be wrong again the next time npm changes its mind.
 *
 * @param {string} stdout Raw stdout from `npm pack --json`.
 * @param {string} pkg Package directory name, for the error message only.
 * @returns {{ filename: string, size: number }} The packed tarball's entry.
 */
export function packResult(stdout, pkg) {
  const parsed = JSON.parse(stdout);
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  if (!entry || typeof entry.filename !== "string") {
    throw new Error(
      `${pkg}: npm pack --json reported a shape with no filename in it: ` +
        JSON.stringify(parsed).slice(0, 200),
    );
  }
  return entry;
}
