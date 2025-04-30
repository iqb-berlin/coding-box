-- liquibase formatted sql

-- changeset jurei733:1
CREATE TABLE person (
                      id SERIAL PRIMARY KEY NOT NULL,
                      "group" TEXT NOT NULL,
                      login TEXT NOT NULL,
                      code TEXT NULL
);
-- rollback DROP TABLE IF EXISTS person;

CREATE TABLE bookletInfo (
                           id SERIAL PRIMARY KEY NOT NULL,
                           name TEXT NOT NULL,
                           size BIGINT DEFAULT (0) NOT NULL
);
-- rollback DROP TABLE IF EXISTS bookletInfo;

CREATE TABLE booklet (
                       id SERIAL PRIMARY KEY NOT NULL,
                       infoId BIGINT NOT NULL,
                       personId BIGINT NOT NULL,
                       lastTs BIGINT DEFAULT 0 NOT NULL,
                       firstTs BIGINT DEFAULT 0 NOT NULL,
                       CONSTRAINT FK_booklet_person FOREIGN KEY (personId) REFERENCES person (id) ON DELETE CASCADE ON UPDATE NO ACTION,
                       CONSTRAINT FK_booklet_info FOREIGN KEY (infoId) REFERENCES bookletInfo (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS booklet;

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

CREATE TABLE bookletLog (
                          bookletId BIGINT NOT NULL,
                          key TEXT NOT NULL,
                          parameter TEXT NULL,
                          ts BIGINT NULL,
                          CONSTRAINT FK_bookletLog_booklet FOREIGN KEY (bookletId) REFERENCES booklet (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS bookletLog;

CREATE TABLE unit (
                    id SERIAL PRIMARY KEY NOT NULL,
                    bookletId BIGINT NOT NULL,
                    name TEXT NOT NULL,
                    alias TEXT NULL,
                    CONSTRAINT FK_unit_booklet FOREIGN KEY (bookletId) REFERENCES booklet (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS unit;

CREATE TABLE unitLog (
                       unitId BIGINT NOT NULL,
                       key TEXT NOT NULL,
                       parameter TEXT NULL,
                       ts BIGINT NULL,
                       CONSTRAINT FK_unitLog_unit FOREIGN KEY (unitId) REFERENCES unit (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS unitLog;

CREATE TABLE unitLastState (
                             unitId BIGINT NOT NULL,
                             key TEXT NOT NULL,
                             value TEXT NULL,
                             CONSTRAINT FK_unitLastState_unit FOREIGN KEY (unitId) REFERENCES unit (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS unitLastState;

CREATE TABLE chunk (
                     unitId BIGINT NOT NULL,
                     key TEXT NOT NULL,
                     type TEXT NULL,
                     variables TEXT NULL,
                     ts BIGINT NULL,
                     CONSTRAINT FK_chunk_unit FOREIGN KEY (unitId) REFERENCES unit (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS chunk;

CREATE TABLE response (
                        unitId BIGINT NOT NULL,
                        variableId TEXT NOT NULL,
                        status TEXT NOT NULL,
                        value TEXT NULL,
                        subform TEXT NULL,
                        code BIGINT DEFAULT (0) NOT NULL,
                        score BIGINT DEFAULT (0) NOT NULL,
                        CONSTRAINT FK_response_unit FOREIGN KEY (unitId) REFERENCES unit (id) ON DELETE CASCADE ON UPDATE NO ACTION
);
-- rollback DROP TABLE IF EXISTS response;
