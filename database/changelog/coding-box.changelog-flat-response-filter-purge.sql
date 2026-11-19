-- liquibase formatted sql

-- changeset iqb:flat-response-filter-purge-outbox
CREATE TABLE public.flat_response_filter_purge (
  workspace_id integer PRIMARY KEY REFERENCES public.workspace(id) ON DELETE CASCADE,
  deletion_event_id integer NOT NULL
);
-- rollback DROP TABLE public.flat_response_filter_purge;

-- changeset iqb:record-flat-response-filter-purge splitStatements:false
-- comment: Each deletion batch writes its journal entry in the same transaction as the data change.
CREATE FUNCTION public.record_flat_response_filter_purge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.flat_response_filter_purge (workspace_id, deletion_event_id)
    VALUES (NEW.workspace_id, NEW.id)
    ON CONFLICT (workspace_id) DO UPDATE SET deletion_event_id = EXCLUDED.deletion_event_id;
  RETURN NULL;
END;
$$;
-- rollback DROP FUNCTION public.record_flat_response_filter_purge();

-- changeset iqb:queue-flat-response-filter-purge
CREATE TRIGGER queue_flat_response_filter_purge AFTER INSERT ON public.journal_entries
  FOR EACH ROW WHEN (NEW.result = 'success' AND NEW.event_type IN (
    'TEST_PERSON_DELETED', 'BOOKLET_DELETED', 'UNIT_DELETED', 'RESPONSE_DELETED',
    'TEST_RESULTS_DELETED', 'TEST_RESULT_RESPONSES_DELETED', 'TEST_LOGS_DELETED', 'DUPLICATE_RESPONSES_RESOLVED'
  )) EXECUTE FUNCTION public.record_flat_response_filter_purge();
-- rollback DROP TRIGGER queue_flat_response_filter_purge ON public.journal_entries;
