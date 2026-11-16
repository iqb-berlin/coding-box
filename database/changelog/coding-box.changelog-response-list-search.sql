--liquibase formatted sql

--changeset iqb:flat-response-unit-count splitStatements:false
--comment: Install exact per-unit counts. The response write lock keeps the initial scan and trigger activation in sync.
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.response IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.flat_response_unit_count (
  unitid integer PRIMARY KEY,
  total bigint NOT NULL
);

INSERT INTO public.flat_response_unit_count (unitid, total)
SELECT unitid, count(*)
FROM public.response
WHERE is_autocoder_generated IS NOT TRUE
GROUP BY unitid;

CREATE FUNCTION public.update_flat_response_unit_counts()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  CASE TG_OP
    WHEN 'INSERT' THEN
      INSERT INTO public.flat_response_unit_count AS stored (unitid, total)
      SELECT unitid, count(*) FROM new_responses
      WHERE is_autocoder_generated IS NOT TRUE
      GROUP BY unitid ORDER BY unitid
      ON CONFLICT (unitid) DO UPDATE SET total = stored.total + EXCLUDED.total;
    WHEN 'UPDATE' THEN
      INSERT INTO public.flat_response_unit_count AS stored (unitid, total)
      SELECT unitid, sum(delta)
      FROM (
        SELECT unitid, count(*) AS delta FROM new_responses
        WHERE is_autocoder_generated IS NOT TRUE GROUP BY unitid
        UNION ALL
        SELECT unitid, -count(*) AS delta FROM old_responses
        WHERE is_autocoder_generated IS NOT TRUE GROUP BY unitid
      ) AS changes
      GROUP BY unitid HAVING sum(delta) <> 0
      ORDER BY unitid
      ON CONFLICT (unitid) DO UPDATE SET total = stored.total + EXCLUDED.total;
    WHEN 'DELETE' THEN
      INSERT INTO public.flat_response_unit_count AS stored (unitid, total)
      SELECT unitid, -count(*) FROM old_responses
      WHERE is_autocoder_generated IS NOT TRUE
      GROUP BY unitid ORDER BY unitid
      ON CONFLICT (unitid) DO UPDATE SET total = stored.total + EXCLUDED.total;
    WHEN 'TRUNCATE' THEN
      TRUNCATE public.flat_response_unit_count;
  END CASE;
  RETURN NULL;
END
$$;

CREATE TRIGGER flat_response_unit_count_insert AFTER INSERT ON public.response
  REFERENCING NEW TABLE AS new_responses
  FOR EACH STATEMENT EXECUTE FUNCTION public.update_flat_response_unit_counts();
CREATE TRIGGER flat_response_unit_count_update AFTER UPDATE ON public.response
  REFERENCING OLD TABLE AS old_responses NEW TABLE AS new_responses
  FOR EACH STATEMENT EXECUTE FUNCTION public.update_flat_response_unit_counts();
CREATE TRIGGER flat_response_unit_count_delete AFTER DELETE ON public.response
  REFERENCING OLD TABLE AS old_responses
  FOR EACH STATEMENT EXECUTE FUNCTION public.update_flat_response_unit_counts();
CREATE TRIGGER flat_response_unit_count_truncate AFTER TRUNCATE ON public.response
  FOR EACH STATEMENT EXECUTE FUNCTION public.update_flat_response_unit_counts();

ANALYZE public.flat_response_unit_count;

--rollback DROP TRIGGER flat_response_unit_count_truncate ON public.response;
--rollback DROP TRIGGER flat_response_unit_count_delete ON public.response;
--rollback DROP TRIGGER flat_response_unit_count_update ON public.response;
--rollback DROP TRIGGER flat_response_unit_count_insert ON public.response;
--rollback DROP FUNCTION public.update_flat_response_unit_counts();
--rollback DROP TABLE public.flat_response_unit_count;

--changeset iqb:flat-response-list-and-value-projections splitStatements:false
--comment: Build and maintain the authenticated list projections in the same database as the responses.
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.workspace, public.persons, public.bookletinfo, public.booklet, public.unit, public.response
  IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.flat_response_first_page_workspace (
  workspace_id integer PRIMARY KEY REFERENCES public.workspace(id) ON DELETE CASCADE,
  ready boolean NOT NULL DEFAULT false
);

CREATE VIEW public.flat_response_first_page_source_unit AS
SELECT u.id AS unit_id, p.workspace_id, p.consider, p.id AS person_id,
  p.code AS person_code, p.login AS person_login, p."group" AS person_group,
  b.id AS booklet_id, bi.name AS booklet_name, u.name AS unit_name, u.alias AS unit_alias
FROM public.unit u
JOIN public.booklet b ON b.id = u.bookletid
JOIN public.bookletinfo bi ON bi.id = b.infoid
JOIN public.persons p ON p.id = b.personid
JOIN public.flat_response_first_page_workspace w ON w.workspace_id = p.workspace_id;

CREATE TABLE public.flat_response_first_page_unit AS
SELECT * FROM public.flat_response_first_page_source_unit WITH NO DATA;

ALTER TABLE public.flat_response_first_page_unit
  ADD PRIMARY KEY (unit_id);
CREATE INDEX flat_response_first_page_unit_order
  ON public.flat_response_first_page_unit (workspace_id, person_code, booklet_name, unit_alias) WHERE consider IS TRUE;

ALTER TABLE public.flat_response_first_page_unit
  ADD FOREIGN KEY (workspace_id) REFERENCES public.flat_response_first_page_workspace(workspace_id) ON DELETE CASCADE;

CREATE TABLE public.flat_response_first_page_total (
  workspace_id integer NOT NULL REFERENCES public.flat_response_first_page_workspace(workspace_id) ON DELETE CASCADE,
  booklet_name text NOT NULL,
  unit_name text NOT NULL,
  shard smallint NOT NULL,
  total bigint NOT NULL,
  PRIMARY KEY (workspace_id, booklet_name, unit_name, shard)
);


CREATE TABLE public.flat_response_value_search_value (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES public.flat_response_first_page_workspace(workspace_id) ON DELETE CASCADE,
  value_prefix text NOT NULL
);
CREATE INDEX flat_response_value_search_lookup
  ON public.flat_response_value_search_value (workspace_id, md5(value_prefix), id);

CREATE TABLE public.flat_response_value_search_link (
  id integer PRIMARY KEY,
  workspace_id integer NOT NULL REFERENCES public.flat_response_first_page_workspace(workspace_id) ON DELETE CASCADE,
  unitid integer NOT NULL,
  variableid text NOT NULL,
  value_id bigint NOT NULL REFERENCES public.flat_response_value_search_value(id) ON DELETE CASCADE
);
CREATE INDEX flat_response_value_search_by_value
  ON public.flat_response_value_search_link (value_id, workspace_id) INCLUDE (id, unitid, variableid);
CREATE INDEX flat_response_value_search_by_workspace
  ON public.flat_response_value_search_link (workspace_id);

CREATE VIEW public.flat_response_value_search_workspace AS
SELECT workspace_id FROM public.flat_response_first_page_workspace WHERE ready;

-- The explicit rebuild is also used to recover a workspace after hierarchy changes.
-- Serialize it with source writes, so every reader sees either the complete projection or the source query.
CREATE FUNCTION public.rebuild_flat_response_workspace(target_workspace integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  LOCK TABLE public.workspace, public.persons, public.bookletinfo, public.booklet, public.unit, public.response
    IN SHARE ROW EXCLUSIVE MODE;

  INSERT INTO public.flat_response_first_page_workspace (workspace_id)
  SELECT id FROM public.workspace WHERE target_workspace IS NULL OR id = target_workspace
  ON CONFLICT (workspace_id) DO NOTHING;

  DELETE FROM public.flat_response_value_search_link WHERE target_workspace IS NULL OR workspace_id = target_workspace;
  DELETE FROM public.flat_response_value_search_value WHERE target_workspace IS NULL OR workspace_id = target_workspace;
  DELETE FROM public.flat_response_first_page_total WHERE target_workspace IS NULL OR workspace_id = target_workspace;
  DELETE FROM public.flat_response_first_page_unit WHERE target_workspace IS NULL OR workspace_id = target_workspace;

  -- Moved units can still have a stale row in a different, invalidated workspace.
  DELETE FROM public.flat_response_first_page_unit stored
  USING public.flat_response_first_page_source_unit current_unit
  WHERE stored.unit_id = current_unit.unit_id
    AND (target_workspace IS NULL OR current_unit.workspace_id = target_workspace);

  INSERT INTO public.flat_response_first_page_unit
  SELECT * FROM public.flat_response_first_page_source_unit
  WHERE target_workspace IS NULL OR workspace_id = target_workspace;

  INSERT INTO public.flat_response_first_page_total (workspace_id, booklet_name, unit_name, shard, total)
  SELECT u.workspace_id, u.booklet_name, u.unit_name, (u.unit_id % 8)::smallint, sum(c.total)
  FROM public.flat_response_first_page_unit u
  JOIN public.flat_response_unit_count c ON c.unitid = u.unit_id
  WHERE u.consider IS TRUE AND (target_workspace IS NULL OR u.workspace_id = target_workspace)
  GROUP BY 1, 2, 3, 4;

  -- The length must match RESPONSE_VALUE_SEARCH_PREFIX_LENGTH used by the source query.
  INSERT INTO public.flat_response_value_search_value (workspace_id, value_prefix)
  SELECT DISTINCT u.workspace_id, left(r.value, 2000)
  FROM public.flat_response_first_page_unit u
  JOIN public.response r ON r.unitid = u.unit_id
  WHERE r.value IS NOT NULL AND r.is_autocoder_generated IS NOT TRUE
    AND (target_workspace IS NULL OR u.workspace_id = target_workspace);

  ANALYZE public.flat_response_value_search_value;
  INSERT INTO public.flat_response_value_search_link (id, workspace_id, unitid, variableid, value_id)
  SELECT r.id, u.workspace_id, r.unitid, r.variableid, v.id
  FROM public.flat_response_first_page_unit u
  JOIN public.response r ON r.unitid = u.unit_id
  JOIN public.flat_response_value_search_value v ON v.workspace_id = u.workspace_id
    AND md5(v.value_prefix) = md5(left(r.value, 2000)) AND v.value_prefix = left(r.value, 2000)
  WHERE r.value IS NOT NULL AND r.is_autocoder_generated IS NOT TRUE
    AND (target_workspace IS NULL OR u.workspace_id = target_workspace)
  ON CONFLICT (id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id,
    unitid = EXCLUDED.unitid, variableid = EXCLUDED.variableid, value_id = EXCLUDED.value_id;

  UPDATE public.flat_response_first_page_workspace SET ready = true
  WHERE target_workspace IS NULL OR workspace_id = target_workspace;
END
$$;

SELECT public.rebuild_flat_response_workspace();

ANALYZE public.flat_response_first_page_unit;
ANALYZE public.flat_response_first_page_total;
ANALYZE public.flat_response_value_search_link;

CREATE FUNCTION public.flat_response_projection_insert_workspace()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.flat_response_first_page_workspace (workspace_id, ready) VALUES (NEW.id, true);
  RETURN NULL;
END
$$;

CREATE FUNCTION public.flat_response_first_page_insert_unit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.flat_response_first_page_unit stored USING new_units i WHERE stored.unit_id = i.id;
  INSERT INTO public.flat_response_first_page_unit
  SELECT u.* FROM new_units i
  JOIN public.flat_response_first_page_source_unit u ON u.unit_id = i.id;
  RETURN NULL;
END
$$;


CREATE FUNCTION public.flat_response_projection_invalidate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_workspace integer;
  new_workspace integer;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    UPDATE public.flat_response_first_page_workspace SET ready = false WHERE ready;
    RETURN NULL;
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'persons' THEN
      old_workspace := OLD.workspace_id;
      IF TG_OP = 'UPDATE' THEN new_workspace := NEW.workspace_id; END IF;
    WHEN 'booklet' THEN
      SELECT workspace_id INTO old_workspace FROM public.persons WHERE id = OLD.personid;
      IF TG_OP = 'UPDATE' THEN
        SELECT workspace_id INTO new_workspace FROM public.persons WHERE id = NEW.personid;
      END IF;
    WHEN 'unit' THEN
      SELECT p.workspace_id INTO old_workspace
      FROM public.booklet b JOIN public.persons p ON p.id = b.personid WHERE b.id = OLD.bookletid;
      IF TG_OP = 'UPDATE' THEN
        SELECT p.workspace_id INTO new_workspace
        FROM public.booklet b JOIN public.persons p ON p.id = b.personid WHERE b.id = NEW.bookletid;
      END IF;
    WHEN 'bookletinfo' THEN
      UPDATE public.flat_response_first_page_workspace w SET ready = false
      WHERE w.ready AND EXISTS (
        SELECT 1 FROM public.booklet b JOIN public.persons p ON p.id = b.personid
        WHERE b.infoid = OLD.id AND p.workspace_id = w.workspace_id
      );
      RETURN NULL;
  END CASE;

  UPDATE public.flat_response_first_page_workspace SET ready = false
  WHERE ready AND workspace_id IN (old_workspace, new_workspace);
  RETURN NULL;
END
$$;

CREATE FUNCTION public.flat_response_value_search_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_workspace integer;
  prefix text;
  matched_id bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.flat_response_value_search_link l USING deleted_responses d WHERE l.id = d.id;
    RETURN NULL;
  END IF;
  IF TG_OP = 'TRUNCATE' THEN
    TRUNCATE public.flat_response_value_search_link, public.flat_response_value_search_value;
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND
    (OLD.id IS DISTINCT FROM NEW.id OR NEW.is_autocoder_generated IS TRUE OR NEW.value IS NULL) THEN
    DELETE FROM public.flat_response_value_search_link WHERE id = OLD.id;
  END IF;
  IF NEW.is_autocoder_generated IS TRUE OR NEW.value IS NULL THEN RETURN NULL; END IF;

  SELECT u.workspace_id INTO target_workspace
  FROM public.flat_response_first_page_unit u JOIN public.flat_response_first_page_workspace w USING (workspace_id)
  WHERE u.unit_id = NEW.unitid AND w.ready;
  IF target_workspace IS NULL THEN
    IF TG_OP = 'UPDATE' THEN DELETE FROM public.flat_response_value_search_link WHERE id = OLD.id; END IF;
    RETURN NULL;
  END IF;

  prefix := left(NEW.value, 2000);
  SELECT id INTO matched_id FROM public.flat_response_value_search_value v
  WHERE v.workspace_id = target_workspace AND md5(v.value_prefix) = md5(prefix) AND v.value_prefix = prefix
  ORDER BY id LIMIT 1;
  -- Concurrent inserts can retain separate dictionary IDs for the same text. Both still match ILIKE.
  IF matched_id IS NULL THEN
    INSERT INTO public.flat_response_value_search_value (workspace_id, value_prefix) VALUES (target_workspace, prefix)
    RETURNING id INTO matched_id;
  END IF;

  INSERT INTO public.flat_response_value_search_link (id, workspace_id, unitid, variableid, value_id)
  VALUES (NEW.id, target_workspace, NEW.unitid, NEW.variableid, matched_id)
  ON CONFLICT (id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id,
    unitid = EXCLUDED.unitid, variableid = EXCLUDED.variableid, value_id = EXCLUDED.value_id;
  RETURN NULL;
END
$$;

CREATE TRIGGER flat_response_projection_workspace_insert AFTER INSERT ON public.workspace
  FOR EACH ROW EXECUTE FUNCTION public.flat_response_projection_insert_workspace();
CREATE TRIGGER flat_response_first_page_unit_insert AFTER INSERT ON public.unit
  REFERENCING NEW TABLE AS new_units FOR EACH STATEMENT EXECUTE FUNCTION public.flat_response_first_page_insert_unit();

CREATE TRIGGER flat_response_projection_person_update
  AFTER UPDATE OF id, workspace_id, consider, code, login, "group" ON public.persons
  FOR EACH ROW WHEN ((OLD.id, OLD.workspace_id, OLD.consider, OLD.code, OLD.login, OLD."group")
    IS DISTINCT FROM (NEW.id, NEW.workspace_id, NEW.consider, NEW.code, NEW.login, NEW."group"))
  EXECUTE FUNCTION public.flat_response_projection_invalidate();
CREATE TRIGGER flat_response_projection_booklet_update AFTER UPDATE OF id, infoid, personid ON public.booklet
  FOR EACH ROW WHEN ((OLD.id, OLD.infoid, OLD.personid) IS DISTINCT FROM (NEW.id, NEW.infoid, NEW.personid))
  EXECUTE FUNCTION public.flat_response_projection_invalidate();
CREATE TRIGGER flat_response_projection_info_update AFTER UPDATE OF name ON public.bookletinfo
  FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION public.flat_response_projection_invalidate();
CREATE TRIGGER flat_response_projection_unit_update AFTER UPDATE OF id, bookletid, alias, name ON public.unit
  FOR EACH ROW WHEN ((OLD.id, OLD.bookletid, OLD.alias, OLD.name) IS DISTINCT FROM (NEW.id, NEW.bookletid, NEW.alias, NEW.name))
  EXECUTE FUNCTION public.flat_response_projection_invalidate();

CREATE TRIGGER flat_response_projection_person_delete AFTER DELETE ON public.persons
  FOR EACH ROW EXECUTE FUNCTION public.flat_response_projection_invalidate();
CREATE TRIGGER flat_response_projection_booklet_delete AFTER DELETE ON public.booklet
  FOR EACH ROW EXECUTE FUNCTION public.flat_response_projection_invalidate();
CREATE TRIGGER flat_response_projection_unit_delete AFTER DELETE ON public.unit
  FOR EACH ROW EXECUTE FUNCTION public.flat_response_projection_invalidate();
CREATE TRIGGER flat_response_projection_person_truncate AFTER TRUNCATE ON public.persons
  FOR EACH STATEMENT EXECUTE FUNCTION public.flat_response_projection_invalidate();
CREATE TRIGGER flat_response_projection_booklet_truncate AFTER TRUNCATE ON public.booklet
  FOR EACH STATEMENT EXECUTE FUNCTION public.flat_response_projection_invalidate();
CREATE TRIGGER flat_response_projection_info_truncate AFTER TRUNCATE ON public.bookletinfo
  FOR EACH STATEMENT EXECUTE FUNCTION public.flat_response_projection_invalidate();
CREATE TRIGGER flat_response_projection_unit_truncate AFTER TRUNCATE ON public.unit
  FOR EACH STATEMENT EXECUTE FUNCTION public.flat_response_projection_invalidate();

CREATE TRIGGER flat_response_value_search_insert AFTER INSERT ON public.response
  FOR EACH ROW EXECUTE FUNCTION public.flat_response_value_search_update();
CREATE TRIGGER flat_response_value_search_update
  AFTER UPDATE OF id, unitid, variableid, value, is_autocoder_generated ON public.response
  FOR EACH ROW WHEN ((OLD.id, OLD.unitid, OLD.variableid, left(OLD.value, 2000), OLD.is_autocoder_generated)
    IS DISTINCT FROM (NEW.id, NEW.unitid, NEW.variableid, left(NEW.value, 2000), NEW.is_autocoder_generated))
  EXECUTE FUNCTION public.flat_response_value_search_update();
CREATE TRIGGER flat_response_value_search_delete AFTER DELETE ON public.response
  REFERENCING OLD TABLE AS deleted_responses FOR EACH STATEMENT EXECUTE FUNCTION public.flat_response_value_search_update();
CREATE TRIGGER flat_response_value_search_truncate AFTER TRUNCATE ON public.response
  FOR EACH STATEMENT EXECUTE FUNCTION public.flat_response_value_search_update();

CREATE FUNCTION public.flat_response_first_page_update_totals()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  changes text;
BEGIN
  CASE TG_OP
    WHEN 'INSERT' THEN
      changes := 'SELECT unitid, total AS delta FROM new_counts';
    WHEN 'UPDATE' THEN
      changes := 'SELECT COALESCE(n.unitid, o.unitid) AS unitid, coalesce(n.total, 0) - coalesce(o.total, 0) AS delta
                   FROM new_counts n FULL JOIN old_counts o USING (unitid)
                   WHERE n.total IS DISTINCT FROM o.total';
    WHEN 'DELETE' THEN
      changes := 'SELECT unitid, -total AS delta FROM old_counts';
    WHEN 'TRUNCATE' THEN
      TRUNCATE public.flat_response_first_page_total;
      RETURN NULL;
  END CASE;
  EXECUTE format('
    INSERT INTO public.flat_response_first_page_total AS stored
    SELECT u.workspace_id, u.booklet_name, u.unit_name, (u.unit_id %% 8)::smallint, sum(c.delta)
    FROM (%s) c
    JOIN public.flat_response_first_page_unit u ON u.unit_id = c.unitid
    JOIN public.flat_response_first_page_workspace w ON w.workspace_id = u.workspace_id AND w.ready
    WHERE u.consider IS TRUE
    GROUP BY 1, 2, 3, 4
    HAVING sum(c.delta) <> 0
    ORDER BY 1, 2, 3, 4
    ON CONFLICT (workspace_id, booklet_name, unit_name, shard)
    DO UPDATE SET total = stored.total + EXCLUDED.total', changes);
  RETURN NULL;
END
$$;

CREATE TRIGGER flat_response_first_page_total_insert AFTER INSERT ON public.flat_response_unit_count
  REFERENCING NEW TABLE AS new_counts FOR EACH STATEMENT EXECUTE FUNCTION public.flat_response_first_page_update_totals();
CREATE TRIGGER flat_response_first_page_total_update AFTER UPDATE ON public.flat_response_unit_count
  REFERENCING OLD TABLE AS old_counts NEW TABLE AS new_counts
  FOR EACH STATEMENT EXECUTE FUNCTION public.flat_response_first_page_update_totals();
CREATE TRIGGER flat_response_first_page_total_delete AFTER DELETE ON public.flat_response_unit_count
  REFERENCING OLD TABLE AS old_counts FOR EACH STATEMENT EXECUTE FUNCTION public.flat_response_first_page_update_totals();
CREATE TRIGGER flat_response_first_page_total_truncate AFTER TRUNCATE ON public.flat_response_unit_count
  FOR EACH STATEMENT EXECUTE FUNCTION public.flat_response_first_page_update_totals();


--rollback DROP TRIGGER flat_response_first_page_total_truncate ON public.flat_response_unit_count;
--rollback DROP TRIGGER flat_response_first_page_total_delete ON public.flat_response_unit_count;
--rollback DROP TRIGGER flat_response_first_page_total_update ON public.flat_response_unit_count;
--rollback DROP TRIGGER flat_response_first_page_total_insert ON public.flat_response_unit_count;
--rollback DROP TRIGGER flat_response_value_search_truncate ON public.response;
--rollback DROP TRIGGER flat_response_value_search_delete ON public.response;
--rollback DROP TRIGGER flat_response_value_search_update ON public.response;
--rollback DROP TRIGGER flat_response_value_search_insert ON public.response;
--rollback DROP TRIGGER flat_response_projection_unit_truncate ON public.unit;
--rollback DROP TRIGGER flat_response_projection_info_truncate ON public.bookletinfo;
--rollback DROP TRIGGER flat_response_projection_booklet_truncate ON public.booklet;
--rollback DROP TRIGGER flat_response_projection_person_truncate ON public.persons;
--rollback DROP TRIGGER flat_response_projection_unit_delete ON public.unit;
--rollback DROP TRIGGER flat_response_projection_booklet_delete ON public.booklet;
--rollback DROP TRIGGER flat_response_projection_person_delete ON public.persons;
--rollback DROP TRIGGER flat_response_projection_unit_update ON public.unit;
--rollback DROP TRIGGER flat_response_projection_info_update ON public.bookletinfo;
--rollback DROP TRIGGER flat_response_projection_booklet_update ON public.booklet;
--rollback DROP TRIGGER flat_response_projection_person_update ON public.persons;
--rollback DROP TRIGGER flat_response_first_page_unit_insert ON public.unit;
--rollback DROP TRIGGER flat_response_projection_workspace_insert ON public.workspace;
--rollback DROP FUNCTION public.flat_response_first_page_update_totals();
--rollback DROP FUNCTION public.flat_response_value_search_update();
--rollback DROP FUNCTION public.flat_response_projection_invalidate();
--rollback DROP FUNCTION public.flat_response_first_page_insert_unit();
--rollback DROP FUNCTION public.flat_response_projection_insert_workspace();
--rollback DROP FUNCTION public.rebuild_flat_response_workspace(integer);
--rollback DROP VIEW public.flat_response_value_search_workspace;
--rollback DROP TABLE public.flat_response_value_search_link;
--rollback DROP TABLE public.flat_response_value_search_value;
--rollback DROP TABLE public.flat_response_first_page_total;
--rollback DROP TABLE public.flat_response_first_page_unit;
--rollback DROP VIEW public.flat_response_first_page_source_unit;
--rollback DROP TABLE public.flat_response_first_page_workspace;
