import { defineFormat, json, type Infer } from "./index.js";

/**
 * Which player profiles exist in one install, and which is active. The default
 * profile has no entry in `named`: its data is the install's unprefixed data,
 * and `defaultName` is present only once the player has renamed it. An absent
 * `active` means the default profile is active.
 */
const validator = json.object({
  /** Profile id to its name and creation time in milliseconds since the epoch. */
  named: json.map(json.object({ name: json.string, createdAt: json.finiteNumber }), json.string),
  defaultName: json.optional(json.string),
  active: json.optional(json.string),
});

export type ProfileIndex = Infer<typeof validator>;

export const profilesFormat = defineFormat({
  format: "neo-angband/web/profiles",
  schemaVersion: 1,
  validator,
  sample: {
    named: { "5b0f7c2e-8d1a-4f3e-9c6b-2a7d4e1f0b93": { name: "Testing", createdAt: 1790000000000 } },
    defaultName: "Main",
    active: "5b0f7c2e-8d1a-4f3e-9c6b-2a7d4e1f0b93",
  },
});

export const profileOwnerFormat = defineFormat({
  format: "neo-angband/web/profile-owner",
  schemaVersion: 1,
  validator: json.object({ profileId: json.string, modId: json.string }),
  sample: { profileId: "5b0f7c2e-8d1a-4f3e-9c6b-2a7d4e1f0b93", modId: "sample-player" },
});

export const profileActionFormat = defineFormat({
  format: "neo-angband/web/profile-action",
  schemaVersion: 1,
  validator: json.object({
    profileId: json.nullable(json.string),
    modId: json.string,
    action: json.object({ kind: json.enum(["create-character"]), armController: json.optional(json.boolean) }),
  }),
  sample: { profileId: null, modId: "sample-player", action: { kind: "create-character", armController: true } },
});
