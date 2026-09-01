export default {
  api: 1,

  register(host, ctx) {
    const exchange = ctx.registries?.stores.byName("STORE_BLACK");
    if (!exchange) return;

    const coreWillBuy = host.stores.willBuyFor("*");
    if (!coreWillBuy) return;

    host.stores.setWillBuy(exchange.feat, (shop) => {
      if (
        shop.obj.tval === ctx.core.TV.SWORD &&
        (shop.obj.toH > 0 || shop.obj.toD > 0)
      ) {
        return true;
      }
      return coreWillBuy(shop);
    });
  }
};
