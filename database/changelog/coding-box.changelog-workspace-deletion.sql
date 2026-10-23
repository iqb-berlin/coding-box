-- liquibase formatted sql

-- changeset jurei733:964-cleanup splitStatements:false
-- comment: Remove only rows whose owning workspace no longer exists; report counts for deployment logs. Run with workers stopped during rollout.
DO $$
DECLARE
  owned_table text;
  removed_count bigint;
BEGIN
  -- The denormalized owner follows the coding job, including legacy NULL values.
  UPDATE public.coding_job_unit cju SET workspace_id = cj.workspace_id
  FROM public.coding_job cj
  WHERE cj.id = cju.coding_job_id AND cju.workspace_id IS DISTINCT FROM cj.workspace_id;

  -- Historical cross-workspace references must not block orphan cleanup.
  UPDATE public.coding_job cj SET missings_profile_id = NULL
  FROM public.missings_profile mp
  WHERE mp.id = cj.missings_profile_id
    AND NOT EXISTS (SELECT 1 FROM public.workspace w WHERE w.id = mp.workspace_id);
  UPDATE public.job_definitions jd SET missings_profile_id = NULL
  FROM public.missings_profile mp
  WHERE mp.id = jd.missings_profile_id
    AND NOT EXISTS (SELECT 1 FROM public.workspace w WHERE w.id = mp.workspace_id);

  FOREACH owned_table IN ARRAY ARRAY[
    'coding_job_unit', 'coding_job', 'job_definitions', 'coder_training_discussion_result',
    'coder_training', 'variable_bundle', 'coding_unit_freshness', 'persons', 'file_upload',
    'replay_statistics', 'journal_entries', 'job', 'variable_analysis_job',
    'test_person_coding_job', 'workspace_test_results_revision', 'missings_profile',
    'workspace_user', 'testcenter_import_run', 'double_coding_review_decision'
  ] LOOP
    EXECUTE format('DELETE FROM public.%I owned WHERE NOT EXISTS (SELECT 1 FROM public.workspace w WHERE w.id = owned.workspace_id)', owned_table);
    GET DIAGNOSTICS removed_count = ROW_COUNT;
    RAISE NOTICE 'Workspace orphan cleanup: % rows from %', removed_count, owned_table;
  END LOOP;
  DELETE FROM public.resource_package p WHERE p.scope = 'workspace'
    AND NOT EXISTS (SELECT 1 FROM public.workspace w WHERE w.id = p."workspaceId");
  GET DIAGNOSTICS removed_count = ROW_COUNT;
  RAISE NOTICE 'Workspace orphan cleanup: % rows from resource_package', removed_count;
END $$;
-- rollback SELECT 1; -- Deleted orphans cannot be reconstructed.

-- changeset jurei733:964-workspace-foreign-keys
-- comment: Persist workspace ownership in the database, including historical job tables.
ALTER TABLE public."file_upload" ADD CONSTRAINT "fk_file_upload_workspace" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
ALTER TABLE public."persons" ADD CONSTRAINT "fk_persons_workspace" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
ALTER TABLE public."coding_job" ADD CONSTRAINT "fk_coding_job_workspace" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
ALTER TABLE public."job_definitions" ADD CONSTRAINT "fk_job_definitions_workspace" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
ALTER TABLE public."coder_training" ADD CONSTRAINT "fk_coder_training_workspace" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
ALTER TABLE public."coder_training_discussion_result" ADD CONSTRAINT "fk_coder_training_discussion_result_workspace" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
ALTER TABLE public."variable_bundle" ADD CONSTRAINT "fk_variable_bundle_workspace" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
ALTER TABLE public."replay_statistics" ADD CONSTRAINT "fk_replay_statistics_workspace" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
ALTER TABLE public."journal_entries" ADD CONSTRAINT "fk_journal_entries_workspace" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
ALTER TABLE public."job" ADD CONSTRAINT "fk_job_workspace" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
ALTER TABLE public."variable_analysis_job" ADD CONSTRAINT "fk_variable_analysis_job_workspace" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
ALTER TABLE public."test_person_coding_job" ADD CONSTRAINT "fk_test_person_coding_job_workspace" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
ALTER TABLE public."coding_unit_freshness" ADD CONSTRAINT "fk_coding_unit_freshness_workspace" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
ALTER TABLE public."workspace_test_results_revision" ADD CONSTRAINT "fk_workspace_test_results_revision_workspace" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
ALTER TABLE public."coding_job_unit" ADD CONSTRAINT "fk_coding_job_unit_workspace" FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
-- rollback ALTER TABLE public."coding_job_unit" DROP CONSTRAINT "fk_coding_job_unit_workspace";
-- rollback ALTER TABLE public."workspace_test_results_revision" DROP CONSTRAINT "fk_workspace_test_results_revision_workspace";
-- rollback ALTER TABLE public."coding_unit_freshness" DROP CONSTRAINT "fk_coding_unit_freshness_workspace";
-- rollback ALTER TABLE public."test_person_coding_job" DROP CONSTRAINT "fk_test_person_coding_job_workspace";
-- rollback ALTER TABLE public."variable_analysis_job" DROP CONSTRAINT "fk_variable_analysis_job_workspace";
-- rollback ALTER TABLE public."job" DROP CONSTRAINT "fk_job_workspace";
-- rollback ALTER TABLE public."journal_entries" DROP CONSTRAINT "fk_journal_entries_workspace";
-- rollback ALTER TABLE public."replay_statistics" DROP CONSTRAINT "fk_replay_statistics_workspace";
-- rollback ALTER TABLE public."variable_bundle" DROP CONSTRAINT "fk_variable_bundle_workspace";
-- rollback ALTER TABLE public."coder_training_discussion_result" DROP CONSTRAINT "fk_coder_training_discussion_result_workspace";
-- rollback ALTER TABLE public."coder_training" DROP CONSTRAINT "fk_coder_training_workspace";
-- rollback ALTER TABLE public."job_definitions" DROP CONSTRAINT "fk_job_definitions_workspace";
-- rollback ALTER TABLE public."coding_job" DROP CONSTRAINT "fk_coding_job_workspace";
-- rollback ALTER TABLE public."persons" DROP CONSTRAINT "fk_persons_workspace";
-- rollback ALTER TABLE public."file_upload" DROP CONSTRAINT "fk_file_upload_workspace";

-- changeset jurei733:964-missings-profile-workspace
ALTER TABLE public.missings_profile ADD CONSTRAINT fk_missings_profile_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
-- rollback ALTER TABLE public.missings_profile DROP CONSTRAINT fk_missings_profile_workspace;

-- changeset jurei733:964-resource-package-workspace
-- comment: Global packages keep the existing workspaceId=0 API convention. Only workspace packages have an owning workspace.
ALTER TABLE public.resource_package ADD COLUMN owner_workspace_id integer
  GENERATED ALWAYS AS (CASE WHEN scope = 'workspace' THEN "workspaceId" ELSE NULL END) STORED;
ALTER TABLE public.resource_package ADD CONSTRAINT fk_resource_package_workspace
  FOREIGN KEY (owner_workspace_id) REFERENCES public.workspace(id) ON DELETE CASCADE;
CREATE INDEX idx_resource_package_owner_workspace ON public.resource_package(owner_workspace_id);
-- rollback ALTER TABLE public.resource_package DROP COLUMN owner_workspace_id;
