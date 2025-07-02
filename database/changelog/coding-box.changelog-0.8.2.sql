-- liquibase formatted sql

-- changeset jurei733:1
-- Add missing indexes for bookletInfo entity
CREATE INDEX IF NOT EXISTS "idx_bookletinfo_name" ON "public"."bookletinfo" ("name");
-- rollback DROP INDEX IF EXISTS "idx_bookletinfo_name";

-- changeset jurei733:2
-- Add missing indexes for persons entity
CREATE INDEX IF NOT EXISTS "idx_persons_workspace_code" ON "public"."persons" ("workspace_id", "code");
CREATE INDEX IF NOT EXISTS "idx_persons_workspace_group" ON "public"."persons" ("workspace_id", "group");
CREATE INDEX IF NOT EXISTS "idx_persons_login_code_workspace" ON "public"."persons" ("login", "code", "workspace_id");
-- rollback DROP INDEX IF EXISTS "idx_persons_workspace_code"; DROP INDEX IF EXISTS "idx_persons_workspace_group"; DROP INDEX IF EXISTS "idx_persons_login_code_workspace";

-- changeset jurei733:3
-- Add missing indexes for response entity
CREATE INDEX IF NOT EXISTS "idx_response_unitid_variableid" ON "public"."response" ("unitid", "variableid");
CREATE INDEX IF NOT EXISTS "idx_response_unitid_status" ON "public"."response" ("unitid", "status");
CREATE INDEX IF NOT EXISTS "idx_response_codedstatus" ON "public"."response" ("codedstatus");
CREATE INDEX IF NOT EXISTS "idx_response_value" ON "public"."response" (substring("value", 1, 1000));
-- rollback DROP INDEX IF EXISTS "idx_response_unitid_variableid"; DROP INDEX IF EXISTS "idx_response_unitid_status"; DROP INDEX IF EXISTS "idx_response_codedstatus"; DROP INDEX IF EXISTS "idx_response_value";

-- changeset jurei733:4
-- Add missing indexes for unit entity
CREATE INDEX IF NOT EXISTS "idx_unit_bookletid_alias" ON "public"."unit" ("bookletid", "alias");
-- rollback DROP INDEX IF EXISTS "idx_unit_bookletid_alias";

-- changeset jurei733:5
-- Add missing indexes for booklet entity
CREATE INDEX IF NOT EXISTS "idx_booklet_personid_infoid" ON "public"."booklet" ("personid", "infoid");
-- rollback DROP INDEX IF EXISTS "idx_booklet_personid_infoid";
