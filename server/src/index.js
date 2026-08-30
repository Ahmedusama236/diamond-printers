const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { DateTime } = require("luxon");

const PORT = process.env.PORT || 4000;
const CAIRO_TZ = "Africa/Cairo";
const AUTH_USERNAME = "ahmed";
const AUTH_PASSWORD = "123456789";
const SESSION_COOKIE_NAME = "diamond_printers_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());

const db = initDb();
const defaultFrontendDir = path.resolve(__dirname, "..", "..", "client", "dist");
const frontendDir = process.env.FRONTEND_DIR || defaultFrontendDir;
const sessions = new Map();

function initDb() {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const database = new DatabaseSync(path.join(dataDir, "diamond_printers.db"));
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");

  database.transaction = (fn) => {
    return (...args) => {
      database.exec("BEGIN");
      try {
        const result = fn(...args);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          database.exec("ROLLBACK");
        } catch (_) {
          // Ignore rollback errors.
        }
        throw error;
      }
    };
  };

  database.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      phone TEXT,
      email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      item_name_normalized TEXT NOT NULL UNIQUE,
      stock_qty INTEGER NOT NULL DEFAULT 0,
      supplier_id INTEGER,
      purchase_link TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS component_price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      component_id INTEGER NOT NULL,
      supplier_id INTEGER,
      price_egp REAL NOT NULL CHECK(price_egp >= 0),
      effective_at TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY(component_id) REFERENCES components(id) ON DELETE CASCADE,
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_price_component_active
    ON component_price_history(component_id, is_active, effective_at DESC);

    CREATE TABLE IF NOT EXISTS component_intake_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      component_id INTEGER NOT NULL,
      qty_received INTEGER NOT NULL CHECK(qty_received > 0),
      supplier_id INTEGER,
      purchase_link TEXT,
      unit_price_egp REAL CHECK(unit_price_egp >= 0),
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(component_id) REFERENCES components(id) ON DELETE RESTRICT,
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_component_intake_component_time
    ON component_intake_records(component_id, received_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bom_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      component_id INTEGER NOT NULL,
      qty_per_unit INTEGER NOT NULL CHECK(qty_per_unit > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(product_id, component_id),
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY(component_id) REFERENCES components(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS manufacturing_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      units_produced INTEGER NOT NULL CHECK(units_produced > 0),
      produced_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('order', 'in_progress', 'completed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS sales_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      units_sold INTEGER NOT NULL CHECK(units_sold > 0),
      unit_sell_price_egp REAL NOT NULL CHECK(unit_sell_price_egp >= 0),
      unit_purchase_cost_egp REAL NOT NULL,
      total_purchase_cost_egp REAL NOT NULL,
      revenue_egp REAL NOT NULL,
      gross_profit_egp REAL NOT NULL,
      margin_pct REAL NOT NULL,
      is_accounted INTEGER NOT NULL DEFAULT 0,
      sold_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS damage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      component_id INTEGER NOT NULL,
      qty_damaged INTEGER NOT NULL CHECK(qty_damaged > 0),
      damaged_at TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(component_id) REFERENCES components(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_damage_damaged_at
    ON damage_records(damaged_at DESC);

    CREATE TABLE IF NOT EXISTS finished_stock (
      product_id INTEGER PRIMARY KEY,
      stock_qty INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_type TEXT NOT NULL CHECK(item_type IN ('component', 'finished')),
      item_id INTEGER NOT NULL,
      delta_qty INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK(reason IN ('receipt', 'manufacture', 'sale', 'adjustment', 'reversal')),
      reference_type TEXT NOT NULL,
      reference_id INTEGER NOT NULL,
      reversed INTEGER NOT NULL DEFAULT 0,
      reversed_from_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_reference
    ON inventory_ledger(reference_type, reference_id, reversed);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const manufacturingColumns = database.prepare(`PRAGMA table_info(manufacturing_records)`).all();
  if (!manufacturingColumns.some((column) => column.name === "status")) {
    database.exec(
      `ALTER TABLE manufacturing_records ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('order', 'in_progress', 'completed'))`
    );
  }
  const salesColumns = database.prepare(`PRAGMA table_info(sales_records)`).all();
  if (!salesColumns.some((column) => column.name === "is_accounted")) {
    database.exec(`ALTER TABLE sales_records ADD COLUMN is_accounted INTEGER NOT NULL DEFAULT 0`);
  }

  const now = nowIso();
  database
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('language', 'en', ?)
       ON CONFLICT(key) DO NOTHING`
    )
    .run(now);

  return database;
}

function nowIso() {
  return new Date().toISOString();
}

function parseCookies(cookieHeader) {
  const pairs = String(cookieHeader || "")
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const cookies = {};
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function setSessionCookie(res, token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(
      token
    )}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
  );
}

function createSession() {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    username: AUTH_USERNAME,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }

  const session = sessions.get(token);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, session };
}

function requireAuth(req, res, next) {
  const current = getSessionFromRequest(req);
  if (!current) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Authentication required" });
  }

  req.auth = current.session;
  req.sessionToken = current.token;
  setSessionCookie(res, current.token);
  next();
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toInt(value, fieldName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return parsed;
}

function toPositiveInt(value, fieldName) {
  const parsed = toInt(value, fieldName);
  if (parsed <= 0) {
    throw new Error(`${fieldName} must be greater than 0`);
  }
  return parsed;
}

function toNonNegativeInt(value, fieldName) {
  const parsed = toInt(value, fieldName);
  if (parsed < 0) {
    throw new Error(`${fieldName} must be 0 or greater`);
  }
  return parsed;
}

function toNonNegativeNumber(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a number >= 0`);
  }
  return parsed;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toUtcIsoFromInput(input, fieldName) {
  if (!input) {
    return nowIso();
  }

  let dt = DateTime.fromISO(String(input), { zone: CAIRO_TZ });
  if (!dt.isValid) {
    dt = DateTime.fromJSDate(new Date(input), { zone: CAIRO_TZ });
  }

  if (!dt.isValid) {
    throw new Error(`${fieldName} must be a valid date/time`);
  }

  return dt.toUTC().toISO();
}

function getComponentById(componentId) {
  return db
    .prepare(
      `
      SELECT c.*, s.name AS supplier_name
      FROM components c
      LEFT JOIN suppliers s ON s.id = c.supplier_id
      WHERE c.id = ?
    `
    )
    .get(componentId);
}

function getProductById(productId) {
  return db.prepare(`SELECT * FROM products WHERE id = ?`).get(productId);
}

function getComponentIntakeRecordById(recordId) {
  return db
    .prepare(
      `
      SELECT
        cir.*,
        cir.unit_price_egp AS price_egp,
        c.item_name,
        s.name AS supplier_name
      FROM component_intake_records cir
      JOIN components c ON c.id = cir.component_id
      LEFT JOIN suppliers s ON s.id = cir.supplier_id
      WHERE cir.id = ?
    `
    )
    .get(recordId);
}

function getComponentPurchaseHistory(componentId) {
  return db
    .prepare(
      `
      SELECT
        cir.*,
        cir.unit_price_egp AS price_egp,
        c.item_name,
        s.name AS supplier_name
      FROM component_intake_records cir
      JOIN components c ON c.id = cir.component_id
      LEFT JOIN suppliers s ON s.id = cir.supplier_id
      WHERE cir.component_id = ?
      ORDER BY cir.received_at DESC, cir.id DESC
    `
    )
    .all(componentId);
}

function getDamageRecordById(recordId) {
  return db
    .prepare(
      `
      SELECT dr.*, c.item_name
      FROM damage_records dr
      JOIN components c ON c.id = dr.component_id
      WHERE dr.id = ?
    `
    )
    .get(recordId);
}

function getBomItems(productId) {
  return db
    .prepare(
      `
      SELECT b.id, b.product_id, b.component_id, b.qty_per_unit, c.item_name, c.stock_qty
      FROM bom_items b
      JOIN components c ON c.id = b.component_id
      WHERE b.product_id = ?
      ORDER BY c.item_name COLLATE NOCASE
    `
    )
    .all(productId);
}

function getLatestPriceForComponent(componentId) {
  return db
    .prepare(
      `
      SELECT *
      FROM component_price_history
      WHERE component_id = ? AND is_active = 1
      ORDER BY effective_at DESC, id DESC
      LIMIT 1
    `
    )
    .get(componentId);
}

function appendPriceHistory(componentId, supplierId, priceEgp, effectiveAt) {
  if (priceEgp === undefined || priceEgp === null) {
    return;
  }

  const priceValue = toNonNegativeNumber(priceEgp, "price_egp");
  const now = nowIso();

  db.prepare(
    `UPDATE component_price_history SET is_active = 0 WHERE component_id = ?`
  ).run(componentId);

  db.prepare(
    `
    INSERT INTO component_price_history
      (component_id, supplier_id, price_egp, effective_at, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `
  ).run(componentId, supplierId || null, priceValue, effectiveAt || now, now);
}

function upsertFinishedStock(productId, newQty) {
  db.prepare(
    `
    INSERT INTO finished_stock (product_id, stock_qty, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(product_id) DO UPDATE
    SET stock_qty = excluded.stock_qty, updated_at = excluded.updated_at
  `
  ).run(productId, newQty, nowIso());
}

function getFinishedStockQty(productId) {
  const row = db
    .prepare(`SELECT stock_qty FROM finished_stock WHERE product_id = ?`)
    .get(productId);
  return row ? row.stock_qty : 0;
}

function updateComponentStock(componentId, deltaQty) {
  const component = db
    .prepare(`SELECT stock_qty FROM components WHERE id = ?`)
    .get(componentId);
  if (!component) {
    throw new Error("Component not found");
  }

  const nextQty = component.stock_qty + deltaQty;
  if (nextQty < 0) {
    throw new Error("Insufficient component stock");
  }

  db.prepare(`UPDATE components SET stock_qty = ?, updated_at = ? WHERE id = ?`).run(
    nextQty,
    nowIso(),
    componentId
  );
  return nextQty;
}

function updateFinishedStock(productId, deltaQty) {
  const current = getFinishedStockQty(productId);
  const nextQty = current + deltaQty;
  if (nextQty < 0) {
    throw new Error("Insufficient finished product stock");
  }
  upsertFinishedStock(productId, nextQty);
  return nextQty;
}

function insertLedger({
  itemType,
  itemId,
  deltaQty,
  reason,
  referenceType,
  referenceId,
  reversedFromId = null,
}) {
  db.prepare(
    `
    INSERT INTO inventory_ledger
      (item_type, item_id, delta_qty, reason, reference_type, reference_id, reversed, reversed_from_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `
  ).run(
    itemType,
    itemId,
    deltaQty,
    reason,
    referenceType,
    referenceId,
    reversedFromId,
    nowIso()
  );
}

function reverseLedgerForReference(referenceType, referenceId) {
  const rows = db
    .prepare(
      `
      SELECT *
      FROM inventory_ledger
      WHERE reference_type = ?
        AND reference_id = ?
        AND reversed = 0
        AND reason != 'reversal'
      ORDER BY id DESC
    `
    )
    .all(referenceType, referenceId);

  for (const row of rows) {
    const reverseDelta = -row.delta_qty;
    if (row.item_type === "component") {
      updateComponentStock(row.item_id, reverseDelta);
    } else {
      updateFinishedStock(row.item_id, reverseDelta);
    }

    insertLedger({
      itemType: row.item_type,
      itemId: row.item_id,
      deltaQty: reverseDelta,
      reason: "reversal",
      referenceType,
      referenceId,
      reversedFromId: row.id,
    });

    db.prepare(`UPDATE inventory_ledger SET reversed = 1 WHERE id = ?`).run(row.id);
  }
}

function applyManufacturingStart(recordId, productId, unitsProduced) {
  const bomItems = getBomItems(productId);
  if (!bomItems.length) {
    throw new Error("Product does not have BOM items");
  }

  for (const item of bomItems) {
    const needed = item.qty_per_unit * unitsProduced;
    if (item.stock_qty < needed) {
      throw new Error(`Insufficient stock for component: ${item.item_name}`);
    }
  }

  for (const item of bomItems) {
    const needed = item.qty_per_unit * unitsProduced;
    updateComponentStock(item.component_id, -needed);
    insertLedger({
      itemType: "component",
      itemId: item.component_id,
      deltaQty: -needed,
      reason: "manufacture",
      referenceType: "manufacturing",
      referenceId: recordId,
    });
  }

}

function applyManufacturingCompletion(recordId, productId, unitsProduced) {
  updateFinishedStock(productId, unitsProduced);
  insertLedger({
    itemType: "finished",
    itemId: productId,
    deltaQty: unitsProduced,
    reason: "manufacture",
    referenceType: "manufacturing",
    referenceId: recordId,
  });
}

function applyManufacturing(recordId, productId, unitsProduced, status = "completed") {
  if (status === "order") return;
  applyManufacturingStart(recordId, productId, unitsProduced);
  if (status === "completed") {
    applyManufacturingCompletion(recordId, productId, unitsProduced);
  }
}

function calculateSaleMetrics(productId, unitsSold, unitSellPriceEgp) {
  const bomItems = getBomItems(productId);
  if (!bomItems.length) {
    throw new Error("Product does not have BOM items");
  }

  let unitPurchaseCost = 0;
  for (const item of bomItems) {
    const latestPrice = getLatestPriceForComponent(item.component_id);
    if (!latestPrice) continue;
    unitPurchaseCost += item.qty_per_unit * latestPrice.price_egp;
  }

  const unitPurchaseCostEgp = round2(unitPurchaseCost);
  const totalPurchaseCostEgp = round2(unitPurchaseCostEgp * unitsSold);
  const revenueEgp = round2(unitSellPriceEgp * unitsSold);
  const grossProfitEgp = round2(revenueEgp - totalPurchaseCostEgp);
  const marginPct = revenueEgp === 0 ? 0 : round2((grossProfitEgp / revenueEgp) * 100);

  return {
    unitPurchaseCostEgp,
    totalPurchaseCostEgp,
    revenueEgp,
    grossProfitEgp,
    marginPct,
  };
}

function applySale(recordId, productId, unitsSold) {
  updateFinishedStock(productId, -unitsSold);
  insertLedger({
    itemType: "finished",
    itemId: productId,
    deltaQty: -unitsSold,
    reason: "sale",
    referenceType: "sale",
    referenceId: recordId,
  });
}

function applyDamage(recordId, componentId, qtyDamaged) {
  updateComponentStock(componentId, -qtyDamaged);
  insertLedger({
    itemType: "component",
    itemId: componentId,
    deltaQty: -qtyDamaged,
    reason: "adjustment",
    referenceType: "damage",
    referenceId: recordId,
  });
}

function applyComponentIntake(recordId, componentId, qtyReceived) {
  updateComponentStock(componentId, qtyReceived);
  insertLedger({
    itemType: "component",
    itemId: componentId,
    deltaQty: qtyReceived,
    reason: "receipt",
    referenceType: "component_intake",
    referenceId: recordId,
  });
}

function requireName(value, field = "name") {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${field} is required`);
  }
  return text;
}

function getDateRange(period, query) {
  const anchor = query.date
    ? DateTime.fromISO(query.date, { zone: CAIRO_TZ })
    : DateTime.now().setZone(CAIRO_TZ);

  if (!anchor.isValid && period !== "date_range") {
    throw new Error("Invalid date");
  }

  if (period === "date_range") {
    if (!query.start_date || !query.end_date) {
      throw new Error("start_date and end_date are required for date_range");
    }
    const start = DateTime.fromISO(query.start_date, { zone: CAIRO_TZ }).startOf("day");
    const end = DateTime.fromISO(query.end_date, { zone: CAIRO_TZ }).endOf("day");
    if (!start.isValid || !end.isValid || end < start) {
      throw new Error("Invalid date range");
    }
    return { start, end };
  }

  const normalizeAnchor = anchor.setZone(CAIRO_TZ);
  if (period === "daily" || period === "specific_day") {
    return { start: normalizeAnchor.startOf("day"), end: normalizeAnchor.endOf("day") };
  }

  if (period === "weekly") {
    const start = startOfBusinessWeek(normalizeAnchor);
    return { start, end: start.plus({ days: 6 }).endOf("day") };
  }

  if (period === "monthly") {
    return { start: normalizeAnchor.startOf("month"), end: normalizeAnchor.endOf("month") };
  }

  if (period === "yearly") {
    return { start: normalizeAnchor.startOf("year"), end: normalizeAnchor.endOf("year") };
  }

  throw new Error("Unsupported period");
}

function startOfBusinessWeek(dt) {
  const weekday = dt.weekday;
  const offset = (weekday + 1) % 7;
  return dt.startOf("day").minus({ days: offset });
}

function bucketKeyForRecord(dt, period) {
  if (period === "yearly") {
    return dt.toFormat("yyyy-LL");
  }
  if (period === "monthly") {
    return startOfBusinessWeek(dt).toFormat("yyyy-LL-dd");
  }
  return dt.toFormat("yyyy-LL-dd");
}

function buildDamagedReport(period, query, rangeOverride = null) {
  const { start, end } = rangeOverride || getDateRange(period, query);

  const rows = db
    .prepare(
      `
      SELECT dr.*, c.item_name
      FROM damage_records dr
      JOIN components c ON c.id = dr.component_id
      ORDER BY dr.damaged_at ASC
    `
    )
    .all();

  const filtered = [];
  for (const row of rows) {
    const damagedAt = DateTime.fromISO(row.damaged_at, { zone: "utc" }).setZone(CAIRO_TZ);
    if (damagedAt >= start && damagedAt <= end) {
      filtered.push({
        ...row,
        damaged_at_cairo: damagedAt.toISO(),
      });
    }
  }

  const buckets = new Map();
  let totalDamagedQty = 0;

  for (const row of filtered) {
    totalDamagedQty += row.qty_damaged;

    const damagedAt = DateTime.fromISO(row.damaged_at, { zone: "utc" }).setZone(CAIRO_TZ);
    const key = bucketKeyForRecord(damagedAt, period);
    if (!buckets.has(key)) {
      buckets.set(key, {
        bucket: key,
        damaged_qty: 0,
        records_count: 0,
      });
    }
    const bucket = buckets.get(key);
    bucket.damaged_qty += row.qty_damaged;
    bucket.records_count += 1;
  }

  const bucketRows = Array.from(buckets.values()).sort((a, b) => (a.bucket > b.bucket ? 1 : -1));

  return {
    period,
    timezone: CAIRO_TZ,
    start_cairo: start.toISO(),
    end_cairo: end.toISO(),
    summary: {
      damaged_qty: totalDamagedQty,
      records_count: filtered.length,
    },
    buckets: bucketRows,
    transactions: filtered.map((row) => ({
      id: row.id,
      component_id: row.component_id,
      item_name: row.item_name,
      qty_damaged: row.qty_damaged,
      damaged_at: row.damaged_at,
      damaged_at_cairo: row.damaged_at_cairo,
      notes: row.notes,
    })),
  };
}

function buildSalesReport(period, query) {
  const { start, end } = getDateRange(period, query);
  const damagedReport = buildDamagedReport(period, query, { start, end });

  const rows = db
    .prepare(
      `
      SELECT sr.*, p.name AS product_name
      FROM sales_records sr
      JOIN products p ON p.id = sr.product_id
      ORDER BY sr.sold_at ASC
    `
    )
    .all();

  const filtered = [];
  for (const row of rows) {
    const soldAt = DateTime.fromISO(row.sold_at, { zone: "utc" }).setZone(CAIRO_TZ);
    if (soldAt >= start && soldAt <= end) {
      filtered.push({
        ...row,
        sold_at_cairo: soldAt.toISO(),
        sold_day: soldAt.toFormat("yyyy-LL-dd"),
      });
    }
  }

  const buckets = new Map();
  let totalRevenue = 0;
  let totalPurchaseCost = 0;
  let totalGrossProfit = 0;
  let totalUnits = 0;

  for (const row of filtered) {
    totalRevenue += row.revenue_egp;
    totalPurchaseCost += row.total_purchase_cost_egp;
    totalGrossProfit += row.gross_profit_egp;
    totalUnits += row.units_sold;

    const soldAt = DateTime.fromISO(row.sold_at, { zone: "utc" }).setZone(CAIRO_TZ);
    const key = bucketKeyForRecord(soldAt, period);
    if (!buckets.has(key)) {
      buckets.set(key, {
        bucket: key,
        revenue_egp: 0,
        purchase_cost_egp: 0,
        gross_profit_egp: 0,
        units_sold: 0,
      });
    }
    const bucket = buckets.get(key);
    bucket.revenue_egp += row.revenue_egp;
    bucket.purchase_cost_egp += row.total_purchase_cost_egp;
    bucket.gross_profit_egp += row.gross_profit_egp;
    bucket.units_sold += row.units_sold;
  }

  const bucketRows = Array.from(buckets.values())
    .sort((a, b) => (a.bucket > b.bucket ? 1 : -1))
    .map((row) => ({
      ...row,
      revenue_egp: round2(row.revenue_egp),
      purchase_cost_egp: round2(row.purchase_cost_egp),
      gross_profit_egp: round2(row.gross_profit_egp),
      avg_margin_pct:
        row.revenue_egp === 0 ? 0 : round2((row.gross_profit_egp / row.revenue_egp) * 100),
    }));

  return {
    period,
    timezone: CAIRO_TZ,
    start_cairo: start.toISO(),
    end_cairo: end.toISO(),
    summary: {
      revenue_egp: round2(totalRevenue),
      purchase_cost_egp: round2(totalPurchaseCost),
      gross_profit_egp: round2(totalGrossProfit),
      units_sold: totalUnits,
      avg_margin_pct: totalRevenue === 0 ? 0 : round2((totalGrossProfit / totalRevenue) * 100),
    },
    buckets: bucketRows,
    transactions: filtered.map((row) => ({
      id: row.id,
      product_id: row.product_id,
      product_name: row.product_name,
      units_sold: row.units_sold,
      unit_sell_price_egp: row.unit_sell_price_egp,
      unit_purchase_cost_egp: row.unit_purchase_cost_egp,
      revenue_egp: row.revenue_egp,
      purchase_cost_egp: row.total_purchase_cost_egp,
      gross_profit_egp: row.gross_profit_egp,
      margin_pct: row.margin_pct,
      sold_at: row.sold_at,
      sold_at_cairo: row.sold_at_cairo,
    })),
    damaged: damagedReport,
  };
}

function reportToCsv(report) {
  const lines = [];
  lines.push(
    [
      "bucket",
      "revenue_egp",
      "purchase_cost_egp",
      "gross_profit_egp",
      "units_sold",
      "avg_margin_pct",
    ].join(",")
  );

  for (const bucket of report.buckets) {
    lines.push(
      [
        bucket.bucket,
        bucket.revenue_egp,
        bucket.purchase_cost_egp,
        bucket.gross_profit_egp,
        bucket.units_sold,
        bucket.avg_margin_pct,
      ].join(",")
    );
  }

  lines.push("");
  lines.push(["summary", "", "", "", "", ""].join(","));
  lines.push(["revenue_egp", report.summary.revenue_egp].join(","));
  lines.push(["purchase_cost_egp", report.summary.purchase_cost_egp].join(","));
  lines.push(["gross_profit_egp", report.summary.gross_profit_egp].join(","));
  lines.push(["units_sold", report.summary.units_sold].join(","));
  lines.push(["avg_margin_pct", report.summary.avg_margin_pct].join(","));
  return lines.join("\n");
}

function runRoute(handler) {
  return (req, res, next) => {
    try {
      handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/auth/status", (req, res) => {
  const current = getSessionFromRequest(req);
  if (!current) {
    clearSessionCookie(res);
    return res.json({ authenticated: false });
  }

  setSessionCookie(res, current.token);
  return res.json({
    authenticated: true,
    username: current.session.username,
  });
});

app.post(
  "/auth/login",
  runRoute((req, res) => {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (username !== AUTH_USERNAME || password !== AUTH_PASSWORD) {
      throw new Error("Invalid username or password");
    }

    const token = createSession();
    setSessionCookie(res, token);
    res.json({ success: true, username: AUTH_USERNAME });
  })
);

app.post("/auth/logout", (req, res) => {
  const current = getSessionFromRequest(req);
  if (current) {
    sessions.delete(current.token);
  }
  clearSessionCookie(res);
  res.json({ success: true });
});

app.use((req, res, next) => {
  if (
    req.path === "/" ||
    req.path === "/health" ||
    req.path.startsWith("/auth") ||
    req.path.startsWith("/app")
  ) {
    return next();
  }
  return requireAuth(req, res, next);
});

app.get(
  "/suppliers",
  runRoute((_req, res) => {
    const rows = db
      .prepare(`SELECT * FROM suppliers ORDER BY name COLLATE NOCASE`)
      .all();
    res.json(rows);
  })
);

app.post(
  "/suppliers",
  runRoute((req, res) => {
    const now = nowIso();
    const name = requireName(req.body.name, "name");
    const phone = req.body.phone ? String(req.body.phone).trim() : null;
    const email = req.body.email ? String(req.body.email).trim() : null;

    const info = db
      .prepare(
        `
        INSERT INTO suppliers (name, phone, email, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `
      )
      .run(name, phone, email, now, now);

    const created = db
      .prepare(`SELECT * FROM suppliers WHERE id = ?`)
      .get(Number(info.lastInsertRowid));
    res.status(201).json(created);
  })
);

app.put(
  "/suppliers/:id",
  runRoute((req, res) => {
    const supplierId = toInt(req.params.id, "id");
    const current = db.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(supplierId);
    if (!current) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    const name = req.body.name !== undefined ? requireName(req.body.name, "name") : current.name;
    const phone = req.body.phone !== undefined ? (req.body.phone || null) : current.phone;
    const email = req.body.email !== undefined ? (req.body.email || null) : current.email;

    db.prepare(
      `
      UPDATE suppliers
      SET name = ?, phone = ?, email = ?, updated_at = ?
      WHERE id = ?
    `
    ).run(name, phone, email, nowIso(), supplierId);

    const updated = db.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(supplierId);
    res.json(updated);
  })
);

app.delete(
  "/suppliers/:id",
  runRoute((req, res) => {
    const supplierId = toInt(req.params.id, "id");
    const inUse = db
      .prepare(`SELECT COUNT(*) AS count FROM components WHERE supplier_id = ?`)
      .get(supplierId);
    if (inUse.count > 0) {
      return res.status(400).json({ error: "Supplier is referenced by components" });
    }

    db.prepare(`DELETE FROM suppliers WHERE id = ?`).run(supplierId);
    res.json({ success: true });
  })
);

app.get(
  "/components",
  runRoute((_req, res) => {
    const rows = db
      .prepare(
        `
        SELECT
          c.*,
          s.name AS supplier_name,
          ph.price_egp AS latest_price_egp,
          ph.supplier_id AS latest_price_supplier_id
        FROM components c
        LEFT JOIN suppliers s ON s.id = c.supplier_id
        LEFT JOIN component_price_history ph ON ph.component_id = c.id AND ph.is_active = 1
        ORDER BY c.item_name COLLATE NOCASE
      `
      )
      .all();

    res.json(rows);
  })
);

app.get(
  "/components/search",
  runRoute((req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    const rows = db
      .prepare(
        `
        SELECT id, item_name, stock_qty
        FROM components
        WHERE item_name_normalized LIKE ?
        ORDER BY item_name COLLATE NOCASE
        LIMIT 20
      `
      )
      .all(`%${q}%`);
    res.json(rows);
  })
);

app.get(
  "/components/:id/prices",
  runRoute((req, res) => {
    const componentId = toInt(req.params.id, "id");
    const rows = db
      .prepare(
        `
        SELECT ph.*, s.name AS supplier_name
        FROM component_price_history ph
        LEFT JOIN suppliers s ON s.id = ph.supplier_id
        WHERE ph.component_id = ?
        ORDER BY ph.effective_at DESC, ph.id DESC
      `
      )
      .all(componentId);
    res.json(rows);
  })
);

app.post(
  "/components",
  runRoute((req, res) => {
    const tx = db.transaction((payload) => {
      const now = nowIso();
      const itemName = requireName(payload.item_name, "item_name");
      const normalized = normalizeName(itemName);
      const supplierId = payload.supplier_id ? toInt(payload.supplier_id, "supplier_id") : null;
      const purchaseLink = payload.purchase_link ? String(payload.purchase_link).trim() : null;
      const stockQty =
        payload.stock_qty !== undefined ? toNonNegativeInt(payload.stock_qty, "stock_qty") : 0;

      const info = db
        .prepare(
          `
          INSERT INTO components
            (item_name, item_name_normalized, stock_qty, supplier_id, purchase_link, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(itemName, normalized, stockQty, supplierId, purchaseLink, now, now);

      const componentId = Number(info.lastInsertRowid);

      appendPriceHistory(
        componentId,
        payload.price_supplier_id || supplierId,
        payload.price_egp,
        now
      );

      if (stockQty > 0) {
        insertLedger({
          itemType: "component",
          itemId: componentId,
          deltaQty: stockQty,
          reason: "adjustment",
          referenceType: "component",
          referenceId: componentId,
        });
      }

      return getComponentById(componentId);
    });

    const result = tx(req.body);
    res.status(201).json(result);
  })
);

app.put(
  "/components/:id",
  runRoute((req, res) => {
    const componentId = toInt(req.params.id, "id");

    const tx = db.transaction((payload) => {
      const current = db.prepare(`SELECT * FROM components WHERE id = ?`).get(componentId);
      if (!current) {
        throw new Error("Component not found");
      }

      const itemName =
        payload.item_name !== undefined ? requireName(payload.item_name, "item_name") : current.item_name;
      const normalized =
        payload.item_name !== undefined
          ? normalizeName(itemName)
          : current.item_name_normalized;
      const supplierId =
        payload.supplier_id !== undefined
          ? payload.supplier_id
            ? toInt(payload.supplier_id, "supplier_id")
            : null
          : current.supplier_id;
      const purchaseLink =
        payload.purchase_link !== undefined
          ? payload.purchase_link
            ? String(payload.purchase_link).trim()
            : null
          : current.purchase_link;

      db.prepare(
        `
        UPDATE components
        SET item_name = ?, item_name_normalized = ?, supplier_id = ?, purchase_link = ?, updated_at = ?
        WHERE id = ?
      `
      ).run(itemName, normalized, supplierId, purchaseLink, nowIso(), componentId);

      if (payload.stock_qty !== undefined) {
        const newStock = toNonNegativeInt(payload.stock_qty, "stock_qty");
        const delta = newStock - current.stock_qty;
        if (delta !== 0) {
          updateComponentStock(componentId, delta);
          insertLedger({
            itemType: "component",
            itemId: componentId,
            deltaQty: delta,
            reason: "adjustment",
            referenceType: "component",
            referenceId: componentId,
          });
        }
      }

      const priceSupplierId = payload.price_supplier_id || supplierId || null;
      appendPriceHistory(componentId, priceSupplierId, payload.price_egp, nowIso());

      return getComponentById(componentId);
    });

    const result = tx(req.body);
    res.json(result);
  })
);

app.delete(
  "/components/:id",
  runRoute((req, res) => {
    const componentId = toInt(req.params.id, "id");
    const tx = db.transaction((id) => {
      const component = db.prepare(`SELECT * FROM components WHERE id = ?`).get(id);
      if (!component) {
        throw new Error("Component not found");
      }

      if (component.stock_qty > 0) {
        throw new Error("Component stock must be zero before deletion");
      }

      const bomUse = db
        .prepare(`SELECT COUNT(*) AS count FROM bom_items WHERE component_id = ?`)
        .get(id);
      if (bomUse.count > 0) {
        throw new Error("Component is used by one or more product BOMs");
      }

      const hasDamageHistory = db
        .prepare(`SELECT COUNT(*) AS count FROM damage_records WHERE component_id = ?`)
        .get(id);
      if (hasDamageHistory.count > 0) {
        throw new Error("Cannot delete component with damage history");
      }

      const hasIntakeHistory = db
        .prepare(`SELECT COUNT(*) AS count FROM component_intake_records WHERE component_id = ?`)
        .get(id);
      if (hasIntakeHistory.count > 0) {
        throw new Error("Cannot delete component with intake history");
      }

      db.prepare(`DELETE FROM components WHERE id = ?`).run(id);
    });

    tx(componentId);
    res.json({ success: true });
  })
);

app.post(
  "/components/intake",
  runRoute((req, res) => {
    const tx = db.transaction((payload) => {
      const qty = toPositiveInt(payload.qty, "qty");
      const explicitDecision = payload.decision !== undefined ? String(payload.decision || "").trim() : "";
      const supplierId = payload.supplier_id ? toInt(payload.supplier_id, "supplier_id") : null;
      const purchaseLink = payload.purchase_link ? String(payload.purchase_link).trim() : null;
      const name = payload.name ? requireName(payload.name, "name") : "";
      const receivedAt = toUtcIsoFromInput(payload.received_at, "received_at");

      let componentId = null;
      let decision = explicitDecision;
      if (!decision) {
        decision = payload.existing_component_id ? "existing" : "new";
      }

      if (decision === "existing") {
        if (payload.existing_component_id) {
          componentId = toInt(payload.existing_component_id, "existing_component_id");
        }
        if (!componentId && name) {
          const normalized = normalizeName(name);
          const exact = db
            .prepare(`SELECT id FROM components WHERE item_name_normalized = ?`)
            .get(normalized);
          if (exact) {
            componentId = exact.id;
          }
        }
        if (!componentId) {
          throw new Error("Existing component must be selected");
        }
      } else if (decision === "new") {
        if (!name) {
          throw new Error("name is required when creating a new component");
        }
        const normalized = normalizeName(name);
        const existing = db
          .prepare(`SELECT id FROM components WHERE item_name_normalized = ?`)
          .get(normalized);
        if (existing) {
          throw new Error("Component already exists. Choose existing decision.");
        }
        const now = nowIso();
        const info = db
          .prepare(
            `
            INSERT INTO components
              (item_name, item_name_normalized, stock_qty, supplier_id, purchase_link, created_at, updated_at)
            VALUES (?, ?, 0, ?, ?, ?, ?)
          `
          )
          .run(name, normalized, supplierId, purchaseLink, now, now);
        componentId = Number(info.lastInsertRowid);
      } else {
        throw new Error("decision must be either 'existing' or 'new'");
      }

      const intakeInfo = db
        .prepare(
          `
          INSERT INTO component_intake_records
            (component_id, qty_received, supplier_id, purchase_link, unit_price_egp, received_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          componentId,
          qty,
          supplierId,
          purchaseLink,
          payload.price_egp !== undefined && payload.price_egp !== null
            ? toNonNegativeNumber(payload.price_egp, "price_egp")
            : null,
          receivedAt,
          nowIso()
        );
      const intakeRecordId = Number(intakeInfo.lastInsertRowid);

      applyComponentIntake(intakeRecordId, componentId, qty);

      if (supplierId || purchaseLink) {
        db.prepare(
          `
          UPDATE components
          SET supplier_id = COALESCE(?, supplier_id),
            purchase_link = COALESCE(?, purchase_link),
            updated_at = ?
          WHERE id = ?
        `
        ).run(supplierId, purchaseLink, receivedAt, componentId);
      }

      appendPriceHistory(componentId, supplierId, payload.price_egp, receivedAt);
      return getComponentById(componentId);
    });

    const result = tx(req.body);
    res.status(201).json(result);
  })
);

app.get(
  "/components/:id/purchase-history",
  runRoute((req, res) => {
    const componentId = toInt(req.params.id, "id");
    const rows = getComponentPurchaseHistory(componentId);
    res.json(rows);
  })
);

app.delete(
  "/components/intake-records/:id",
  runRoute((req, res) => {
    const intakeRecordId = toInt(req.params.id, "id");
    const tx = db.transaction((id) => {
      const record = getComponentIntakeRecordById(id);
      if (!record) {
        throw new Error("Intake record not found");
      }
      reverseLedgerForReference("component_intake", id);
      db.prepare(`DELETE FROM component_intake_records WHERE id = ?`).run(id);
      return record;
    });

    const deleted = tx(intakeRecordId);
    res.json({ success: true, deleted });
  })
);

app.put(
  "/components/intake-records/:id",
  runRoute((req, res) => {
    const intakeRecordId = toInt(req.params.id, "id");
    const tx = db.transaction((payload) => {
      const current = db.prepare(`SELECT * FROM component_intake_records WHERE id = ?`).get(intakeRecordId);
      if (!current) {
        throw new Error("Intake record not found");
      }

      const componentId =
        payload.component_id !== undefined
          ? toInt(payload.component_id, "component_id")
          : current.component_id;
      const qtyReceived =
        payload.qty_received !== undefined
          ? toPositiveInt(payload.qty_received, "qty_received")
          : current.qty_received;
      const supplierId =
        payload.supplier_id !== undefined
          ? payload.supplier_id
            ? toInt(payload.supplier_id, "supplier_id")
            : null
          : current.supplier_id;
      const purchaseLink =
        payload.purchase_link !== undefined
          ? payload.purchase_link
            ? String(payload.purchase_link).trim()
            : null
          : current.purchase_link;
      const unitPriceEgp =
        payload.price_egp !== undefined
          ? payload.price_egp === null || payload.price_egp === ""
            ? null
            : toNonNegativeNumber(payload.price_egp, "price_egp")
          : current.unit_price_egp;
      const receivedAt =
        payload.received_at !== undefined
          ? toUtcIsoFromInput(payload.received_at, "received_at")
          : current.received_at;

      if (!getComponentById(componentId)) {
        throw new Error("Component not found");
      }

      reverseLedgerForReference("component_intake", intakeRecordId);

      db.prepare(
        `
        UPDATE component_intake_records
        SET component_id = ?,
            qty_received = ?,
            supplier_id = ?,
            purchase_link = ?,
            unit_price_egp = ?,
            received_at = ?
        WHERE id = ?
      `
      ).run(
        componentId,
        qtyReceived,
        supplierId,
        purchaseLink,
        unitPriceEgp,
        receivedAt,
        intakeRecordId
      );

      applyComponentIntake(intakeRecordId, componentId, qtyReceived);

      if (supplierId || purchaseLink) {
        db.prepare(
          `
          UPDATE components
          SET supplier_id = COALESCE(?, supplier_id),
              purchase_link = COALESCE(?, purchase_link),
              updated_at = ?
          WHERE id = ?
        `
        ).run(supplierId, purchaseLink, receivedAt, componentId);
      }

      appendPriceHistory(componentId, supplierId, unitPriceEgp, receivedAt);
      return getComponentIntakeRecordById(intakeRecordId);
    });

    const updated = tx(req.body);
    res.json(updated);
  })
);

app.get(
  "/products",
  runRoute((_req, res) => {
    const rows = db
      .prepare(
        `
        SELECT p.*, COALESCE(fs.stock_qty, 0) AS finished_stock_qty
        FROM products p
        LEFT JOIN finished_stock fs ON fs.product_id = p.id
        ORDER BY p.name COLLATE NOCASE
      `
      )
      .all();
    res.json(rows);
  })
);

app.post(
  "/products",
  runRoute((req, res) => {
    const name = requireName(req.body.name, "name");
    const now = nowIso();
    const info = db
      .prepare(`INSERT INTO products (name, created_at, updated_at) VALUES (?, ?, ?)`)
      .run(name, now, now);

    upsertFinishedStock(Number(info.lastInsertRowid), 0);

    const created = db
      .prepare(`SELECT * FROM products WHERE id = ?`)
      .get(Number(info.lastInsertRowid));
    res.status(201).json(created);
  })
);

app.put(
  "/products/:id",
  runRoute((req, res) => {
    const productId = toInt(req.params.id, "id");
    const current = getProductById(productId);
    if (!current) {
      return res.status(404).json({ error: "Product not found" });
    }

    const name = req.body.name !== undefined ? requireName(req.body.name, "name") : current.name;
    db.prepare(`UPDATE products SET name = ?, updated_at = ? WHERE id = ?`).run(
      name,
      nowIso(),
      productId
    );

    const updated = getProductById(productId);
    res.json(updated);
  })
);

app.delete(
  "/products/:id",
  runRoute((req, res) => {
    const productId = toInt(req.params.id, "id");
    const tx = db.transaction((id) => {
      const product = getProductById(id);
      if (!product) {
        throw new Error("Product not found");
      }

      const finishedQty = getFinishedStockQty(id);
      if (finishedQty > 0) {
        throw new Error("Finished stock must be zero before deleting product");
      }

      const hasManufacturing = db
        .prepare(`SELECT COUNT(*) AS count FROM manufacturing_records WHERE product_id = ?`)
        .get(id);
      const hasSales = db
        .prepare(`SELECT COUNT(*) AS count FROM sales_records WHERE product_id = ?`)
        .get(id);
      if (hasManufacturing.count > 0 || hasSales.count > 0) {
        throw new Error("Cannot delete product with manufacturing or sales history");
      }

      db.prepare(`DELETE FROM products WHERE id = ?`).run(id);
    });

    tx(productId);
    res.json({ success: true });
  })
);

app.get(
  "/products/:id/bom",
  runRoute((req, res) => {
    const productId = toInt(req.params.id, "id");
    const rows = getBomItems(productId);
    res.json(rows);
  })
);

app.post(
  "/products/:id/bom",
  runRoute((req, res) => {
    const productId = toInt(req.params.id, "id");
    const componentId = toInt(req.body.component_id, "component_id");
    const qtyPerUnit = toPositiveInt(req.body.qty_per_unit, "qty_per_unit");
    const now = nowIso();

    db.prepare(
      `
      INSERT INTO bom_items (product_id, component_id, qty_per_unit, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(product_id, component_id)
      DO UPDATE SET qty_per_unit = excluded.qty_per_unit, updated_at = excluded.updated_at
    `
    ).run(productId, componentId, qtyPerUnit, now, now);

    const rows = getBomItems(productId);
    res.status(201).json(rows);
  })
);

app.put(
  "/products/:id/bom",
  runRoute((req, res) => {
    const productId = toInt(req.params.id, "id");
    const items = Array.isArray(req.body.items) ? req.body.items : null;
    if (!items) {
      throw new Error("items array is required");
    }

    const tx = db.transaction((entries) => {
      db.prepare(`DELETE FROM bom_items WHERE product_id = ?`).run(productId);
      const now = nowIso();
      const seen = new Set();

      for (const entry of entries) {
        const componentId = toInt(entry.component_id, "component_id");
        const qtyPerUnit = toPositiveInt(entry.qty_per_unit, "qty_per_unit");
        if (seen.has(componentId)) {
          throw new Error("Duplicate component in BOM payload");
        }
        seen.add(componentId);
        db.prepare(
          `
          INSERT INTO bom_items (product_id, component_id, qty_per_unit, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `
        ).run(productId, componentId, qtyPerUnit, now, now);
      }
      return getBomItems(productId);
    });

    const result = tx(items);
    res.json(result);
  })
);

app.delete(
  "/products/:id/bom",
  runRoute((req, res) => {
    const productId = toInt(req.params.id, "id");
    db.prepare(`DELETE FROM bom_items WHERE product_id = ?`).run(productId);
    res.json({ success: true });
  })
);

app.delete(
  "/products/:id/bom/:bomItemId",
  runRoute((req, res) => {
    const productId = toInt(req.params.id, "id");
    const bomItemId = toInt(req.params.bomItemId, "bomItemId");
    db.prepare(`DELETE FROM bom_items WHERE id = ? AND product_id = ?`).run(bomItemId, productId);
    res.json({ success: true });
  })
);

app.get(
  "/manufacturing-records",
  runRoute((_req, res) => {
    const rows = db
      .prepare(
        `
        SELECT mr.*, p.name AS product_name
        FROM manufacturing_records mr
        JOIN products p ON p.id = mr.product_id
        ORDER BY mr.produced_at DESC
      `
      )
      .all();
    res.json(rows);
  })
);

app.post(
  "/manufacturing-records",
  runRoute((req, res) => {
    const tx = db.transaction((payload) => {
      const productId = toInt(payload.product_id, "product_id");
      const unitsProduced = toPositiveInt(payload.units_produced, "units_produced");
      const producedAt = toUtcIsoFromInput(payload.produced_at, "produced_at");

      if (!getProductById(productId)) {
        throw new Error("Product not found");
      }

      const now = nowIso();
      const info = db
        .prepare(
          `
          INSERT INTO manufacturing_records
            (product_id, units_produced, produced_at, status, created_at, updated_at)
          VALUES (?, ?, ?, 'order', ?, ?)
        `
        )
        .run(productId, unitsProduced, producedAt, now, now);

      const recordId = Number(info.lastInsertRowid);
      return db
        .prepare(
          `
          SELECT mr.*, p.name AS product_name
          FROM manufacturing_records mr
          JOIN products p ON p.id = mr.product_id
          WHERE mr.id = ?
        `
        )
        .get(recordId);
    });

    const created = tx(req.body);
    res.status(201).json(created);
  })
);

app.put(
  "/manufacturing-records/:id",
  runRoute((req, res) => {
    const recordId = toInt(req.params.id, "id");

    const tx = db.transaction((payload) => {
      const current = db
        .prepare(`SELECT * FROM manufacturing_records WHERE id = ?`)
        .get(recordId);
      if (!current) {
        throw new Error("Manufacturing record not found");
      }

      const productId =
        payload.product_id !== undefined
          ? toInt(payload.product_id, "product_id")
          : current.product_id;
      const unitsProduced =
        payload.units_produced !== undefined
          ? toPositiveInt(payload.units_produced, "units_produced")
          : current.units_produced;
      const producedAt =
        payload.produced_at !== undefined
          ? toUtcIsoFromInput(payload.produced_at, "produced_at")
          : current.produced_at;
      const currentStatus = current.status || "completed";
      const nextStatus = payload.status !== undefined ? String(payload.status) : currentStatus;
      const validTransitions = {
        order: new Set(["order", "in_progress"]),
        in_progress: new Set(["in_progress", "completed"]),
        completed: new Set(["completed"]),
      };
      if (!validTransitions[currentStatus]?.has(nextStatus)) {
        throw new Error("Invalid manufacturing status transition");
      }

      const detailsChanged = productId !== current.product_id || unitsProduced !== current.units_produced;
      if (detailsChanged && currentStatus !== "order") {
        reverseLedgerForReference("manufacturing", recordId);
      }

      db.prepare(
        `
        UPDATE manufacturing_records
        SET product_id = ?, units_produced = ?, produced_at = ?, status = ?, updated_at = ?
        WHERE id = ?
      `
      ).run(productId, unitsProduced, producedAt, nextStatus, nowIso(), recordId);

      if (detailsChanged) {
        applyManufacturing(recordId, productId, unitsProduced, nextStatus);
      } else if (currentStatus === "order" && nextStatus === "in_progress") {
        applyManufacturingStart(recordId, productId, unitsProduced);
      } else if (currentStatus === "in_progress" && nextStatus === "completed") {
        applyManufacturingCompletion(recordId, productId, unitsProduced);
      }

      return db
        .prepare(
          `
          SELECT mr.*, p.name AS product_name
          FROM manufacturing_records mr
          JOIN products p ON p.id = mr.product_id
          WHERE mr.id = ?
        `
        )
        .get(recordId);
    });

    const updated = tx(req.body);
    res.json(updated);
  })
);

app.delete(
  "/manufacturing-records/:id",
  runRoute((req, res) => {
    const recordId = toInt(req.params.id, "id");
    const tx = db.transaction((id) => {
      const current = db
        .prepare(`SELECT * FROM manufacturing_records WHERE id = ?`)
        .get(id);
      if (!current) {
        throw new Error("Manufacturing record not found");
      }
      reverseLedgerForReference("manufacturing", id);
      db.prepare(`DELETE FROM manufacturing_records WHERE id = ?`).run(id);
    });

    tx(recordId);
    res.json({ success: true });
  })
);

app.get(
  "/sales-records",
  runRoute((_req, res) => {
    const rows = db
      .prepare(
        `
        SELECT sr.*, p.name AS product_name
        FROM sales_records sr
        JOIN products p ON p.id = sr.product_id
        ORDER BY sr.sold_at DESC
      `
      )
      .all();
    res.json(rows);
  })
);

app.post(
  "/sales-records",
  runRoute((req, res) => {
    const tx = db.transaction((payload) => {
      const productId = toInt(payload.product_id, "product_id");
      const unitsSold = toPositiveInt(payload.units_sold, "units_sold");
      const unitSellPriceEgp = toNonNegativeNumber(payload.unit_sell_price_egp, "unit_sell_price_egp");
      const soldAt = toUtcIsoFromInput(payload.sold_at, "sold_at");

      if (!getProductById(productId)) {
        throw new Error("Product not found");
      }

      const availableStock = getFinishedStockQty(productId);
      if (availableStock < unitsSold) {
        throw new Error(`Insufficient finished product stock. Available: ${availableStock}`);
      }

      const metrics = calculateSaleMetrics(productId, unitsSold, unitSellPriceEgp);
      const now = nowIso();
      const info = db
        .prepare(
          `
          INSERT INTO sales_records
            (
              product_id,
              units_sold,
              unit_sell_price_egp,
              unit_purchase_cost_egp,
              total_purchase_cost_egp,
              revenue_egp,
              gross_profit_egp,
              margin_pct,
              sold_at,
              created_at,
              updated_at
            )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          productId,
          unitsSold,
          unitSellPriceEgp,
          metrics.unitPurchaseCostEgp,
          metrics.totalPurchaseCostEgp,
          metrics.revenueEgp,
          metrics.grossProfitEgp,
          metrics.marginPct,
          soldAt,
          now,
          now
        );

      const recordId = Number(info.lastInsertRowid);
      applySale(recordId, productId, unitsSold);

      return db
        .prepare(
          `
          SELECT sr.*, p.name AS product_name
          FROM sales_records sr
          JOIN products p ON p.id = sr.product_id
          WHERE sr.id = ?
        `
        )
        .get(recordId);
    });

    const created = tx(req.body);
    res.status(201).json(created);
  })
);

app.put(
  "/sales-records/:id",
  runRoute((req, res) => {
    const recordId = toInt(req.params.id, "id");

    const tx = db.transaction((payload) => {
      const current = db.prepare(`SELECT * FROM sales_records WHERE id = ?`).get(recordId);
      if (!current) {
        throw new Error("Sales record not found");
      }

      if (
        payload.is_accounted !== undefined &&
        Object.keys(payload).every((key) => key === "is_accounted")
      ) {
        db.prepare(`UPDATE sales_records SET is_accounted = ?, updated_at = ? WHERE id = ?`).run(
          payload.is_accounted ? 1 : 0,
          nowIso(),
          recordId
        );
        return db
          .prepare(
            `SELECT sr.*, p.name AS product_name FROM sales_records sr JOIN products p ON p.id = sr.product_id WHERE sr.id = ?`
          )
          .get(recordId);
      }

      const productId =
        payload.product_id !== undefined
          ? toInt(payload.product_id, "product_id")
          : current.product_id;
      const unitsSold =
        payload.units_sold !== undefined
          ? toPositiveInt(payload.units_sold, "units_sold")
          : current.units_sold;
      const unitSellPriceEgp =
        payload.unit_sell_price_egp !== undefined
          ? toNonNegativeNumber(payload.unit_sell_price_egp, "unit_sell_price_egp")
          : current.unit_sell_price_egp;
      const soldAt =
        payload.sold_at !== undefined
          ? toUtcIsoFromInput(payload.sold_at, "sold_at")
          : current.sold_at;

      let availableStock = getFinishedStockQty(productId);
      if (productId === current.product_id) {
        availableStock += current.units_sold;
      }
      if (availableStock < unitsSold) {
        throw new Error(`Insufficient finished product stock. Available: ${availableStock}`);
      }

      reverseLedgerForReference("sale", recordId);
      const metrics = calculateSaleMetrics(productId, unitsSold, unitSellPriceEgp);

      db.prepare(
        `
        UPDATE sales_records
        SET product_id = ?,
            units_sold = ?,
            unit_sell_price_egp = ?,
            unit_purchase_cost_egp = ?,
            total_purchase_cost_egp = ?,
            revenue_egp = ?,
            gross_profit_egp = ?,
            margin_pct = ?,
            sold_at = ?,
            updated_at = ?
        WHERE id = ?
      `
      ).run(
        productId,
        unitsSold,
        unitSellPriceEgp,
        metrics.unitPurchaseCostEgp,
        metrics.totalPurchaseCostEgp,
        metrics.revenueEgp,
        metrics.grossProfitEgp,
        metrics.marginPct,
        soldAt,
        nowIso(),
        recordId
      );

      applySale(recordId, productId, unitsSold);

      return db
        .prepare(
          `
          SELECT sr.*, p.name AS product_name
          FROM sales_records sr
          JOIN products p ON p.id = sr.product_id
          WHERE sr.id = ?
        `
        )
        .get(recordId);
    });

    const updated = tx(req.body);
    res.json(updated);
  })
);

app.delete(
  "/sales-records/:id",
  runRoute((req, res) => {
    const recordId = toInt(req.params.id, "id");
    const tx = db.transaction((id) => {
      const current = db.prepare(`SELECT * FROM sales_records WHERE id = ?`).get(id);
      if (!current) {
        throw new Error("Sales record not found");
      }
      reverseLedgerForReference("sale", id);
      db.prepare(`DELETE FROM sales_records WHERE id = ?`).run(id);
    });
    tx(recordId);
    res.json({ success: true });
  })
);

app.get(
  "/damage-records",
  runRoute((_req, res) => {
    const rows = db
      .prepare(
        `
        SELECT dr.*, c.item_name
        FROM damage_records dr
        JOIN components c ON c.id = dr.component_id
        ORDER BY dr.damaged_at DESC
      `
      )
      .all();
    res.json(rows);
  })
);

app.post(
  "/damage-records",
  runRoute((req, res) => {
    const tx = db.transaction((payload) => {
      const componentId = toInt(payload.component_id, "component_id");
      const qtyDamaged = toPositiveInt(payload.qty_damaged, "qty_damaged");
      const damagedAt = toUtcIsoFromInput(payload.damaged_at, "damaged_at");
      const notes = payload.notes ? String(payload.notes).trim() : null;

      if (!getComponentById(componentId)) {
        throw new Error("Component not found");
      }

      const now = nowIso();
      const info = db
        .prepare(
          `
          INSERT INTO damage_records
            (component_id, qty_damaged, damaged_at, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        )
        .run(componentId, qtyDamaged, damagedAt, notes, now, now);

      const recordId = Number(info.lastInsertRowid);
      applyDamage(recordId, componentId, qtyDamaged);
      return getDamageRecordById(recordId);
    });

    const created = tx(req.body);
    res.status(201).json(created);
  })
);

app.put(
  "/damage-records/:id",
  runRoute((req, res) => {
    const recordId = toInt(req.params.id, "id");

    const tx = db.transaction((payload) => {
      const current = db.prepare(`SELECT * FROM damage_records WHERE id = ?`).get(recordId);
      if (!current) {
        throw new Error("Damage record not found");
      }

      const componentId =
        payload.component_id !== undefined
          ? toInt(payload.component_id, "component_id")
          : current.component_id;
      const qtyDamaged =
        payload.qty_damaged !== undefined
          ? toPositiveInt(payload.qty_damaged, "qty_damaged")
          : current.qty_damaged;
      const damagedAt =
        payload.damaged_at !== undefined
          ? toUtcIsoFromInput(payload.damaged_at, "damaged_at")
          : current.damaged_at;
      const notes =
        payload.notes !== undefined
          ? payload.notes
            ? String(payload.notes).trim()
            : null
          : current.notes;

      if (!getComponentById(componentId)) {
        throw new Error("Component not found");
      }

      reverseLedgerForReference("damage", recordId);

      db.prepare(
        `
        UPDATE damage_records
        SET component_id = ?, qty_damaged = ?, damaged_at = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `
      ).run(componentId, qtyDamaged, damagedAt, notes, nowIso(), recordId);

      applyDamage(recordId, componentId, qtyDamaged);

      return getDamageRecordById(recordId);
    });

    const updated = tx(req.body);
    res.json(updated);
  })
);

app.delete(
  "/damage-records/:id",
  runRoute((req, res) => {
    const recordId = toInt(req.params.id, "id");
    const tx = db.transaction((id) => {
      const current = db.prepare(`SELECT * FROM damage_records WHERE id = ?`).get(id);
      if (!current) {
        throw new Error("Damage record not found");
      }
      reverseLedgerForReference("damage", id);
      db.prepare(`DELETE FROM damage_records WHERE id = ?`).run(id);
    });

    tx(recordId);
    res.json({ success: true });
  })
);

app.get(
  "/shortages",
  runRoute((_req, res) => {
    const rows = db
      .prepare(
        `
        SELECT c.*, s.name AS supplier_name
        FROM components c
        LEFT JOIN suppliers s ON s.id = c.supplier_id
        WHERE c.stock_qty <= 5
        ORDER BY c.stock_qty ASC, c.item_name COLLATE NOCASE
      `
      )
      .all();
    res.json(rows);
  })
);

app.get(
  "/inventory/search",
  runRoute((req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    if (!q) {
      return res.json([]);
    }

    const rows = db
      .prepare(
        `
        SELECT type, id, name
        FROM (
          SELECT 'component' AS type, c.id AS id, c.item_name AS name
          FROM components c
          WHERE c.item_name_normalized LIKE ?

          UNION ALL

          SELECT 'product' AS type, p.id AS id, p.name AS name
          FROM products p
          WHERE lower(trim(p.name)) LIKE ?
        )
        ORDER BY name COLLATE NOCASE
        LIMIT 20
      `
      )
      .all(`%${q}%`, `%${q}%`);

    res.json(rows);
  })
);

app.get(
  "/inventory/item",
  runRoute((req, res) => {
    const type = String(req.query.type || "").trim().toLowerCase();
    const id = toInt(req.query.id, "id");

    if (type === "component") {
      const row = db
        .prepare(
          `
          SELECT
            c.id,
            c.item_name AS name,
            c.stock_qty,
            s.name AS supplier_name,
            (
              SELECT cir.received_at
              FROM component_intake_records cir
              WHERE cir.component_id = c.id
              ORDER BY cir.received_at DESC, cir.id DESC
              LIMIT 1
            ) AS last_purchased_at
          FROM components c
          LEFT JOIN suppliers s ON s.id = c.supplier_id
          WHERE c.id = ?
        `
        )
        .get(id);
      if (!row) {
        throw new Error("Component not found");
      }
      return res.json({ type, ...row });
    }

    if (type === "product") {
      const row = db
        .prepare(
          `
          SELECT
            p.id,
            p.name,
            COALESCE(fs.stock_qty, 0) AS stock_qty,
            (
              SELECT mr.produced_at
              FROM manufacturing_records mr
              WHERE mr.product_id = p.id
              ORDER BY mr.produced_at DESC, mr.id DESC
              LIMIT 1
            ) AS last_manufactured_at
          FROM products p
          LEFT JOIN finished_stock fs ON fs.product_id = p.id
          WHERE p.id = ?
        `
        )
        .get(id);
      if (!row) {
        throw new Error("Product not found");
      }
      return res.json({ type, ...row });
    }

    throw new Error("type must be either 'component' or 'product'");
  })
);

app.get(
  "/reports/sales",
  runRoute((req, res) => {
    const period = String(req.query.period || "daily");
    const valid = new Set(["daily", "weekly", "monthly", "yearly", "specific_day", "date_range"]);
    if (!valid.has(period)) {
      throw new Error("Invalid period");
    }
    const report = buildSalesReport(period, req.query);
    res.json(report);
  })
);

app.get(
  "/reports/sales.csv",
  runRoute((req, res) => {
    const period = String(req.query.period || "daily");
    const report = buildSalesReport(period, req.query);
    const csv = reportToCsv(report);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"sales-report-${period}-${DateTime.now().toFormat("yyyyLLdd-HHmmss")}.csv\"`
    );
    res.send(csv);
  })
);

app.get(
  "/settings/language",
  runRoute((_req, res) => {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'language'`).get();
    res.json({ language: row ? row.value : "en" });
  })
);

app.put(
  "/settings/language",
  runRoute((req, res) => {
    const language = String(req.body.language || "").trim();
    if (!["en", "ar"].includes(language)) {
      throw new Error("language must be 'en' or 'ar'");
    }
    db.prepare(
      `
      INSERT INTO settings (key, value, updated_at)
      VALUES ('language', ?, ?)
      ON CONFLICT(key)
      DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `
    ).run(language, nowIso());
    res.json({ language });
  })
);

if (frontendDir && fs.existsSync(path.join(frontendDir, "index.html"))) {
  app.use("/app", express.static(frontendDir));

  app.get("/", (_req, res) => {
    res.redirect("/app");
  });

  app.get("/app", (_req, res) => {
    res.sendFile(path.join(frontendDir, "index.html"));
  });

  app.get("/app/*", (_req, res) => {
    res.sendFile(path.join(frontendDir, "index.html"));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.use((error, _req, res, _next) => {
  if (error && typeof error.message === "string") {
    return res.status(400).json({ error: error.message });
  }
  return res.status(500).json({ error: "Unexpected server error" });
});

app.listen(PORT, () => {
  console.log(`Diamond Printers API running on http://localhost:${PORT}`);
});
