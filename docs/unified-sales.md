# Unified sales — 25 October 2026

## Recovery point

The published source before this change is tagged `backup-before-unified-sales-20261025` in GitHub. The unrelated local deletion of `client/public/diamond-logo.png` is intentionally excluded from the change.

On the first authenticated API request after deployment, the locked migration `unified_sales_20261025_v1` takes a data-only snapshot of the 15 existing business tables into `diamond_backup_20261025` before adding the invoice ledger. This snapshot stays in Neon; it is not committed to GitHub. The schema is not exposed to the Data API and PUBLIC has no schema access. Accounts/sessions, constraints and sequences are not part of this business-data snapshot.

Do not blindly restore that snapshot after recording new transactions: it would discard subsequent work. A code rollback does not reverse database stock movements or payments. Reconcile the newer invoice, return, stock and payment records before a data rollback. The new schema is additive; no original invoice is deleted or overwritten by the migration.

## Accounting rules

- `/sales` is the combined invoice workspace. Existing `/printers/sales` links open its printer filter. Printer and product forms remain reachable as workflows from the new-invoice chooser.
- Stable display numbers are `P-id`, `M-id`, `R-id`, preserving the existing source IDs. No duplicate invoice copies are created.
- Completed maintenance appears as an invoice, including awaiting delivery. The legacy detailed maintenance revenue/profit report still recognizes delivered repairs; its caption distinguishes this from all completed invoices.
- Historical collection status is **unknown**, not automatically paid or unpaid. One explicit review sets the opening collected amount; subsequent receipts/refunds are append-only. An outstanding customer balance requires a customer name; phone remains optional.
- Review historical collections before changing an invoice's financial value, returning items or cancelling it. This avoids losing a refund obligation by establishing an opening receipt after reducing the invoice value. Descriptive edits remain available before review.
- New printer/product invoices record their chosen initial receipt in the same transaction as invoice creation and stock movement.
- Totals and filters use invoice date in Africa/Cairo. "Recorded collections" is the cumulative net receipts for those selected invoices, not cash received during that period. Unknown invoices contribute to sales, not to guessed collections/debt.
- Returns operate on individual invoice lines with bounded integer quantities and saved sale prices. Product returns add finished stock; printer/accessory lines have no connection to component stock. Cancellation restores only the remaining unreturned product quantity and changes net invoice revenue to zero. Neither operation invents a cash refund: an actual refund is recorded separately, limited to the credit owed.
- Cancelling maintenance does not restore consumed parts; the cost remains in the detailed profit report.
- Invoice deletion is blocked. Cancelled/returned invoice lines cannot be edited. Payments and return history cannot be silently rewritten. Edits preserve recorded payments and produce a credit if the revised amount is lower.
- Manufacturing payment is independent of customer payment and is not inferred from it. Cancellation/return does not automatically claim that the manufacturer was paid.
- Product profit with missing or historical unverified costs is labeled provisional. New sales store `cost_complete`; old costs are not retroactively guessed.
- The shared PostgreSQL transaction/advisory lock and retry ledger cover invoice mutations, source edits, stock changes, receipts, refunds, and audit events. Expected revisions reject stale forms. Authenticated actor names are supplied by the server, never trusted from client input.

## Verification

`npm run build --prefix client` regenerates `lib/business.cjs` and the frontend/OCR assets. Run:

```text
node --test tests/web-features.test.cjs tests/modern-workspace.test.cjs tests/unified-sales.test.cjs
```

The unified-sales tests exercise initial collection rollback, historical review, overpayment, stale edits, duplicate serials, partial returns then cancellation, refunds, reports/dashboard net figures, Cairo filters and consumed maintenance costs. The test database is in-memory; transaction orchestration also has its existing pool-level tests. No customer invoices are created for QA.

In this session the browser inventory was empty and the native Computer Use pipe unavailable. No desktop/mobile screenshot or real-device interaction could be verified. The synthetic HTTP preview served the SPA and all three invoice types successfully; build and domain checks passed. Production migrations require the first authenticated request, so their application is not inferred from a successful frontend deployment.

`scripts/preview-workspace.cjs` remains synthetic and read-only by default. `DIAMOND_PREVIEW_WRITE=1` permits process-local in-memory mutations for UI QA only; it never connects to Neon. The copy is discarded when stopped.
