-- liquibase formatted sql

-- changeset jurei733:813-coding-status-revision splitStatements:false
-- comment: Track all workspace state that contributes to coding status snapshots
CREATE TABLE "public"."workspace_coding_status_revision" (
  "workspace_id" INTEGER PRIMARY KEY,
  "revision" BIGINT NOT NULL DEFAULT 0,
  "last_touch_transaction_id" BIGINT,
  "processed_test_results_revision" INTEGER NOT NULL DEFAULT 0,
  "failed_test_results_revision" INTEGER,
  "last_test_result_update_failed_at" TIMESTAMP WITH TIME ZONE,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "workspace_coding_status_revision_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace" ("id") ON DELETE CASCADE
);

CREATE TABLE "public"."workspace_coding_status_revision_operation" (
  "workspace_id" INTEGER NOT NULL,
  "test_results_revision" INTEGER NOT NULL,
  "started_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  PRIMARY KEY ("workspace_id", "test_results_revision"),
  CONSTRAINT "workspace_coding_status_revision_operation_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace" ("id") ON DELETE CASCADE
);

INSERT INTO "public"."workspace_coding_status_revision" (
  "workspace_id",
  "revision",
  "processed_test_results_revision"
)
SELECT
  workspace.id,
  1,
  COALESCE(test_revision.revision, 0)
FROM "public"."workspace"
LEFT JOIN "public"."workspace_test_results_revision" test_revision
  ON test_revision.workspace_id = workspace.id;

CREATE OR REPLACE FUNCTION "public"."touch_workspace_coding_status_revision_by_id"(
  changed_workspace_id INTEGER
)
RETURNS void AS $$
DECLARE
  touched_workspace_ids TEXT;
  workspace_marker TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "public"."workspace"
    WHERE "id" = changed_workspace_id
  ) THEN
    RETURN;
  END IF;

  touched_workspace_ids := COALESCE(
    NULLIF(current_setting('coding_box.touched_status_workspaces', true), ''),
    ','
  );
  workspace_marker := ',' || changed_workspace_id::TEXT || ',';
  IF strpos(touched_workspace_ids, workspace_marker) > 0 THEN
    RETURN;
  END IF;
  PERFORM set_config(
    'coding_box.touched_status_workspaces',
    touched_workspace_ids || changed_workspace_id::TEXT || ',',
    true
  );

  INSERT INTO "public"."workspace_coding_status_revision" (
    "workspace_id",
    "revision",
    "last_touch_transaction_id",
    "processed_test_results_revision",
    "updated_at"
  )
  VALUES (
    changed_workspace_id,
    1,
    txid_current(),
    0,
    now()
  )
  ON CONFLICT ("workspace_id") DO UPDATE
  SET "revision" = "workspace_coding_status_revision"."revision" + 1,
      "last_touch_transaction_id" = EXCLUDED."last_touch_transaction_id",
      "updated_at" = EXCLUDED."updated_at"
  WHERE "workspace_coding_status_revision"."last_touch_transaction_id"
    IS DISTINCT FROM EXCLUDED."last_touch_transaction_id";
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "public"."touch_workspace_coding_status_revision"()
RETURNS trigger AS $$
DECLARE
  old_workspace_id INTEGER;
  new_workspace_id INTEGER;
  changed_workspace_id INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_workspace_id := NULLIF(to_jsonb(OLD) ->> TG_ARGV[0], '')::INTEGER;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_workspace_id := NULLIF(to_jsonb(NEW) ->> TG_ARGV[0], '')::INTEGER;
  END IF;

  FOR changed_workspace_id IN
    SELECT DISTINCT candidate.workspace_id
    FROM unnest(ARRAY[old_workspace_id, new_workspace_id]) AS candidate(workspace_id)
    WHERE candidate.workspace_id IS NOT NULL
  LOOP
    PERFORM "public"."touch_workspace_coding_status_revision_by_id"(changed_workspace_id);
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "public"."touch_workspace_coding_status_revision_from_file_upload"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM "public"."touch_workspace_coding_status_revision_by_id"(NEW.workspace_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM "public"."touch_workspace_coding_status_revision_by_id"(OLD.workspace_id);
  ELSE
    PERFORM "public"."touch_workspace_coding_status_revision_by_id"(OLD.workspace_id);
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      PERFORM "public"."touch_workspace_coding_status_revision_by_id"(NEW.workspace_id);
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "public"."touch_workspace_coding_status_revision_from_parent"()
RETURNS trigger AS $$
DECLARE
  old_parent_id INTEGER;
  new_parent_id INTEGER;
  changed_workspace_id INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_parent_id := NULLIF(to_jsonb(OLD) ->> TG_ARGV[1], '')::INTEGER;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_parent_id := NULLIF(to_jsonb(NEW) ->> TG_ARGV[1], '')::INTEGER;
  END IF;

  FOR changed_workspace_id IN EXECUTE format(
    'SELECT DISTINCT workspace_id FROM public.%I WHERE id = ANY($1)',
    TG_ARGV[0]
  ) USING ARRAY[old_parent_id, new_parent_id]
  LOOP
    PERFORM "public"."touch_workspace_coding_status_revision_by_id"(changed_workspace_id);
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "public"."touch_workspace_coding_status_revision_from_workspace_rows"()
RETURNS trigger AS $$
DECLARE
  changed_rows_sql TEXT;
  workspace_query TEXT;
  changed_workspace_id INTEGER;
BEGIN
  changed_rows_sql := CASE TG_OP
    WHEN 'INSERT' THEN 'SELECT * FROM new_rows'
    WHEN 'DELETE' THEN 'SELECT * FROM old_rows'
    ELSE 'SELECT * FROM old_rows UNION ALL SELECT * FROM new_rows'
  END;

  workspace_query := format(
    'SELECT DISTINCT NULLIF(to_jsonb(changed) ->> %L, '''')::INTEGER '
    'FROM (%s) changed '
    'WHERE NULLIF(to_jsonb(changed) ->> %L, '''') IS NOT NULL',
    TG_ARGV[0],
    changed_rows_sql,
    TG_ARGV[0]
  );

  FOR changed_workspace_id IN EXECUTE workspace_query
  LOOP
    PERFORM "public"."touch_workspace_coding_status_revision_by_id"(changed_workspace_id);
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "public"."touch_workspace_coding_status_revision_from_parent_rows"()
RETURNS trigger AS $$
DECLARE
  changed_rows_sql TEXT;
  workspace_query TEXT;
  changed_workspace_id INTEGER;
BEGIN
  changed_rows_sql := CASE TG_OP
    WHEN 'INSERT' THEN 'SELECT * FROM new_rows'
    WHEN 'DELETE' THEN 'SELECT * FROM old_rows'
    ELSE 'SELECT * FROM old_rows UNION ALL SELECT * FROM new_rows'
  END;

  workspace_query := format(
    'SELECT DISTINCT parent.workspace_id '
    'FROM (%s) changed '
    'INNER JOIN public.%I parent '
    'ON parent.id = NULLIF(to_jsonb(changed) ->> %L, '''')::INTEGER '
    'WHERE parent.workspace_id IS NOT NULL',
    changed_rows_sql,
    TG_ARGV[0],
    TG_ARGV[1]
  );

  FOR changed_workspace_id IN EXECUTE workspace_query
  LOOP
    PERFORM "public"."touch_workspace_coding_status_revision_by_id"(changed_workspace_id);
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "public"."touch_workspace_coding_status_revision_from_setting"()
RETURNS trigger AS $$
DECLARE
  old_setting_key TEXT;
  new_setting_key TEXT;
  changed_setting_key TEXT;
  setting_key_match TEXT[];
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_setting_key := OLD.key;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_setting_key := NEW.key;
  END IF;

  FOR changed_setting_key IN
    SELECT DISTINCT candidate.setting_key
    FROM unnest(ARRAY[old_setting_key, new_setting_key]) AS candidate(setting_key)
    WHERE candidate.setting_key IS NOT NULL
  LOOP
    setting_key_match := regexp_match(
      changed_setting_key,
      '^workspace-([0-9]+)-(duplicate-aggregation-threshold|response-matching-mode|include-derive-error-in-manual-coding)$'
    );
    IF setting_key_match IS NOT NULL THEN
      PERFORM "public"."touch_workspace_coding_status_revision_by_id"(
        setting_key_match[1]::INTEGER
      );
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "public"."touch_workspace_coding_status_revision_from_results"()
RETURNS trigger AS $$
DECLARE
  changed_rows_sql TEXT;
  workspace_query TEXT;
  changed_workspace_id INTEGER;
BEGIN
  changed_rows_sql := CASE TG_OP
    WHEN 'INSERT' THEN 'SELECT * FROM new_rows'
    WHEN 'DELETE' THEN 'SELECT * FROM old_rows'
    ELSE 'SELECT * FROM old_rows UNION ALL SELECT * FROM new_rows'
  END;

  workspace_query := CASE TG_ARGV[0]
    WHEN 'persons' THEN format(
      'SELECT DISTINCT workspace_id FROM (%s) changed WHERE workspace_id IS NOT NULL',
      changed_rows_sql
    )
    WHEN 'booklet' THEN format(
      'SELECT DISTINCT person.workspace_id FROM (%s) changed '
      'INNER JOIN public.persons person ON person.id = changed.personid',
      changed_rows_sql
    )
    WHEN 'unit' THEN format(
      'SELECT DISTINCT person.workspace_id FROM (%s) changed '
      'INNER JOIN public.booklet booklet ON booklet.id = changed.bookletid '
      'INNER JOIN public.persons person ON person.id = booklet.personid',
      changed_rows_sql
    )
    WHEN 'response' THEN format(
      'SELECT DISTINCT person.workspace_id FROM (%s) changed '
      'INNER JOIN public.unit unit_record ON unit_record.id = changed.unitid '
      'INNER JOIN public.booklet booklet ON booklet.id = unit_record.bookletid '
      'INNER JOIN public.persons person ON person.id = booklet.personid',
      changed_rows_sql
    )
    ELSE NULL
  END;

  IF workspace_query IS NULL THEN
    RAISE EXCEPTION 'Unsupported coding status revision source: %', TG_ARGV[0];
  END IF;

  FOR changed_workspace_id IN EXECUTE workspace_query
  LOOP
    PERFORM "public"."touch_workspace_coding_status_revision_by_id"(changed_workspace_id);
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "workspace_coding_status_revision_workspace"
AFTER INSERT OR UPDATE ON "public"."workspace"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision"('id');

CREATE TRIGGER "workspace_coding_status_revision_persons_insert"
AFTER INSERT ON "public"."persons"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_results"('persons');

CREATE TRIGGER "workspace_coding_status_revision_persons_update"
AFTER UPDATE ON "public"."persons"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_results"('persons');

CREATE TRIGGER "workspace_coding_status_revision_persons_delete"
AFTER DELETE ON "public"."persons"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_results"('persons');

CREATE TRIGGER "workspace_coding_status_revision_booklet_insert"
AFTER INSERT ON "public"."booklet"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_results"('booklet');

CREATE TRIGGER "workspace_coding_status_revision_booklet_update"
AFTER UPDATE ON "public"."booklet"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_results"('booklet');

CREATE TRIGGER "workspace_coding_status_revision_booklet_delete"
AFTER DELETE ON "public"."booklet"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_results"('booklet');

CREATE TRIGGER "workspace_coding_status_revision_unit_insert"
AFTER INSERT ON "public"."unit"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_results"('unit');

CREATE TRIGGER "workspace_coding_status_revision_unit_update"
AFTER UPDATE ON "public"."unit"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_results"('unit');

CREATE TRIGGER "workspace_coding_status_revision_unit_delete"
AFTER DELETE ON "public"."unit"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_results"('unit');

CREATE TRIGGER "workspace_coding_status_revision_response_insert"
AFTER INSERT ON "public"."response"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_results"('response');

CREATE TRIGGER "workspace_coding_status_revision_response_update"
AFTER UPDATE ON "public"."response"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_results"('response');

CREATE TRIGGER "workspace_coding_status_revision_response_delete"
AFTER DELETE ON "public"."response"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_results"('response');

CREATE TRIGGER "workspace_coding_status_revision_setting"
AFTER INSERT OR UPDATE OR DELETE ON "public"."setting"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_setting"();

CREATE TRIGGER "workspace_coding_status_revision_file_upload"
AFTER INSERT OR UPDATE OR DELETE ON "public"."file_upload"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_file_upload"();

CREATE TRIGGER "workspace_coding_status_revision_missings_profile"
AFTER INSERT OR UPDATE OR DELETE ON "public"."missings_profile"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision"('workspace_id');

CREATE TRIGGER "workspace_coding_status_revision_coding_unit_freshness_insert"
AFTER INSERT ON "public"."coding_unit_freshness"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_workspace_rows"('workspace_id');

CREATE TRIGGER "workspace_coding_status_revision_coding_unit_freshness_update"
AFTER UPDATE ON "public"."coding_unit_freshness"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_workspace_rows"('workspace_id');

CREATE TRIGGER "workspace_coding_status_revision_coding_unit_freshness_delete"
AFTER DELETE ON "public"."coding_unit_freshness"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_workspace_rows"('workspace_id');

CREATE TRIGGER "workspace_coding_status_revision_job_definitions"
AFTER INSERT OR UPDATE OR DELETE ON "public"."job_definitions"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision"('workspace_id');

CREATE TRIGGER "workspace_coding_status_revision_coding_job"
AFTER INSERT OR UPDATE OR DELETE ON "public"."coding_job"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision"('workspace_id');

CREATE TRIGGER "workspace_coding_status_revision_variable_bundle"
AFTER INSERT OR UPDATE OR DELETE ON "public"."variable_bundle"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision"('workspace_id');

CREATE TRIGGER "workspace_coding_status_revision_coder_training"
AFTER INSERT OR UPDATE OR DELETE ON "public"."coder_training"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision"('workspace_id');

CREATE TRIGGER "workspace_coding_status_revision_training_discussion"
AFTER INSERT OR UPDATE OR DELETE ON "public"."coder_training_discussion_result"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision"('workspace_id');

CREATE TRIGGER "workspace_coding_status_revision_double_coding_review"
AFTER INSERT OR UPDATE OR DELETE ON "public"."double_coding_review_decision"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision"('workspace_id');

CREATE TRIGGER "workspace_coding_status_revision_coding_job_unit_insert"
AFTER INSERT ON "public"."coding_job_unit"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_parent_rows"(
  'coding_job',
  'coding_job_id'
);

CREATE TRIGGER "workspace_coding_status_revision_coding_job_unit_update"
AFTER UPDATE ON "public"."coding_job_unit"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_parent_rows"(
  'coding_job',
  'coding_job_id'
);

CREATE TRIGGER "workspace_coding_status_revision_coding_job_unit_delete"
AFTER DELETE ON "public"."coding_job_unit"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_parent_rows"(
  'coding_job',
  'coding_job_id'
);

CREATE TRIGGER "workspace_coding_status_revision_coding_job_variable"
AFTER INSERT OR UPDATE OR DELETE ON "public"."coding_job_variable"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_parent"(
  'coding_job',
  'coding_job_id'
);

CREATE TRIGGER "workspace_coding_status_revision_coding_job_variable_bundle"
AFTER INSERT OR UPDATE OR DELETE ON "public"."coding_job_variable_bundle"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_parent"(
  'coding_job',
  'coding_job_id'
);

CREATE TRIGGER "workspace_coding_status_revision_coding_job_coder"
AFTER INSERT OR UPDATE OR DELETE ON "public"."coding_job_coder"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_parent"(
  'coding_job',
  'coding_job_id'
);

CREATE TRIGGER "workspace_coding_status_revision_coder_training_variable"
AFTER INSERT OR UPDATE OR DELETE ON "public"."coder_training_variable"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_parent"(
  'coder_training',
  'coder_training_id'
);

CREATE TRIGGER "workspace_coding_status_revision_coder_training_bundle"
AFTER INSERT OR UPDATE OR DELETE ON "public"."coder_training_bundle"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_parent"(
  'coder_training',
  'coder_training_id'
);

CREATE TRIGGER "workspace_coding_status_revision_coder_training_coder"
AFTER INSERT OR UPDATE OR DELETE ON "public"."coder_training_coder"
FOR EACH ROW EXECUTE FUNCTION "public"."touch_workspace_coding_status_revision_from_parent"(
  'coder_training',
  'coder_training_id'
);

-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_coder_training_coder" ON "public"."coder_training_coder";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_coder_training_bundle" ON "public"."coder_training_bundle";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_coder_training_variable" ON "public"."coder_training_variable";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_coding_job_coder" ON "public"."coding_job_coder";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_coding_job_variable_bundle" ON "public"."coding_job_variable_bundle";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_coding_job_variable" ON "public"."coding_job_variable";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_coding_job_unit_delete" ON "public"."coding_job_unit";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_coding_job_unit_update" ON "public"."coding_job_unit";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_coding_job_unit_insert" ON "public"."coding_job_unit";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_double_coding_review" ON "public"."double_coding_review_decision";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_training_discussion" ON "public"."coder_training_discussion_result";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_coder_training" ON "public"."coder_training";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_variable_bundle" ON "public"."variable_bundle";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_coding_job" ON "public"."coding_job";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_job_definitions" ON "public"."job_definitions";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_coding_unit_freshness_delete" ON "public"."coding_unit_freshness";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_coding_unit_freshness_update" ON "public"."coding_unit_freshness";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_coding_unit_freshness_insert" ON "public"."coding_unit_freshness";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_missings_profile" ON "public"."missings_profile";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_file_upload" ON "public"."file_upload";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_setting" ON "public"."setting";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_response_delete" ON "public"."response";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_response_update" ON "public"."response";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_response_insert" ON "public"."response";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_unit_delete" ON "public"."unit";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_unit_update" ON "public"."unit";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_unit_insert" ON "public"."unit";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_booklet_delete" ON "public"."booklet";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_booklet_update" ON "public"."booklet";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_booklet_insert" ON "public"."booklet";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_persons_delete" ON "public"."persons";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_persons_update" ON "public"."persons";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_persons_insert" ON "public"."persons";
-- rollback DROP TRIGGER IF EXISTS "workspace_coding_status_revision_workspace" ON "public"."workspace";
-- rollback DROP FUNCTION IF EXISTS "public"."touch_workspace_coding_status_revision_from_setting"();
-- rollback DROP FUNCTION IF EXISTS "public"."touch_workspace_coding_status_revision_from_results"();
-- rollback DROP FUNCTION IF EXISTS "public"."touch_workspace_coding_status_revision_from_parent_rows"();
-- rollback DROP FUNCTION IF EXISTS "public"."touch_workspace_coding_status_revision_from_workspace_rows"();
-- rollback DROP FUNCTION IF EXISTS "public"."touch_workspace_coding_status_revision_from_parent"();
-- rollback DROP FUNCTION IF EXISTS "public"."touch_workspace_coding_status_revision_from_file_upload"();
-- rollback DROP FUNCTION IF EXISTS "public"."touch_workspace_coding_status_revision"();
-- rollback DROP FUNCTION IF EXISTS "public"."touch_workspace_coding_status_revision_by_id"(INTEGER);
-- rollback DROP TABLE IF EXISTS "public"."workspace_coding_status_revision_operation";
-- rollback DROP TABLE IF EXISTS "public"."workspace_coding_status_revision";
