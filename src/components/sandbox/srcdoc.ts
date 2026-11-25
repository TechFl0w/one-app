/**
 * The document loaded into a component frame. The frame is sandboxed without allow-same-origin
 * (opaque origin), and this CSP stops it from talking to the network: scripts only from our
 * /sandbox/ files, connect-src 'none'. Images only from our origin or data/blob URLs.
 */
export function sandboxSrcdoc(appOrigin: string): string {
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap">
<style type="text/tailwindcss">
@theme {
  --color-ground: #f7f5f0; --color-card: #ffffff; --color-line: #e8e4da; --color-ink: #1c1b19; --color-muted: #5e5b55;
  --color-accent: #17694f; --color-accent-hover: #0f5640; --color-accent-tint: #e4f2ea;
  --font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
  --shadow-soft: 0 1px 2px rgb(28 27 25 / 0.04), 0 4px 16px rgb(28 27 25 / 0.05);
}
html, body { margin: 0; background: transparent; color: var(--color-ink); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
</style>
<script src="${appOrigin}/sandbox/tailwind.js"></script>
</head><body><div id="root"></div><script src="${appOrigin}/sandbox/runtime.js"></script></body></html>`;
}
