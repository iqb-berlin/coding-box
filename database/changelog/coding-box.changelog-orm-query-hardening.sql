-- liquibase formatted sql

-- changeset iqb:orm-multirow-identity
-- comment: Preserve every chunk/state row, including existing duplicates; never treat unitid as unique.
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.chunk ADD COLUMN id SERIAL PRIMARY KEY;
-- rollback ALTER TABLE public.chunk DROP COLUMN id;

-- changeset iqb:orm-bookletlog-identity runInTransaction:false
-- comment: Fail on conflicting legacy ids instead of silently deleting or merging log rows.
CREATE UNIQUE INDEX CONCURRENTLY orm_bookletlog_id_unique ON public.bookletlog(id);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.orm_bookletlog_id_unique;

-- changeset iqb:orm-unitlog-identity runInTransaction:false
CREATE UNIQUE INDEX CONCURRENTLY orm_unitlog_id_unique ON public.unitlog(id);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.orm_unitlog_id_unique;

-- changeset iqb:orm-session-identity runInTransaction:false
CREATE UNIQUE INDEX CONCURRENTLY orm_session_id_unique ON public.session(id);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.orm_session_id_unique;

-- changeset iqb:orm-laststate-identity runInTransaction:false
CREATE UNIQUE INDEX CONCURRENTLY orm_unitlaststate_id_unique ON public.unitlaststate(id);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.orm_unitlaststate_id_unique;

-- changeset iqb:orm-log-primary-keys
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.bookletlog ADD CONSTRAINT bookletlog_pkey PRIMARY KEY USING INDEX orm_bookletlog_id_unique;
ALTER TABLE public.unitlog ADD CONSTRAINT unitlog_pkey PRIMARY KEY USING INDEX orm_unitlog_id_unique;
ALTER TABLE public.session ADD CONSTRAINT session_pkey PRIMARY KEY USING INDEX orm_session_id_unique;
ALTER TABLE public.unitlaststate ADD CONSTRAINT unitlaststate_pkey PRIMARY KEY USING INDEX orm_unitlaststate_id_unique;
-- rollback ALTER TABLE public.unitlaststate DROP CONSTRAINT unitlaststate_pkey;
-- rollback ALTER TABLE public.session DROP CONSTRAINT session_pkey;
-- rollback ALTER TABLE public.unitlog DROP CONSTRAINT unitlog_pkey;
-- rollback ALTER TABLE public.bookletlog DROP CONSTRAINT bookletlog_pkey;
-- rollback CREATE UNIQUE INDEX orm_bookletlog_id_unique ON public.bookletlog(id);
-- rollback CREATE UNIQUE INDEX orm_unitlog_id_unique ON public.unitlog(id);
-- rollback CREATE UNIQUE INDEX orm_session_id_unique ON public.session(id);
-- rollback CREATE UNIQUE INDEX orm_unitlaststate_id_unique ON public.unitlaststate(id);

-- changeset iqb:orm-decision-response-index runInTransaction:false
-- comment: FK cascade checks do not include workspace_id; index the referencing key first.
CREATE INDEX CONCURRENTLY idx_review_decision_response ON public.double_coding_review_decision(response_id);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.idx_review_decision_response;

-- changeset iqb:orm-discussion-response-index runInTransaction:false
CREATE INDEX CONCURRENTLY idx_training_discussion_response ON public.coder_training_discussion_result(response_id);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.idx_training_discussion_response;

-- changeset iqb:orm-freshness-unit-index runInTransaction:false
CREATE INDEX CONCURRENTLY idx_coding_freshness_unit ON public.coding_unit_freshness(unit_id);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.idx_coding_freshness_unit;

-- changeset iqb:orm-bookletlog-booklet-index runInTransaction:false
CREATE INDEX CONCURRENTLY idx_bookletlog_booklet_id ON public.bookletlog(bookletid, id);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.idx_bookletlog_booklet_id;

-- changeset iqb:orm-booklet-info-index runInTransaction:false
CREATE INDEX CONCURRENTLY idx_booklet_info ON public.booklet(infoid);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.idx_booklet_info;

-- changeset iqb:orm-remove-duplicate-indexes runInTransaction:false
-- comment: Keep the UNIQUE constraints/primary keys and one copy of each lookup index.
DROP INDEX CONCURRENTLY IF EXISTS public.person_unique_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_responses_codedstatus;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_responses_unitid;
DROP INDEX CONCURRENTLY IF EXISTS public.response_id_idx;
-- rollback CREATE INDEX CONCURRENTLY response_id_idx ON public.response(id);
-- rollback CREATE INDEX CONCURRENTLY idx_responses_unitid ON public.response(unitid);
-- rollback CREATE INDEX CONCURRENTLY idx_responses_codedstatus ON public.response(status_v1);
-- rollback CREATE UNIQUE INDEX CONCURRENTLY person_unique_idx ON public.persons(code, "group", login, workspace_id);

-- changeset iqb:orm-remove-obsolete-status-indexes runInTransaction:false
-- comment: These indexes still compare numeric status::text with the old literal VALUE_CHANGED and are empty.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_response_statistics_covering;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_response_status_codedstatus_unitid;
-- rollback CREATE INDEX CONCURRENTLY idx_response_status_codedstatus_unitid ON public.response(status, status_v1, unitid) WHERE status::text = 'VALUE_CHANGED';
-- rollback CREATE INDEX CONCURRENTLY idx_response_statistics_covering ON public.response(status, unitid, status_v1, id) WHERE status::text = 'VALUE_CHANGED';
