/* A listener that throws on every level arrival. */
export default {
  api: 1,
  register(_host, ctx) {
    ctx.events.on("dungeonlevel", () => {
      throw new Error("the thrower listener broke");
    });
  },
};
