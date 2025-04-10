-- liquibase formatted sql

-- changeset jurei733:1
CREATE TABLE "public"."persons" (
                                  "id"            SERIAL PRIMARY KEY,
                                  "group"         VARCHAR(100) NOT NULL,
                                  "login"         VARCHAR(100) NOT NULL,
                                  "code"          VARCHAR(100) NOT NULL,
                                  "booklets"      JSONB,
                                  "workspace_id"  INTEGER,
                                  "uploaded_at"   TIMESTAMP WITH TIME ZONE DEFAULT now(),
                                  "source"        VARCHAR(100)
);
-- rollback DROP TABLE "public"."persons";

-- changeset jurei733:2
ALTER TABLE "public"."persons" ADD CONSTRAINT person_id UNIQUE ("group",login,code);
-- rollback ALTER TABLE "public"."persons" DROP CONSTRAINT person_id;
