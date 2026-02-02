-- liquibase formatted sql

-- changeset jurei733:0
-- comment: Create tables for coder training configuration

CREATE TABLE "public"."coder_training_variable" (
  "id" SERIAL PRIMARY KEY,
  "coder_training_id" INTEGER NOT NULL,
  "variable_id" VARCHAR(255) NOT NULL,
  "unit_name" VARCHAR(255) NOT NULL,
  "sample_count" INTEGER NOT NULL DEFAULT 10,
  CONSTRAINT "fk_coder_training_variable_training" FOREIGN KEY ("coder_training_id") REFERENCES "public"."coder_training" ("id") ON DELETE CASCADE
);

CREATE INDEX "idx_coder_training_variable_training_id" ON "public"."coder_training_variable" ("coder_training_id");

CREATE TABLE "public"."coder_training_bundle" (
  "id" SERIAL PRIMARY KEY,
  "coder_training_id" INTEGER NOT NULL,
  "variable_bundle_id" INTEGER NOT NULL,
  "sample_count" INTEGER NOT NULL DEFAULT 10,
  CONSTRAINT "fk_coder_training_bundle_training" FOREIGN KEY ("coder_training_id") REFERENCES "public"."coder_training" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_coder_training_bundle_bundle" FOREIGN KEY ("variable_bundle_id") REFERENCES "public"."variable_bundle" ("id") ON DELETE CASCADE
);

CREATE INDEX "idx_coder_training_bundle_training_id" ON "public"."coder_training_bundle" ("coder_training_id");

CREATE TABLE "public"."coder_training_coder" (
  "id" SERIAL PRIMARY KEY,
  "coder_training_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  CONSTRAINT "fk_coder_training_coder_training" FOREIGN KEY ("coder_training_id") REFERENCES "public"."coder_training" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_coder_training_coder_user" FOREIGN KEY ("user_id") REFERENCES "public"."user" ("id") ON DELETE CASCADE
);

CREATE INDEX "idx_coder_training_coder_training_id" ON "public"."coder_training_coder" ("coder_training_id");

-- rollback DROP TABLE IF EXISTS "public"."coder_training_coder";
-- rollback DROP TABLE IF EXISTS "public"."coder_training_bundle";
-- rollback DROP TABLE IF EXISTS "public"."coder_training_variable";
