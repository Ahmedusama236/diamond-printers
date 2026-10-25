module.exports={saleTypesSchema:[
 `ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS device_type text CHECK(device_type IN ('printer','device'))`,
 `CREATE TABLE spare_sales (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
   items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)>0),
   total_amount numeric(16,2) NOT NULL CHECK(total_amount>=0),customer_name text,customer_phone text,
   sold_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`,
 'ALTER TABLE spare_sales ENABLE ROW LEVEL SECURITY',
 'REVOKE ALL ON spare_sales FROM PUBLIC',
 'ALTER TABLE sales_invoice_meta DROP CONSTRAINT IF EXISTS sales_invoice_meta_kind_check',
 `ALTER TABLE sales_invoice_meta ADD CONSTRAINT sales_invoice_meta_kind_check CHECK(kind IN ('product','printer','spare','maintenance'))`,
]};
