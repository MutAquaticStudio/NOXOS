begin;

-- Draft production orders may replace their derived lines and lot allocations.
-- Keep the runtime role narrowly scoped: DELETE is limited to these two
-- draft-guarded tables; no order, batch, or cross-module delete privilege is
-- introduced.
grant delete on production.production_order_lines to nox_app_runtime;
grant delete on production.production_material_allocations to nox_app_runtime;

commit;
