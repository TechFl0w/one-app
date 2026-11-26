import type { Tone } from "@/schema/blueprint";
import { TONES } from "@/schema/blueprint";

/** Strong colour (text, borders, filled headers) and soft tint (backgrounds) for each tone. */
export const TONE: Record<Tone, { color: string; tint: string }> = {
  accent: { color: "var(--accent)", tint: "var(--accent-tint)" },
  red: { color: "#B42318", tint: "#FDE7E5" },
  amber: { color: "#8A5A0C", tint: "#FDF0D9" },
  blue: { color: "#2B6CB0", tint: "#EAF1FA" },
  purple: { color: "#6B46C1", tint: "#F2EDFA" },
  neutral: { color: "var(--ink)", tint: "var(--ground)" },
};

export const toneOf = (v: unknown, fallback: Tone = "accent"): Tone => ((TONES as readonly string[]).includes(String(v)) ? (v as Tone) : fallback);

/** Board columns without a colour of their own take these, in order (stages read left to right). */
export const COLUMN_COLORS = ["#2B6CB0", "#3B7DC4", "#B7791F", "#6B46C1", "#C2410C", "#17694F", "#0E7490", "#6E685D"];

/** A colour at low opacity, for column and row backgrounds ("#RRGGBB" → "#RRGGBB14"). */
export const soft = (hex: string, alpha = "14") => (/^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alpha}` : "var(--ground)");
