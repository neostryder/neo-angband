/**
 * What a mod controller's pump does on a tick that finds a modal open.
 *
 * `escape` answers it the way the pump always has (answerBlockingPrompt): a
 * -more- pager, a floor pile, a confirm. `drive-store` asks the controller for a
 * decision instead and hands any `shop-*` intent it returns to the open store
 * screen. The store is the one modal a controller can act in, because the
 * snapshot reports phase `store` and a ready store status for it; pressing
 * Escape there closed the shop before the controller's next wait, so every
 * `shop-buy`, `shop-sell` and `shop-exit` came back "store is not open".
 *
 * A controller shops only when it holds `input:intent`, since a `shop-*` intent
 * is an intent. One the player switched off for faults never gets the store, so
 * the pump falls back to Escape and the shop closes.
 */
export type ModalPumpAction = "escape" | "drive-store";

export function modalPumpAction(input: {
  readonly storeOpen: boolean;
  readonly holdsIntent: boolean;
  readonly switchedOff: boolean;
}): ModalPumpAction {
  return input.storeOpen && input.holdsIntent && !input.switchedOff ? "drive-store" : "escape";
}
