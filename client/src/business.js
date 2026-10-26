import { DateTime } from "luxon";
import {createInvoiceLedger} from './invoiceLedger.js';
import {accountingProduct,accountingSpare,filterInvoices,salesTotals} from './salesModel.js';
import {createShopInventory} from './shopInventory.js';
import {deliveryValue,giftValue} from './invoiceOptions.js';

// Each operation owns its database connection and helper scope.
export function createBusiness(databaseRequest, context={}) {
const readCache = new Map();
const shop=createShopInventory({selectRows,selectSingle,insertRow,updateRows,toPositiveInt,toNonNegativeNumber,toUtcIsoFromInput,nowIso,actor:context.actor});
const invoices=createInvoiceLedger({selectRows,selectSingle,insertRow,updateRows,updateFinishedStock,updateComponentStock,moveShopStock:shop.move,insertLedger,actor:context.actor,nowIso,toUtcIsoFromInput});

const DATA_API_URL = import.meta.env.VITE_DATA_API_URL || "/api/data";

const CAIRO_TZ = "Africa/Cairo";
const AUTH_STORAGE_KEY = "diamond_printers_auth";

async function authRequest(action, body = {}) {
  const response = await fetch('/api/auth', {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...body,action}),
  });
  const result = await response.json();
  if (!response.ok) throw withStatus(response.status,result.error || 'Authentication failed');
  return result;
}

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
  const parsed = Number(value);
  if (!['string','number'].includes(typeof value) || String(value).trim()==='' || !Number.isSafeInteger(parsed)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return parsed;
}

function toPositiveInt(value, fieldName) {
  const parsed = toInt(value, fieldName);
  if (parsed <= 0 || parsed>2147483647) {
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
  if (!['string','number'].includes(typeof value) || String(value).trim()==='' || !Number.isFinite(parsed) || parsed < 0 || parsed>999999999999) {
    throw new Error(`${fieldName} must be a number >= 0`);
  }
  return parsed;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function repairType(value,allowLegacy=false){
  if(value==null&&allowLegacy)return null;
  if(!['printer','device'].includes(value))throw new Error('اختر صيانة طابعة أو صيانة جهاز');
  return value;
}
async function sparePayload(body,current={}){
  const values={...current,...body};
  if(!Array.isArray(values.items)||!values.items.length||values.items.length>50)throw new Error('أضف من قطعة واحدة إلى 50 قطعة مختلفة');
  const seen=new Set(),items=[];
  for(const item of values.items){
    if(!item||typeof item!=='object')throw new Error('بيانات قطعة الغيار غير صالحة');
    const isGift=giftValue(item.is_gift),quantity=toPositiveInt(item.quantity,'quantity');
    if(item.shop_item_id){
      const shopId=toPositiveInt(item.shop_item_id,'shop_item_id'),key='shop:'+shopId;
      if(seen.has(key))throw new Error('الصنف مكرر؛ عدّل الكمية في نفس السطر');seen.add(key);
      const good=await shop.item(shopId);if(!good)throw new Error('صنف المحل غير موجود');if(good.stock_qty<quantity)throw new Error(`رصيد المحل غير كافٍ للصنف ${good.item_name}. المتاح: ${good.stock_qty}`);
      const previous=current.items?.find(i=>i.shop_item_id===shopId);
      items.push({shop_item_id:shopId,item_name:good.item_name,quantity,unit_price:isGift?0:toNonNegativeNumber(item.unit_price,'unit_price'),is_gift:isGift,unit_cost_egp:previous?previous.unit_cost_egp:Number(good.latest_price_egp||0),cost_complete:previous?Boolean(previous.cost_complete):good.latest_price_egp!=null});continue;
    }
    if(!item.component_id){
      const name=requireName(item.item_name,'item_name'),key='manual:'+name.toLocaleLowerCase();
      if(seen.has(key))throw new Error('الصنف مكرر؛ عدّل الكمية في نفس السطر');seen.add(key);
      items.push({item_name:name,quantity,unit_price:isGift?0:toNonNegativeNumber(item.unit_price,'unit_price'),is_gift:isGift,unit_cost_egp:0,cost_complete:false});continue;
    }
    const componentId=toPositiveInt(item.component_id,'component_id');
    if(seen.has(componentId))throw new Error('القطعة مكررة؛ عدّل الكمية في نفس السطر');seen.add(componentId);
    const component=await getComponentById(componentId);if(!component)throw new Error('قطعة الغيار غير موجودة بالمخزون');
    if(component.stock_qty<quantity)throw new Error(`المخزون غير كافٍ للقطعة ${component.item_name}. المتاح: ${component.stock_qty}`);
    const previous=current.items?.find(line=>line.component_id===componentId),price=await getLatestPriceForComponent(componentId);
    items.push({component_id:componentId,item_name:component.item_name,quantity,unit_price:isGift?0:toNonNegativeNumber(item.unit_price,'unit_price'),is_gift:isGift,unit_cost_egp:previous?previous.unit_cost_egp:Number(price?.price_egp||0),cost_complete:previous?Boolean(previous.cost_complete):Boolean(price)});
  }
  const total=round2(items.reduce((sum,i)=>sum+round2(i.quantity*i.unit_price),0));
  if(!Number.isFinite(total)||total>999999999999)throw new Error('إجمالي الفاتورة أكبر من الحد المسموح');
  return {items,total_amount:total,delivery_method:deliveryValue(body.delivery_method,current.delivery_method),customer_name:values.customer_name?String(values.customer_name).trim()||null:null,customer_phone:values.customer_phone?String(values.customer_phone).trim()||null:null,sold_at:toUtcIsoFromInput(values.sold_at,'sold_at'),updated_at:nowIso()};
}
async function applySpareSale(row){for(const item of row.items){if(item.shop_item_id){await shop.move(item.shop_item_id,-item.quantity,'spare_sale',row.id,item.is_gift?'gift':'sale');continue;}if(!item.component_id)continue;await updateComponentStock(item.component_id,-item.quantity);await insertLedger({itemType:'component',itemId:item.component_id,deltaQty:-item.quantity,reason:'sale',referenceType:'spare_sale',referenceId:row.id});}}

function printerInvoicePayload(body,current={}) {
  const values={...current,...body};
  if(values.extra_items != null && (!Array.isArray(values.extra_items)||values.extra_items.length>50))throw new Error('يمكن إضافة حتى 50 صنفًا إضافيًا في الفاتورة');
  const extraItems=(values.extra_items||[]).map((item,index)=>{
    if(!item||typeof item!=='object')throw new Error('بيانات الصنف الإضافي غير صالحة');
    const name=String(item.item_name||'').trim();
    if(!name)throw new Error(`أدخل اسم الصنف الإضافي ${index+1} أو احذفه`);
    const isGift=giftValue(item.is_gift);
    if(!isGift&&(item.unit_price===''||item.unit_price==null))throw new Error(`أدخل سعر الصنف الإضافي ${index+1}`);
    return {item_name:name,quantity:toPositiveInt(item.quantity === '' || item.quantity == null?1:item.quantity,'quantity'),unit_price:isGift?0:toNonNegativeNumber(item.unit_price,'unit_price'),...(item.is_gift!==undefined?{is_gift:isGift}:{}),...(item.shop_item_id?{shop_item_id:toPositiveInt(item.shop_item_id,'shop_item_id')}: {})};
  });
  const isGift=giftValue(values.is_gift);
  if(!isGift&&(values.unit_price===''||values.unit_price==null))throw new Error('أدخل سعر الوحدة');
  const quantity=toPositiveInt(values.quantity === '' || values.quantity == null?1:values.quantity,'quantity');
  const total=quantity*(isGift?0:Number(values.unit_price))+extraItems.reduce((s,i)=>s+i.quantity*i.unit_price,0);
  if(!Number.isFinite(total)||total>999999999999)throw new Error('إجمالي الفاتورة أكبر من الحد المسموح');
  if(values.serial_number&&String(values.serial_number).trim()&&quantity!==1)throw new Error('عند تسجيل سريل، سجّل كل طابعة في فاتورة مستقلة');
  return {
    item_name:requireName(values.item_name),quantity,
    unit_price:isGift?0:toNonNegativeNumber(values.unit_price,'unit_price'),extra_items:extraItems,is_gift:isGift,delivery_method:deliveryValue(body.delivery_method,current.delivery_method),
    counter:values.counter === '' || values.counter == null?null:toNonNegativeInt(values.counter,'counter'),
    serial_number:values.serial_number == null?null:String(values.serial_number).trim()||null,
    customer_phone:values.customer_phone?String(values.customer_phone).trim()||null:null,
    customer_name:values.customer_name?String(values.customer_name).trim()||null:null,
    sold_at:toUtcIsoFromInput(values.sold_at,'sold_at'),
  };
}
async function stockedPrinterPayload(body,current={}){
  const payload=printerInvoicePayload(body,current),totals=new Map();
  for(const line of payload.extra_items){if(!line.shop_item_id)continue;const good=await shop.item(line.shop_item_id);if(!good)throw new Error('صنف المحل غير موجود');
    totals.set(good.id,(totals.get(good.id)||0)+line.quantity);if(totals.get(good.id)>good.stock_qty)throw new Error(`رصيد المحل غير كافٍ للصنف ${good.item_name}. المتاح: ${good.stock_qty}`);
    const previous=current.extra_items?.find(i=>i.shop_item_id===good.id);line.item_name=good.item_name;line.unit_cost_egp=previous?previous.unit_cost_egp:Number(good.latest_price_egp||0);line.cost_complete=previous?Boolean(previous.cost_complete):good.latest_price_egp!=null;
  }return payload;
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
  const key=JSON.stringify({table,...options});
  if(!readCache.has(key))readCache.set(key,databaseRequest({ action: "select", table, ...options }));
  return readCache.get(key);
}

async function selectSingle(table, options = {}) {
  const rows = await selectRows(table, { ...options, limit: 1 });
  return rows[0] || null;
}

async function insertRow(table, payload) {
  readCache.clear();
  const rows = await databaseRequest({ action: "insert", table, payload });
  return rows[0] || null;
}

async function updateRows(table, payload, eq = []) {
  readCache.clear();
  return databaseRequest({ action: "update", table, payload, eq });
}

async function deleteRows(table, eq = []) {
  readCache.clear();
  return databaseRequest({ action: "delete", table, eq });
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
    getComponentsWithDerivedFields(),
  ]);
  const componentMap = new Map(components.map((row) => [row.id, row]));
  return rows
    .map((row) => ({
      ...row,
      item_name: componentMap.get(row.component_id)?.item_name || "",
      stock_qty: componentMap.get(row.component_id)?.stock_qty ?? 0,
      latest_price_egp: componentMap.get(row.component_id)?.latest_price_egp ?? null,
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
  const [components, suppliers, prices, bomItems] = await Promise.all([
    getComponentsRaw(),
    getSuppliers(),
    selectRows("component_price_history"),
    selectRows("bom_items"),
  ]);
  const supplierMap = new Map(suppliers.map((row) => [row.id, row]));
  const latestPriceMap = new Map();
  for (const row of prices.filter((item) => item.is_active)) {
    const current = latestPriceMap.get(row.component_id);
    if (!current || row.effective_at > current.effective_at || row.id > current.id) {
      latestPriceMap.set(row.component_id, row);
    }
  }
  const bomMinimumMap = new Map();
  for (const item of bomItems) {
    bomMinimumMap.set(
      item.component_id,
      Math.max(bomMinimumMap.get(item.component_id) || 0, Number(item.qty_per_unit) || 0)
    );
  }
  return components.map((row) => ({
    ...row,
    supplier_name: supplierMap.get(row.supplier_id)?.name || null,
    latest_price_egp: latestPriceMap.get(row.id)?.price_egp ?? null,
    latest_price_supplier_id: latestPriceMap.get(row.id)?.supplier_id ?? null,
    automatic_minimum_stock_qty: bomMinimumMap.get(row.id) || 0,
    effective_minimum_stock_qty:
      row.minimum_stock_qty === null || row.minimum_stock_qty === undefined
        ? bomMinimumMap.get(row.id) || 0
        : Number(row.minimum_stock_qty),
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
    ...['unified_sales_egp','recorded_collections_egp','customer_due_egp','refund_due_egp','unreviewed_invoices','incomplete_cost_invoices','spare_revenue_egp','spare_cost_egp','spare_profit_egp','spare_incomplete_cost_invoices','printer_shop_gifts_cost_egp'].map(key=>[key,report.summary[key]].join(',')),
    ["revenue_egp", report.summary.revenue_egp].join(","),
    ["purchase_cost_egp", report.summary.purchase_cost_egp].join(","),
    ["gross_profit_egp", report.summary.gross_profit_egp].join(","),
    ["units_sold", report.summary.units_sold].join(","),
    ["manufacturing_cost_egp", report.summary.manufacturing_cost_egp].join(","),
    ["manufacturing_paid_units", report.summary.manufacturing_paid_units].join(","),
    ["manufacturing_remaining_units", report.summary.manufacturing_remaining_units].join(","),
    ["maintenance_revenue_egp", report.summary.maintenance_revenue_egp].join(","),
    ["maintenance_parts_cost_egp", report.summary.maintenance_parts_cost_egp].join(","),
    ["maintenance_profit_egp", report.summary.maintenance_profit_egp].join(","),
    ["total_profit_with_maintenance_egp", report.summary.total_profit_with_maintenance_egp].join(","),
    ["delivered_maintenance_count", report.summary.delivered_maintenance_count].join(","),
    ["avg_margin_pct", report.summary.avg_margin_pct].join(","),
  ];
  return lines.join("\n");
}

async function applyManufacturingStart(recordId, productId, unitsProduced) {
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
}

async function applyManufacturingCompletion(recordId, productId, unitsProduced) {
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

async function applyManufacturing(recordId, productId, unitsProduced, status = "completed") {
  if (status === "order") return;
  await applyManufacturingStart(recordId, productId, unitsProduced);
  if (status === "completed") {
    await applyManufacturingCompletion(recordId, productId, unitsProduced);
  }
}

async function calculateSaleMetrics(productId, unitsSold, unitSellPriceEgp, manufacturingCostPerUnit) {
  const bomItems = await getBomItems(productId);
  if (!bomItems.length) throw new Error("Product does not have BOM items");
  let unitPurchaseCost = 0;
  let costComplete=true;
  for (const item of bomItems) {
    const latestPrice = await getLatestPriceForComponent(item.component_id);
    if (!latestPrice) {costComplete=false;continue;}
    unitPurchaseCost += item.qty_per_unit * latestPrice.price_egp;
  }
  const unitPurchaseCostEgp = round2(unitPurchaseCost + manufacturingCostPerUnit);
  const totalPurchaseCostEgp = round2(unitPurchaseCostEgp * unitsSold);
  const revenueEgp = round2(unitSellPriceEgp * unitsSold);
  if(!Number.isFinite(revenueEgp)||revenueEgp>999999999999)throw new Error('إجمالي الفاتورة أكبر من الحد المسموح');
  const grossProfitEgp = round2(revenueEgp - totalPurchaseCostEgp);
  const marginPct = revenueEgp === 0 ? 0 : round2((grossProfitEgp / revenueEgp) * 100);
  return { unitPurchaseCostEgp, totalPurchaseCostEgp, revenueEgp, grossProfitEgp, marginPct,costComplete };
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
  const allInvoices=await invoices.list();
  const rows=allInvoices.filter(r=>r.kind==='product').map(accountingProduct),products=await getProductsRaw();
  const unified=salesTotals(filterInvoices(allInvoices,{from:start.toISODate(),to:end.toISODate()}));
  const spareInvoices=filterInvoices(allInvoices,{kind:'spare',from:start.toISODate(),to:end.toISODate()}),spareMetrics=spareInvoices.map(accountingSpare);
  const spareRevenue=round2(spareMetrics.reduce((s,r)=>s+r.revenue,0)),spareCost=round2(spareMetrics.reduce((s,r)=>s+r.cost,0)),spareProfit=round2(spareRevenue-spareCost);
  const printerShopGiftsCost=round2(filterInvoices(allInvoices,{kind:'printer',from:start.toISODate(),to:end.toISODate()}).filter(i=>i.state!=='cancelled').reduce((sum,i)=>sum+i.lines.filter(l=>l.is_gift&&l.shop_item_id).reduce((s,l)=>s+(l.quantity-l.returned)*Number(l.unit_cost_egp||0),0),0));
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
  let totalManufacturingCost = 0;
  let manufacturingPaidUnits = 0;
  let manufacturingRemainingUnits = 0;
  for (const row of filtered) {
    totalRevenue += row.revenue_egp;
    totalPurchaseCost += row.total_purchase_cost_egp;
    totalGrossProfit += row.gross_profit_egp;
    totalUnits += row.units_sold;
    totalManufacturingCost += Number(row.manufacturing_cost_per_unit ?? 1000) * row.units_sold;
    if (row.is_accounted) manufacturingPaidUnits += row.units_sold;
    else manufacturingRemainingUnits += row.units_sold;
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
  const maintenanceTickets = (await getMaintenanceTickets()).map(ticket=>({...ticket,repair_charge_egp:allInvoices.find(r=>r.kind==='maintenance'&&r.source_id===ticket.id)?.net??ticket.repair_charge_egp})).filter((ticket) => {
    if (!ticket.delivered || !ticket.delivered_at) return false;
    const deliveredAt = DateTime.fromISO(ticket.delivered_at, { zone: "utc" }).setZone(CAIRO_TZ);
    return deliveredAt >= start && deliveredAt <= end;
  });
  const maintenanceRevenue = maintenanceTickets.reduce(
    (total, ticket) => total + Number(ticket.repair_charge_egp),
    0
  );
  const maintenancePartsCost = maintenanceTickets.reduce(
    (total, ticket) => total + Number(ticket.parts_cost_egp),
    0
  );
  const maintenanceProfit = maintenanceRevenue - maintenancePartsCost;
  return {
    period,
    timezone: CAIRO_TZ,
    start_cairo: start.toISO(),
    end_cairo: end.toISO(),
    summary: {
      unified_sales_egp:unified.sales,recorded_collections_egp:unified.collected,customer_due_egp:unified.due,refund_due_egp:unified.refund,unreviewed_invoices:unified.unknown,
      incomplete_cost_invoices:filtered.filter(r=>r.cost_complete!==true&&r.units_sold>0).length,
      spare_revenue_egp:spareRevenue,spare_cost_egp:spareCost,spare_profit_egp:spareProfit,spare_incomplete_cost_invoices:spareMetrics.filter(m=>!m.complete).length,
      printer_shop_gifts_cost_egp:printerShopGiftsCost,
      revenue_egp: round2(totalRevenue),
      purchase_cost_egp: round2(totalPurchaseCost),
      gross_profit_egp: round2(totalGrossProfit),
      units_sold: totalUnits,
      manufacturing_cost_egp: round2(totalManufacturingCost),
      manufacturing_paid_units: manufacturingPaidUnits,
      manufacturing_remaining_units: manufacturingRemainingUnits,
      maintenance_revenue_egp: round2(maintenanceRevenue),
      maintenance_parts_cost_egp: round2(maintenancePartsCost),
      maintenance_profit_egp: round2(maintenanceProfit),
      total_profit_with_maintenance_egp: round2(totalGrossProfit + spareProfit + maintenanceProfit),
      delivered_maintenance_count: maintenanceTickets.length,
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
      manufacturing_cost_per_unit: row.manufacturing_cost_per_unit ?? 1000,
      manufacturing_paid: Boolean(row.is_accounted),
      sold_at: row.sold_at,
      sold_at_cairo: row.sold_at_cairo,
    })),
    damaged: await buildDamagedReport(period, query, { start, end }),
    maintenance: maintenanceTickets,
  };
}

async function getMaintenanceTickets() {
  const [tickets, parts, components,metas] = await Promise.all([
    selectRows("maintenance_tickets", { order: [["opened_at", false]] }),
    selectRows("maintenance_parts", { order: [["id", true]] }),
    getComponentsRaw(),
    selectRows('sales_invoice_meta'),
  ]);
  const componentMap = new Map(components.map((row) => [row.id, row]));
  return tickets.map((ticket) => {
    const ticketParts = parts
      .filter((part) => part.ticket_id === ticket.id)
      .map((part) => ({ ...part, item_name: componentMap.get(part.component_id)?.item_name || "" }));
    const partsCost = round2(ticketParts.reduce((total, part) => total + Number(part.total_price_egp), 0));
    return {
      ...ticket,
      invoice_revision:metas.find(m=>m.kind==='maintenance'&&m.source_id===ticket.id)?.revision||0,
      parts: ticketParts,
      parts_cost_egp: partsCost,
      maintenance_profit_egp: round2(Number(ticket.repair_charge_egp) - partsCost),
    };
  });
}

async function handleGet(pathname, query) {
  if(pathname==='/shop-items')return shop.items();
  if(pathname==='/shop-purchases')return shop.purchases();
  if(pathname==='/sales-hub')return invoices.list();
  if(/^\/sales-hub\/(product|printer|spare|maintenance)\/\d+$/.test(pathname)){
    const [, ,kind,id]=pathname.split('/');const row=await invoices.get(kind,Number(id));
    return {...row,events:row.meta?await selectRows('sales_events',{eq:[['invoice_id',row.meta.id]],order:[['id',false]]}):[]};
  }
  if (pathname === '/dashboard') {
    const [shortages,sales,manufacturing,printers,products,maintenance]=await Promise.all([
      handleGet('/shortages',{}),handleGet('/sales-records',{}),handleGet('/manufacturing-records',{}),
      handleGet('/printer-sales',{}),handleGet('/products',{}),handleGet('/maintenance-tickets',{}),
    ]);
    return {shortages,sales,manufacturing,printers,products,maintenance,invoices:await invoices.list()};
  }
  if (pathname === "/auth/status") {
    const result = await authRequest('status');
    setAuthState(result.authenticated);
    return result;
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
    return rows.map((row) => ({
      ...row,
      status: row.status || "completed",
      product_name: productMap.get(row.product_id)?.name || "",
    }));
  }
  if (pathname === "/sales-records") {
    const [rows, products] = await Promise.all([
      selectRows("sales_records", { order: [["sold_at", false]] }),
      getProductsRaw(),
    ]);
    const productMap = new Map(products.map((row) => [row.id, row]));
    const metas=await selectRows('sales_invoice_meta');
    return rows.map((row) => ({ ...row, product_name: productMap.get(row.product_id)?.name || "",invoice_revision:metas.find(m=>m.kind==='product'&&m.source_id===row.id)?.revision||0 }));
  }
  if (pathname === '/printer-sales') {const [rows,metas]=await Promise.all([selectRows('printer_sales',{order:[['sold_at',false]]}),selectRows('sales_invoice_meta')]);return rows.map(row=>({...row,invoice_revision:metas.find(m=>m.kind==='printer'&&m.source_id===row.id)?.revision||0}));}
  if (pathname === '/spare-sales') {const [rows,metas]=await Promise.all([selectRows('spare_sales',{order:[['sold_at',false]]}),selectRows('sales_invoice_meta')]);return rows.map(row=>({...row,invoice_revision:metas.find(m=>m.kind==='spare'&&m.source_id===row.id)?.revision||0}));}
  if (pathname === '/accounts') return (await authRequest('list')).users;
  if (pathname === "/damage-records") {
    const [rows, components] = await Promise.all([
      selectRows("damage_records", { order: [["damaged_at", false]] }),
      getComponentsRaw(),
    ]);
    const componentMap = new Map(components.map((row) => [row.id, row]));
    return rows.map((row) => ({ ...row, item_name: componentMap.get(row.component_id)?.item_name || "" }));
  }
  if (pathname === "/maintenance-tickets") return getMaintenanceTickets();
  if (pathname === "/shortages") {
    return (await getComponentsWithDerivedFields())
      .filter((row) => row.stock_qty <= row.effective_minimum_stock_qty)
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
        selectRows("manufacturing_records", { eq: [["product_id", id], ["status", "completed"]], order: [["produced_at", false], ["id", false]], limit: 1 }),
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
  if(pathname==='/shop-purchases')return shop.purchase(body);
  if(pathname==='/spare-sales'){const row=await insertRow('spare_sales',await sparePayload(body));await applySpareSale(row);return row;}
  if (pathname === "/auth/login") {
    const result = await authRequest('login',body);
    setAuthState(true);
    return result;
  }
  if (pathname === "/auth/logout") {
    await authRequest('logout');
    setAuthState(false);
    return { success: true };
  }
  if (pathname === '/accounts') return authRequest('create',body);
  if (pathname === '/printer-sales') {
    const row=await insertRow('printer_sales', {...await stockedPrinterPayload(body),request_id:body.request_id});
    await shop.applyExtras(row);return row;
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
  if (pathname === "/maintenance-tickets") {
    const now = nowIso();
    return insertRow("maintenance_tickets", {
      device_type:repairType(body.device_type),
      customer_name: requireName(body.customer_name, "customer_name"),
      phone: body.phone ? String(body.phone).trim() : null,
      device_issue: requireName(body.device_issue, "device_issue"),
      maintenance_description: body.maintenance_description ? String(body.maintenance_description).trim() : null,
      status: "in_progress",
      repair_charge_egp: 0,
      delivered: false,
      opened_at: toUtcIsoFromInput(body.opened_at, "opened_at"),
      completed_at: null,
      delivered_at: null,
      created_at: now,
      updated_at: now,
    });
  }
  if (pathname.match(/^\/maintenance-tickets\/\d+\/parts$/)) {
    const ticketId = toInt(pathname.split("/")[2], "ticket_id");
    const ticket = await selectSingle("maintenance_tickets", { eq: [["id", ticketId]] });
    if (!ticket || ticket.status !== "in_progress") throw new Error("Maintenance ticket is not active");
    const componentId = toInt(body.component_id, "component_id");
    const qtyUsed = toPositiveInt(body.qty_used, "qty_used");
    const component = await getComponentById(componentId);
    if (!component) throw new Error("Component not found");
    if (component.stock_qty < qtyUsed) {
      throw new Error(`Insufficient component stock. Available: ${component.stock_qty}`);
    }
    const latestPrice = await getLatestPriceForComponent(componentId);
    const unitPrice = Number(latestPrice?.price_egp || 0);
    const part = await insertRow("maintenance_parts", {
      ticket_id: ticketId,
      component_id: componentId,
      qty_used: qtyUsed,
      unit_price_egp: unitPrice,
      total_price_egp: round2(unitPrice * qtyUsed),
      created_at: nowIso(),
    });
    await updateComponentStock(componentId, -qtyUsed);
    await insertLedger({
      itemType: "component",
      itemId: componentId,
      deltaQty: -qtyUsed,
      reason: "adjustment",
      referenceType: "maintenance_part",
      referenceId: part.id,
    });
    return { ...part, item_name: component.item_name };
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
      status: "order",
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    return { ...created, product_name: (await getProductById(productId))?.name || "" };
  }
  if (pathname === "/sales-records") {
    const productId = toInt(body.product_id, "product_id");
    const unitsSold = toPositiveInt(body.units_sold, "units_sold");
    const isGift=giftValue(body.is_gift);
    const unitSellPriceEgp = isGift?0:toNonNegativeNumber(body.unit_sell_price_egp, "unit_sell_price_egp");
    const manufacturingCostPerUnit = toNonNegativeNumber(body.manufacturing_cost_per_unit ?? 1000, "manufacturing_cost_per_unit");
    const soldAt = toUtcIsoFromInput(body.sold_at, "sold_at");
    if (!(await getProductById(productId))) throw new Error("Product not found");
    const availableStock = await getFinishedStockQty(productId);
    if (availableStock < unitsSold) {
      throw new Error(`Insufficient finished product stock. Available: ${availableStock}`);
    }
    const metrics = await calculateSaleMetrics(productId, unitsSold, unitSellPriceEgp, manufacturingCostPerUnit);
    const created = await insertRow("sales_records", {
      product_id: productId,
      units_sold: unitsSold,
      is_gift:isGift,delivery_method:deliveryValue(body.delivery_method),
      customer_name:body.customer_name?String(body.customer_name).trim()||null:null,
      customer_phone:body.customer_phone?String(body.customer_phone).trim()||null:null,
      unit_sell_price_egp: unitSellPriceEgp,
      unit_purchase_cost_egp: metrics.unitPurchaseCostEgp,
      total_purchase_cost_egp: metrics.totalPurchaseCostEgp,
      revenue_egp: metrics.revenueEgp,
      gross_profit_egp: metrics.grossProfitEgp,
      margin_pct: metrics.marginPct,
      is_accounted: false,
      manufacturing_cost_per_unit: manufacturingCostPerUnit,
      cost_includes_manufacturing: true,
      cost_complete:metrics.costComplete,
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
          minimum_stock_qty:
            body.minimum_stock_qty === undefined || body.minimum_stock_qty === null || body.minimum_stock_qty === ""
              ? null
              : toNonNegativeInt(body.minimum_stock_qty, "minimum_stock_qty"),
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
    if (body.minimum_stock_qty !== undefined && body.minimum_stock_qty !== "") {
      await updateRows("components", {
        minimum_stock_qty:
          body.minimum_stock_qty === null
            ? null
            : toNonNegativeInt(body.minimum_stock_qty, "minimum_stock_qty"),
        updated_at: receivedAt,
      }, [["id", componentId]]);
    }
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
  if(/^\/shop-purchases\/\d+$/.test(pathname))return shop.purchase(body,toPositiveInt(pathname.split('/')[2],'id'));
  if(/^\/spare-sales\/\d+$/.test(pathname)){
    const id=toPositiveInt(pathname.split('/')[2],'id'),current=await selectSingle('spare_sales',{eq:[['id',id]]});
    if(!current)throw new Error('الفاتورة غير موجودة');
    await reverseLedgerForReference('spare_sale',id);
    await shop.reverse('spare_sale',id);
    const payload=await sparePayload(body,current),row=(await updateRows('spare_sales',payload,[['id',id]]))[0];await applySpareSale(row);return row;
  }
  if (/^\/printer-sales\/\d+$/.test(pathname)) {
    const invoiceId=toPositiveInt(pathname.split('/')[2],'invoice_id');
    const current=await selectSingle('printer_sales',{eq:[['id',invoiceId]]});
    if(!current)throw withStatus(404,'الفاتورة غير موجودة');
    await shop.reverse('printer_sale',invoiceId);
    const row=(await updateRows('printer_sales',await stockedPrinterPayload(body,current),[['id',invoiceId]]))[0];await shop.applyExtras(row);return row;
  }
  if (pathname.startsWith('/accounts/')) return authRequest('update',{...body,id:pathname.split('/')[2]});
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
  if (pathname.startsWith("/maintenance-tickets/")) {
    const ticketId = toInt(pathname.split("/")[2], "id");
    const current = await selectSingle("maintenance_tickets", { eq: [["id", ticketId]] });
    if (!current) throw new Error("Maintenance ticket not found");
    const nextStatus = body.status !== undefined ? String(body.status) : current.status;
    if (!["in_progress", "completed"].includes(nextStatus)) throw new Error("Invalid maintenance status");
    if (current.status === "completed" && nextStatus !== "completed") throw new Error("Completed ticket cannot be reopened");
    const delivered = body.delivered !== undefined ? Boolean(body.delivered) : Boolean(current.delivered);
    if (delivered && nextStatus !== "completed") throw new Error("Complete the maintenance ticket before delivery");
    const updated = (await updateRows("maintenance_tickets", {
      device_type:body.device_type!==undefined?repairType(body.device_type,current.device_type==null):current.device_type,
      customer_name: body.customer_name !== undefined ? requireName(body.customer_name, "customer_name") : current.customer_name,
      phone: body.phone !== undefined ? (body.phone ? String(body.phone).trim() : null) : current.phone,
      device_issue: body.device_issue !== undefined ? requireName(body.device_issue, "device_issue") : current.device_issue,
      maintenance_description:
        body.maintenance_description !== undefined
          ? body.maintenance_description ? String(body.maintenance_description).trim() : null
          : current.maintenance_description,
      repair_charge_egp:
        body.repair_charge_egp !== undefined
          ? toNonNegativeNumber(body.repair_charge_egp, "repair_charge_egp")
          : current.repair_charge_egp,
      status: nextStatus,
      delivered,
      completed_at: nextStatus === "completed" ? current.completed_at || nowIso() : null,
      delivered_at: delivered ? current.delivered_at || nowIso() : null,
      updated_at: nowIso(),
    }, [["id", ticketId]]))[0];
    return updated;
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
    const minimumStockQty = body.minimum_stock_qty !== undefined
      ? (body.minimum_stock_qty === null || body.minimum_stock_qty === ""
          ? null
          : toNonNegativeInt(body.minimum_stock_qty, "minimum_stock_qty"))
      : current.minimum_stock_qty;
    await updateRows("components", {
      item_name: itemName,
      item_name_normalized: normalizeName(itemName),
      supplier_id: supplierId,
      purchase_link: purchaseLink,
      minimum_stock_qty: minimumStockQty,
      updated_at: nowIso(),
    }, [["id", componentId]]);
    if (body.stock_qty !== undefined) {
      const newStockQty = toNonNegativeInt(body.stock_qty, "stock_qty");
      const delta = newStockQty - Number(current.stock_qty);
      if (delta !== 0) {
        await updateRows(
          "components",
          { stock_qty: newStockQty, updated_at: nowIso() },
          [["id", componentId]]
        );
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
    const currentStatus = current.status || "completed";
    const nextStatus = body.status !== undefined ? String(body.status) : currentStatus;
    const validTransitions = {
      order: new Set(["order", "in_progress"]),
      in_progress: new Set(["in_progress", "completed"]),
      completed: new Set(["completed"]),
    };
    if (!validTransitions[currentStatus]?.has(nextStatus)) throw new Error("Invalid manufacturing status transition");

    const detailsChanged = productId !== current.product_id || unitsProduced !== current.units_produced;
    if (detailsChanged && currentStatus !== "order") {
      await reverseLedgerForReference("manufacturing", recordId);
    }

    const updated = (await updateRows("manufacturing_records", {
      product_id: productId,
      units_produced: unitsProduced,
      produced_at: producedAt,
      status: nextStatus,
      updated_at: nowIso(),
    }, [["id", recordId]]))[0];

    if (detailsChanged) {
      await applyManufacturing(recordId, productId, unitsProduced, nextStatus);
    } else if (currentStatus === "order" && nextStatus === "in_progress") {
      await applyManufacturingStart(recordId, productId, unitsProduced);
    } else if (currentStatus === "in_progress" && nextStatus === "completed") {
      await applyManufacturingCompletion(recordId, productId, unitsProduced);
    }
    return { ...updated, product_name: (await getProductById(productId))?.name || "" };
  }
  if (pathname.startsWith("/sales-records/")) {
    const recordId = toInt(pathname.split("/")[2], "id");
    const current = await selectSingle("sales_records", { eq: [["id", recordId]] });
    if (!current) throw new Error("Sales record not found");
    if (body.is_accounted !== undefined && Object.keys(body).every((key) => key === "is_accounted")) {
      const updated = (await updateRows(
        "sales_records",
        { is_accounted: Boolean(body.is_accounted), updated_at: nowIso() },
        [["id", recordId]]
      ))[0];
      return { ...updated, product_name: (await getProductById(updated.product_id))?.name || "" };
    }
    const productId = body.product_id !== undefined ? toInt(body.product_id, "product_id") : current.product_id;
    const unitsSold = body.units_sold !== undefined ? toPositiveInt(body.units_sold, "units_sold") : current.units_sold;
    const isGift=giftValue(body.is_gift===undefined?current.is_gift:body.is_gift);
    const unitSellPriceEgp = isGift?0:body.unit_sell_price_egp !== undefined ? toNonNegativeNumber(body.unit_sell_price_egp, "unit_sell_price_egp") : current.unit_sell_price_egp;
    const manufacturingCostPerUnit = body.manufacturing_cost_per_unit !== undefined
      ? toNonNegativeNumber(body.manufacturing_cost_per_unit, "manufacturing_cost_per_unit")
      : Number(current.manufacturing_cost_per_unit ?? 1000);
    const soldAt = body.sold_at !== undefined ? toUtcIsoFromInput(body.sold_at, "sold_at") : current.sold_at;
    let availableStock = await getFinishedStockQty(productId);
    if (productId === current.product_id) availableStock += current.units_sold;
    if (availableStock < unitsSold) {
      throw new Error(`Insufficient finished product stock. Available: ${availableStock}`);
    }
    await reverseLedgerForReference("sale", recordId);
    const metrics = await calculateSaleMetrics(productId, unitsSold, unitSellPriceEgp, manufacturingCostPerUnit);
    const updated = (await updateRows("sales_records", {
      product_id: productId,
      units_sold: unitsSold,
      is_gift:isGift,delivery_method:deliveryValue(body.delivery_method,current.delivery_method),
      customer_name:body.customer_name!==undefined?String(body.customer_name).trim()||null:current.customer_name,
      customer_phone:body.customer_phone!==undefined?String(body.customer_phone).trim()||null:current.customer_phone,
      unit_sell_price_egp: unitSellPriceEgp,
      unit_purchase_cost_egp: metrics.unitPurchaseCostEgp,
      total_purchase_cost_egp: metrics.totalPurchaseCostEgp,
      revenue_egp: metrics.revenueEgp,
      gross_profit_egp: metrics.grossProfitEgp,
      margin_pct: metrics.marginPct,
      manufacturing_cost_per_unit: manufacturingCostPerUnit,
      cost_includes_manufacturing: true,
      cost_complete:metrics.costComplete,
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
    if((await selectRows('shop_purchases',{eq:[['supplier_id',supplierId]]})).length)throw new Error('المورد مرتبط بمشتريات المحل ولا يمكن حذفه');
    if ((await selectRows("components", { eq: [["supplier_id", supplierId]] })).length > 0) {
      throw withStatus(400, "Supplier is referenced by components");
    }
    await deleteRows("suppliers", [["id", supplierId]]);
    return { success: true };
  }
  if (pathname.startsWith("/maintenance-parts/")) {
    const partId = toInt(pathname.split("/")[2], "id");
    const part = await selectSingle("maintenance_parts", { eq: [["id", partId]] });
    if (!part) throw new Error("Maintenance part not found");
    const ticket = await selectSingle("maintenance_tickets", { eq: [["id", part.ticket_id]] });
    if (ticket?.status === "completed") throw new Error("Cannot change parts after completion");
    await reverseLedgerForReference("maintenance_part", partId);
    await deleteRows("maintenance_parts", [["id", partId]]);
    return { success: true };
  }
  if (pathname.startsWith("/maintenance-tickets/")) {
    const ticketId = toInt(pathname.split("/")[2], "id");
    const parts = await selectRows("maintenance_parts", { eq: [["ticket_id", ticketId]] });
    for (const part of parts) await reverseLedgerForReference("maintenance_part", part.id);
    await deleteRows("maintenance_tickets", [["id", ticketId]]);
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
    if((await selectRows('spare_sales')).some(s=>s.items.some(i=>i.component_id===componentId)))throw new Error('لا يمكن حذف قطعة لها فواتير بيع محفوظة');
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

async function purgeSalesInvoice(kind,id,body){
  const invoice=await invoices.get(kind,id),meta=invoice.meta;
  if(body.confirm_number!==invoice.number)throw new Error(`اكتب رقم الفاتورة ${invoice.number} لتأكيد الحذف النهائي`);
  if(Number(body.revision)!==(meta?.revision||0))throw new Error('الفاتورة اتغيّرت؛ افتحها من جديد قبل الحذف');
  const references=[];
  const remaining=line=>invoice.state==='cancelled'?0:line.quantity-line.returned;
  if(kind==='product'){
    const quantity=remaining(invoice.lines[0]);
    if(quantity)await updateFinishedStock(invoice.source.product_id,quantity);
    references.push(['inventory_ledger','sale',id]);
  }else if(kind==='printer'||kind==='spare'){
    for(const line of invoice.lines){
      const quantity=remaining(line);
      if(!quantity)continue;
      if(line.shop_item_id)await shop.move(line.shop_item_id,quantity,'invoice_purge',id,'restore');
      else if(kind==='spare'&&line.component_id)await updateComponentStock(line.component_id,quantity);
    }
    references.push(kind==='printer'?['shop_stock_ledger','printer_sale',id]:['inventory_ledger','spare_sale',id]);
    if(kind==='spare')references.push(['shop_stock_ledger','spare_sale',id]);
  }else if(kind==='maintenance'){
    const parts=await selectRows('maintenance_parts',{eq:[['ticket_id',id]]});
    for(const part of parts){
      await reverseLedgerForReference('maintenance_part',part.id);
      references.push(['inventory_ledger','maintenance_part',part.id]);
      await deleteRows('maintenance_parts',[['id',part.id]]);
    }
  }
  const returns=meta?await selectRows('sales_returns',{eq:[['invoice_id',meta.id]]}):[];
  for(const row of returns){references.push(['inventory_ledger','sales_return',row.id],['shop_stock_ledger','sales_return',row.id]);}
  if(meta)references.push(['inventory_ledger','sales_cancellation',meta.id],['shop_stock_ledger','sales_cancellation',meta.id]);
  for(const [table,type,referenceId] of references)await deleteRows(table,[['reference_type',type],['reference_id',referenceId]]);
  if(kind==='printer'||kind==='spare')await deleteRows('shop_stock_ledger',[['reference_type','invoice_purge'],['reference_id',id]]);
  if(meta){
    for(const table of ['sales_events','sales_payments','sales_returns'])await deleteRows(table,[['invoice_id',meta.id]]);
    await deleteRows('sales_invoice_meta',[['id',meta.id]]);
  }
  await deleteRows(invoices.sourceTables[kind],[['id',id]]);
  return {success:true,deleted:invoice.number};
}

async function request(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const body = options.body ? JSON.parse(options.body) : {};
  const { pathname, query } = parsePath(path);
  if (pathname.startsWith('/auth/') || pathname.startsWith('/accounts')) throw withStatus(404, 'Route not found');
  if(method==='POST'&&/^\/sales-hub\/(product|printer|spare|maintenance)\/\d+\/(review|payment|return|cancel)$/.test(pathname)){
    const [,,kind,id,action]=pathname.split('/');return invoices.mutate(kind,Number(id),action,body);
  }
  if(method==='POST'&&/^\/sales-hub\/(product|printer|spare|maintenance)\/\d+\/purge$/.test(pathname)){
    const [,,kind,id]=pathname.split('/');return purgeSalesInvoice(kind,Number(id),body);
  }
  const match=pathname.match(/^\/(sales-records|printer-sales|spare-sales|maintenance-tickets)(?:\/(\d+))?$/);
  // Production operations always supply the authenticated actor. Read helpers can run independently.
  if(context.actor&&match&&method!=='GET'){
    const kind={'sales-records':'product','printer-sales':'printer','spare-sales':'spare','maintenance-tickets':'maintenance'}[match[1]],id=Number(match[2]);
    const current=id?await selectSingle(invoices.sourceTables[kind],{eq:[['id',id]]}):null;
    const finalized=kind!=='maintenance'||current?.status==='completed';
    if(method==='DELETE'&&finalized)throw new Error('استخدم إلغاء الفاتورة من المبيعات مع تسجيل السبب بدل الحذف');
    const accountOnly=kind==='product'&&body.is_accounted!==undefined&&Object.keys(body).every(k=>k==='is_accounted');
    if(current&&finalized&&!accountOnly)await invoices.before(kind,id,body);
    if(kind==='printer'&&body.serial_number){
      const serial=String(body.serial_number).trim().toUpperCase();
      const all=await invoices.list();const duplicate=all.find(r=>r.kind==='printer'&&r.source_id!==id&&r.serial.toUpperCase()===serial&&r.state!=='cancelled'&&r.lines[0].returned<r.lines[0].quantity);
      if(duplicate)throw new Error(`السريل مستخدم في فاتورة ${duplicate.number}؛ راجع الفاتورة قبل البيع`);
      body.serial_number=serial;
    }
    const result=method==='POST'?await handlePost(pathname,body):method==='PUT'?await handlePut(pathname,body):await handleDelete(pathname);
    if(method==='POST'&&kind!=='maintenance')await invoices.created(kind,result,body);
    if(method==='PUT'&&current&&(finalized||result.status==='completed')){
      if(!finalized)await invoices.created(kind,result,body);else await invoices.edited(kind,id,current,result);
    }
    return result;
  }
  if (method === "GET") return handleGet(pathname, query);
  if (method === "POST") return handlePost(pathname, body);
  if (method === "PUT") return handlePut(pathname, body);
  if (method === "DELETE") return handleDelete(pathname);
  throw new Error(`Unsupported method: ${method}`);
}
return {request};
}
