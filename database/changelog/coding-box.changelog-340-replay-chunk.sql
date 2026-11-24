-- liquibase formatted sql

-- changeset iqb:340-replay-chunk
-- comment: Preserve the player data part independently of the effective coding subform. NULL marks earlier imports.
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.response
  ADD COLUMN source_chunk_key text,
  ADD COLUMN chunk_has_subform boolean;
-- rollback ALTER TABLE public.response DROP COLUMN chunk_has_subform, DROP COLUMN source_chunk_key;
