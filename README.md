# Diamond Printers Manufacturing Manager

Local-first manufacturing management system for Diamond Printers.

## Stack
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: SQLite (`node:sqlite`)
- Timezone rules: `Africa/Cairo`
- Currency: `EGP`

## Features Implemented
- Session login for web access:
  - username: `ahmed`
  - password: `123456789`
- Suppliers CRUD
- Components CRUD with:
  - case-insensitive item matching
  - optional purchase link
  - supplier assignment
  - intake flow with match suggestions (`existing` or `new`)
  - per-intake purchase records (invoice-like rows)
  - delete one intake invoice without deleting the component
  - multi-price history with active/latest price selection
- Products CRUD + BOM management
- Manufacturing records:
  - auto component deduction from BOM
  - finished goods stock increment
  - inventory ledger entries
  - stock-blocking when insufficient
- Sales records:
  - finished goods deduction
  - cost calculation from latest active component prices
  - revenue, purchase cost, gross profit, margin storage
- Damaged component records:
  - component stock deduction
  - edit/delete reconciliation via ledger reversal
- Edit/Delete reconciliation:
  - reverse previous ledger impact then apply new impact
- Shortage view:
  - components with stock `< 1`
- Inventory lookup tab:
  - search products/components by prefix
  - component stock + last purchase date
  - product stock + last manufacturing date
- Sales report endpoint:
  - daily, weekly, monthly, yearly, specific day, date range
  - includes damaged components summary by period
  - CSV export
- Bilingual UI:
  - English/Arabic switch
  - RTL for Arabic, LTR for English

## Project Structure
- `server/` Express API + SQLite schema/business logic
- `client/` React UI

## Run Locally
1. Install dependencies:
  - `npm install --prefix server`
  - `npm install --prefix client`
2. Start backend:
   - `npm run dev:server`
3. Start frontend:
   - `npm run dev:client`
4. Open:
   - `http://localhost:5173`

Backend default URL: `http://localhost:4000`

## Run As Web App
1. Build frontend assets:
   - `npm run build:web`
2. Start the server:
   - `npm run start:web`
3. Open:
   - `http://localhost:4000`

The Express server serves the built React app from `client/dist` at `/app` and redirects `/` to `/app`.

## Deploy On Render
1. Push the project to GitHub.
2. In Render, create a new `Web Service` from the GitHub repo.
3. Render can read the included [render.yaml](/d:/Diamond printer/render.yaml) automatically.
4. If you configure manually, use:
   - Build command: `npm install && npm --prefix client install && npm --prefix server install && npm run build:web`
   - Start command: `npm run start:web`
   - Health check path: `/health`
5. Default login for the web app:
   - username: `ahmed`
   - password: `123456789`

Note: the free Render setup uses `DATA_DIR=/tmp/diamond-printers-data`, which is suitable for demos and testing, not long-term durable storage.

## Run As Desktop App
1. Build frontend assets:
   - `npm --prefix client run build`
2. Start desktop app (server starts automatically in background):
   - `npm run start:desktop`

## Build `.exe` (No Manual Server Start)
1. Make sure dependencies are installed:
   - `npm install`
   - `npm --prefix server install`
   - `npm --prefix client install`
2. Build executable:
   - `npm run build:desktop`
3. Output file:
   - `release\Diamond Printers 1.0.0.exe`

The `.exe` launches backend and UI automatically. No need to manually run `dev:server` or `dev:client`.

## Key API Endpoints
- `GET/POST/PUT/DELETE /suppliers`
- `GET/POST/PUT/DELETE /components`
- `GET /components/search?q=`
- `POST /components/intake`
- `GET /components/:id/purchase-history`
- `PUT /components/intake-records/:id`
- `DELETE /components/intake-records/:id`
- `GET /components/:id/prices`
- `GET/POST/PUT/DELETE /products`
- `GET/POST/PUT/DELETE /products/:id/bom`
- `DELETE /products/:id/bom/:bomItemId`
- `GET/POST/PUT/DELETE /manufacturing-records`
- `GET/POST/PUT/DELETE /sales-records`
- `GET/POST/PUT/DELETE /damage-records`
- `GET /shortages`
- `GET /inventory/search?q=`
- `GET /inventory/item?type=&id=`
- `GET /reports/sales`
- `GET /reports/sales.csv`
- `GET/PUT /settings/language`

## Notes
- The desktop app stores DB files in user app data, not in the install folder.
