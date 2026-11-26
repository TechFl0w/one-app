# Control center and learning from users

`/control` is for One App's own team (signed-in users whose email is in `PLATFORM_ADMIN_EMAILS`;
everyone else gets a 404).

- **Apps**: every business, its size (pages, tables, custom screens, automations, records) and how
  much its owner and the assistant changed it after setup.
- **An app**: its pages as layout sketches, its data model and automations, and every change since
  setup (owner / assistant / undo). **Open with sample data** runs the real app (same pages, blocks
  and custom screens) on made-up records (`engine/sampleRecords.ts`) — a business's own records are
  never loaded. Nothing done in a preview is saved.
- **Learning**: owners' changes (`blueprint_history`) turned into patterns per business type
  (`engine/learning.ts`): fields added or removed, renames, new options, pages, blocks, custom
  screens, automations switched off… ranked by how many businesses of that type made the change.
  Undone and system changes don't count.
  - **Teach the builder** → the assistant (chat and MCP `get_setup`) is told what owners of that
    type usually change, so it suggests it when it fits.
  - **Add to template** (fields) → new businesses of that type start with the field
    (`withLearnings` at onboarding).
  - **Ignore** hides it. Decisions live in `platform_learnings` (server only).

Over time, patterns that keep coming up should also be built into the template code itself.
