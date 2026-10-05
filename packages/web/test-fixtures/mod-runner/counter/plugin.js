/* Counts level arrivals; loaded after the thrower, it must still hear every one. */
export const heard = [];

export default {
  api: 1,
  register(_host, ctx) {
    ctx.events.on("dungeonlevel", (_type, data) => {
      heard.push(data.depth);
    });
  },
};
