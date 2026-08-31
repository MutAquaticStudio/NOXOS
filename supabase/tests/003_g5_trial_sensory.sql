begin;

select plan(19);

select is(
  (
    select array_agg(table_name::text order by table_name)
    from information_schema.tables
    where table_schema = 'trial_sensory' and table_type = 'BASE TABLE'
  ),
  array['sensory_deltas', 'sensory_evaluations', 'trial_lines', 'trials']::text[],
  'Trial and Sensory owns exactly the four canonical persistence tables'
);

select has_table('trial_sensory', 'trials', 'trials table exists');
select has_table('trial_sensory', 'trial_lines', 'trial lines table exists');
select has_table('trial_sensory', 'sensory_evaluations', 'sensory evaluations table exists');
select has_table('trial_sensory', 'sensory_deltas', 'sensory deltas table exists');

select ok(
  not has_schema_privilege('anon', 'trial_sensory', 'usage')
    and not has_schema_privilege('authenticated', 'trial_sensory', 'usage'),
  'browser roles cannot use the private Trial and Sensory schema'
);
select ok(
  has_schema_privilege('nox_app_runtime', 'trial_sensory', 'usage'),
  'limited application runtime may use the private schema'
);
select ok(
  not has_table_privilege('anon', 'trial_sensory.trials', 'select')
    and not has_table_privilege('authenticated', 'trial_sensory.trials', 'select'),
  'browser roles cannot read Trial persistence'
);
select ok(
  has_table_privilege('nox_app_runtime', 'trial_sensory.trials', 'select,insert,update,delete')
    and not has_table_privilege('nox_app_runtime', 'trial_sensory.trials', 'truncate'),
  'limited runtime has DML but no structural table privilege'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class
    where relnamespace = 'trial_sensory'::regnamespace
      and relkind = 'r' and relrowsecurity and relforcerowsecurity
  ),
  4,
  'all four canonical tables force row security'
);

select has_trigger('trial_sensory', 'trials', 'trials_formula_lineage', 'Trial lineage is checked');
select has_trigger('trial_sensory', 'trials', 'trials_immutability', 'Prepared Trial is immutable');
select has_trigger(
  'trial_sensory',
  'trial_lines',
  'trial_lines_mutability',
  'Trial lines lock after preparation'
);
select has_trigger(
  'trial_sensory',
  'sensory_evaluations',
  'sensory_evaluations_immutability',
  'FINAL evaluation is immutable'
);
select has_trigger(
  'trial_sensory',
  'sensory_deltas',
  'sensory_deltas_mutability',
  'sensory deltas lock after FINAL'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'trial_sensory.trial_lines'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like '%design_studio.formula_lines%material_snapshot_hash%'
  ),
  'Trial line Material and snapshot hash belong to the exact frozen Formula line'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'trial_sensory' and table_name = 'sensory_deltas'
      and column_name in ('material_id', 'formula_line_id')
  ),
  'sensory deltas remain whole-composition taxonomy truth'
);
select ok(
  pg_get_functiondef('trial_sensory.protect_trial()'::regprocedure)
    like '%sum(scaled_mass_mg)%TRIAL_FORMULA_TOTAL_INVALID%',
  'PREPARED transition enforces the exact target mass total'
);

select ok(
  pg_get_functiondef('trial_sensory.protect_evaluation()'::regprocedure)
    like '%trial_status is distinct from ''PREPARED''%TRIAL_NOT_PREPARED%',
  'draft sensory evidence is immutable after its Trial leaves PREPARED'
);

select * from finish();
rollback;
