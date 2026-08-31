const { neon } = require("@neondatabase/serverless");

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
]);

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const NUMERIC_OIDS = new Set([20, 21, 23, 700, 701, 1700]);
let schemaReady = false;

async function ensureSchema(sql) {
  if (schemaReady) return;
  await sql.query(`
    ALTER TABLE components
    ADD COLUMN IF NOT EXISTS minimum_stock_qty integer
    CHECK (minimum_stock_qty IS NULL OR minimum_stock_qty >= 0)
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
    await ensureSchema(sql);
    const body = req.body || {};
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
      const columns = Object.keys(payload);
      if (!columns.length) throw new Error("Insert payload is empty");
      params.push(...columns.map((column) => payload[column]));
      statement = `INSERT INTO ${table} (${columns.map((column) => identifier(column, "column")).join(", ")}) VALUES (${params.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING *`;
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
    return res.status(400).json({ error: error.message || "Database request failed" });
  }
};
