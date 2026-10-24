-- liquibase formatted sql

-- changeset iqb:965-geogebra-response-index runInTransaction:false
-- comment: Index only GeoGebra candidates so availability and export filters do not scan response values on every request. The concurrent build inspects existing values during migration without blocking writes.
-- Drop a possible invalid index left behind by an interrupted concurrent build before retrying.
DROP INDEX CONCURRENTLY IF EXISTS "public"."idx_response_geogebra_unit";

-- Keep this predicate aligned with WorkspaceTestResultsService.createGeoGebraValueCondition.
CREATE INDEX CONCURRENTLY "idx_response_geogebra_unit"
  ON "public"."response" ("unitid")
  WHERE ("value" LIKE 'UEsD%' OR "value" ILIKE 'data:%;base64,UEsD%');

-- rollback DROP INDEX CONCURRENTLY IF EXISTS "public"."idx_response_geogebra_unit";
