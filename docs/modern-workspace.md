# Modern workspace upgrade

## Recovery

Code baseline: Git tag `backup-before-modern-workspace-20261021` at `9fc8225`.
The first authenticated business request creates a one-time **data-only** snapshot
of the 16 business tables in `diamond_backup_20261021`, under the migration lock and
a SHARE lock on the source tables. Existing live tables are retained. This is not
a full PostgreSQL backup: it does not include constraints, sequences, accounts or
sessions. Use Neon backup/branch recovery for full database restoration. Do not
restore snapshot data into a live system without reconciling later transactions.

## Interface

Printer invoices accept an optional `extra_items` JSON array on the same sale row.
Each accessory stores name, quantity and unit price. Invoice totals, printer
revenue and search include these items; the printer count remains the main line's
quantity. Existing invoices default to an empty list. Migration 011 is applied
automatically; accessories are free-text sales and do not adjust component stock.
Saved invoices have an Edit action. PUT `/printer-sales/:id` validates the same
fields as creation, replaces quantities and accessories, and keeps the invoice
ID, creation time and original request ID. The form loads the saved Cairo date
instead of replacing it with the current time.

- Grouped sidebar with collapse/search on desktop; drawer and bottom navigation
  on mobile. Existing routes remain valid. Original logo is retained.
- Cairo font is bundled locally. Shared form labels, focus management, dirty-form
  confirmation, mobile full-screen dialogs and readable record cards.
- Shared tables have search, Cairo date filters, 20-record display pages and
  details dialogs for secondary sales columns. Filters are reflected in the URL.
  Pagination currently divides the loaded result, not a database cursor.
- Dashboard fetches one consistent snapshot with date filters, separated revenue,
  product profit, all-time manufacturing dues, stock and repair follow-up.
  Printer revenue is not represented as profit.
- Visible dashboards refresh every 30 seconds and on returning to the page.
  Baseline page data is loaded according to the active section. Duplicate reads
  are coalesced briefly and caches invalidated by writes.

## Business operations

`client/src/dataApi.js` is a transport, not the business authority. Server business
logic lives in `client/src/business.js` and is bundled to `lib/business.cjs` by
`scripts/build-business.cjs`. **Build and commit both source and generated bundle.**

`lib/operations.js` creates a request-scoped Neon Pool connection. Writes use one
PostgreSQL transaction and advisory lock 781353, including record changes, stock,
price history and ledger. Failed operations roll back. Read operations use a
repeatable-read snapshot. Connections are released and closed in all cases.
This follows the [Neon Pool transaction pattern](https://github.com/neondatabase/serverless).

`app_operation_requests` stores per-user UUID request results and payload hashes.
Same-ID retries return the original result; changed payloads with that ID fail.
The client reuses the ID after an uncertain failure. Generic legacy writes are
rejected with a refresh message so they cannot bypass business transactions.

Existing admin/user roles are retained. Fine-grained roles, partial payments,
customer histories and returns remain separate future additions.

## Verification

Run `npm --prefix client run build`, then
`node --test tests/web-features.test.cjs tests/modern-workspace.test.cjs`.
The tests cover accounting defaults, unpriced BOM, stock replacement, rollback,
idempotency, server sessions and Cairo dashboard periods. Database adapters are
mocked locally; production checks should be read-only.

`node scripts/preview-workspace.cjs` serves a localhost-only visual preview using
synthetic records, no external database, and rejects writes. It must not be used
as a production server. Check desktop, 390px mobile and 768px tablet layouts,
form opening, record details, filtering and navigation.
