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
 * `drive-prompt` is the second half of the same purchase. A `shop-buy` makes the
 * store raise its own quantity prompt and then a confirm prompt, and while either
 * is open the store screen is no longer reading input, so `storeOpen` is false.
 * Escape there cancelled the purchase, every time. A controller that holds
 * `input:prompt.reply` is asked for a decision at that phase instead, and answers
 * the prompt through `act.answer`. The `-more-` pager (`ack`) keeps its Escape:
 * it is not a question. The controller gets `MAX_PROMPT_ASKS` ticks to answer one
 * prompt, so a controller that ignores prompts still has the old Escape when its
 * turns run out.
 *
 * A controller shops only when it holds `input:intent`, since a `shop-*` intent
 * is an intent. One the player switched off for faults never gets the store, so
 * the pump falls back to Escape and the shop closes.
 */
export type ModalPumpAction = "escape" | "drive-store" | "drive-prompt";

/** Ticks a controller gets to answer one open prompt before the pump presses Escape. */
export const MAX_PROMPT_ASKS = 8;

export function modalPumpAction(input: {
  readonly storeOpen: boolean;
  readonly holdsIntent: boolean;
  readonly switchedOff: boolean;
  /** The store screen is up, whether or not it is reading input right now. */
  readonly storeModal?: boolean;
  /** The kind of the open typed prompt, or null when none is open. */
  readonly promptKind?: string | null;
  readonly holdsReply?: boolean;
  /** Ticks this prompt has already been put to the controller. */
  readonly promptAsks?: number;
}): ModalPumpAction {
  if (input.switchedOff) return "escape";
  if (input.storeOpen && input.holdsIntent) return "drive-store";
  if (
    input.storeModal === true && input.holdsReply === true && input.holdsIntent &&
    input.promptKind != null && input.promptKind !== "ack" &&
    (input.promptAsks ?? 0) < MAX_PROMPT_ASKS
  ) return "drive-prompt";
  return "escape";
}
