-- Fail closed when a draft SensoryEvaluation belongs to a cancelled or
-- otherwise non-PREPARED Trial. This forward migration is intentionally
-- separate because the initial G5 migration may already exist in Preview.

begin;

create or replace function trial_sensory.protect_evaluation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  owner_tenant_id uuid;
  owner_trial_id uuid;
  trial_status text;
  unconfirmed_count integer;
  nonzero_count integer;
begin
  owner_tenant_id := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  owner_trial_id := case when tg_op = 'DELETE' then old.trial_id else new.trial_id end;

  select status into trial_status
  from trial_sensory.trials
  where tenant_id = owner_tenant_id and id = owner_trial_id
  for update;

  if tg_op = 'INSERT' then
    if trial_status is distinct from 'PREPARED' then
      raise exception using errcode = '55000', message = 'TRIAL_NOT_PREPARED';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'FINAL' then
      raise exception using errcode = '55000', message = 'FINAL_EVALUATION_IMMUTABLE';
    end if;
    if trial_status is distinct from 'PREPARED' then
      raise exception using errcode = '55000', message = 'TRIAL_NOT_PREPARED';
    end if;
    return old;
  end if;

  if old.status = 'FINAL' then
    raise exception using errcode = '55000', message = 'FINAL_EVALUATION_IMMUTABLE';
  end if;
  if trial_status is distinct from 'PREPARED' then
    raise exception using errcode = '55000', message = 'TRIAL_NOT_PREPARED';
  end if;

  if new.status = 'FINAL' then
    select count(*) into unconfirmed_count
    from trial_sensory.sensory_deltas
    where tenant_id = new.tenant_id and evaluation_id = new.id
      and confirmed_delta is null;
    if unconfirmed_count > 0 then
      raise exception using errcode = '23514', message = 'INVALID_SENSORY_DELTA';
    end if;
    if new.decision = 'REVISION_REQUIRED' then
      select count(*) into nonzero_count
      from trial_sensory.sensory_deltas
      where tenant_id = new.tenant_id and evaluation_id = new.id and confirmed_delta <> 0;
      if nonzero_count = 0 then
        raise exception using errcode = '23514', message = 'REVISION_REQUIRES_NONZERO_DELTA';
      end if;
    end if;
  end if;
  return new;
end
$function$;

revoke all on function trial_sensory.protect_evaluation() from public;

commit;
