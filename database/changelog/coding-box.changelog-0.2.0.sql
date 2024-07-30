-- liquibase formatted sql

-- changeset paf:1
alter table responses add column unit_state jsonb default '{}'::jsonb;
-- rollback alter table responses drop column unit_state;

-- changeset paf:2
alter table file_upload add constraint file_upload_id
  unique (file_id);
-- rollback alter table file_upload drop constraint file_upload_id;

-- changeset jojohoch:3
alter table responses add column booklet_id varchar(100);
-- rollback alter table responses drop column booklet_id;

-- changeset jojohoch:4
alter table responses add constraint response_id
  unique (unit_id, test_person);
-- rollback alter table responses drop constraint response_id;
