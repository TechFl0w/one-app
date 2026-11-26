import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ICON_NAMES, normalizeIconName } from "./iconNames";
import { ICONS, Icon } from "./icons";
import { KIT_DTS } from "@/codegen/kitTypes";

const render = (props: { name: string; className?: string; label?: string }) => renderToStaticMarkup(createElement(Icon, props));

describe("kit icons", () => {
  it("bundles exactly the documented names", () => {
    expect(Object.keys(ICONS).sort()).toEqual([...ICON_NAMES].sort());
    for (const n of ICON_NAMES) expect(KIT_DTS).toContain(`"${n}"`);
  });
  it("draws a real svg for every name", () => {
    for (const n of ICON_NAMES) {
      const html = render({ name: n });
      expect(html, n).toMatch(/^<svg[^>]*data-icon="[a-z-]+"[^>]*>.*<(path|circle|rect|line|polyline|polygon)\b/);
    }
  });
  it("sizes to the text, takes classes, and is decorative unless labelled", () => {
    const html = render({ name: "calendar", className: "h-5 w-5 text-accent" });
    expect(html).toContain('width="1em"');
    expect(html).toContain("h-5 w-5 text-accent");
    expect(html).toContain('aria-hidden="true"');
    expect(render({ name: "trash", label: "Delete" })).toMatch(/role="img"[^>]*aria-label="Delete"|aria-label="Delete"[^>]*role="img"/);
  });
  it("accepts PascalCase and draws nothing for unknown names", () => {
    expect(normalizeIconName("CalendarCheck")).toBe("calendar-check");
    expect(render({ name: "CalendarCheck" })).toContain('data-icon="calendar-check"');
    expect(render({ name: "no-such-icon" })).toBe("");
    expect(render({ name: undefined as unknown as string })).toBe("");
  });
});
