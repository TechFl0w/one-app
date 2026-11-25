import type { Theme } from "@/schema/blueprint";

/** CSS variables for a business theme (the defaults live in globals.css). */
export function themeVars(theme: Theme | undefined): Record<string, string> {
  if (!theme) return {};
  const c = theme.colors ?? {};
  const v: Record<string, string> = {};
  const map: [keyof NonNullable<Theme["colors"]>, string][] = [
    ["ground", "--ground"], ["card", "--card"], ["ink", "--ink"], ["muted", "--muted"], ["line", "--line"],
    ["accent", "--accent"], ["accentHover", "--accent-hover"], ["accentTint", "--accent-tint"],
  ];
  for (const [k, css] of map) if (c[k]) v[css] = c[k]!;
  if (theme.font) v["--font-body"] = `"${theme.font}", ui-sans-serif, system-ui, sans-serif`;
  if (theme.headingFont) v["--font-heading"] = `"${theme.headingFont}", ui-serif, Georgia, serif`;
  if (theme.radius !== undefined) v["--card-radius"] = `${theme.radius}px`;
  if (theme.squareButtons) v["--button-radius"] = `${Math.min(theme.radius ?? 12, 12)}px`;
  return v;
}

/** Google Fonts stylesheet for the theme's fonts (null when it uses the built-in font). */
export function themeFontsHref(theme: Theme | undefined): string | null {
  const fonts = [...new Set([theme?.font, theme?.headingFont].filter((f) => !!f && f !== "Plus Jakarta Sans") as string[])];
  if (!fonts.length) return null;
  return `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700`).join("&")}&display=swap`;
}

export const cssDeclarations = (vars: Record<string, string>) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");
