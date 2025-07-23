-- liquibase formatted sql

-- changeset jurei733:1
CREATE TABLE setting (
  key VARCHAR(255) PRIMARY KEY NOT NULL,
  content TEXT NOT NULL
);

-- rollback DROP TABLE IF EXISTS setting;
