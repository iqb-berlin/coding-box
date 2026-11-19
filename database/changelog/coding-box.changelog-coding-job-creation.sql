-- liquibase formatted sql

-- changeset iqb:orm-manual-coding-job-candidate-index runInTransaction:false
-- comment: Find job candidates by unit and variable among CODING_INCOMPLETE (8) and INTENDED_INCOMPLETE (12) responses.
-- An interrupted concurrent build can leave an invalid index behind.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_response_manual_job_candidates;
CREATE INDEX CONCURRENTLY idx_response_manual_job_candidates
  ON public.response(unitid, variableid, id)
  WHERE status_v1 IN (8, 12);
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.idx_response_manual_job_candidates;

-- changeset iqb:coding-job-creation-request-id
ALTER TABLE public.coding_job ADD COLUMN creation_request_id uuid;

CREATE UNIQUE INDEX coding_job_creation_request_idx
  ON public.coding_job (workspace_id, creator_user_id, creation_request_id)
  WHERE creation_request_id IS NOT NULL;

-- rollback DROP INDEX public.coding_job_creation_request_idx;
-- rollback ALTER TABLE public.coding_job DROP COLUMN creation_request_id;
