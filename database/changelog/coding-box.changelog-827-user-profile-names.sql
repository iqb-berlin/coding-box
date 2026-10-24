-- liquibase formatted sql

-- changeset iqb:827-user-profile-names
-- comment: Persist OIDC given and family names; existing profiles fill on authentication
ALTER TABLE "public"."user"
  ADD COLUMN "first_name" VARCHAR NULL,
  ADD COLUMN "last_name" VARCHAR NULL;

-- rollback ALTER TABLE "public"."user" DROP COLUMN "last_name";
-- rollback ALTER TABLE "public"."user" DROP COLUMN "first_name";
