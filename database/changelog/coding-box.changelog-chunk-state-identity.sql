-- liquibase formatted sql

-- changeset iqb:chunk-state-row-identity
-- comment: Give each chunk and unit last state its own ORM identity without deduplicating existing rows.
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.chunk ADD COLUMN id SERIAL PRIMARY KEY;
ALTER TABLE public.unitlaststate ADD CONSTRAINT unitlaststate_pkey PRIMARY KEY (id);
-- rollback ALTER TABLE public.unitlaststate DROP CONSTRAINT unitlaststate_pkey;
-- rollback ALTER TABLE public.chunk DROP COLUMN id;
