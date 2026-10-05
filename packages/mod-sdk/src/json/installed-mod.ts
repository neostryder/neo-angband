import { defineFormat, json } from "./index.js";

/**
 * How an installed mod reached the game: from the default registry's own list
 * ("curated"), its community list ("community"), a community entry carrying the
 * reviewed label ("reviewed"), a repository the player typed ("address"), or an
 * archive ("file"). A record written before this field has none.
 */
export const INSTALL_LISTINGS = ["curated", "community", "reviewed", "address", "file"] as const;
export type InstallListing = (typeof INSTALL_LISTINGS)[number];

/**
 * What the web host records about one mod it installed from a repository: where
 * it came from, the files it wrote and their digests. Stored as an object in the
 * `modsMeta` IndexedDB store, keyed by mod id.
 */
const validator = json.object({
  id: json.string,
  name: json.optional(json.string),
  repo: json.string,
  tag: json.string,
  sha: json.optional(json.string),
  files: json.array(json.string),
  installedAt: json.string,
  digests: json.optional(json.map(json.string, json.string)),
  installedByModId: json.optional(json.string),
  listing: json.optional(json.enum(INSTALL_LISTINGS)),
});

export const installedModFormat = defineFormat({
  format: "neo-angband/web/installed-mod",
  schemaVersion: 1,
  validator,
  sample: {
    id: "neo-angband-mod-qol",
    name: "Quality of Life",
    repo: "neostryder/neo-angband-mod-qol",
    tag: "v1.4.0",
    files: ["manifest.json", "plugin.js"],
    installedAt: "2026-09-27T12:00:00.000Z",
    listing: "curated",
  },
});
