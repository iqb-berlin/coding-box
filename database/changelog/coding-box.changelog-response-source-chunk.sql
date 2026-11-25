-- liquibase formatted sql

-- changeset iqb:response-source-chunk
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.response ADD COLUMN source_chunk_key TEXT;
-- rollback ALTER TABLE public.response DROP COLUMN source_chunk_key;
