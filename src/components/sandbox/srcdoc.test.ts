import { describe, expect, it } from "vitest";
import { sandboxSrcdoc } from "./srcdoc";

describe("sandbox document", () => {
  it("locks the frame down: our scripts only, no network, no forms", () => {
    const html = sandboxSrcdoc("https://app.example");
    const csp = /content="([^"]+)"/.exec(html)![1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src https://app.example/sandbox/ 'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("img-src https://app.example data: blob:");
    expect(html).toContain('<script src="https://app.example/sandbox/runtime.js"></script>');
  });
});
