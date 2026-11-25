import { describe, expect, it } from "vitest";
import { themeFontsHref, themeVars } from "./theme";

describe("theme", () => {
  it("maps a theme to CSS variables and fonts", () => {
    expect(themeVars(undefined)).toEqual({});
    expect(themeVars({ colors: { accent: "#AA3366", ground: "#000000" }, font: "Inter", radius: 4, squareButtons: true })).toEqual({
      "--ground": "#000000", "--accent": "#AA3366", "--font-body": '"Inter", ui-sans-serif, system-ui, sans-serif', "--card-radius": "4px", "--button-radius": "4px",
    });
    expect(themeFontsHref({ font: "Plus Jakarta Sans" })).toBeNull();
    expect(themeFontsHref({ font: "DM Sans", headingFont: "Playfair Display" })).toBe("https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap");
  });
});
