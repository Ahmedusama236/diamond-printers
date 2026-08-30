alter table sales_records
add column if not exists is_accounted boolean not null default false;
