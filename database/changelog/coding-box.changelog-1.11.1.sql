-- liquibase formatted sql

-- changeset jurei733:1
-- comment: Drop index on response.value to avoid size limit issues with large base64 strings

-- Drop the index created by changelog 0.8.2 (if it exists)
DROP INDEX IF EXISTS "idx_response_value";

-- rollback CREATE INDEX "idx_response_value" ON "public"."response" (substring("value", 1, 1000));
