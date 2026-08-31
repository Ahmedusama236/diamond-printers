alter table components
add column if not exists minimum_stock_qty integer
check (minimum_stock_qty is null or minimum_stock_qty >= 0);
