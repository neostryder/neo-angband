/**
 * The host layer on its own, importable without the game engine.
 *
 * core's main barrel re-exports everything, which is right for a front end that
 * runs the game. The Electron MAIN process does not run the game: it only serves
 * z-file.c to the renderer. Importing the barrel there pulled the entire engine -
 * rules, generation, monsters - into the main-process bundle, 479 kB of code a
 * file write has no use for.
 *
 * So the host is reachable as `@neo-angband/core/host`. Same modules, same
 * single copy of the semantics; just a door that does not open onto the rest.
 */

export * from "./io";
export * from "./raw";
export * from "./bridge";
export * from "./memory";
