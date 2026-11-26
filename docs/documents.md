# Quotes and invoices (documents)

A **document** is something a customer receives and acts on: a **quote** (scope of work they
accept online) or an **invoice** (they pay online). It is config (`blueprint.documents`) that maps
onto ordinary tables, so totals, statuses and history stay plain data.

```
documents: [{ id: "doc_quote", kind: "quote" | "invoice", label, table,
  number?, prefix?,            // text field numbered on create ("Q-0007"), per-business counter
  customer,                    // link field to the customer (name/email/phone/address read from it)
  title?, intro?, terms?, footer?, issued?, due?, sent?,
  lines: { table, via, description, qty?, unit?, price?, total, group? },
  totals: { subtotal?, tax?, total, paid?, balance? },
  accept?: { acceptedOn, acceptedBy?, declinedOn? },          // quotes
  pay?: { table, via, amount, date, title?, method?, card? },  // invoices
  from?: { document: "doc_quote", link } }]                   // invoice made from a quote
```

- **Facts, not statuses** (docs/data-rules.md): `sent`, `acceptedOn`, `declinedOn`, payments are stored;
  the status field is derived (Draft / Sent / Accepted / Declined / Expired; Draft / Sent / Overdue / Paid).
- **Customer link** `/d/<token>`: private, no account. Read, accept with their name, decline, pay
  (Stripe Checkout for the balance), print / save as PDF. Tokens live in `document_links` (server only).
- **Paid online** → Stripe webhook marks the payment paid → a payment record is added on the
  invoice (`pay`), so Paid / Balance / status update by themselves.
- **In the app**: a `document` block on the record page shows the document with Send (email + link,
  marks it sent), Copy link, Customer view, and Create invoice (accepted quote → invoice with its lines).
- **Numbers**: `next_document_number(business, document)` — never repeats, never reused.
- Any template can add the standard set with `invoicingTables()` (src/templates/invoicing.ts):
  Quotes, Quote lines, Invoices, Invoice lines, Payments + both documents.
