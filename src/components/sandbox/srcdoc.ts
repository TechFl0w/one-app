/**
 * The document loaded into a component frame. The frame is sandboxed without allow-same-origin
 * (opaque origin), and this CSP stops it from talking to the network: scripts only from our
 * /sandbox/ files, connect-src 'none'. Images only from our origin or data/blob URLs.
 */
import type { Theme } from "@/schema/blueprint";
import { themeFontsHref } from "@/theme/theme";

/** Changes with every build of the sandbox scripts (see next.config.ts), so they can be cached forever. */
const V = process.env.NEXT_PUBLIC_SANDBOX_VERSION ?? "dev";

export function sandboxSrcdoc(appOrigin: string, theme?: Theme): string {
  const c = theme?.colors ?? {};
  const font = theme?.font ?? "Plus Jakarta Sans";
  const heading = theme?.headingFont ?? font;
  const fonts = themeFontsHref({ font: theme?.font, headingFont: theme?.headingFont }) ?? "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap";
  const csp = [
    "default-src 'none'",
    // 'unsafe-eval' runs the compiled component (new Function); no inline scripts.
    `script-src ${appOrigin}/sandbox/ 'unsafe-eval'`,
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    `img-src ${appOrigin} data: blob:`,
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${fonts}">
<style type="text/tailwindcss">
@theme {
  --color-ground: ${c.ground ?? "#f7f5f0"}; --color-card: ${c.card ?? "#ffffff"}; --color-line: ${c.line ?? "#e8e4da"}; --color-ink: ${c.ink ?? "#1c1b19"}; --color-muted: ${c.muted ?? "#5e5b55"};
  --color-accent: ${c.accent ?? "#17694f"}; --color-accent-hover: ${c.accentHover ?? "#0f5640"}; --color-accent-tint: ${c.accentTint ?? "#e4f2ea"};
  --font-sans: "${font}", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "${heading}", ui-serif, Georgia, serif;
  --shadow-soft: 0 1px 2px rgb(28 27 25 / 0.04), 0 4px 16px rgb(28 27 25 / 0.05);
}
:root { --card-radius: ${theme?.radius ?? 20}px; --button-radius: ${theme?.squareButtons ? Math.min(theme.radius ?? 12, 12) : 9999}px; }
h1, h2, h3 { font-family: "${heading}", ui-sans-serif, system-ui, sans-serif; }
html, body { margin: 0; background: transparent; color: var(--color-ink); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
</style>
<script src="${appOrigin}/sandbox/tailwind.js?v=${V}"></script>
</head><body><div id="root"></div><script src="${appOrigin}/sandbox/runtime.js?v=${V}"></script></body></html>`;
}
