-- UI v3 approved narrow G4 amendment: two creation commands only.
-- Nullable fields preserve existing rows and old clients; no new domain tables.
begin;

alter table design_studio.projects
  add column creation_key uuid,
  add column creation_payload_hash text,
  add constraint projects_creation_key_unique
    unique (tenant_id, created_by_user_id, creation_key),
  add constraint projects_creation_hash_valid check (
    (creation_key is null and creation_payload_hash is null)
    or (creation_key is not null and creation_payload_hash is not null
      and creation_payload_hash ~ '^[0-9a-f]{64}$')
  );

alter table design_studio.design_briefs
  add column creation_key uuid,
  add column creation_payload_hash text,
  add constraint briefs_creation_key_unique
    unique (tenant_id, created_by_user_id, creation_key),
  add constraint briefs_creation_hash_valid check (
    (creation_key is null and creation_payload_hash is null)
    or (creation_key is not null and creation_payload_hash is not null
      and creation_payload_hash ~ '^[0-9a-f]{64}$')
  );

commit;
