--liquibase formatted sql

-- changeset iqb:flat-response-projection-recovery splitStatements:false
--comment: Restore response projections from their sources and skip counters for coding-only updates.
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.response IN SHARE ROW EXCLUSIVE MODE;

-- Transition tables cannot be combined with UPDATE OF. Only changes that move
-- an eligible response into or out of a unit need to adjust the two counters.
CREATE FUNCTION public.move_flat_response_unit_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.flat_response_unit_count AS stored (unitid, total)
  SELECT unitid, delta FROM (VALUES
    (OLD.unitid, -1, OLD.is_autocoder_generated), (NEW.unitid, 1, NEW.is_autocoder_generated)
  ) AS changes(unitid, delta, generated)
  WHERE generated IS NOT TRUE ORDER BY unitid
  ON CONFLICT (unitid) DO UPDATE SET total = stored.total + EXCLUDED.total;

  DELETE FROM public.flat_response_unit_count WHERE unitid = OLD.unitid AND total = 0;
  RETURN NULL;
END
$$;

DROP TRIGGER flat_response_unit_count_update ON public.response;
CREATE TRIGGER flat_response_unit_count_update AFTER UPDATE OF unitid, is_autocoder_generated ON public.response
  FOR EACH ROW WHEN (
    (CASE WHEN OLD.is_autocoder_generated IS NOT TRUE THEN OLD.unitid END) IS DISTINCT FROM
    (CASE WHEN NEW.is_autocoder_generated IS NOT TRUE THEN NEW.unitid END)
  ) EXECUTE FUNCTION public.move_flat_response_unit_count();

CREATE VIEW public.flat_response_payload_source AS
SELECT id, unitid, variableid, status, left(value, 2000) AS value_prefix
FROM public.response
WHERE is_autocoder_generated IS NOT TRUE;

ALTER FUNCTION public.rebuild_flat_response_workspace(integer) RENAME TO rebuild_flat_response_list_and_search;

CREATE FUNCTION public.rebuild_flat_response_workspace(target_workspace integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Refresh unit membership and search links first. The six source locks remain
  -- held until commit. Correcting the counters below also adjusts the rebuilt
  -- totals through their triggers, before any reader can see the ready flag.
  PERFORM public.rebuild_flat_response_list_and_search(target_workspace);

  DELETE FROM public.flat_response_first_page_response p
  WHERE (target_workspace IS NULL OR p.unitid IN (
    SELECT unit_id FROM public.flat_response_unit_data WHERE workspace_id = target_workspace
  )) AND NOT EXISTS (SELECT FROM public.flat_response_payload_source r WHERE r.id = p.id AND r.unitid = p.unitid);

  INSERT INTO public.flat_response_first_page_response
  SELECT r.* FROM public.flat_response_payload_source r
  LEFT JOIN public.flat_response_first_page_response p ON p.id = r.id
  WHERE (target_workspace IS NULL OR r.unitid IN (
    SELECT unit_id FROM public.flat_response_unit_data WHERE workspace_id = target_workspace
  )) AND (p.id IS NULL OR (p.unitid, p.variableid, p.status, p.value_prefix)
    IS DISTINCT FROM (r.unitid, r.variableid, r.status, r.value_prefix))
  ON CONFLICT (id) DO UPDATE SET unitid = EXCLUDED.unitid, variableid = EXCLUDED.variableid,
    status = EXCLUDED.status, value_prefix = EXCLUDED.value_prefix;

  DELETE FROM public.flat_response_unit_count c
  WHERE (target_workspace IS NULL OR c.unitid IN (
    SELECT unit_id FROM public.flat_response_unit_data WHERE workspace_id = target_workspace
  )) AND NOT EXISTS (SELECT FROM public.flat_response_payload_source r WHERE r.unitid = c.unitid);

  INSERT INTO public.flat_response_unit_count AS stored (unitid, total)
  SELECT r.unitid, count(*) FROM public.flat_response_payload_source r
  WHERE target_workspace IS NULL OR r.unitid IN (
    SELECT unit_id FROM public.flat_response_unit_data WHERE workspace_id = target_workspace
  )
  GROUP BY r.unitid
  ON CONFLICT (unitid) DO UPDATE SET total = EXCLUDED.total WHERE stored.total <> EXCLUDED.total;
END
$$;

--rollback DROP FUNCTION public.rebuild_flat_response_workspace(integer);
--rollback ALTER FUNCTION public.rebuild_flat_response_list_and_search(integer) RENAME TO rebuild_flat_response_workspace;
--rollback DROP VIEW public.flat_response_payload_source;
--rollback DROP TRIGGER flat_response_unit_count_update ON public.response;
--rollback CREATE TRIGGER flat_response_unit_count_update AFTER UPDATE ON public.response REFERENCING OLD TABLE AS old_responses NEW TABLE AS new_responses FOR EACH STATEMENT EXECUTE FUNCTION public.update_flat_response_unit_counts();
--rollback DROP FUNCTION public.move_flat_response_unit_count();
