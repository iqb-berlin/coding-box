-- liquibase formatted sql

-- changeset jurei733:1
CREATE TABLE "public"."user"
(
  "id"          SERIAL
    PRIMARY KEY,
  "username"    VARCHAR(50)  NOT NULL,
  "isAdmin"     BOOLEAN DEFAULT FALSE,
  "description" TEXT,
  "identity"    TEXT NOT NULL,
  "issuer"      TEXT NOT NULL
);
-- rollback DROP TABLE "public"."user";

-- changeset jurei733:2
CREATE TABLE "public"."workspace"
(
  "id"       SERIAL
    PRIMARY KEY,
  "name"     VARCHAR(50) NOT NULL,
  "settings" JSONB
);
-- rollback DROP TABLE "public"."workspace";

-- changeset jurei733:3
CREATE TABLE "public"."workspace_user"
(
  "workspace_id" INTEGER NOT NULL
    REFERENCES "public"."workspace"
      ON DELETE CASCADE,
  "user_id"      INTEGER NOT NULL
    REFERENCES "public"."user"
      ON DELETE CASCADE,
  PRIMARY KEY ("workspace_id", "user_id")
);
-- rollback DROP TABLE "public"."workspace_user";

-- changeset jurei733:4
CREATE TABLE "public"."responses"
(
  "id"          SERIAL
    PRIMARY KEY,
  "unit_id"      VARCHAR(50) NOT NULL,
  "test_person"  VARCHAR(100),
  "test_group"   VARCHAR(100),
  "workspace_id" INTEGER     NOT NULL,
  "responses"    JSONB,
  "created_at"  TIMESTAMP WITH TIME ZONE DEFAULT now()
);
-- rollback DROP TABLE "public"."responses;

-- changeset jurei733:5
CREATE TABLE "public"."file_upload"
(
  "id"          SERIAL
    PRIMARY KEY,
  "data"        VARCHAR,
  "workspace_id" INTEGER     NOT NULL,
  "filename"    VARCHAR(100),
  "file_size"   INTEGER,
  "file_type"   VARCHAR(100),
  "created_at"  TIMESTAMP WITH TIME ZONE DEFAULT now()
);
-- rollback DROP TABLE "public"."file_upload;

-- changeset jurei733:6
CREATE TABLE "public"."resource_package"
(
  "id"         SERIAL NOT NULL
    PRIMARY KEY,
  "elements"   TEXT[],
  "name"       VARCHAR(100),
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now()
);
-- rollback DROP TABLE "public"."resource_package";
