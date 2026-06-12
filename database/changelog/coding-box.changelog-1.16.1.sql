-- liquibase formatted sql

-- changeset jurei733:1
--validCheckSum: 9:07488bba2e47a938b6e337fe296cc376
-- comment: Persist DERIVE_ERROR opt-in for coder-training variables

ALTER TABLE "public"."coder_training_variable"
  ADD COLUMN IF NOT EXISTS "include_derive_error" BOOLEAN NOT NULL DEFAULT FALSE;

-- rollback ALTER TABLE "public"."coder_training_variable" DROP COLUMN IF EXISTS "include_derive_error";

-- changeset jurei733:2
-- comment: Persist full display options for coder trainings

ALTER TABLE "public"."coder_training"
  ADD COLUMN IF NOT EXISTS "show_score" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "allow_comments" BOOLEAN NOT NULL DEFAULT true;

-- rollback ALTER TABLE "public"."coder_training" DROP COLUMN IF EXISTS "allow_comments";
-- rollback ALTER TABLE "public"."coder_training" DROP COLUMN IF EXISTS "show_score";

-- changeset jurei733:3 splitStatements:false
-- comment: Store coding issue review jobs with explicit metadata instead of comment markers

ALTER TABLE "public"."coding_job"
  ADD COLUMN IF NOT EXISTS "job_type" VARCHAR(32) NOT NULL DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS "source_coding_job_id" INTEGER NULL,
  ADD COLUMN IF NOT EXISTS "reviewer_user_id" INTEGER NULL;

WITH marker_jobs AS (
  SELECT
    cj."id",
    SUBSTRING(cj."comment" FROM '^\[coding-issue-review-source-job:([0-9]+)\]$')::INTEGER AS source_id,
    (
      SELECT cjc."user_id"
      FROM "public"."coding_job_coder" cjc
      WHERE cjc."coding_job_id" = cj."id"
      ORDER BY cjc."id"
      LIMIT 1
    ) AS reviewer_user_id
  FROM "public"."coding_job" cj
  WHERE cj."comment" ~ '^\[coding-issue-review-source-job:[0-9]+\]$'
)
UPDATE "public"."coding_job" target
SET
  "job_type" = 'coding_issue_review',
  "source_coding_job_id" = source."id",
  "reviewer_user_id" = marker.reviewer_user_id,
  "comment" = NULL
FROM marker_jobs marker
LEFT JOIN "public"."coding_job" source ON source."id" = marker.source_id
WHERE target."id" = marker."id";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'check_coding_job_job_type'
  ) THEN
    ALTER TABLE "public"."coding_job"
      ADD CONSTRAINT "check_coding_job_job_type"
        CHECK ("job_type" IN ('regular', 'coding_issue_review'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_coding_job_source_coding_job'
  ) THEN
    ALTER TABLE "public"."coding_job"
      ADD CONSTRAINT "fk_coding_job_source_coding_job"
        FOREIGN KEY ("source_coding_job_id")
        REFERENCES "public"."coding_job" ("id")
        ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_coding_job_workspace_job_type"
  ON "public"."coding_job" ("workspace_id", "job_type");

CREATE INDEX IF NOT EXISTS "idx_coding_job_source_coding_job_id"
  ON "public"."coding_job" ("source_coding_job_id")
  WHERE "source_coding_job_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_coding_issue_review_source_reviewer"
  ON "public"."coding_job" ("source_coding_job_id", "reviewer_user_id")
  WHERE "job_type" = 'coding_issue_review'
    AND "source_coding_job_id" IS NOT NULL
    AND "reviewer_user_id" IS NOT NULL;

-- rollback UPDATE "public"."coding_job" SET "comment" = CONCAT('[coding-issue-review-source-job:', "source_coding_job_id", ']') WHERE "job_type" = 'coding_issue_review' AND "source_coding_job_id" IS NOT NULL AND "comment" IS NULL;
-- rollback DROP INDEX IF EXISTS "public"."uq_coding_issue_review_source_reviewer";
-- rollback DROP INDEX IF EXISTS "public"."idx_coding_job_source_coding_job_id";
-- rollback DROP INDEX IF EXISTS "public"."idx_coding_job_workspace_job_type";
-- rollback ALTER TABLE "public"."coding_job" DROP CONSTRAINT IF EXISTS "fk_coding_job_source_coding_job";
-- rollback ALTER TABLE "public"."coding_job" DROP CONSTRAINT IF EXISTS "check_coding_job_job_type";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "reviewer_user_id";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "source_coding_job_id";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "job_type";
