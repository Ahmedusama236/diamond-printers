alter table manufacturing_records
add column if not exists status text not null default 'completed'
check (status in ('order', 'in_progress', 'completed'));
