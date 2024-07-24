-- liquibase formatted sql

-- changeset paf:1
alter table responses add column unit_state jsonb default '{}'::jsonb;
-- rollback alter table responses drop column unit_state;
