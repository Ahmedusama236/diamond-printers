create table if not exists maintenance_tickets (
  id bigint generated always as identity primary key,
  customer_name text not null,
  phone text not null,
  device_issue text not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  repair_charge_egp numeric not null default 0 check (repair_charge_egp >= 0),
  delivered boolean not null default false,
  opened_at timestamptz not null default now(),
  completed_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists maintenance_parts (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references maintenance_tickets(id) on delete cascade,
  component_id bigint not null references components(id) on delete restrict,
  qty_used integer not null check (qty_used > 0),
  unit_price_egp numeric not null default 0 check (unit_price_egp >= 0),
  total_price_egp numeric not null default 0 check (total_price_egp >= 0),
  created_at timestamptz not null default now()
);
