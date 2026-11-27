Goal: the data stays true (docs/data-rules.md) whatever the AI or owner does.

1. Read the setup. Find statuses that follow dates or other records (they say "follows:" and "computed, read-only").
2. Create records that should land in each of those statuses (e.g. a date in the past, today, next month). Read them back: are the statuses right?
3. Try to set a computed status or a rollup by hand. It must be refused with a clear message.
4. Change the facts (a date, a payment, a line) and read the record back: did the status and totals follow?
5. Find the automations. For each one: would it ever message someone who shouldn't get it (e.g. after a booking was cancelled)? Use explain_automation.
6. Try to create a record with a missing required field and with a link to a record that doesn't exist. Are the errors understandable for an owner?
