# Accounts, dashboard and printer sales

- Web routes are handled by `client/src/navigation.js`; Vercel rewrites application routes to index.html while preserving API and asset requests.
- `/api/auth` creates account/session tables additively. Passwords use salted scrypt; session tokens are random and only their SHA-256 hashes are stored. Cookies are HttpOnly, SameSite=Strict and Secure on HTTPS.
- On the first successful login only, an administrator is created using `INITIAL_ADMIN_USERNAME` and `INITIAL_ADMIN_PASSWORD` (the existing login is the compatibility fallback). After that all logins use persisted accounts. Change the initial administrator password from Settings → Accounts.
- Accounts are excluded from generic database access; optional anonymous/authenticated Data API grants are revoked from authentication tables.
- All `/api/data` requests require a valid server session. Existing database records are retained.
- Printer invoices are independent from manufacturing inventory, use Cairo local time converted to UTC, and have unique request IDs so retries cannot create duplicate invoices.
- Dashboard manufacturing dues include all unpaid sales; amounts use the manufacturing cost saved on each sale. Printer totals are revenue, not profit.
- Migration: `neon/migrations/009_accounts_and_printer_sales.sql`; automatic startup creates the same tables. A Git rollback restores code, not database snapshots. No existing production data is rewritten by this migration.

Verification: build the client, run `node --test tests/web-features.test.cjs`, then smoke-test login, a direct nested route, creating a user, printer invoice save and date filtering in the deployed environment. Production database mutations are not part of automated local tests.
