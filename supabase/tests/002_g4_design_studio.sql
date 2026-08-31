begin;

select plan(23);

select is(
  (
    select array_agg(table_name::text order by table_name)
    from information_schema.tables
    where table_schema = 'design_studio'
      and table_type = 'BASE TABLE'
  ),
  array[
    'design_briefs',
    'formula_frozen_snapshots',
    'formula_lines',
    'formula_versions',
    'formulas',
    'projects'
  ]::text[],
  'Design Studio owns exactly the six canonical persistence tables'
);

select has_table('design_studio', 'projects', 'projects table exists');
select has_table('design_studio', 'design_briefs', 'design briefs table exists');
select has_table('design_studio', 'formulas', 'formulas table exists');
select has_table('design_studio', 'formula_versions', 'formula versions table exists');
select has_table('design_studio', 'formula_lines', 'formula lines table exists');
select has_table(
  'design_studio',
  'formula_frozen_snapshots',
  'formula frozen snapshots table exists'
);

select ok(
  not has_schema_privilege('anon', 'design_studio', 'usage')
    and not has_schema_privilege('authenticated', 'design_studio', 'usage'),
  'browser roles cannot use the private Design Studio schema'
);

select ok(
  has_schema_privilege('nox_app_runtime', 'design_studio', 'usage'),
  'limited application runtime may use the private schema'
);

select ok(
  not has_table_privilege('anon', 'design_studio.projects', 'select')
    and not has_table_privilege('authenticated', 'design_studio.projects', 'select'),
  'browser roles cannot read Design Studio persistence'
);

select ok(
  has_table_privilege('nox_app_runtime', 'design_studio.projects', 'select,insert,update,delete'),
  'limited application runtime has the required project DML surface'
);

select ok(
  not has_table_privilege('nox_app_runtime', 'design_studio.projects', 'truncate')
    and not has_table_privilege('nox_app_runtime', 'design_studio.projects', 'references')
    and not has_table_privilege('nox_app_runtime', 'design_studio.projects', 'trigger'),
  'limited application runtime has no structural table privileges'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class
    where relnamespace = 'design_studio'::regnamespace
      and relkind = 'r'
      and relrowsecurity
      and relforcerowsecurity
  ),
  6,
  'all six canonical tables force row security'
);

select has_trigger(
  'design_studio',
  'formula_versions',
  'formula_versions_immutability',
  'formula versions have a database immutability trigger'
);
select has_trigger(
  'design_studio',
  'formula_lines',
  'formula_lines_mutability',
  'formula lines are protected after freeze'
);
select has_trigger(
  'design_studio',
  'formula_frozen_snapshots',
  'formula_frozen_snapshots_mutability',
  'frozen Material snapshots are protected after freeze'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'design_studio.formula_frozen_snapshots'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like '%snapshot_hash%material_snapshot_hash%'
  ),
  'snapshot hash must equal the referenced Formula line Material snapshot hash'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'design_studio.formula_versions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%reference_formula_mass_mg = 1000000%'
  ),
  'Formula versions use the exact one-kilogram reference mass'
);

select has_column(
  'design_studio',
  'formula_lines',
  'contribution_evidence',
  'Formula lines preserve transparent contribution evidence'
);

select ok(
  pg_get_functiondef('design_studio.protect_formula_version()'::regprocedure)
    like '%sum(normalized_mass_mg)%FORMULA_TOTAL_OR_SNAPSHOT_SET_INVALID%',
  'Freeze transition checks the exact line total and complete snapshot set'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'material_intelligence'
      and table_name = 'material_properties'
      and column_name = 'odor_threshold'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'material_intelligence'
      and table_name = 'material_properties'
      and column_name = 'ifra_limits'
  ),
  'G3 Material properties are extended in-place for G4 guidance'
);

select has_table(
  'material_intelligence',
  'material_formulation_guidance',
  'canonical G3 formulation guidance table exists'
);
select has_table(
  'scientific_runtime',
  'scientific_artifacts',
  'scientific artifacts remain isolated in the scientific runtime schema'
);

select * from finish();
rollback;
