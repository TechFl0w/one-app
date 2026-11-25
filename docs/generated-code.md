# Generated code

The AI can write code for a business, not only configure building blocks: custom screens and
whole pages, public websites, and server functions that run automations and call outside APIs.
Building blocks stay as ready-made parts the AI can reuse.

What does not change: the data model (tables, records, RLS, audit log), change sets with
preview → keep / undo, and confirmations for risky actions — decided by our code, never by
generated code.

## Where code lives

Generated code is part of the blueprint (`components[]`, later `functions[]`), so it is versioned,
diffed and undone like any other change. Each entry keeps the TypeScript **source** the AI wrote
and the **compiled** JavaScript our server produced from it. The AI never supplies compiled code.

```jsonc
"components": [{ "id": "cmp_booking_hub", "label": "Booking hub",
  "source": "import { useRecords, Card } from \"@one/kit\"; export default function …",
  "compiled": "…" }]
```

A page shows a component with a `custom` block: `{ type: "custom", options: { component: "cmp_…", props: {…} } }`.
A page whose only block is a full-width custom block is a fully custom page.

## Compiling

`src/codegen/compile.ts` (server only): TypeScript type-checks the source against the kit's
declarations (`src/codegen/kitTypes.ts`), then transpiles TSX → CommonJS. Only `react` and
`@one/kit` may be imported. Errors go back to the AI, which fixes and retries before anything is
shown to the owner. Size limits keep bundles small.

## Browser sandbox (screens, pages, websites)

- Rendered in `<iframe sandbox="allow-scripts">` (no `allow-same-origin`): the frame gets an opaque
  origin, so it cannot read our cookies, session or the app's DOM.
- CSP inside the frame: scripts only from our `/sandbox/` files, `connect-src 'none'` (no network).
- The runtime (`public/sandbox/runtime.js`, built by `scripts/build-sandbox.mjs`) contains React,
  the kit and Tailwind (browser build), and is cached across businesses. A component is a few KB.
- The only way out is `postMessage` to the host. The host (`SandboxFrame`) checks every request and
  runs it as the signed-in user (RLS applies) — or against the demo store. Risky requests (delete)
  show One App's own confirmation outside the frame.
- The frame reports its height; the host sizes it. A crash shows an error inside that block only.

## Server sandbox (automations, API connections, webhooks)

- `blueprint.functions[]`: `{ id: "fn_…", label, source, compiled, hosts[], webhook? }`. Saving one is
  a risky change (needs the owner's confirmation); so is a test run.
- Each run is a fresh Vercel Sandbox micro-VM (`src/functions/runner.ts`) running the harness
  (`src/functions/harness.ts`). Its firewall allows only One App and the function's `hosts`.
- **No secrets inside the VM.** Calls to One App's kit API (`/api/fn/kit`) get the run's one-time
  token added by the firewall; it maps to one business and expires with the run. API keys the
  owner saved (`business_secrets`, never readable by users or code) are swapped in by the firewall:
  code sends `secret("SHIPPO")` (a placeholder) in a header, and only requests to that key's host
  get the real value.
- Triggers: automation step `{ type: "run_function", function }` (queue, retries, run log; a step
  that succeeded isn't re-run), webhooks at `/api/hooks/<business>/<fn>` for functions with
  `webhook: true`, and test runs from the assistant. Kit writes are tagged `automation` (no loops).
- Runs are logged in `function_runs` (owners see status, logs, errors under Settings → API keys & code).
- Locally, `ONE_LOCAL_FUNCTION_RUNNER=1` runs functions in a plain Node process (no firewall) for dev/tests.

## The kit (`@one/kit`)

One small typed API for generated code — the same surface as the owner agent's tools:
records (list/get/create/update/delete), the business's tables and fields, navigation, toasts,
current user, and UI primitives (Card, Button, Badge, Collapsible, Tabs, Field inputs…).
Generated code calls the kit; the kit calls One App; One App enforces permissions.
