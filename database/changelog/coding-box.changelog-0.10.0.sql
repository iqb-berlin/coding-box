-- liquibase formatted sql

-- changeset jurei733:1
CREATE TABLE unit_note (
  id SERIAL PRIMARY KEY NOT NULL,
  "unitId" BIGINT NOT NULL,
  note TEXT NOT NULL,
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX unit_note_unitId_idx ON unit_note("unitId");
CREATE INDEX unit_note_composite_idx ON unit_note("unitId", note);

-- rollback DROP TABLE IF EXISTS unit_note;
