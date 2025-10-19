-- liquibase formatted sql

-- changeset admin:1.2.0-1
-- comment: Add partial_results column to coding_job table for storing partial coding progress

ALTER TABLE coding_job
  ADD COLUMN partial_results TEXT NULL;

-- rollback ALTER TABLE coding_job DROP COLUMN partial_results;
