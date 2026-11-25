/** Mounted component frames that can take a picture of themselves (for the assistant's self-check). */
export interface Capture {
  /** JPEG data URL, or null if the picture failed. */
  image: string | null;
  /** The error the component hit while rendering, if any (it shows an error card then). */
  crash: string | null;
}
const frames = new Map<string, () => Promise<Capture>>();

export function registerCapture(componentId: string, capture: () => Promise<Capture>) {
  frames.set(componentId, capture);
  return () => {
    if (frames.get(componentId) === capture) frames.delete(componentId);
  };
}

/** Waits (up to `waitMs`) for the component to be on screen, then pictures it and reports any crash. */
export async function captureComponent(componentId: string, waitMs = 15_000): Promise<Capture | null> {
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
