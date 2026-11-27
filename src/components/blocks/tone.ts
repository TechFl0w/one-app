import type { Tone } from "@/schema/blueprint";
import { TONES } from "@/schema/blueprint";

/** Strong colour (text, borders, filled headers) and soft tint (backgrounds) for each tone. */
export const TONE: Record<Tone, { color: string; tint: string }> = {
  accent: { color: "var(--accent)", tint: "var(--accent-tint)" },
  // Tints mix the tone into the theme's card colour, so alerts read on light and dark themes.
  // The text colour mixes towards the theme's ink so it keeps contrast on a dark card.
  red: { color: "color-mix(in srgb, #B42318 75%, var(--ink))", tint: "color-mix(in srgb, #B42318 14%, var(--card))" },
  amber: { color: "color-mix(in srgb, #8A5A0C 75%, var(--ink))", tint: "color-mix(in srgb, #D99A1E 18%, var(--card))" },
  blue: { color: "color-mix(in srgb, #2B6CB0 75%, var(--ink))", tint: "color-mix(in srgb, #2B6CB0 14%, var(--card))" },
  purple: { color: "color-mix(in srgb, #6B46C1 75%, var(--ink))", tint: "color-mix(in srgb, #6B46C1 14%, var(--card))" },
  neutral: { color: "var(--ink)", tint: "var(--ground)" },
};

export const toneOf = (v: unknown, fallback: Tone = "accent"): Tone => ((TONES as readonly string[]).includes(String(v)) ? (v as Tone) : fallback);

/** Board columns without a colour of their own take these, in order (stages read left to right). */
export const COLUMN_COLORS = ["#2B6CB0", "#3B7DC4", "#B7791F", "#6B46C1", "#C2410C", "#17694F", "#0E7490", "#6E685D"];

/** A colour at low opacity, for column and row backgrounds ("#RRGGBB" → "#RRGGBB14"). */
export const soft = (hex: string, alpha = "14") => (/^#[0-9a-f]{6}$/i.test(hex) ? `color-mix(in srgb, ${hex} ${Math.round((parseInt(alpha, 16) / 255) * 100)}%, var(--card))` : "var(--ground)");
