/**
 * @neo-angband/borg trait subsystem (P8.3): the self-model and power fitness.
 *
 * Public API:
 * - BI / BI_MAX / PREFIX_PREF - the trait index space (borg-trait.h enum).
 * - borgNotice(ctx, opts?) - fill ctx.world.self.trait[BI_*] (borg_notice).
 * - borgPower(ctx, opts?) - the scalar fitness (borg_power); writes self.power.
 * - borgPrepared(ctx, depth, opts?) - depth-readiness reason or null.
 * - borgRestock(ctx, depth, opts?) - crucial-supply reason or null.
 * - config seams (BorgTraitOpts, defaults) and the derived side-state store.
 */

export * from "./trait-index";
export * from "./tables";
export * from "./config";
export * from "./state";
export * from "./item-util";
export * from "./trait";
export * from "./power";
export * from "./prepared";
