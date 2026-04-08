create table if not exists suppliers (
  id bigint generated always as identity primary key,
  name text not null unique,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists components (
  id bigint generated always as identity primary key,
  item_name text not null,
  item_name_normalized text not null unique,
  stock_qty integer not null default 0,
  supplier_id bigint references suppliers(id) on delete set null,
  purchase_link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists component_price_history (
  id bigint generated always as identity primary key,
  component_id bigint not null references components(id) on delete cascade,
  supplier_id bigint references suppliers(id) on delete set null,
  price_egp numeric not null check (price_egp >= 0),
  effective_at timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists component_intake_records (
  id bigint generated always as identity primary key,
  component_id bigint not null references components(id) on delete restrict,
  qty_received integer not null check (qty_received > 0),
  supplier_id bigint references suppliers(id) on delete set null,
  purchase_link text,
  unit_price_egp numeric check (unit_price_egp >= 0),
  received_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bom_items (
  id bigint generated always as identity primary key,
  product_id bigint not null references products(id) on delete cascade,
  component_id bigint not null references components(id) on delete restrict,
  qty_per_unit integer not null check (qty_per_unit > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, component_id)
);

create table if not exists manufacturing_records (
  id bigint generated always as identity primary key,
  product_id bigint not null references products(id) on delete restrict,
  units_produced integer not null check (units_produced > 0),
  produced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sales_records (
  id bigint generated always as identity primary key,
  product_id bigint not null references products(id) on delete restrict,
  units_sold integer not null check (units_sold > 0),
  unit_sell_price_egp numeric not null check (unit_sell_price_egp >= 0),
  unit_purchase_cost_egp numeric not null,
  total_purchase_cost_egp numeric not null,
  revenue_egp numeric not null,
  gross_profit_egp numeric not null,
  margin_pct numeric not null,
  sold_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists damage_records (
  id bigint generated always as identity primary key,
  component_id bigint not null references components(id) on delete restrict,
  qty_damaged integer not null check (qty_damaged > 0),
  damaged_at timestamptz not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists finished_stock (
  product_id bigint primary key references products(id) on delete cascade,
  stock_qty integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists inventory_ledger (
  id bigint generated always as identity primary key,
  item_type text not null check (item_type in ('component', 'finished')),
  item_id bigint not null,
  delta_qty integer not null,
  reason text not null check (reason in ('receipt', 'manufacture', 'sale', 'adjustment', 'reversal')),
  reference_type text not null,
  reference_id bigint not null,
  reversed boolean not null default false,
  reversed_from_id bigint,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into settings (key, value, updated_at)
values ('language', 'en', now())
on conflict (key) do nothing;

create index if not exists idx_price_component_active on component_price_history(component_id, is_active, effective_at desc);
create index if not exists idx_component_intake_component_time on component_intake_records(component_id, received_at desc, id desc);
create index if not exists idx_damage_damaged_at on damage_records(damaged_at desc);
create index if not exists idx_inventory_reference on inventory_ledger(reference_type, reference_id, reversed);

alter table suppliers enable row level security;
alter table components enable row level security;
alter table component_price_history enable row level security;
alter table component_intake_records enable row level security;
alter table products enable row level security;
alter table bom_items enable row level security;
alter table manufacturing_records enable row level security;
alter table sales_records enable row level security;
alter table damage_records enable row level security;
alter table finished_stock enable row level security;
alter table inventory_ledger enable row level security;
alter table settings enable row level security;

drop policy if exists "public suppliers" on suppliers;
create policy "public suppliers" on suppliers for all using (true) with check (true);
drop policy if exists "public components" on components;
create policy "public components" on components for all using (true) with check (true);
drop policy if exists "public component_price_history" on component_price_history;
create policy "public component_price_history" on component_price_history for all using (true) with check (true);
drop policy if exists "public component_intake_records" on component_intake_records;
create policy "public component_intake_records" on component_intake_records for all using (true) with check (true);
drop policy if exists "public products" on products;
create policy "public products" on products for all using (true) with check (true);
drop policy if exists "public bom_items" on bom_items;
create policy "public bom_items" on bom_items for all using (true) with check (true);
drop policy if exists "public manufacturing_records" on manufacturing_records;
create policy "public manufacturing_records" on manufacturing_records for all using (true) with check (true);
drop policy if exists "public sales_records" on sales_records;
create policy "public sales_records" on sales_records for all using (true) with check (true);
drop policy if exists "public damage_records" on damage_records;
create policy "public damage_records" on damage_records for all using (true) with check (true);
drop policy if exists "public finished_stock" on finished_stock;
create policy "public finished_stock" on finished_stock for all using (true) with check (true);
drop policy if exists "public inventory_ledger" on inventory_ledger;
create policy "public inventory_ledger" on inventory_ledger for all using (true) with check (true);
drop policy if exists "public settings" on settings;
create policy "public settings" on settings for all using (true) with check (true);
