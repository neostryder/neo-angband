/* Adds a throwing listener straight to the game's event bus, past the guard ctx.events puts on each one. */
export default {
  api: 1,
  register(_host, ctx) {
    ctx.state.events.on("dungeonlevel", () => {
      throw new Error("the raw listener broke");
    });
  },
};
