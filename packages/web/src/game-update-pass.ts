/**
 * The optional mod half of a game update.
 *
 * A game build and a mod release are independent, but a player who has chosen
 * to replace the game is already making an update decision.  This small
 * coordinator keeps that choice explicit while guaranteeing that an individual
 * mod failure never prevents the game update from continuing.
 */

import type { ModUpgrade } from "./mod-refresh";

export type GameUpdatePassChoice = "game-only" | "game-and-mods";

export interface ModUpdateFailure {
  readonly update: ModUpgrade;
  readonly problem: string;
}

export interface GameUpdatePassDeps<T> {
  /** Install one tag the player was shown.  A problem is local to that mod. */
  readonly updateMod: (update: ModUpgrade) => Promise<string | null>;
  /** Show failures before the game restarts, so they cannot disappear silently. */
  readonly reportModFailures: (failures: readonly ModUpdateFailure[]) => Promise<void>;
  /** The existing game updater. It always runs after the requested mod attempts. */
  readonly updateGame: () => Promise<T>;
}

export interface GameUpdatePassResult<T> {
  readonly game: T;
  readonly failures: readonly ModUpdateFailure[];
}

/** There is no extra question when no installed mod can actually move forward. */
export function shouldOfferGameUpdateMods(pending: readonly ModUpgrade[]): boolean {
  return pending.length > 0;
}

/**
 * Apply the selected pass.  Each mod is isolated deliberately: a failed
 * download, changed repository, or newly-incompatible tag is reported and the
 * next mod and the game update still get their chance.
 */
export async function runGameUpdatePass<T>(
  choice: GameUpdatePassChoice,
  pending: readonly ModUpgrade[],
  deps: GameUpdatePassDeps<T>,
): Promise<GameUpdatePassResult<T>> {
  const failures: ModUpdateFailure[] = [];
  if (choice === "game-and-mods") {
    for (const update of pending) {
      try {
        const problem = await deps.updateMod(update);
        if (problem !== null) failures.push({ update, problem });
      } catch (error: unknown) {
        failures.push({
          update,
          problem: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  if (failures.length > 0) await deps.reportModFailures(failures);
  return { game: await deps.updateGame(), failures };
}

/** The report is intentionally brief: the ordinary Mod manager is the retry door. */
export function gameUpdateModFailureLines(failures: readonly ModUpdateFailure[]): readonly string[] {
  if (failures.length === 0) return [];
  return [
    "The game update will continue, but these mod updates failed:",
    "",
    ...failures.map(
      ({ update, problem }) => `  ${update.name ?? update.id} (${update.from} -> ${update.to}): ${problem}`,
    ),
    "",
    "You can retry these from Mods -> Update installed mods.",
  ];
}
