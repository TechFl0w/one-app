/**
 * The assistant models a business can choose (Settings → Assistant). Prices are $ per million
 * tokens: input, output, cache read, cache write (5 min). Keep in sync with the check constraint
 * on businesses.ai_model.
 */
export const AI_MODELS = [
  { id: "claude-haiku-5-5", label: "Fast", hint: "Quick answers and small changes. Cheapest; weaker at building screens.", prices: [0.1, 0.5, 0.01, 0.125] },
  { id: "claude-sonnet-5-5", label: "Balanced", hint: "Good at building and changing your app, at half the price of Best.", prices: [2, 10, 0.1, 2.5] },
  { id: "claude-opus-5-5", label: "Best", hint: "Most capable: closest recreations of designs and the most reliable builds.", prices: [4, 20, 0.2, 5] },
] as const satisfies readonly { id: string; label: string; hint: string; prices: readonly [number, number, number, number] }[];

export type AiModelId = (typeof AI_MODELS)[number]["id"];

export const isAiModel = (v: unknown): v is AiModelId => AI_MODELS.some((m) => m.id === v);

/** The app-wide default: ONE_AI_MODEL if it names a known model, else Best. */
export function defaultAiModel(): AiModelId {
  const env = process.env.ONE_AI_MODEL?.trim();
  return isAiModel(env) ? env : "claude-opus-5-5";
}

/** The business's choice when it made one, else the default. */
export const resolveAiModel = (choice: unknown): AiModelId => (isAiModel(choice) ? choice : defaultAiModel());

export const aiModelInfo = (id: string) => AI_MODELS.find((m) => m.id === id) ?? AI_MODELS[2];
