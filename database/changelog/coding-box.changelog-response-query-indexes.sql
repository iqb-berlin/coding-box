-- liquibase formatted sql

-- changeset iqb:orm-manual-response-covering-index runInTransaction:false
-- comment: Scoped counts and facets read narrow index entries instead of response/value heap pages.
CREATE INDEX CONCURRENTLY idx_response_manual_unit_variable
  ON public.response(unitid, variableid, id) INCLUDE (status)
  WHERE is_autocoder_generated IS NOT TRUE;
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.idx_response_manual_unit_variable;

-- changeset iqb:orm-controller-duration-covering-index runInTransaction:false
-- comment: Read first controller timestamps without random bookletlog heap fetches.
CREATE INDEX CONCURRENTLY idx_bookletlog_controller_covering
  ON public.bookletlog(bookletid, parameter, id) INCLUDE(ts)
  WHERE key = 'CONTROLLER';
-- rollback DROP INDEX CONCURRENTLY IF EXISTS public.idx_bookletlog_controller_covering;

-- changeset iqb:orm-retire-controller-duration-index runInTransaction:false
-- comment: Retire the superseded lookup only after its covering replacement is recorded.
DROP INDEX CONCURRENTLY public.idx_bookletlog_controller_booklet_parameter_id;
-- rollback CREATE INDEX CONCURRENTLY idx_bookletlog_controller_booklet_parameter_id ON public.bookletlog(bookletid, parameter, id) WHERE key = 'CONTROLLER';
