module.exports={shopSchema:[
 `CREATE TABLE shop_items (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,item_name text NOT NULL,item_name_normalized text NOT NULL UNIQUE,
 stock_qty integer NOT NULL DEFAULT 0 CHECK(stock_qty>=0),sell_price numeric(16,2) CHECK(sell_price>=0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`,
 `CREATE TABLE shop_purchases (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,shop_item_id bigint NOT NULL REFERENCES shop_items(id),
 quantity integer NOT NULL CHECK(quantity>0),unit_price numeric(16,2) NOT NULL CHECK(unit_price>=0),supplier_id bigint REFERENCES suppliers(id),
 received_at timestamptz NOT NULL,notes text,revision integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`,
 `CREATE TABLE shop_stock_ledger (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,shop_item_id bigint NOT NULL REFERENCES shop_items(id),delta_qty integer NOT NULL,
 reference_type text NOT NULL,reference_id bigint NOT NULL,reason text NOT NULL,reversed boolean NOT NULL DEFAULT false,actor text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`,
 ...['shop_items','shop_purchases','shop_stock_ledger'].flatMap(t=>[`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`,`REVOKE ALL ON ${t} FROM PUBLIC`]),
 'CREATE INDEX shop_stock_reference ON shop_stock_ledger(reference_type,reference_id,reversed)',
 'CREATE INDEX shop_purchase_item ON shop_purchases(shop_item_id,received_at)',
 ...['printer_sales','sales_records','spare_sales'].map(t=>`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS delivery_method text CHECK(delivery_method IN ('damietta','mansoura','shipping'))`),
 ...['printer_sales','sales_records'].map(t=>`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS is_gift boolean NOT NULL DEFAULT false`),
]};
