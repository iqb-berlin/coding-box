-- liquibase formatted sql

-- changeset jurei733:1

alter table file_upload drop constraint if exists file_upload_id;
-- rollback alter table file_upload add constraint file_upload_id unique (file_id);
