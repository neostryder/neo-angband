/*
 * The no-downgrade rule for the update bridge. In its own module, not in updater.ts, because
 * the Electron update canary loads updater.js by itself and cannot resolve the SDK package.
 */
import { compareSemver } from "@rpgm-tools/neo-angband-mod-sdk";

/**
 * Refuse a release that is not newer than the installed version. A save is read by the engine
 * that opens it and its format only moves forward, so an older engine can corrupt a character
 * it cannot read. The page applies the same rule when it picks an update; this is the copy in
 * the process that installs, because any script in the page can call the update bridge with
 * any tag. A tag that is not a version cannot be ordered and is refused too.
 */
export function assertNewerThanInstalled(tag: string, installed: string): void {
  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  const order = compareSemver(version, installed);
  if (order === null || order <= 0) {
    throw new Error("this release is not newer than the installed version");
  }
}
