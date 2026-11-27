Goal: a tradesperson quotes a job, the client accepts, it gets invoiced and paid. (Only for businesses with Quotes and Invoices tables — otherwise report "not applicable".)

1. Create a client with an email address, and a quote for them with three lines (labour, materials, other) and a tax rate.
2. Read the quote back: does it have a number (Q-…), the right subtotal, tax and total, and status Draft?
3. Mark it sent (today), then accepted (today, with a name). Does the status follow each time?
4. Create an invoice for the same client from the quote (link it), copy the lines, due yesterday, sent 10 days ago. Number (INV-…)? Status Overdue? Balance right?
5. Add a part payment, then the rest. Do Paid, Balance and the status follow?
6. Try to change a line's price on the invoice — this is a price change: what happens?
