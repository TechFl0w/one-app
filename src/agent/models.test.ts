import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAiModel, resolveAiModel } from "./models";

afterEach(() => vi.unstubAllEnvs());

describe("assistant model choice", () => {
  it("uses the business's choice, else ONE_AI_MODEL, else Best", () => {
    expect(resolveAiModel("claude-haiku-5-5")).toBe("claude-haiku-5-5");
    expect(resolveAiModel(null)).toBe("claude-opus-5-5");
    vi.stubEnv("ONE_AI_MODEL", "claude-sonnet-5-5");
    expect(defaultAiModel()).toBe("claude-sonnet-5-5");
    expect(resolveAiModel(undefined)).toBe("claude-sonnet-5-5");
  });
  it("ignores unknown or empty values", () => {
    vi.stubEnv("ONE_AI_MODEL", "");
    expect(defaultAiModel()).toBe("claude-opus-5-5");
    vi.stubEnv("ONE_AI_MODEL", "gpt-something");
    expect(defaultAiModel()).toBe("claude-opus-5-5");
    expect(resolveAiModel("claude-opus-4-1")).toBe("claude-opus-5-5");
  });
});
