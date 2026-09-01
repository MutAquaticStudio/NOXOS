begin;

select plan(16);

select is(
  (
    select array_agg(table_name::text order by table_name)
    from information_schema.tables
    where table_schema = 'release_readiness' and table_type = 'BASE TABLE'
  ),
  array['assessments', 'checks']::text[],
  'Release Readiness owns exactly assessments and checks'
);

select has_table('release_readiness', 'assessments', 'assessments table exists');
select has_table('release_readiness', 'checks', 'checks table exists');

select ok(
  not has_schema_privilege('anon', 'release_readiness', 'usage')
    and not has_schema_privilege('authenticated', 'release_readiness', 'usage'),
  'browser roles cannot use the private Release Readiness schema'
);
select ok(
  has_schema_privilege('nox_app_runtime', 'release_readiness', 'usage'),
  'limited application runtime may use the private schema'
);
select ok(
  has_table_privilege('nox_app_runtime', 'release_readiness.assessments', 'select,insert')
    and not has_table_privilege('nox_app_runtime', 'release_readiness.assessments', 'update')
    and not has_table_privilege('nox_app_runtime', 'release_readiness.assessments', 'delete')
    and not has_table_privilege('nox_app_runtime', 'release_readiness.assessments', 'truncate'),
  'runtime can create/read but cannot mutate final assessments'
);
select ok(
  has_table_privilege('nox_app_runtime', 'release_readiness.checks', 'select,insert')
    and not has_table_privilege('nox_app_runtime', 'release_readiness.checks', 'update')
    and not has_table_privilege('nox_app_runtime', 'release_readiness.checks', 'delete'),
  'runtime can create/read but cannot mutate final checks'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class
    where relnamespace = 'release_readiness'::regnamespace
      and relkind = 'r' and relrowsecurity and relforcerowsecurity
  ),
  2,
  'both canonical tables force row security'
);

select has_trigger(
  'release_readiness', 'assessments', 'assessments_source_guard',
  'assessment source eligibility is checked in PostgreSQL'
);
select has_trigger(
  'release_readiness', 'assessments', 'assessments_immutable',
  'final assessment is immutable'
);
select has_trigger(
  'release_readiness', 'checks', 'checks_immutable',
  'final check set is immutable'
);
select has_trigger(
  'release_readiness', 'assessments', 'assessments_complete_check_set',
  'assessment cannot commit with a partial check set'
);

select ok(
  pg_get_functiondef('release_readiness.assert_assessment_source()'::regprocedure)
    like '%source_composition_kind is distinct from ''FULL_FORMULA''%'
    and pg_get_functiondef('release_readiness.assert_assessment_source()'::regprocedure)
      like '%source_approval is distinct from ''APPROVED''%',
  'database rejects non-FULL or unapproved Formula sources'
);
select ok(
  pg_get_functiondef('release_readiness.assert_complete_check_set()'::regprocedure)
    like '%RELEASE_ASSESSMENT_DECISION_MISMATCH%'
    and pg_get_functiondef('release_readiness.protect_assessment_check()'::regprocedure)
      like '%RELEASE_CHECK_MATERIAL_NOT_IN_FORMULA%',
  'database derives final decision from checks and rejects unrelated Material evidence'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'release_readiness.assessments'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like '%design_studio.formula_versions%'
  ),
  'assessment references the exact G4 FormulaVersion authority'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'release_readiness.assessments'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like '%release_readiness.assessments%'
  ),
  'reassessment lineage references an immutable prior assessment'
);

select * from finish();
rollback;
