import { DateTime } from "luxon";

const DATA_API_URL = import.meta.env.VITE_DATA_API_URL || "/api/data";

const CAIRO_TZ = "Africa/Cairo";
const AUTH_USERNAME = "ahmed";
const AUTH_PASSWORD = "123456789";
const AUTH_STORAGE_KEY = "diamond_printers_auth";

function nowIso() {
  return new Date().toISOString();
}

function withStatus(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function requireName(value, field = "name") {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${field} is required`);
  }
  return text;
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

function parsePath(rawPath) {
  const url = new URL(rawPath, "https://diamond-printers.local");
  return { pathname: url.pathname, query: Object.fromEntries(url.searchParams.entries()) };
}

function getAuthState() {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY) === "1";
  } catch (_) {
    return false;
  }
}

function setAuthState(value) {
  try {
    if (value) {
      localStorage.setItem(AUTH_STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch (_) {
    // Ignore storage errors.
  }
}

function ensureAuthenticated(pathname) {
  if (pathname === "/auth/status" || pathname === "/auth/login") {
    return;
  }
  if (!getAuthState()) {
    throw withStatus(401, "Authentication required");
  }
}

async function selectRows(table, options = {}) {
  return databaseRequest({ action: "select", table, ...options });
}

async function selectSingle(table, options = {}) {
  const rows = await selectRows(table, { ...options, limit: 1 });
  return rows[0] || null;
}

async function insertRow(table, payload) {
  const rows = await databaseRequest({ action: "insert", table, payload });
  return rows[0] || null;
}

async function updateRows(table, payload, eq = []) {
  return databaseRequest({ action: "update", table, payload, eq });
}

async function deleteRows(table, eq = []) {
  return databaseRequest({ action: "delete", table, eq });
}

async function databaseRequest(payload) {
  const response = await fetch(DATA_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Database request failed");
  return result.data || [];
}

async function getSuppliers() {
  return selectRows("suppliers", { order: [["name", true]] });
}

async function getComponentsRaw() {
  return selectRows("components", { order: [["item_name", true]] });
}

async function getProductsRaw() {
  return selectRows("products", { order: [["name", true]] });
}

async function getProductById(productId) {
  return selectSingle("products", { eq: [["id", productId]] });
}

async function getComponentById(componentId) {
  const [component, suppliers] = await Promise.all([
    selectSingle("components", { eq: [["id", componentId]] }),
    getSuppliers(),
  ]);
  if (!component) return null;
  return {
    ...component,
    supplier_name: suppliers.find((row) => row.id === component.supplier_id)?.name || null,
  };
}

async function getFinishedStockQty(productId) {
  const row = await selectSingle("finished_stock", { eq: [["product_id", productId]] });
  return row ? row.stock_qty : 0;
}

async function upsertFinishedStock(productId, newQty) {
  const existing = await selectSingle("finished_stock", { eq: [["product_id", productId]] });
  if (existing) {
    await updateRows("finished_stock", { stock_qty: newQty, updated_at: nowIso() }, [["product_id", productId]]);
  } else {
    await insertRow("finished_stock", { product_id: productId, stock_qty: newQty, updated_at: nowIso() });
  }
}

async function updateComponentStock(componentId, deltaQty) {
  const component = await selectSingle("components", { eq: [["id", componentId]] });
  if (!component) throw new Error("Component not found");
  const nextQty = component.stock_qty + deltaQty;
  if (nextQty < 0) throw new Error("Insufficient component stock");
  await updateRows("components", { stock_qty: nextQty, updated_at: nowIso() }, [["id", componentId]]);
  return nextQty;
}

async function updateFinishedStock(productId, deltaQty) {
  const current = await getFinishedStockQty(productId);
  const nextQty = current + deltaQty;
  if (nextQty < 0) throw new Error("Insufficient finished product stock");
  await upsertFinishedStock(productId, nextQty);
  return nextQty;
}

async function insertLedger(entry) {
  await insertRow("inventory_ledger", {
    item_type: entry.itemType,
    item_id: entry.itemId,
    delta_qty: entry.deltaQty,
    reason: entry.reason,
    reference_type: entry.referenceType,
    reference_id: entry.referenceId,
    reversed: false,
    reversed_from_id: entry.reversedFromId || null,
    created_at: nowIso(),
  });
}

async function reverseLedgerForReference(referenceType, referenceId) {
  const rows = await selectRows("inventory_ledger", {
    eq: [
      ["reference_type", referenceType],
      ["reference_id", referenceId],
      ["reversed", false],
    ],
    order: [["id", false]],
  });
  for (const row of rows.filter((item) => item.reason !== "reversal")) {
    const reverseDelta = -row.delta_qty;
    if (row.item_type === "component") {
      await updateComponentStock(row.item_id, reverseDelta);
    } else {
      await updateFinishedStock(row.item_id, reverseDelta);
    }
    await insertLedger({
      itemType: row.item_type,
      itemId: row.item_id,
      deltaQty: reverseDelta,
      reason: "reversal",
      referenceType,
      referenceId,
      reversedFromId: row.id,
    });
    await updateRows("inventory_ledger", { reversed: true }, [["id", row.id]]);
  }
}

async function appendPriceHistory(componentId, supplierId, priceEgp, effectiveAt) {
  if (priceEgp === undefined || priceEgp === null || priceEgp === "") return;
  const rows = await selectRows("component_price_history", { eq: [["component_id", componentId]] });
  for (const row of rows.filter((item) => item.is_active)) {
    await updateRows("component_price_history", { is_active: false }, [["id", row.id]]);
  }
  await insertRow("component_price_history", {
    component_id: componentId,
    supplier_id: supplierId || null,
    price_egp: toNonNegativeNumber(priceEgp, "price_egp"),
    effective_at: effectiveAt || nowIso(),
    is_active: true,
    created_at: nowIso(),
  });
}

async function getLatestPriceForComponent(componentId) {
  const rows = await selectRows("component_price_history", {
    eq: [
      ["component_id", componentId],
      ["is_active", true],
    ],
    order: [
      ["effective_at", false],
      ["id", false],
    ],
    limit: 1,
  });
  return rows[0] || null;
}

async function getBomItems(productId) {
  const [rows, components] = await Promise.all([
    selectRows("bom_items", { eq: [["product_id", productId]], order: [["id", true]] }),
    getComponentsRaw(),
  ]);
  const componentMap = new Map(components.map((row) => [row.id, row]));
  return rows
    .map((row) => ({
      ...row,
      item_name: componentMap.get(row.component_id)?.item_name || "",
      stock_qty: componentMap.get(row.component_id)?.stock_qty ?? 0,
    }))
    .sort((a, b) => a.item_name.localeCompare(b.item_name));
}

async function getPurchaseHistory(componentId) {
  const [rows, components, suppliers] = await Promise.all([
    selectRows("component_intake_records", {
      eq: [["component_id", componentId]],
      order: [
        ["received_at", false],
        ["id", false],
      ],
    }),
    getComponentsRaw(),
    getSuppliers(),
  ]);
  const componentMap = new Map(components.map((row) => [row.id, row]));
  const supplierMap = new Map(suppliers.map((row) => [row.id, row]));
  return rows.map((row) => ({
    ...row,
    price_egp: row.unit_price_egp,
    item_name: componentMap.get(row.component_id)?.item_name || null,
    supplier_name: supplierMap.get(row.supplier_id)?.name || null,
  }));
}

async function getComponentsWithDerivedFields() {
  const [components, suppliers, prices] = await Promise.all([
    getComponentsRaw(),
    getSuppliers(),
    selectRows("component_price_history"),
  ]);
  const supplierMap = new Map(suppliers.map((row) => [row.id, row]));
  const latestPriceMap = new Map();
  for (const row of prices.filter((item) => item.is_active)) {
    const current = latestPriceMap.get(row.component_id);
    if (!current || row.effective_at > current.effective_at || row.id > current.id) {
      latestPriceMap.set(row.component_id, row);
    }
  }
  return components.map((row) => ({
    ...row,
    supplier_name: supplierMap.get(row.supplier_id)?.name || null,
    latest_price_egp: latestPriceMap.get(row.id)?.price_egp ?? null,
    latest_price_supplier_id: latestPriceMap.get(row.id)?.supplier_id ?? null,
  }));
}

async function getProductsWithStock() {
  const [products, stockRows] = await Promise.all([getProductsRaw(), selectRows("finished_stock")]);
  const stockMap = new Map(stockRows.map((row) => [row.product_id, row.stock_qty]));
  return products.map((row) => ({ ...row, finished_stock_qty: stockMap.get(row.id) ?? 0 }));
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
  const normalized = anchor.setZone(CAIRO_TZ);
  if (period === "daily" || period === "specific_day") {
    return { start: normalized.startOf("day"), end: normalized.endOf("day") };
  }
  if (period === "weekly") {
    const offset = (normalized.weekday + 1) % 7;
    const start = normalized.startOf("day").minus({ days: offset });
    return { start, end: start.plus({ days: 6 }).endOf("day") };
  }
  if (period === "monthly") {
    return { start: normalized.startOf("month"), end: normalized.endOf("month") };
  }
  if (period === "yearly") {
    return { start: normalized.startOf("year"), end: normalized.endOf("year") };
  }
  throw new Error("Unsupported period");
}

function bucketKeyForRecord(dt, period) {
  if (period === "yearly") return dt.toFormat("yyyy-LL");
  if (period === "monthly") {
    const offset = (dt.weekday + 1) % 7;
    return dt.startOf("day").minus({ days: offset }).toFormat("yyyy-LL-dd");
  }
  return dt.toFormat("yyyy-LL-dd");
}

function buildCsv(report) {
  const lines = [
    ["bucket", "revenue_egp", "purchase_cost_egp", "gross_profit_egp", "units_sold", "avg_margin_pct"].join(","),
    ...report.buckets.map((bucket) =>
      [bucket.bucket, bucket.revenue_egp, bucket.purchase_cost_egp, bucket.gross_profit_egp, bucket.units_sold, bucket.avg_margin_pct].join(",")
    ),
    "",
    ["summary", "", "", "", "", ""].join(","),
    ["revenue_egp", report.summary.revenue_egp].join(","),
    ["purchase_cost_egp", report.summary.purchase_cost_egp].join(","),
    ["gross_profit_egp", report.summary.gross_profit_egp].join(","),
    ["units_sold", report.summary.units_sold].join(","),
    ["avg_margin_pct", report.summary.avg_margin_pct].join(","),
  ];
  return lines.join("\n");
}

async function applyManufacturing(recordId, productId, unitsProduced) {
  const bomItems = await getBomItems(productId);
  if (!bomItems.length) throw new Error("Product does not have BOM items");
  for (const item of bomItems) {
    const needed = item.qty_per_unit * unitsProduced;
    if (item.stock_qty < needed) {
      throw new Error(`Insufficient stock for component: ${item.item_name}`);
    }
  }
  for (const item of bomItems) {
    const needed = item.qty_per_unit * unitsProduced;
    await updateComponentStock(item.component_id, -needed);
    await insertLedger({
      itemType: "component",
      itemId: item.component_id,
      deltaQty: -needed,
      reason: "manufacture",
      referenceType: "manufacturing",
      referenceId: recordId,
    });
  }
  await updateFinishedStock(productId, unitsProduced);
  await insertLedger({
    itemType: "finished",
    itemId: productId,
    deltaQty: unitsProduced,
    reason: "manufacture",
    referenceType: "manufacturing",
    referenceId: recordId,
  });
}

async function calculateSaleMetrics(productId, unitsSold, unitSellPriceEgp) {
  const bomItems = await getBomItems(productId);
  if (!bomItems.length) throw new Error("Product does not have BOM items");
  let unitPurchaseCost = 0;
  for (const item of bomItems) {
    const latestPrice = await getLatestPriceForComponent(item.component_id);
    if (!latestPrice) {
      throw new Error(`Missing active price for component: ${item.item_name}`);
    }
    unitPurchaseCost += item.qty_per_unit * latestPrice.price_egp;
  }
  const unitPurchaseCostEgp = round2(unitPurchaseCost);
  const totalPurchaseCostEgp = round2(unitPurchaseCostEgp * unitsSold);
  const revenueEgp = round2(unitSellPriceEgp * unitsSold);
  const grossProfitEgp = round2(revenueEgp - totalPurchaseCostEgp);
  const marginPct = revenueEgp === 0 ? 0 : round2((grossProfitEgp / revenueEgp) * 100);
  return { unitPurchaseCostEgp, totalPurchaseCostEgp, revenueEgp, grossProfitEgp, marginPct };
}

async function applySale(recordId, productId, unitsSold) {
  await updateFinishedStock(productId, -unitsSold);
  await insertLedger({
    itemType: "finished",
    itemId: productId,
    deltaQty: -unitsSold,
    reason: "sale",
    referenceType: "sale",
    referenceId: recordId,
  });
}

async function applyDamage(recordId, componentId, qtyDamaged) {
  await updateComponentStock(componentId, -qtyDamaged);
  await insertLedger({
    itemType: "component",
    itemId: componentId,
    deltaQty: -qtyDamaged,
    reason: "adjustment",
    referenceType: "damage",
    referenceId: recordId,
  });
}

async function applyComponentIntake(recordId, componentId, qtyReceived) {
  await updateComponentStock(componentId, qtyReceived);
  await insertLedger({
    itemType: "component",
    itemId: componentId,
    deltaQty: qtyReceived,
    reason: "receipt",
    referenceType: "component_intake",
    referenceId: recordId,
  });
}

async function buildDamagedReport(period, query, rangeOverride = null) {
  const { start, end } = rangeOverride || getDateRange(period, query);
  const [rows, components] = await Promise.all([
    selectRows("damage_records", { order: [["damaged_at", true]] }),
    getComponentsRaw(),
  ]);
  const componentMap = new Map(components.map((row) => [row.id, row]));
  const filtered = [];
  for (const row of rows) {
    const damagedAt = DateTime.fromISO(row.damaged_at, { zone: "utc" }).setZone(CAIRO_TZ);
    if (damagedAt >= start && damagedAt <= end) {
      filtered.push({
        ...row,
        item_name: componentMap.get(row.component_id)?.item_name || "",
        damaged_at_cairo: damagedAt.toISO(),
      });
    }
  }
  const buckets = new Map();
  let totalDamagedQty = 0;
  for (const row of filtered) {
    totalDamagedQty += row.qty_damaged;
    const key = bucketKeyForRecord(
      DateTime.fromISO(row.damaged_at, { zone: "utc" }).setZone(CAIRO_TZ),
      period
    );
    if (!buckets.has(key)) {
      buckets.set(key, { bucket: key, damaged_qty: 0, records_count: 0 });
    }
    const bucket = buckets.get(key);
    bucket.damaged_qty += row.qty_damaged;
    bucket.records_count += 1;
  }
  return {
    period,
    timezone: CAIRO_TZ,
    start_cairo: start.toISO(),
    end_cairo: end.toISO(),
    summary: { damaged_qty: totalDamagedQty, records_count: filtered.length },
    buckets: Array.from(buckets.values()).sort((a, b) => (a.bucket > b.bucket ? 1 : -1)),
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

async function buildSalesReport(period, query) {
  const { start, end } = getDateRange(period, query);
  const [rows, products] = await Promise.all([
    selectRows("sales_records", { order: [["sold_at", true]] }),
    getProductsRaw(),
  ]);
  const productMap = new Map(products.map((row) => [row.id, row]));
  const filtered = [];
  for (const row of rows) {
    const soldAt = DateTime.fromISO(row.sold_at, { zone: "utc" }).setZone(CAIRO_TZ);
    if (soldAt >= start && soldAt <= end) {
      filtered.push({
        ...row,
        product_name: productMap.get(row.product_id)?.name || "",
        sold_at_cairo: soldAt.toISO(),
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
    const key = bucketKeyForRecord(DateTime.fromISO(row.sold_at, { zone: "utc" }).setZone(CAIRO_TZ), period);
    if (!buckets.has(key)) {
      buckets.set(key, { bucket: key, revenue_egp: 0, purchase_cost_egp: 0, gross_profit_egp: 0, units_sold: 0 });
    }
    const bucket = buckets.get(key);
    bucket.revenue_egp += row.revenue_egp;
    bucket.purchase_cost_egp += row.total_purchase_cost_egp;
    bucket.gross_profit_egp += row.gross_profit_egp;
    bucket.units_sold += row.units_sold;
  }
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
    buckets: Array.from(buckets.values())
      .sort((a, b) => (a.bucket > b.bucket ? 1 : -1))
      .map((row) => ({
        ...row,
        revenue_egp: round2(row.revenue_egp),
        purchase_cost_egp: round2(row.purchase_cost_egp),
        gross_profit_egp: round2(row.gross_profit_egp),
        avg_margin_pct: row.revenue_egp === 0 ? 0 : round2((row.gross_profit_egp / row.revenue_egp) * 100),
      })),
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
    damaged: await buildDamagedReport(period, query, { start, end }),
  };
}

async function handleGet(pathname, query) {
  if (pathname === "/auth/status") {
    return { authenticated: getAuthState(), username: getAuthState() ? AUTH_USERNAME : undefined };
  }
  if (pathname === "/settings/language") {
    const row = await selectSingle("settings", { eq: [["key", "language"]] });
    return { language: row?.value || "en" };
  }
  if (pathname === "/suppliers") return getSuppliers();
  if (pathname === "/components") return getComponentsWithDerivedFields();
  if (pathname === "/components/search") {
    const q = normalizeName(query.q || "");
    if (!q) return [];
    return (await getComponentsRaw())
      .filter((row) => row.item_name_normalized.includes(q))
      .slice(0, 20)
      .map((row) => ({ id: row.id, item_name: row.item_name, stock_qty: row.stock_qty }));
  }
  if (pathname.startsWith("/components/") && pathname.endsWith("/purchase-history")) {
    return getPurchaseHistory(toInt(pathname.split("/")[2], "id"));
  }
  if (pathname === "/products") return getProductsWithStock();
  if (pathname.startsWith("/products/") && pathname.endsWith("/bom")) {
    return getBomItems(toInt(pathname.split("/")[2], "id"));
  }
  if (pathname === "/manufacturing-records") {
    const [rows, products] = await Promise.all([
      selectRows("manufacturing_records", { order: [["produced_at", false]] }),
      getProductsRaw(),
    ]);
    const productMap = new Map(products.map((row) => [row.id, row]));
    return rows.map((row) => ({ ...row, product_name: productMap.get(row.product_id)?.name || "" }));
  }
  if (pathname === "/sales-records") {
    const [rows, products] = await Promise.all([
      selectRows("sales_records", { order: [["sold_at", false]] }),
      getProductsRaw(),
    ]);
    const productMap = new Map(products.map((row) => [row.id, row]));
    return rows.map((row) => ({ ...row, product_name: productMap.get(row.product_id)?.name || "" }));
  }
  if (pathname === "/damage-records") {
    const [rows, components] = await Promise.all([
      selectRows("damage_records", { order: [["damaged_at", false]] }),
      getComponentsRaw(),
    ]);
    const componentMap = new Map(components.map((row) => [row.id, row]));
    return rows.map((row) => ({ ...row, item_name: componentMap.get(row.component_id)?.item_name || "" }));
  }
  if (pathname === "/shortages") {
    return (await getComponentsWithDerivedFields())
      .filter((row) => row.stock_qty < 1)
      .sort((a, b) => (a.stock_qty - b.stock_qty) || a.item_name.localeCompare(b.item_name));
  }
  if (pathname === "/inventory/search") {
    const q = normalizeName(query.q || "");
    if (!q) return [];
    const [components, products] = await Promise.all([getComponentsRaw(), getProductsRaw()]);
    return [
      ...components.filter((row) => row.item_name_normalized.includes(q)).map((row) => ({ type: "component", id: row.id, name: row.item_name })),
      ...products.filter((row) => normalizeName(row.name).includes(q)).map((row) => ({ type: "product", id: row.id, name: row.name })),
    ].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20);
  }
  if (pathname === "/inventory/item") {
    const id = toInt(query.id, "id");
    if (String(query.type).toLowerCase() === "component") {
      const [component, suppliers, intakeRows] = await Promise.all([
        selectSingle("components", { eq: [["id", id]] }),
        getSuppliers(),
        selectRows("component_intake_records", { eq: [["component_id", id]], order: [["received_at", false], ["id", false]], limit: 1 }),
      ]);
      if (!component) throw new Error("Component not found");
      return {
        type: "component",
        id: component.id,
        name: component.item_name,
        stock_qty: component.stock_qty,
        supplier_name: suppliers.find((row) => row.id === component.supplier_id)?.name || null,
        last_purchased_at: intakeRows[0]?.received_at || null,
      };
    }
    if (String(query.type).toLowerCase() === "product") {
      const [product, rows] = await Promise.all([
        selectSingle("products", { eq: [["id", id]] }),
        selectRows("manufacturing_records", { eq: [["product_id", id]], order: [["produced_at", false], ["id", false]], limit: 1 }),
      ]);
      if (!product) throw new Error("Product not found");
      return { type: "product", id: product.id, name: product.name, stock_qty: await getFinishedStockQty(id), last_manufactured_at: rows[0]?.produced_at || null };
    }
    throw new Error("type must be either 'component' or 'product'");
  }
  if (pathname === "/reports/sales") return buildSalesReport(query.period || "daily", query);
  if (pathname === "/reports/sales.csv") return buildCsv(await buildSalesReport(query.period || "daily", query));
  throw withStatus(404, `Route not found: GET ${pathname}`);
}

async function handlePost(pathname, body) {
  if (pathname === "/auth/login") {
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (username !== AUTH_USERNAME || password !== AUTH_PASSWORD) throw new Error("Invalid username or password");
    setAuthState(true);
    return { success: true, username: AUTH_USERNAME };
  }
  if (pathname === "/auth/logout") {
    setAuthState(false);
    return { success: true };
  }
  if (pathname === "/suppliers") {
    const now = nowIso();
    return insertRow("suppliers", {
      name: requireName(body.name, "name"),
      phone: body.phone ? String(body.phone).trim() : null,
      email: body.email ? String(body.email).trim() : null,
      created_at: now,
      updated_at: now,
    });
  }
  if (pathname === "/products") {
    const now = nowIso();
    const created = await insertRow("products", {
      name: requireName(body.name, "name"),
      created_at: now,
      updated_at: now,
    });
    await upsertFinishedStock(created.id, 0);
    return created;
  }
  if (pathname.startsWith("/products/") && pathname.endsWith("/bom")) {
    const productId = toInt(pathname.split("/")[2], "id");
    const componentId = toInt(body.component_id, "component_id");
    const qtyPerUnit = toPositiveInt(body.qty_per_unit, "qty_per_unit");
    const existing = await selectSingle("bom_items", { eq: [["product_id", productId], ["component_id", componentId]] });
    if (existing) {
      await updateRows("bom_items", { qty_per_unit: qtyPerUnit, updated_at: nowIso() }, [["id", existing.id]]);
    } else {
      await insertRow("bom_items", {
        product_id: productId,
        component_id: componentId,
        qty_per_unit: qtyPerUnit,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }
    return getBomItems(productId);
  }
  if (pathname === "/manufacturing-records") {
    const productId = toInt(body.product_id, "product_id");
    const unitsProduced = toPositiveInt(body.units_produced, "units_produced");
    const producedAt = toUtcIsoFromInput(body.produced_at, "produced_at");
    if (!(await getProductById(productId))) throw new Error("Product not found");
    const created = await insertRow("manufacturing_records", {
      product_id: productId,
      units_produced: unitsProduced,
      produced_at: producedAt,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    await applyManufacturing(created.id, productId, unitsProduced);
    return { ...created, product_name: (await getProductById(productId))?.name || "" };
  }
  if (pathname === "/sales-records") {
    const productId = toInt(body.product_id, "product_id");
    const unitsSold = toPositiveInt(body.units_sold, "units_sold");
    const unitSellPriceEgp = toNonNegativeNumber(body.unit_sell_price_egp, "unit_sell_price_egp");
    const soldAt = toUtcIsoFromInput(body.sold_at, "sold_at");
    if (!(await getProductById(productId))) throw new Error("Product not found");
    const metrics = await calculateSaleMetrics(productId, unitsSold, unitSellPriceEgp);
    const created = await insertRow("sales_records", {
      product_id: productId,
      units_sold: unitsSold,
      unit_sell_price_egp: unitSellPriceEgp,
      unit_purchase_cost_egp: metrics.unitPurchaseCostEgp,
      total_purchase_cost_egp: metrics.totalPurchaseCostEgp,
      revenue_egp: metrics.revenueEgp,
      gross_profit_egp: metrics.grossProfitEgp,
      margin_pct: metrics.marginPct,
      sold_at: soldAt,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    await applySale(created.id, productId, unitsSold);
    return { ...created, product_name: (await getProductById(productId))?.name || "" };
  }
  if (pathname === "/damage-records") {
    const componentId = toInt(body.component_id, "component_id");
    const qtyDamaged = toPositiveInt(body.qty_damaged, "qty_damaged");
    const damagedAt = toUtcIsoFromInput(body.damaged_at, "damaged_at");
    if (!(await getComponentById(componentId))) throw new Error("Component not found");
    const created = await insertRow("damage_records", {
      component_id: componentId,
      qty_damaged: qtyDamaged,
      damaged_at: damagedAt,
      notes: body.notes ? String(body.notes).trim() : null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    await applyDamage(created.id, componentId, qtyDamaged);
    return { ...created, item_name: (await getComponentById(componentId))?.item_name || "" };
  }
  if (pathname === "/components/intake") {
    const qty = toPositiveInt(body.qty, "qty");
    const explicitDecision = body.decision !== undefined ? String(body.decision || "").trim() : "";
    const supplierId = body.supplier_id ? toInt(body.supplier_id, "supplier_id") : null;
    const purchaseLink = body.purchase_link ? String(body.purchase_link).trim() : null;
    const name = body.name ? requireName(body.name, "name") : "";
    const receivedAt = toUtcIsoFromInput(body.received_at, "received_at");
    let componentId = null;
    const decision = explicitDecision || (body.existing_component_id ? "existing" : "new");
    if (decision === "existing") {
      componentId = body.existing_component_id ? toInt(body.existing_component_id, "existing_component_id") : null;
      if (!componentId && name) {
        componentId = (await selectSingle("components", { eq: [["item_name_normalized", normalizeName(name)]] }))?.id || null;
      }
      if (!componentId) throw new Error("Existing component must be selected");
    } else if (decision === "new") {
      if (!name) throw new Error("name is required when creating a new component");
      if (await selectSingle("components", { eq: [["item_name_normalized", normalizeName(name)]] })) {
        throw new Error("Component already exists. Choose existing decision.");
      }
      componentId = (
        await insertRow("components", {
          item_name: name,
          item_name_normalized: normalizeName(name),
          stock_qty: 0,
          supplier_id: supplierId,
          purchase_link: purchaseLink,
          created_at: nowIso(),
          updated_at: nowIso(),
        })
      ).id;
    } else {
      throw new Error("decision must be either 'existing' or 'new'");
    }
    const intakeRecord = await insertRow("component_intake_records", {
      component_id: componentId,
      qty_received: qty,
      supplier_id: supplierId,
      purchase_link: purchaseLink,
      unit_price_egp: body.price_egp !== undefined && body.price_egp !== null ? toNonNegativeNumber(body.price_egp, "price_egp") : null,
      received_at: receivedAt,
      created_at: nowIso(),
    });
    await applyComponentIntake(intakeRecord.id, componentId, qty);
    if (supplierId || purchaseLink) {
      const component = await selectSingle("components", { eq: [["id", componentId]] });
      await updateRows("components", {
        supplier_id: supplierId || component.supplier_id,
        purchase_link: purchaseLink || component.purchase_link,
        updated_at: receivedAt,
      }, [["id", componentId]]);
    }
    await appendPriceHistory(componentId, supplierId, body.price_egp, receivedAt);
    return getComponentById(componentId);
  }
  throw withStatus(404, `Route not found: POST ${pathname}`);
}

async function handlePut(pathname, body) {
  if (pathname === "/settings/language") {
    const language = String(body.language || "").trim();
    if (!["en", "ar"].includes(language)) throw new Error("language must be 'en' or 'ar'");
    const existing = await selectSingle("settings", { eq: [["key", "language"]] });
    if (existing) {
      await updateRows("settings", { value: language, updated_at: nowIso() }, [["key", "language"]]);
    } else {
      await insertRow("settings", { key: "language", value: language, updated_at: nowIso() });
    }
    return { language };
  }
  if (pathname.startsWith("/suppliers/")) {
    const supplierId = toInt(pathname.split("/")[2], "id");
    const current = await selectSingle("suppliers", { eq: [["id", supplierId]] });
    if (!current) throw withStatus(404, "Supplier not found");
    return (await updateRows("suppliers", {
      name: body.name !== undefined ? requireName(body.name, "name") : current.name,
      phone: body.phone !== undefined ? body.phone || null : current.phone,
      email: body.email !== undefined ? body.email || null : current.email,
      updated_at: nowIso(),
    }, [["id", supplierId]]))[0];
  }
  if (pathname.startsWith("/components/intake-records/")) {
    const recordId = toInt(pathname.split("/")[3], "id");
    const current = await selectSingle("component_intake_records", { eq: [["id", recordId]] });
    if (!current) throw new Error("Intake record not found");
    const componentId = body.component_id !== undefined ? toInt(body.component_id, "component_id") : current.component_id;
    const qtyReceived = body.qty_received !== undefined ? toPositiveInt(body.qty_received, "qty_received") : current.qty_received;
    const supplierId = body.supplier_id !== undefined ? (body.supplier_id ? toInt(body.supplier_id, "supplier_id") : null) : current.supplier_id;
    const purchaseLink = body.purchase_link !== undefined ? (body.purchase_link ? String(body.purchase_link).trim() : null) : current.purchase_link;
    const unitPriceEgp = body.price_egp !== undefined ? (body.price_egp === null || body.price_egp === "" ? null : toNonNegativeNumber(body.price_egp, "price_egp")) : current.unit_price_egp;
    const receivedAt = body.received_at !== undefined ? toUtcIsoFromInput(body.received_at, "received_at") : current.received_at;
    if (!(await getComponentById(componentId))) throw new Error("Component not found");
    await reverseLedgerForReference("component_intake", recordId);
    await updateRows("component_intake_records", {
      component_id: componentId,
      qty_received: qtyReceived,
      supplier_id: supplierId,
      purchase_link: purchaseLink,
      unit_price_egp: unitPriceEgp,
      received_at: receivedAt,
    }, [["id", recordId]]);
    await applyComponentIntake(recordId, componentId, qtyReceived);
    if (supplierId || purchaseLink) {
      const component = await selectSingle("components", { eq: [["id", componentId]] });
      await updateRows("components", {
        supplier_id: supplierId || component.supplier_id,
        purchase_link: purchaseLink || component.purchase_link,
        updated_at: receivedAt,
      }, [["id", componentId]]);
    }
    await appendPriceHistory(componentId, supplierId, unitPriceEgp, receivedAt);
    return (await getPurchaseHistory(componentId)).find((row) => row.id === recordId) || null;
  }
  if (pathname.startsWith("/components/")) {
    const componentId = toInt(pathname.split("/")[2], "id");
    const current = await selectSingle("components", { eq: [["id", componentId]] });
    if (!current) throw new Error("Component not found");
    const itemName = body.item_name !== undefined ? requireName(body.item_name, "item_name") : current.item_name;
    const supplierId = body.supplier_id !== undefined ? (body.supplier_id ? toInt(body.supplier_id, "supplier_id") : null) : current.supplier_id;
    const purchaseLink = body.purchase_link !== undefined ? (body.purchase_link ? String(body.purchase_link).trim() : null) : current.purchase_link;
    await updateRows("components", {
      item_name: itemName,
      item_name_normalized: normalizeName(itemName),
      supplier_id: supplierId,
      purchase_link: purchaseLink,
      updated_at: nowIso(),
    }, [["id", componentId]]);
    if (body.stock_qty !== undefined) {
      const delta = toNonNegativeInt(body.stock_qty, "stock_qty") - current.stock_qty;
      if (delta !== 0) {
        await updateComponentStock(componentId, delta);
        await insertLedger({ itemType: "component", itemId: componentId, deltaQty: delta, reason: "adjustment", referenceType: "component", referenceId: componentId });
      }
    }
    await appendPriceHistory(componentId, body.price_supplier_id || supplierId || null, body.price_egp, nowIso());
    return getComponentById(componentId);
  }
  if (pathname.startsWith("/products/") && pathname.endsWith("/bom")) {
    const productId = toInt(pathname.split("/")[2], "id");
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items) throw new Error("items array is required");
    await deleteRows("bom_items", [["product_id", productId]]);
    const seen = new Set();
    for (const entry of items) {
      const componentId = toInt(entry.component_id, "component_id");
      const qtyPerUnit = toPositiveInt(entry.qty_per_unit, "qty_per_unit");
      if (seen.has(componentId)) throw new Error("Duplicate component in BOM payload");
      seen.add(componentId);
      await insertRow("bom_items", { product_id: productId, component_id: componentId, qty_per_unit: qtyPerUnit, created_at: nowIso(), updated_at: nowIso() });
    }
    return getBomItems(productId);
  }
  if (pathname.startsWith("/products/")) {
    const productId = toInt(pathname.split("/")[2], "id");
    const current = await getProductById(productId);
    if (!current) throw withStatus(404, "Product not found");
    return (await updateRows("products", {
      name: body.name !== undefined ? requireName(body.name, "name") : current.name,
      updated_at: nowIso(),
    }, [["id", productId]]))[0];
  }
  if (pathname.startsWith("/manufacturing-records/")) {
    const recordId = toInt(pathname.split("/")[2], "id");
    const current = await selectSingle("manufacturing_records", { eq: [["id", recordId]] });
    if (!current) throw new Error("Manufacturing record not found");
    const productId = body.product_id !== undefined ? toInt(body.product_id, "product_id") : current.product_id;
    const unitsProduced = body.units_produced !== undefined ? toPositiveInt(body.units_produced, "units_produced") : current.units_produced;
    const producedAt = body.produced_at !== undefined ? toUtcIsoFromInput(body.produced_at, "produced_at") : current.produced_at;
    await reverseLedgerForReference("manufacturing", recordId);
    const updated = (await updateRows("manufacturing_records", { product_id: productId, units_produced: unitsProduced, produced_at: producedAt, updated_at: nowIso() }, [["id", recordId]]))[0];
    await applyManufacturing(recordId, productId, unitsProduced);
    return { ...updated, product_name: (await getProductById(productId))?.name || "" };
  }
  if (pathname.startsWith("/sales-records/")) {
    const recordId = toInt(pathname.split("/")[2], "id");
    const current = await selectSingle("sales_records", { eq: [["id", recordId]] });
    if (!current) throw new Error("Sales record not found");
    const productId = body.product_id !== undefined ? toInt(body.product_id, "product_id") : current.product_id;
    const unitsSold = body.units_sold !== undefined ? toPositiveInt(body.units_sold, "units_sold") : current.units_sold;
    const unitSellPriceEgp = body.unit_sell_price_egp !== undefined ? toNonNegativeNumber(body.unit_sell_price_egp, "unit_sell_price_egp") : current.unit_sell_price_egp;
    const soldAt = body.sold_at !== undefined ? toUtcIsoFromInput(body.sold_at, "sold_at") : current.sold_at;
    await reverseLedgerForReference("sale", recordId);
    const metrics = await calculateSaleMetrics(productId, unitsSold, unitSellPriceEgp);
    const updated = (await updateRows("sales_records", {
      product_id: productId,
      units_sold: unitsSold,
      unit_sell_price_egp: unitSellPriceEgp,
      unit_purchase_cost_egp: metrics.unitPurchaseCostEgp,
      total_purchase_cost_egp: metrics.totalPurchaseCostEgp,
      revenue_egp: metrics.revenueEgp,
      gross_profit_egp: metrics.grossProfitEgp,
      margin_pct: metrics.marginPct,
      sold_at: soldAt,
      updated_at: nowIso(),
    }, [["id", recordId]]))[0];
    await applySale(recordId, productId, unitsSold);
    return { ...updated, product_name: (await getProductById(productId))?.name || "" };
  }
  if (pathname.startsWith("/damage-records/")) {
    const recordId = toInt(pathname.split("/")[2], "id");
    const current = await selectSingle("damage_records", { eq: [["id", recordId]] });
    if (!current) throw new Error("Damage record not found");
    const componentId = body.component_id !== undefined ? toInt(body.component_id, "component_id") : current.component_id;
    const qtyDamaged = body.qty_damaged !== undefined ? toPositiveInt(body.qty_damaged, "qty_damaged") : current.qty_damaged;
    const damagedAt = body.damaged_at !== undefined ? toUtcIsoFromInput(body.damaged_at, "damaged_at") : current.damaged_at;
    const notes = body.notes !== undefined ? (body.notes ? String(body.notes).trim() : null) : current.notes;
    if (!(await getComponentById(componentId))) throw new Error("Component not found");
    await reverseLedgerForReference("damage", recordId);
    const updated = (await updateRows("damage_records", {
      component_id: componentId,
      qty_damaged: qtyDamaged,
      damaged_at: damagedAt,
      notes,
      updated_at: nowIso(),
    }, [["id", recordId]]))[0];
    await applyDamage(recordId, componentId, qtyDamaged);
    return { ...updated, item_name: (await getComponentById(componentId))?.item_name || "" };
  }
  throw withStatus(404, `Route not found: PUT ${pathname}`);
}

async function handleDelete(pathname) {
  if (pathname.startsWith("/suppliers/")) {
    const supplierId = toInt(pathname.split("/")[2], "id");
    if ((await selectRows("components", { eq: [["supplier_id", supplierId]] })).length > 0) {
      throw withStatus(400, "Supplier is referenced by components");
    }
    await deleteRows("suppliers", [["id", supplierId]]);
    return { success: true };
  }
  if (pathname.startsWith("/components/intake-records/")) {
    const recordId = toInt(pathname.split("/")[3], "id");
    const record = await selectSingle("component_intake_records", { eq: [["id", recordId]] });
    if (!record) throw new Error("Intake record not found");
    const deleted = (await getPurchaseHistory(record.component_id)).find((row) => row.id === recordId) || record;
    await reverseLedgerForReference("component_intake", recordId);
    await deleteRows("component_intake_records", [["id", recordId]]);
    return { success: true, deleted };
  }
  if (pathname.startsWith("/components/")) {
    const componentId = toInt(pathname.split("/")[2], "id");
    const component = await selectSingle("components", { eq: [["id", componentId]] });
    if (!component) throw new Error("Component not found");
    if (component.stock_qty > 0) throw new Error("Component stock must be zero before deletion");
    if ((await selectRows("bom_items", { eq: [["component_id", componentId]] })).length > 0) throw new Error("Component is used by one or more product BOMs");
    if ((await selectRows("damage_records", { eq: [["component_id", componentId]] })).length > 0) throw new Error("Cannot delete component with damage history");
    if ((await selectRows("component_intake_records", { eq: [["component_id", componentId]] })).length > 0) throw new Error("Cannot delete component with intake history");
    await deleteRows("components", [["id", componentId]]);
    return { success: true };
  }
  if (pathname.includes("/bom/")) {
    const [, , productIdRaw, , bomItemIdRaw] = pathname.split("/");
    await deleteRows("bom_items", [["id", toInt(bomItemIdRaw, "bomItemId")], ["product_id", toInt(productIdRaw, "id")]]);
    return { success: true };
  }
  if (pathname.startsWith("/products/")) {
    const productId = toInt(pathname.split("/")[2], "id");
    if (!(await getProductById(productId))) throw new Error("Product not found");
    if ((await getFinishedStockQty(productId)) > 0) throw new Error("Finished stock must be zero before deleting product");
    if ((await selectRows("manufacturing_records", { eq: [["product_id", productId]] })).length > 0 ||
        (await selectRows("sales_records", { eq: [["product_id", productId]] })).length > 0) {
      throw new Error("Cannot delete product with manufacturing or sales history");
    }
    await deleteRows("products", [["id", productId]]);
    return { success: true };
  }
  if (pathname.startsWith("/manufacturing-records/")) {
    const recordId = toInt(pathname.split("/")[2], "id");
    if (!(await selectSingle("manufacturing_records", { eq: [["id", recordId]] }))) throw new Error("Manufacturing record not found");
    await reverseLedgerForReference("manufacturing", recordId);
    await deleteRows("manufacturing_records", [["id", recordId]]);
    return { success: true };
  }
  if (pathname.startsWith("/sales-records/")) {
    const recordId = toInt(pathname.split("/")[2], "id");
    if (!(await selectSingle("sales_records", { eq: [["id", recordId]] }))) throw new Error("Sales record not found");
    await reverseLedgerForReference("sale", recordId);
    await deleteRows("sales_records", [["id", recordId]]);
    return { success: true };
  }
  if (pathname.startsWith("/damage-records/")) {
    const recordId = toInt(pathname.split("/")[2], "id");
    if (!(await selectSingle("damage_records", { eq: [["id", recordId]] }))) throw new Error("Damage record not found");
    await reverseLedgerForReference("damage", recordId);
    await deleteRows("damage_records", [["id", recordId]]);
    return { success: true };
  }
  throw withStatus(404, `Route not found: DELETE ${pathname}`);
}

export async function request(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const body = options.body ? JSON.parse(options.body) : {};
  const { pathname, query } = parsePath(path);
  ensureAuthenticated(pathname);
  if (method === "GET") return handleGet(pathname, query);
  if (method === "POST") return handlePost(pathname, body);
  if (method === "PUT") return handlePut(pathname, body);
  if (method === "DELETE") return handleDelete(pathname);
  throw new Error(`Unsupported method: ${method}`);
}
