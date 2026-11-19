--liquibase formatted sql

-- changeset iqb:flat-response-first-page-payload splitStatements:false
--comment: Store small response payloads for the first unfiltered response page.
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.response IN SHARE ROW EXCLUSIVE MODE;

-- The payload depends only on response fields. Workspace membership and
-- visibility are still resolved by the existing unit projection at read time.
CREATE TABLE public.flat_response_first_page_response AS
SELECT id, unitid, variableid, status, left(value, 2000) AS value_prefix
FROM public.response
WHERE is_autocoder_generated IS NOT TRUE;

ALTER TABLE public.flat_response_first_page_response ADD PRIMARY KEY (id);
CREATE INDEX flat_response_first_page_response_order
  ON public.flat_response_first_page_response (unitid, variableid, id);

CREATE FUNCTION public.maintain_flat_response_first_page_payload()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.flat_response_first_page_response
    SELECT id, unitid, variableid, status, left(value, 2000)
    FROM new_responses WHERE is_autocoder_generated IS NOT TRUE;
  ELSIF TG_OP = 'UPDATE' THEN
    DELETE FROM public.flat_response_first_page_response WHERE id = OLD.id;
    IF NEW.is_autocoder_generated IS NOT TRUE THEN
      INSERT INTO public.flat_response_first_page_response
      VALUES (NEW.id, NEW.unitid, NEW.variableid, NEW.status, left(NEW.value, 2000));
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.flat_response_first_page_response payload
    USING old_responses deleted WHERE payload.id = deleted.id;
  ELSE
    TRUNCATE public.flat_response_first_page_response;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER flat_response_first_page_payload_insert AFTER INSERT ON public.response
  REFERENCING NEW TABLE AS new_responses
  FOR EACH STATEMENT EXECUTE FUNCTION public.maintain_flat_response_first_page_payload();

CREATE TRIGGER flat_response_first_page_payload_update
  AFTER UPDATE OF id, unitid, variableid, status, value, is_autocoder_generated ON public.response
  FOR EACH ROW
  WHEN ((OLD.id, OLD.unitid, OLD.variableid, OLD.status, OLD.value, OLD.is_autocoder_generated)
    IS DISTINCT FROM (NEW.id, NEW.unitid, NEW.variableid, NEW.status, NEW.value, NEW.is_autocoder_generated))
  EXECUTE FUNCTION public.maintain_flat_response_first_page_payload();

CREATE TRIGGER flat_response_first_page_payload_delete AFTER DELETE ON public.response
  REFERENCING OLD TABLE AS old_responses
  FOR EACH STATEMENT EXECUTE FUNCTION public.maintain_flat_response_first_page_payload();

CREATE TRIGGER flat_response_first_page_payload_truncate AFTER TRUNCATE ON public.response
  FOR EACH STATEMENT EXECUTE FUNCTION public.maintain_flat_response_first_page_payload();

ANALYZE public.flat_response_first_page_response;

--rollback DROP TRIGGER flat_response_first_page_payload_truncate ON public.response;
--rollback DROP TRIGGER flat_response_first_page_payload_delete ON public.response;
--rollback DROP TRIGGER flat_response_first_page_payload_update ON public.response;
--rollback DROP TRIGGER flat_response_first_page_payload_insert ON public.response;
--rollback DROP FUNCTION public.maintain_flat_response_first_page_payload();
--rollback DROP TABLE public.flat_response_first_page_response;
