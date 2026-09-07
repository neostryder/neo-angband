// This proves the renderer receives Ctrl zoom chords that are INJECTED into it.
// It does NOT prove that a real keypress reaches the renderer, and it must not
// be cited as evidence for that.
//
// Electron resolves application-menu accelerators in the browser process.
// Playwright's keyboard API injects through the DevTools protocol, which enters
// below that layer, so an injected chord arrives whether or not a menu claims
// it. The measurement that settles this: the packaged build under
// C:\Temp\na\audit-1.10.2 is 1.10.2-edge.133, which predates the removal of the
// default menu and still carries it, and every chord below passes against that
// build anyway. A test that passes with the menu present cannot be detecting
// the menu's absence.
//
// What this test is good for is renderer-side behaviour: that nothing inside
// the page swallows these chords, and that the probe ordering below works.
// Verifying that a real keypress survives the browser process needs operating
// system level input, which nothing in this lane provides.
import { expect, test, type ObservedKeyEvent } from "./electron.fixture.js";

const zoomChords = [
  { accelerator: "Control+=", key: "=", code: "Equal" },
  { accelerator: "Control+-", key: "-", code: "Minus" },
  { accelerator: "Control+0", key: "0", code: "Digit0" },
] as const;

test("the renderer receives Ctrl zoom chords from the packaged desktop app", async ({ gamePage }) => {
  const pressAndCapture = async (accelerator: string): Promise<ObservedKeyEvent[]> => {
    await gamePage.evaluate(() => {
      window.electronKeyEvents.splice(0);
    });
    await gamePage.keyboard.press(accelerator);
    return gamePage.evaluate(() =>
      window.electronKeyEvents.splice(0),
    );
  };

  const controlEvents = await pressAndCapture("x");
  console.log(`plain x: ${JSON.stringify(controlEvents)}`);
  expect(controlEvents).toContainEqual({ type: "keydown", key: "x", code: "KeyX", ctrlKey: false });

  for (const chord of zoomChords) {
    const events = await pressAndCapture(chord.accelerator);
    console.log(`${chord.accelerator}: ${JSON.stringify(events)}`);
    expect.soft(
      events.some(
        (event) =>
          event.type === "keydown" &&
          event.key === chord.key &&
          event.code === chord.code &&
          event.ctrlKey,
      ),
      `${chord.accelerator} must reach a renderer keydown listener`,
    ).toBe(true);
  }
});
