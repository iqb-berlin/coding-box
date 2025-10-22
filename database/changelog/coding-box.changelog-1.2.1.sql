-- liquibase formatted sql

-- changeset jurei733:1
-- comment: Create missings_profile table to replace settings-based storage

CREATE TABLE "public"."missings_profile" (
  "id" SERIAL PRIMARY KEY,
  "label" VARCHAR(255) NOT NULL UNIQUE,
  "missings" TEXT NOT NULL
);

-- rollback DROP TABLE IF EXISTS "public"."missings_profile";

-- changeset jurei733:2
-- comment: Migrate existing missings profiles from settings table to dedicated table

-- Migrate data from settings table if the key exists
INSERT INTO "public"."missings_profile" ("label", "missings")
SELECT 'IQB-Standard' as label, content as missings
FROM "public"."setting"
WHERE key = 'missings-profile-iqb-standard';

-- Comment: Only delete after confirming migration works correctly in production
-- DELETE FROM "public"."setting" WHERE key = 'missings-profile-iqb-standard';

-- rollback DELETE FROM "public"."missings_profile" WHERE "label" = 'IQB-Standard';
