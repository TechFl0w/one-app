# Architecture

## 1. Blueprint (the heart)
A business's whole configuration is one versioned JSON document validated by zod.

```jsonc
{
  "version": 12,
  "business": { "name": "Polished Nail Bar", "type": "nail_salon", "timezone": "America/Vancouver" },
  "tables": [
    { "id": "tbl_clients", "label": "Clients", "fields": [
      { "id": "fld_name", "label": "Name", "type": "text", "required": true },
      { "id": "fld_whatsapp", "label": "WhatsApp", "type": "phone" },
      { "id": "fld_fav_tech", "label": "Favourite tech", "type": "link", "to": "tbl_team" }
    ]}
  ],
  "pages": [
    { "id": "pg_today", "label": "Today", "icon": "calendar", "menuOrder": 1, "hidden": false,
      "layout": { "columns": 12, "blocks": [
        { "id": "blk_rev", "type": "number", "source": { "table": "tbl_payments", "agg": "sum", "field": "fld_amount", "filters": [{ "field": "fld_start", "op": "eq", "value": "@today" }] }, "x": 0, "y": 0, "w": 4, "h": 1 },
        { "id": "blk_cal", "type": "calendar", "source": { "table": "tbl_bookings", "groupBy": "fld_practitioner" }, "x": 0, "y": 1, "w": 8, "h": 4 }
      ]},
      "layoutOverrides": { "device:phone": { "blocks": [] }, "user:<uuid>": { "blocks": [] } }
    }
  ],
  "automations": [
    { "id": "aut_reminder", "label": "Reminder 24h before", "enabled": true,
      "trigger": { "type": "date_reached", "table": "tbl_bookings", "field": "fld_start", "offset": "-24h" },
      "conditions": [], "actions": [{ "type": "send_message", "channel": "whatsapp", "template": "tpl_reminder" }] }
  ],
  "connections": [{ "id": "con_stripe", "provider": "stripe", "status": "connected" }],
  "modules": ["bookings", "payments", "messaging"]
}
```

Rules: ids are stable and never shown; labels are free text. Unknown block/field/trigger/action types are rejected.

## 2. Change sets
Every edit (UI or AI) is a list of operations: `rename`, `addField`, `removeField`, `addPage`, `moveBlock`,
`resizeBlock`, `addAutomation`, `toggleAutomation`, … → `previewChangeSet()` → user approves → `applyChangeSet()`
→ new blueprint version + history entry. Undo = apply the inverse / restore previous version.
Each operation is tagged `safe` or `risky`; risky ones require explicit confirmation.

## 3. Data storage
Start with a generic records model so tables are config, not migrations:
- `businesses`, `memberships(user_id, business_id, role)`, `blueprints(business_id, version, json)`,
  `blueprint_history`, `records(id, business_id, table_id, data jsonb, created_at, updated_at)`,
  `record_links`, `files`, `automation_runs`, `messages`, `conversations`.
- Index hot JSON paths; promote heavy modules (bookings, payments) to typed tables when needed.
- RLS on every table by `business_id` membership.

## 4. Building blocks
- Field types: text, long text, number, money, date/time, status/choice, person, link, file/photo, checkbox,
  phone, email, formula, rollup.
- Views/blocks: table, board (kanban), calendar, gallery, form (public), number, chart, list, messages, buttons, notes.
- Triggers: record created/updated, status changed, date reached, schedule, form submitted, message received,
  connector event, button pressed.
- Actions: create/update record, send WhatsApp/email/SMS, notify owner/staff, assign, generate document,
  call connector, wait, AI step (classify/extract/draft), approval step.
- Engine needs: job queue, retries, idempotency keys, run log, test mode on sample data.

## 5. Agents
- **Builder/owner agent** (in-app chat): tools = typed functions over blueprint + records
  (`propose_change_set`, `query_records`, `update_record`, `explain_automation`, …). It never gets raw SQL.
  Knows the current page so "make this bigger" works.
- **Customer agent** (WhatsApp, later): tools = `find_slots`, `hold_slot`, `create_booking_request`,
  `answer_from_catalog`, `create_draft_order`, `escalate_to_owner`. No admin tools exist in its toolset.
- Routing by authenticated session or sender number happens in code before any model call.
- Agent responses are structured: `{ text, preview?, buttons?, confirm? }`.

## 6. MCP server per business
Expose the owner tool set as an MCP server so owners can manage the business from Claude/ChatGPT too.
Same permission checks as in-app.
