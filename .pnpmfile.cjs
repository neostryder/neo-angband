// typescript-eslint drives the TypeScript JS compiler API, which TypeScript 7 no
// longer ships (the compiler is native; `tsc` still runs from typescript 7). Its
// peer range stops below 7 and it refuses to load against 7, so each package in the
// family is rewritten to depend on the TypeScript 6 API package under the
// `typescript` name instead of taking the workspace's typescript as a peer.
// Remove this file when typescript-eslint supports TypeScript 7.
const TS6 = "npm:@typescript/typescript6@6.0.2";

function readPackage(pkg) {
  const family = pkg.name === "typescript-eslint" || pkg.name.startsWith("@typescript-eslint/");
  if (family && pkg.peerDependencies && pkg.peerDependencies.typescript) {
    delete pkg.peerDependencies.typescript;
    if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta.typescript;
    pkg.dependencies = { ...pkg.dependencies, typescript: TS6 };
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
