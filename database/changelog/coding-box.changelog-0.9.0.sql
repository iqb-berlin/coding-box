-- liquibase formatted sql

-- changeset jurei733:1

CREATE INDEX IF NOT EXISTS idx_booklet_person ON booklet(personId);
CREATE INDEX IF NOT EXISTS idx_session_booklet ON session(bookletId);
CREATE INDEX IF NOT EXISTS idx_unit_booklet ON unit(bookletId);
CREATE INDEX IF NOT EXISTS idx_unitLog_unit ON unitLog(unitId);
CREATE INDEX IF NOT EXISTS idx_chunk_unit ON chunk(unitId);
CREATE INDEX IF NOT EXISTS idx_unitLastState_unit ON unitLastState(unitId);
CREATE INDEX IF NOT EXISTS idx_response_unit ON response(unitId);

-- rollback DROP INDEX IF EXISTS idx_booklet_person;
-- rollback DROP INDEX IF EXISTS idx_session_booklet;
-- rollback DROP INDEX IF EXISTS idx_unit_booklet;
-- rollback DROP INDEX IF EXISTS idx_unitLog_unit;
-- rollback DROP INDEX IF EXISTS idx_chunk_unit;
-- rollback DROP INDEX IF EXISTS idx_unitLastState_unit;
-- rollback DROP INDEX IF EXISTS idx_response_unit;


-- changeset jurei733:2

CREATE INDEX IF NOT EXISTS idx_response_subform ON response(subform);

-- Add index on the combination of unitId, variableId, and subform for better performance with bulk inserts
CREATE INDEX IF NOT EXISTS idx_response_unit_var_subform ON response(unitId, variableId, subform);

-- Add index on the combination of status and codedStatus for better performance when filtering responses
CREATE INDEX IF NOT EXISTS idx_response_status_coded ON response(status, codedStatus);

-- Add index on uploaded_at column in persons table for better performance when querying by upload date
CREATE INDEX IF NOT EXISTS idx_persons_uploaded_at ON persons(uploaded_at);

-- Add index on the combination of workspace_id and uploaded_at for better performance when filtering by workspace and upload date
CREATE INDEX IF NOT EXISTS idx_persons_workspace_uploaded ON persons(workspace_id, uploaded_at);

-- rollback DROP INDEX IF EXISTS idx_response_subform;
-- rollback DROP INDEX IF EXISTS idx_response_unit_var_subform;
-- rollback DROP INDEX IF EXISTS idx_response_status_coded;
-- rollback DROP INDEX IF EXISTS idx_persons_uploaded_at;
-- rollback DROP INDEX IF EXISTS idx_persons_workspace_uploaded;
