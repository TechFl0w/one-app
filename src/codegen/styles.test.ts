import { describe, expect, it } from "vitest";
import { compileStyles } from "./styles";
import { sandboxSrcdoc } from "@/components/sandbox/srcdoc";

describe("screen styles compiled at save", () => {
  it("builds only the classes a screen uses, with theme colours as variables", async () => {
    const css = (await compileStyles('<div className="flex rounded-2xl bg-accent p-4 md:grid-cols-3">x</div>'))!;
    expect(css).toContain(".bg-accent");
    expect(css).toContain("var(--color-accent)");
    expect(css).toContain("--color-accent: var(--one-accent)");
    expect(css).not.toContain(".bg-red-500");
    expect(css.length).toBeLessThan(10_000);
  });
  it("can't break out of the frame's style element", async () => {
    expect(await compileStyles(`<p className="content-['</style><script>x</script>']">x</p>`)).not.toMatch(/<\/style/i);
  });
  it("frames with compiled styles skip the in-browser compiler", () => {
    const html = sandboxSrcdoc("https://app.example", { colors: { accent: "#b5482b" } }, ".x{}");
    expect(html).toContain("/sandbox/kit.css");
    expect(html).not.toContain("tailwind.js");
    expect(html).toContain("--one-accent: #b5482b");
    expect(sandboxSrcdoc("https://app.example")).toContain("tailwind.js");
  });
});
