-- liquibase formatted sql

-- changeset jurei733:1
CREATE TABLE "public"."variable_bundle" (
                                          "id" SERIAL PRIMARY KEY,
                                          "workspace_id" INTEGER NOT NULL,
                                          "name" VARCHAR(255) NOT NULL,
                                          "description" TEXT,
                                          "variables" JSONB NOT NULL,
                                          "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
                                          "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_variable_bundle_workspace_id" ON "public"."variable_bundle" ("workspace_id");

-- rollback DROP TABLE IF EXISTS "public"."variable_bundle" CASCADE;
