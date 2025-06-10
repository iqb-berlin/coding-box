-- liquibase formatted sql

-- changeset jurei733:1
CREATE TABLE person (
                      id SERIAL PRIMARY KEY NOT NULL,
                      "group" TEXT NOT NULL,
                      login TEXT NOT NULL,
                      code TEXT NULL
);
-- rollback DROP TABLE IF EXISTS person;

-- changeset jurei733:2
CREATE TABLE bookletInfo (
                           id SERIAL PRIMARY KEY NOT NULL,
                           name TEXT NOT NULL,
                           size BIGINT DEFAULT (0) NOT NULL
);
-- rollback DROP TABLE IF EXISTS bookletInfo;

-- changeset jurei733:3
CREATE TABLE booklet (
                       id SERIAL PRIMARY KEY NOT NULL,
                       infoId BIGINT NOT NULL,
                       personId BIGINT NOT NULL,
                       lastTs BIGINT DEFAULT 0 NOT NULL,
                       firstTs BIGINT DEFAULT 0 NOT NULL,
                       CONSTRAINT FK_booklet_person FOREIGN KEY (personId) REFERENCES persons (id) ON DELETE CASCADE ON UPDATE NO ACTION,
                       CONSTRAINT FK_booklet_info FOREIGN KEY (infoId) REFERENCES bookletInfo (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS booklet;

-- changeset jurei733:4
CREATE TABLE session (
                       bookletId BIGINT NOT NULL,
                       browser TEXT NULL,
                       os TEXT NULL,
                       screen TEXT NULL,
                       ts BIGINT NULL,
                       loadCompleteMS BIGINT NULL,
                       CONSTRAINT FK_session_booklet FOREIGN KEY (bookletId) REFERENCES booklet (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS session;

-- changeset jurei733:5
CREATE TABLE bookletLog (
                          bookletId BIGINT NOT NULL,
                          key TEXT NOT NULL,
                          parameter TEXT NULL,
                          ts BIGINT NULL,
                          CONSTRAINT FK_bookletLog_booklet FOREIGN KEY (bookletId) REFERENCES booklet (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS bookletLog;

-- changeset jurei733:6
CREATE TABLE unit (
                    id SERIAL PRIMARY KEY NOT NULL,
                    bookletId BIGINT NOT NULL,
                    name TEXT NOT NULL,
                    alias TEXT NULL,
                    CONSTRAINT FK_unit_booklet FOREIGN KEY (bookletId) REFERENCES booklet (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS unit;

-- changeset jurei733:7
CREATE TABLE unitLog (
                       unitId BIGINT NOT NULL,
                       key TEXT NOT NULL,
                       parameter TEXT NULL,
                       ts BIGINT NULL,
                       CONSTRAINT FK_unitLog_unit FOREIGN KEY (unitId) REFERENCES unit (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS unitLog;

-- changeset jurei733:8
CREATE TABLE unitLastState (
                             unitId BIGINT NOT NULL,
                             key TEXT NOT NULL,
                             value TEXT NULL,
                             CONSTRAINT FK_unitLastState_unit FOREIGN KEY (unitId) REFERENCES unit (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS unitLastState;

-- changeset jurei733:9
CREATE TABLE chunk (
                     unitId BIGINT NOT NULL,
                     key TEXT NOT NULL,
                     type TEXT NULL,
                     variables TEXT NULL,
                     ts BIGINT NULL,
                     CONSTRAINT FK_chunk_unit FOREIGN KEY (unitId) REFERENCES unit (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS chunk;

-- changeset jurei733:10
CREATE TABLE response (
                        unitId BIGINT NOT NULL,
                        variableId TEXT NOT NULL,
                        status TEXT NOT NULL,
                        value TEXT NULL,
                        subform TEXT NULL,
                        code BIGINT NULL,
                        score BIGINT NULL,
                        CONSTRAINT FK_response_unit FOREIGN KEY (unitId) REFERENCES unit (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS response;

-- changeset jurei733:11
CREATE UNIQUE INDEX person_unique_idx ON persons("group", "code", "login");
-- rollback DROP INDEX IF EXISTS persons_unique_idx;

-- changeset jurei733:12
ALTER TABLE bookletInfo ADD CONSTRAINT bookletInfoId UNIQUE ("name", "size");
-- rollback ALTER TABLE bookletInfo DROP CONSTRAINT IF EXISTS bookletInfoId;

-- changeset jurei733:13
ALTER TABLE response ADD id serial4 NOT NULL;
ALTER TABLE response ALTER COLUMN id SET STORAGE PLAIN;
-- rollback ALTER TABLE response DROP COLUMN id;

-- changeset jurei733:14
ALTER TABLE bookletLog ADD id serial4 NOT NULL;
ALTER TABLE bookletLog ALTER COLUMN id SET STORAGE PLAIN;
-- rollback ALTER TABLE bookletLog DROP COLUMN id;

-- changeset jurei733:15
ALTER TABLE session ADD id serial4 NOT NULL;
ALTER TABLE session ALTER COLUMN id SET STORAGE PLAIN;
-- rollback ALTER TABLE session DROP COLUMN id;

-- changeset jurei733:16
ALTER TABLE unitLog ADD id serial4 NOT NULL;
ALTER TABLE unitLog ALTER COLUMN id SET STORAGE PLAIN;
-- rollback ALTER TABLE unitLog DROP COLUMN id;

-- changeset jurei733:17
ALTER TABLE unitLastState ADD id serial4 NOT NULL;
ALTER TABLE unitLastState ALTER COLUMN id SET STORAGE PLAIN;
-- rollback ALTER TABLE unitLastState DROP COLUMN id;

-- changeset jurei733:18
ALTER TABLE booklet DROP CONSTRAINT FK_booklet_person;
ALTER TABLE booklet
  ADD CONSTRAINT FK_booklet_person FOREIGN KEY (personId)
    REFERENCES person (id) ON DELETE CASCADE ON UPDATE NO ACTION;
-- rollback ALTER TABLE booklet DROP CONSTRAINT FK_booklet_person;

-- changeset jurei733:19
ALTER TABLE response ADD COLUMN codedStatus TEXT;
-- rollback ALTER TABLE response DROP COLUMN codedStatus;

-- changeset jurei733:20
CREATE TABLE unit_tag (
                       id SERIAL PRIMARY KEY NOT NULL,
                       "unitId" BIGINT NOT NULL,
                       tag TEXT NOT NULL,
                       "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                       CONSTRAINT FK_unit_tag_unit FOREIGN KEY ("unitId") REFERENCES unit (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS unit_tag;

-- changeset jurei733:21
CREATE INDEX unit_tag_unitId_idx ON unit_tag("unitId");
-- rollback DROP INDEX IF EXISTS unit_tag_unitId_idx;

-- changeset jurei733:22
CREATE INDEX unit_tag_tag_idx ON unit_tag(tag);
-- rollback DROP INDEX IF EXISTS unit_tag_tag_idx;

-- changeset jurei733:23
CREATE INDEX unit_tag_unitId_tag_idx ON unit_tag("unitId", tag);
-- rollback DROP INDEX IF EXISTS unit_tag_unitId_tag_idx;

-- changeset jurei733:24
ALTER TABLE unit_tag ADD COLUMN color TEXT NULL;
-- rollback ALTER TABLE unit_tag DROP COLUMN color;

-- changeset jurei733:25
ALTER TABLE booklet DROP CONSTRAINT IF EXISTS FK_booklet_person;
ALTER TABLE booklet ADD CONSTRAINT FK_booklet_person FOREIGN KEY (personId) REFERENCES person (id) ON DELETE CASCADE ON UPDATE NO ACTION;
-- rollback ALTER TABLE booklet DROP CONSTRAINT IF EXISTS FK_booklet_person;

-- changeset jurei733:26
ALTER TABLE response
  ALTER COLUMN code TYPE BIGINT,
  ALTER COLUMN code SET DEFAULT 0,
  ALTER COLUMN code SET NOT NULL,
  ALTER COLUMN score TYPE BIGINT,
  ALTER COLUMN score SET DEFAULT 0,
  ALTER COLUMN score SET NOT NULL;
-- rollback ALTER TABLE response ALTER COLUMN code TYPE INTEGER, ALTER COLUMN code DROP DEFAULT, ALTER COLUMN code DROP NOT NULL, ALTER COLUMN score TYPE INTEGER, ALTER COLUMN score DROP DEFAULT, ALTER COLUMN score DROP NOT NULL;

-- changeset jurei733:27
CREATE UNIQUE INDEX person_unique_idx ON person("group", "code", "login");
-- rollback DROP INDEX IF EXISTS person_unique_idx;

