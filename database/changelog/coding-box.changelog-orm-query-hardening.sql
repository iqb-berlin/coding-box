-- liquibase formatted sql

-- changeset iqb:orm-bookletlog-identity runInTransaction:false
-- preconditions onFail:MARK_RAN onError:HALT
-- precondition-sql-check expectedResult:0 SELECT count(*) FROM pg_catalog.pg_index WHERE indexrelid = to_regclass('public.orm_bookletlog_id_unique') AND indisvalid AND indisready AND pg_get_indexdef(indexrelid) = 'CREATE UNIQUE INDEX orm_bookletlog_id_unique ON public.bookletlog USING btree (id)';
-- comment: Fail on conflicting legacy ids instead of silently deleting or merging log rows.
CREATE UNIQUE INDEX CONCURRENTLY orm_bookletlog_id_unique ON public.bookletlog(id);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.orm_bookletlog_id_unique;

-- changeset iqb:orm-unitlog-identity runInTransaction:false
-- preconditions onFail:MARK_RAN onError:HALT
-- precondition-sql-check expectedResult:0 SELECT count(*) FROM pg_catalog.pg_index WHERE indexrelid = to_regclass('public.orm_unitlog_id_unique') AND indisvalid AND indisready AND pg_get_indexdef(indexrelid) = 'CREATE UNIQUE INDEX orm_unitlog_id_unique ON public.unitlog USING btree (id)';
CREATE UNIQUE INDEX CONCURRENTLY orm_unitlog_id_unique ON public.unitlog(id);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.orm_unitlog_id_unique;

-- changeset iqb:orm-session-identity runInTransaction:false
-- preconditions onFail:MARK_RAN onError:HALT
-- precondition-sql-check expectedResult:0 SELECT count(*) FROM pg_catalog.pg_index WHERE indexrelid = to_regclass('public.orm_session_id_unique') AND indisvalid AND indisready AND pg_get_indexdef(indexrelid) = 'CREATE UNIQUE INDEX orm_session_id_unique ON public.session USING btree (id)';
CREATE UNIQUE INDEX CONCURRENTLY orm_session_id_unique ON public.session(id);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.orm_session_id_unique;

-- changeset iqb:orm-log-primary-keys
-- preconditions onFail:MARK_RAN onError:HALT
-- precondition-sql-check expectedResult:0 SELECT (count(*) = 3)::integer AS committed FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_index i ON i.indexrelid = c.conindid JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'id' WHERE (c.conrelid, c.conname) IN (('public.bookletlog'::regclass, 'bookletlog_pkey'), ('public.unitlog'::regclass, 'unitlog_pkey'), ('public.session'::regclass, 'session_pkey')) AND c.contype = 'p' AND c.conkey = ARRAY[a.attnum] AND NOT c.condeferrable AND i.indnatts = 1 AND i.indisvalid AND i.indisready AND i.indislive;
-- comment: Attaching the indexes renames them. If all three keys were committed before Liquibase recorded the changeset, only the history entry is missing.
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.bookletlog ADD CONSTRAINT bookletlog_pkey PRIMARY KEY USING INDEX orm_bookletlog_id_unique;
ALTER TABLE public.unitlog ADD CONSTRAINT unitlog_pkey PRIMARY KEY USING INDEX orm_unitlog_id_unique;
ALTER TABLE public.session ADD CONSTRAINT session_pkey PRIMARY KEY USING INDEX orm_session_id_unique;
-- rollback ALTER TABLE public.session DROP CONSTRAINT session_pkey;
-- rollback ALTER TABLE public.unitlog DROP CONSTRAINT unitlog_pkey;
-- rollback ALTER TABLE public.bookletlog DROP CONSTRAINT bookletlog_pkey;
-- rollback CREATE UNIQUE INDEX orm_bookletlog_id_unique ON public.bookletlog(id);
-- rollback CREATE UNIQUE INDEX orm_unitlog_id_unique ON public.unitlog(id);
-- rollback CREATE UNIQUE INDEX orm_session_id_unique ON public.session(id);

-- changeset iqb:orm-decision-response-index runInTransaction:false
-- preconditions onFail:MARK_RAN onError:HALT
-- precondition-sql-check expectedResult:0 SELECT count(*) FROM pg_catalog.pg_index WHERE indexrelid = to_regclass('public.idx_review_decision_response') AND indisvalid AND indisready AND pg_get_indexdef(indexrelid) = 'CREATE INDEX idx_review_decision_response ON public.double_coding_review_decision USING btree (response_id)';
-- comment: FK cascade checks do not include workspace_id; index the referencing key first.
CREATE INDEX CONCURRENTLY idx_review_decision_response ON public.double_coding_review_decision(response_id);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.idx_review_decision_response;

-- changeset iqb:orm-discussion-response-index runInTransaction:false
-- preconditions onFail:MARK_RAN onError:HALT
-- precondition-sql-check expectedResult:0 SELECT count(*) FROM pg_catalog.pg_index WHERE indexrelid = to_regclass('public.idx_training_discussion_response') AND indisvalid AND indisready AND pg_get_indexdef(indexrelid) = 'CREATE INDEX idx_training_discussion_response ON public.coder_training_discussion_result USING btree (response_id)';
CREATE INDEX CONCURRENTLY idx_training_discussion_response ON public.coder_training_discussion_result(response_id);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.idx_training_discussion_response;

-- changeset iqb:orm-freshness-unit-index runInTransaction:false
-- preconditions onFail:MARK_RAN onError:HALT
-- precondition-sql-check expectedResult:0 SELECT count(*) FROM pg_catalog.pg_index WHERE indexrelid = to_regclass('public.idx_coding_freshness_unit') AND indisvalid AND indisready AND pg_get_indexdef(indexrelid) = 'CREATE INDEX idx_coding_freshness_unit ON public.coding_unit_freshness USING btree (unit_id)';
CREATE INDEX CONCURRENTLY idx_coding_freshness_unit ON public.coding_unit_freshness(unit_id);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.idx_coding_freshness_unit;

-- changeset iqb:orm-bookletlog-booklet-index runInTransaction:false
-- preconditions onFail:MARK_RAN onError:HALT
-- precondition-sql-check expectedResult:0 SELECT count(*) FROM pg_catalog.pg_index WHERE indexrelid = to_regclass('public.idx_bookletlog_booklet_id') AND indisvalid AND indisready AND pg_get_indexdef(indexrelid) = 'CREATE INDEX idx_bookletlog_booklet_id ON public.bookletlog USING btree (bookletid, id)';
CREATE INDEX CONCURRENTLY idx_bookletlog_booklet_id ON public.bookletlog(bookletid, id);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.idx_bookletlog_booklet_id;

-- changeset iqb:orm-booklet-info-index runInTransaction:false
-- preconditions onFail:MARK_RAN onError:HALT
-- precondition-sql-check expectedResult:0 SELECT count(*) FROM pg_catalog.pg_index WHERE indexrelid = to_regclass('public.idx_booklet_info') AND indisvalid AND indisready AND pg_get_indexdef(indexrelid) = 'CREATE INDEX idx_booklet_info ON public.booklet USING btree (infoid)';
CREATE INDEX CONCURRENTLY idx_booklet_info ON public.booklet(infoid);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.idx_booklet_info;

-- changeset iqb:orm-remove-duplicate-indexes runInTransaction:false rollbackSplitStatements:false splitStatements:true
-- preconditions onFail:HALT onError:HALT
-- precondition-sql-check expectedResult:ok SELECT COALESCE(max(c.relname::text), 'ok') AS result FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.person_unique_idx') AND pg_get_indexdef(c.oid) IS DISTINCT FROM $def$CREATE UNIQUE INDEX person_unique_idx ON public.persons USING btree (code, "group", login, workspace_id)$def$;
-- precondition-sql-check expectedResult:ok SELECT COALESCE(max(c.relname::text), 'ok') AS result FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.idx_responses_codedstatus') AND pg_get_indexdef(c.oid) IS DISTINCT FROM $def$CREATE INDEX idx_responses_codedstatus ON public.response USING btree (status_v1)$def$;
-- precondition-sql-check expectedResult:ok SELECT COALESCE(max(c.relname::text), 'ok') AS result FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.idx_responses_unitid') AND pg_get_indexdef(c.oid) IS DISTINCT FROM $def$CREATE INDEX idx_responses_unitid ON public.response USING btree (unitid)$def$;
-- precondition-sql-check expectedResult:ok SELECT COALESCE(max(c.relname::text), 'ok') AS result FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.response_id_idx') AND pg_get_indexdef(c.oid) IS DISTINCT FROM $def$CREATE INDEX response_id_idx ON public.response USING btree (id)$def$;
-- comment: Keep the UNIQUE constraints/primary keys and one copy of each lookup index.
DROP INDEX CONCURRENTLY IF EXISTS public.person_unique_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_responses_codedstatus;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_responses_unitid;
DROP INDEX CONCURRENTLY IF EXISTS public.response_id_idx;
-- rollback DO $restore_indexes$
-- rollback DECLARE
-- rollback   index_name text;
-- rollback   expected_definition text;
-- rollback   existing_index record;
-- rollback BEGIN
-- rollback   FOR index_name, expected_definition IN VALUES
-- rollback     ('response_id_idx', 'CREATE INDEX response_id_idx ON public.response USING btree (id)'),
-- rollback     ('idx_responses_unitid', 'CREATE INDEX idx_responses_unitid ON public.response USING btree (unitid)'),
-- rollback     ('idx_responses_codedstatus', 'CREATE INDEX idx_responses_codedstatus ON public.response USING btree (status_v1)'),
-- rollback     ('person_unique_idx', 'CREATE UNIQUE INDEX person_unique_idx ON public.persons USING btree (code, "group", login, workspace_id)')
-- rollback   LOOP
-- rollback     SELECT pg_get_indexdef(i.indexrelid) AS definition,
-- rollback            i.indisvalid AND i.indisready AND i.indislive AS usable
-- rollback       INTO existing_index
-- rollback       FROM pg_class c LEFT JOIN pg_index i ON i.indexrelid = c.oid
-- rollback       WHERE c.oid = to_regclass(format('public.%I', index_name));
-- rollback     IF FOUND THEN
-- rollback       IF existing_index.definition IS DISTINCT FROM expected_definition THEN
-- rollback         RAISE EXCEPTION 'Cannot restore index public.%: existing object has a different definition', index_name;
-- rollback       END IF;
-- rollback       IF existing_index.usable THEN
-- rollback         CONTINUE;
-- rollback       END IF;
-- rollback       EXECUTE format('DROP INDEX public.%I', index_name);
-- rollback     END IF;
-- rollback     EXECUTE expected_definition;
-- rollback   END LOOP;
-- rollback END;
-- rollback $restore_indexes$;

-- changeset iqb:orm-remove-obsolete-status-indexes runInTransaction:false rollbackSplitStatements:false splitStatements:true
-- preconditions onFail:HALT onError:HALT
-- precondition-sql-check expectedResult:ok SELECT COALESCE(max(c.relname::text), 'ok') AS result FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.idx_response_statistics_covering') AND pg_get_indexdef(c.oid) IS DISTINCT FROM $def$CREATE INDEX idx_response_statistics_covering ON public.response USING btree (status, unitid, status_v1, id) WHERE ((status)::text = 'VALUE_CHANGED'::text)$def$;
-- precondition-sql-check expectedResult:ok SELECT COALESCE(max(c.relname::text), 'ok') AS result FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.idx_response_status_codedstatus_unitid') AND pg_get_indexdef(c.oid) IS DISTINCT FROM $def$CREATE INDEX idx_response_status_codedstatus_unitid ON public.response USING btree (status, status_v1, unitid) WHERE ((status)::text = 'VALUE_CHANGED'::text)$def$;
-- comment: These indexes still compare numeric status::text with the old literal VALUE_CHANGED and are empty.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_response_statistics_covering;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_response_status_codedstatus_unitid;
-- rollback DO $restore_indexes$
-- rollback DECLARE
-- rollback   index_name text;
-- rollback   expected_definition text;
-- rollback   existing_index record;
-- rollback BEGIN
-- rollback   FOR index_name, expected_definition IN VALUES
-- rollback     ('idx_response_status_codedstatus_unitid', $index$CREATE INDEX idx_response_status_codedstatus_unitid ON public.response USING btree (status, status_v1, unitid) WHERE ((status)::text = 'VALUE_CHANGED'::text)$index$),
-- rollback     ('idx_response_statistics_covering', $index$CREATE INDEX idx_response_statistics_covering ON public.response USING btree (status, unitid, status_v1, id) WHERE ((status)::text = 'VALUE_CHANGED'::text)$index$)
-- rollback   LOOP
-- rollback     SELECT pg_get_indexdef(i.indexrelid) AS definition,
-- rollback            i.indisvalid AND i.indisready AND i.indislive AS usable
-- rollback       INTO existing_index
-- rollback       FROM pg_class c LEFT JOIN pg_index i ON i.indexrelid = c.oid
-- rollback       WHERE c.oid = to_regclass(format('public.%I', index_name));
-- rollback     IF FOUND THEN
-- rollback       IF existing_index.definition IS DISTINCT FROM expected_definition THEN
-- rollback         RAISE EXCEPTION 'Cannot restore index public.%: existing object has a different definition', index_name;
-- rollback       END IF;
-- rollback       IF existing_index.usable THEN
-- rollback         CONTINUE;
-- rollback       END IF;
-- rollback       EXECUTE format('DROP INDEX public.%I', index_name);
-- rollback     END IF;
-- rollback     EXECUTE expected_definition;
-- rollback   END LOOP;
-- rollback END;
-- rollback $restore_indexes$;
