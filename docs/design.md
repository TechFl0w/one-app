# Design

Reference screens: HTML mockups in `docs/design-screens/` (source of truth for layout, copy and styling;
they use a canvas runtime, so read the markup rather than opening them in a browser).
Original canvas (owner only): https://claude.ai/artifact/7CAiESbpQLdbc7wc6msQmU

Files: Main (AI builder) · Salon (nail salon calendar) · Mechanic (bay board) · Ornaments (orders) ·
EditMode · NewBoard (new page) · ConnectStripe · Connections · LayoutEditor · LayoutVariants
1 AI builder · 2 Nail salon calendar · 3 Mechanic bay board · 4 Ornament orders · 5 Edit mode ·
6 New page · 7 Connect Stripe · 8 Connections · 9 Layout editor · 10 Same data, three layouts

## Look
- Ground `#F7F5F0`, cards `#FFFFFF` with border `#E8E4DA`, radius 20px, soft shadow.
- Text `#1C1B19`, muted `#5E5B55`.
- Accent forest green `#17694F` (hover `#0F5640`), tint `#E4F2EA`.
- Font: Plus Jakarta Sans. Pill buttons. White sidebar with thin divider.
- No purple, no dark sidebar/theme. Business colour only on its logo tile; owners can change accent/density.

## Shell
Business switcher · sidebar of modules (renamable, reorderable, hideable) · main page (block grid) ·
"Ask the assistant" panel available on every page · Edit mode bar (Done / Discard).

## Must work on phone
Owners use it between clients: responsive, installable (PWA), push notifications for approvals and alerts.
