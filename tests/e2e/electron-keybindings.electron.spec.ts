// This is an application-level regression test. A default Electron application
// menu consumes these accelerators before renderer keydown listeners can see
// them, so source inspection alone cannot prove the intended behavior.
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
