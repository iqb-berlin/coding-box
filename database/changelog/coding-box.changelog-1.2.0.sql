-- liquibase formatted sql

-- changeset jurei733:1
ALTER TABLE response ADD PRIMARY KEY (id);
-- rollback ALTER TABLE response DROP CONSTRAINT response_pkey;


-- changeset jurei733:2
CREATE TABLE "public"."coding_job_unit" (
                                          "id" SERIAL PRIMARY KEY,
                                          "coding_job_id" INTEGER NOT NULL,
                                          "response_id" INTEGER NOT NULL,
                                          "unit_name" VARCHAR(255) NOT NULL,
                                          "unit_alias" VARCHAR(255),
                                          "variable_id" VARCHAR(255) NOT NULL,
                                          "variable_anchor" VARCHAR(255) NOT NULL,
                                          "booklet_name" VARCHAR(255) NOT NULL,
                                          "person_login" VARCHAR(255) NOT NULL,
                                          "person_code" VARCHAR(255) NOT NULL,
                                          "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
                                          CONSTRAINT "fk_coding_job_unit_coding_job" FOREIGN KEY ("coding_job_id") REFERENCES "public"."coding_job" ("id") ON DELETE CASCADE,
                                          CONSTRAINT "fk_coding_job_unit_response" FOREIGN KEY ("response_id") REFERENCES "public"."response" ("id") ON DELETE CASCADE
);

CREATE INDEX "idx_coding_job_unit_coding_job_id" ON "public"."coding_job_unit" ("coding_job_id");
CREATE INDEX "idx_coding_job_unit_response_id" ON "public"."coding_job_unit" ("response_id");

-- rollback DROP TABLE IF EXISTS "public"."coding_job_unit";


-- changeset jurei733:3
-- comment: Add code-related columns to coding_job_unit table

ALTER TABLE coding_job_unit
  ADD COLUMN code_id INTEGER NULL;

ALTER TABLE coding_job_unit
  ADD COLUMN code VARCHAR(255) NULL;

ALTER TABLE coding_job_unit
  ADD COLUMN code_label VARCHAR(255) NULL;

ALTER TABLE coding_job_unit
  ADD COLUMN score INTEGER NULL;

-- rollback ALTER TABLE coding_job_unit DROP COLUMN score;
-- rollback ALTER TABLE coding_job_unit DROP COLUMN code_label;
-- rollback ALTER TABLE coding_job_unit DROP COLUMN code;
-- rollback ALTER TABLE coding_job_unit DROP COLUMN code_id;
