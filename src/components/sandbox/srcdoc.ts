/**
 * The document loaded into a component frame. The frame is sandboxed without allow-same-origin
 * (opaque origin), and this CSP stops it from talking to the network: scripts only from our
 * /sandbox/ files, connect-src 'none'. Images only from our origin or data/blob URLs.
 */
import type { Theme } from "@/schema/blueprint";
import { themeFontsHref } from "@/theme/theme";

/** Changes with every build of the sandbox scripts (see next.config.ts), so they can be cached forever. */
const V = process.env.NEXT_PUBLIC_SANDBOX_VERSION ?? "dev";

/** `css`: the screen's precompiled styles; without it the frame compiles Tailwind in the browser (older screens). */
export function sandboxSrcdoc(appOrigin: string, theme?: Theme, css?: string): string {
  const c = theme?.colors ?? {};
  const font = theme?.font ?? "Plus Jakarta Sans";
  const heading = theme?.headingFont ?? font;
  const fonts = themeFontsHref({ font: theme?.font, headingFont: theme?.headingFont }) ?? "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap";
  const csp = [
    "default-src 'none'",
    // 'unsafe-eval' runs the compiled component (new Function); no inline scripts.
    `script-src ${appOrigin}/sandbox/ 'unsafe-eval'`,
    `style-src 'unsafe-inline' ${appOrigin}/sandbox/ https://fonts.googleapis.com`,
    "font-src https://fonts.gstatic.com",
    `img-src ${appOrigin} data: blob:`,
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  // Older screens without precompiled styles: Tailwind compiles in the browser, same tokens.
  const legacyStyles = `<style type="text/tailwindcss">
@theme {
  --color-ground: var(--one-ground); --color-card: var(--one-card); --color-line: var(--one-line); --color-ink: var(--one-ink); --color-muted: var(--one-muted);
  --color-accent: var(--one-accent); --color-accent-hover: var(--one-accent-hover); --color-accent-tint: var(--one-accent-tint);
  --font-sans: var(--one-font); --font-serif: var(--one-heading);
  --shadow-soft: 0 1px 2px rgb(28 27 25 / 0.04), 0 4px 16px rgb(28 27 25 / 0.05);
}
</style>
<script src="${appOrigin}/sandbox/tailwind.js?v=${V}"></script>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${fonts}">
${css === undefined ? legacyStyles : `<link rel="stylesheet" href="${appOrigin}/sandbox/kit.css?v=${V}">\n<style>${css}</style>`}
<style>
:root {
  --one-ground: ${c.ground ?? "#f7f5f0"}; --one-card: ${c.card ?? "#ffffff"}; --one-line: ${c.line ?? "#e7e2d8"}; --one-ink: ${c.ink ?? "#1f1b14"}; --one-muted: ${c.muted ?? "#6e685d"};
  --one-accent: ${c.accent ?? "#17694f"}; --one-accent-hover: ${c.accentHover ?? "#0f4f3b"}; --one-accent-tint: ${c.accentTint ?? "#e3f1eb"};
  --one-font: "${font}", ui-sans-serif, system-ui, sans-serif; --one-heading: "${heading}", ui-serif, Georgia, serif;
  --card-radius: ${theme?.radius ?? 20}px; --button-radius: ${theme?.squareButtons ? Math.min(theme.radius ?? 12, 12) : 9999}px;
}
h1, h2, h3 { font-family: "${heading}", ui-sans-serif, system-ui, sans-serif; }
html, body { margin: 0; background: transparent; color: var(--one-ink); font-family: var(--one-font); -webkit-font-smoothing: antialiased; }
</style>
</head><body><div id="root"></div><script src="${appOrigin}/sandbox/runtime.js?v=${V}"></script></body></html>`;
}
