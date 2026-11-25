/** Mounted component frames that can take a picture of themselves (for the assistant's self-check). */
const frames = new Map<string, () => Promise<string | null>>();

export function registerCapture(componentId: string, capture: () => Promise<string | null>) {
  frames.set(componentId, capture);
  return () => {
    if (frames.get(componentId) === capture) frames.delete(componentId);
  };
}

/** Waits (up to `waitMs`) for the component to be on screen, then returns a JPEG data URL. */
export async function captureComponent(componentId: string, waitMs = 15_000): Promise<string | null> {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    const capture = frames.get(componentId);
    if (capture) {
      // Give data and fonts a moment to load before the picture.
      await new Promise((r) => setTimeout(r, 2500));
      return (frames.get(componentId) ?? capture)();
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}
