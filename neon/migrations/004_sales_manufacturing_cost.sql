alter table sales_records
add column if not exists manufacturing_cost_per_unit numeric not null default 1000;

alter table sales_records
add column if not exists cost_includes_manufacturing boolean not null default false;

update sales_records
set unit_purchase_cost_egp = unit_purchase_cost_egp + manufacturing_cost_per_unit,
    total_purchase_cost_egp = total_purchase_cost_egp + (manufacturing_cost_per_unit * units_sold),
    gross_profit_egp = revenue_egp - (total_purchase_cost_egp + (manufacturing_cost_per_unit * units_sold)),
    margin_pct = case
      when revenue_egp = 0 then 0
      else ((revenue_egp - (total_purchase_cost_egp + (manufacturing_cost_per_unit * units_sold))) / revenue_egp) * 100
    end,
    cost_includes_manufacturing = true
where cost_includes_manufacturing = false;
