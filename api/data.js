const { neon } = require("@neondatabase/serverless");
const { ensureAuth, currentUser } = require('../lib/auth');
const {runMigration} = require('../lib/migrations');
const {salesSchemaStatements} = require('../lib/sales-schema');
const {saleTypesSchema} = require('../lib/sale-types-schema');

const TABLES = new Set([
  "suppliers",
  "components",
  "component_price_history",
  "component_intake_records",
  "products",
  "bom_items",
  "manufacturing_records",
  "sales_records",
  "damage_records",
  "finished_stock",
  "inventory_ledger",
  "settings",
  "maintenance_tickets",
  "maintenance_parts",
  "printer_sales",
]);

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const NUMERIC_OIDS = new Set([20, 21, 23, 700, 701, 1700]);
let schemaReady = false;

async function ensureSchema(database) {
  if (schemaReady) return;
  const statements=[];
  const sql={query:async(statement)=>{statements.push(statement);}};
  await sql.query(`CREATE TABLE IF NOT EXISTS printer_sales (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_name text NOT NULL, quantity integer NOT NULL CHECK(quantity>0),
    unit_price numeric NOT NULL CHECK(unit_price>=0), counter bigint CHECK(counter>=0),
    customer_phone text, customer_name text,
    sold_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    request_id uuid UNIQUE NOT NULL)`);
  await sql.query('ALTER TABLE printer_sales ALTER COLUMN customer_phone DROP NOT NULL');
  await sql.query(`
    ALTER TABLE components
    ADD COLUMN IF NOT EXISTS minimum_stock_qty integer
    CHECK (minimum_stock_qty IS NULL OR minimum_stock_qty >= 0)
  `);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS maintenance_tickets (
      id bigint generated always as identity primary key,
      customer_name text not null,
      phone text,
      device_issue text not null,
      maintenance_description text,
      status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
      repair_charge_egp numeric not null default 0 check (repair_charge_egp >= 0),
      delivered boolean not null default false,
      opened_at timestamptz not null default now(),
      completed_at timestamptz,
      delivered_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await sql.query(`
    ALTER TABLE maintenance_tickets
    ADD COLUMN IF NOT EXISTS maintenance_description text
  `);
  await sql.query(`
    ALTER TABLE maintenance_tickets
    ALTER COLUMN phone DROP NOT NULL
  `);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS maintenance_parts (
      id bigint generated always as identity primary key,
      ticket_id bigint not null references maintenance_tickets(id) on delete cascade,
      component_id bigint not null references components(id) on delete restrict,
      qty_used integer not null check (qty_used > 0),
      unit_price_egp numeric not null default 0 check (unit_price_egp >= 0),
      total_price_egp numeric not null default 0 check (total_price_egp >= 0),
      created_at timestamptz not null default now()
    )
  `);
  await sql.query(`
    ALTER TABLE manufacturing_records
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('order', 'in_progress', 'completed'))
  `);
  await sql.query(`
    ALTER TABLE sales_records
    ADD COLUMN IF NOT EXISTS is_accounted boolean NOT NULL DEFAULT false
  `);
  await sql.query(`
    ALTER TABLE sales_records
    ADD COLUMN IF NOT EXISTS manufacturing_cost_per_unit numeric NOT NULL DEFAULT 1000
  `);
  await sql.query(`
    ALTER TABLE sales_records
    ADD COLUMN IF NOT EXISTS cost_includes_manufacturing boolean NOT NULL DEFAULT false
  `);
  await sql.query(`
    UPDATE sales_records
    SET unit_purchase_cost_egp = unit_purchase_cost_egp + manufacturing_cost_per_unit,
        total_purchase_cost_egp = total_purchase_cost_egp + (manufacturing_cost_per_unit * units_sold),
        gross_profit_egp = revenue_egp - (total_purchase_cost_egp + (manufacturing_cost_per_unit * units_sold)),
        margin_pct = CASE
          WHEN revenue_egp = 0 THEN 0
          ELSE ((revenue_egp - (total_purchase_cost_egp + (manufacturing_cost_per_unit * units_sold))) / revenue_egp) * 100
        END,
        cost_includes_manufacturing = true
    WHERE cost_includes_manufacturing = false
  `);
  await runMigration(database,'business_schema_v11',statements);
  await runMigration(database,'printer_invoice_extras_v1',[
    `ALTER TABLE public.printer_sales ADD COLUMN IF NOT EXISTS extra_items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(extra_items) = 'array')`,
  ]);
  await runMigration(database,'printer_serial_number_v1',[
    'ALTER TABLE public.printer_sales ADD COLUMN IF NOT EXISTS serial_number text',
  ]);
  await runMigration(database,'unified_sales_20261025_v1',salesSchemaStatements);
  await runMigration(database,'sale_repair_types_20261025_v1',saleTypesSchema);
  schemaReady = true;
}

function identifier(value, type) {
  const text = String(value || "");
  if (!IDENTIFIER.test(text)) throw new Error(`Invalid ${type}`);
  return `"${text}"`;
}

function tableName(value) {
  if (!TABLES.has(value)) throw new Error("Table is not allowed");
  return identifier(value, "table");
}

function addFilters(parts, params, filters = [], operator = "=") {
  for (const entry of filters) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error("Invalid filter");
    params.push(entry[1]);
    parts.push(`${identifier(entry[0], "column")} ${operator} $${params.length}`);
  }
}

function normalizeRows(result) {
  const numericFields = new Set(
    (result.fields || []).filter((field) => NUMERIC_OIDS.has(field.dataTypeID)).map((field) => field.name)
  );
  return (result.rows || []).map((row) => {
    const normalized = { ...row };
    for (const field of numericFields) {
      if (normalized[field] !== null && normalized[field] !== undefined) {
        normalized[field] = Number(normalized[field]);
      }
    }
    return normalized;
  });
}

async function queryDatabase(sql, text, params) {
  const result = await sql.query(text, params, { fullResults: true });
  return normalizeRows(result);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ error: "DATABASE_URL is not configured" });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensureAuth(sql);
    const user = await currentUser(sql, req);
    if (!user) return res.status(401).json({error:'Authentication required'});
    if (req.headers.origin && req.headers.host && new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({error:'Invalid origin'});
    res.setHeader('Cache-Control','no-store');
    await ensureSchema(sql);
    const body = req.body || {};
    if(body.action === 'business') {
      const {executeOperation} = require('../lib/operations');
      await runMigration(sql,'modern_operations_v1',[
        `CREATE TABLE IF NOT EXISTS app_operation_requests (
          user_id bigint NOT NULL, request_id uuid NOT NULL, fingerprint text NOT NULL,
          result jsonb, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,request_id))`,
        'ALTER TABLE app_operation_requests ENABLE ROW LEVEL SECURITY',
        // Data-only recovery snapshot, created once before the first modern operation.
        'CREATE SCHEMA IF NOT EXISTS diamond_backup_20261021',
        `LOCK TABLE ${Array.from(TABLES).map(table=>'public.'+table).join(',')} IN SHARE MODE`,
        ...Array.from(TABLES).map(table=>`CREATE TABLE IF NOT EXISTS diamond_backup_20261021.${table} AS TABLE public.${table}`),
        'REVOKE ALL ON SCHEMA diamond_backup_20261021 FROM PUBLIC',
      ]);
      const data=await executeOperation(process.env.DATABASE_URL,user,body);
      return res.status(200).json({data});
    }
    if(body.action !== 'select') return res.status(409).json({error:'تم تحديث النظام. حدّث الصفحة لإتمام العملية بأمان.'});
    const table = tableName(body.table);
    const params = [];
    let statement;

    if (body.action === "select") {
      const where = [];
      addFilters(where, params, body.eq);
      addFilters(where, params, body.ilike, "ILIKE");
      statement = `SELECT * FROM ${table}`;
      if (where.length) statement += ` WHERE ${where.join(" AND ")}`;
      if (Array.isArray(body.order) && body.order.length) {
        const order = body.order.map(([column, ascending]) =>
          `${identifier(column, "column")} ${ascending ? "ASC" : "DESC"}`
        );
        statement += ` ORDER BY ${order.join(", ")}`;
      }
      if (body.limit) {
        const limit = Number.parseInt(body.limit, 10);
        if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error("Invalid limit");
        statement += ` LIMIT ${limit}`;
      }
    } else if (body.action === "insert") {
      const payload = body.payload || {};
      if (body.table === 'printer_sales') {
        if (!String(payload.item_name || '').trim()) throw new Error('الصنف مطلوب');
        if (payload.quantity === undefined || payload.quantity === null || payload.quantity === '') payload.quantity = 1;
        payload.customer_phone = String(payload.customer_phone || '').trim() || null;
        if (!Number.isSafeInteger(Number(payload.quantity)) || Number(payload.quantity) <= 0) throw new Error('العدد غير صالح');
        if (payload.unit_price === '' || !Number.isFinite(Number(payload.unit_price)) || Number(payload.unit_price)<0) throw new Error('السعر غير صالح');
        if (payload.counter != null && (!Number.isSafeInteger(Number(payload.counter)) || Number(payload.counter)<0)) throw new Error('العداد غير صالح');
        if (!payload.sold_at || !Number.isFinite(Date.parse(payload.sold_at))) throw new Error('التاريخ غير صالح');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.request_id || '')) throw new Error('Invalid invoice request');
      }
      const columns = Object.keys(payload);
      if (!columns.length) throw new Error("Insert payload is empty");
      params.push(...columns.map((column) => payload[column]));
      statement = `INSERT INTO ${table} (${columns.map((column) => identifier(column, "column")).join(", ")}) VALUES (${params.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING *`;
      if (body.table === 'printer_sales') statement = statement.replace(' RETURNING *', ' ON CONFLICT(request_id) DO UPDATE SET request_id=EXCLUDED.request_id RETURNING *');
    } else if (body.action === "update") {
      const payload = body.payload || {};
      const columns = Object.keys(payload);
      if (!columns.length || !Array.isArray(body.eq) || !body.eq.length) throw new Error("Invalid update");
      const set = columns.map((column) => {
        params.push(payload[column]);
        return `${identifier(column, "column")} = $${params.length}`;
      });
      const where = [];
      addFilters(where, params, body.eq);
      statement = `UPDATE ${table} SET ${set.join(", ")} WHERE ${where.join(" AND ")} RETURNING *`;
    } else if (body.action === "delete") {
      if (!Array.isArray(body.eq) || !body.eq.length) throw new Error("Delete filters are required");
      const where = [];
      addFilters(where, params, body.eq);
      statement = `DELETE FROM ${table} WHERE ${where.join(" AND ")} RETURNING *`;
    } else {
      throw new Error("Invalid database action");
    }

    const rows = await queryDatabase(sql, statement, params);
    return res.status(200).json({ data: rows });
  } catch (error) {
    const messages={'23503':'لا يمكن إتمام العملية لارتباط السجل ببيانات أخرى.','23505':'هذا السجل موجود بالفعل.','23514':'القيم المدخلة غير صالحة.','57014':'استغرقت العملية وقتًا أطول من المتوقع. حاول مرة أخرى.'};
    return res.status(error.status || 400).json({ error: messages[error.code] || error.message || "Database request failed" });
  }
};
