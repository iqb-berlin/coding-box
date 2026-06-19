-- liquibase formatted sql

-- changeset jurei733:1
-- comment: Preserve previous IQB standard missings variants and canonicalize the active profile with explicit NA scores

WITH canonical_iqb_standard AS (
  SELECT $$[{"id":"mir","label":"missing invalid response","description":"(1) Item wurde bearbeitet und (2a) leere Antwort oder (2b) sonstwie ungültige (Spaß-)Antwort.","code":-98,"score":0},{"id":"mbi_mbo","label":"missing by omission","description":"Item wurde nicht bearbeitet aber gesehen oder es wurde nicht gesehen, aber es gibt nachfolgend gesehene oder bearbeitete Items.","code":-99,"score":0},{"id":"mnr","label":"missing not reached","description":"(1) Item wurde nicht gesehen und (2) es folgen nur nicht gesehene Items.","code":-96,"score":null},{"id":"mci","label":"missing coding impossible","description":"(1) Item müsste/könnte bearbeitet worden sein und (2) Antwort ist aufgrund technischer Probleme nicht auswertbar.","code":-97,"score":null},{"id":"mbd","label":"missing by design","description":"Antwort liegt nicht vor, weil das Item der Testperson planmäßig nicht präsentiert wurde.","code":-94,"score":null}]$$::TEXT AS missings
)
INSERT INTO "public"."missings_profile" ("workspace_id", "label", "missings")
SELECT w."id", 'IQB-Standard', canonical_iqb_standard."missings"
FROM "public"."workspace" w
CROSS JOIN canonical_iqb_standard
WHERE NOT EXISTS (
  SELECT 1
  FROM "public"."missings_profile" mp
  WHERE mp."workspace_id" = w."id"
    AND mp."label" = 'IQB-Standard'
);

WITH canonical_iqb_standard AS (
  SELECT $$[{"id":"mir","label":"missing invalid response","description":"(1) Item wurde bearbeitet und (2a) leere Antwort oder (2b) sonstwie ungültige (Spaß-)Antwort.","code":-98,"score":0},{"id":"mbi_mbo","label":"missing by omission","description":"Item wurde nicht bearbeitet aber gesehen oder es wurde nicht gesehen, aber es gibt nachfolgend gesehene oder bearbeitete Items.","code":-99,"score":0},{"id":"mnr","label":"missing not reached","description":"(1) Item wurde nicht gesehen und (2) es folgen nur nicht gesehene Items.","code":-96,"score":null},{"id":"mci","label":"missing coding impossible","description":"(1) Item müsste/könnte bearbeitet worden sein und (2) Antwort ist aufgrund technischer Probleme nicht auswertbar.","code":-97,"score":null},{"id":"mbd","label":"missing by design","description":"Antwort liegt nicht vor, weil das Item der Testperson planmäßig nicht präsentiert wurde.","code":-94,"score":null}]$$::TEXT AS missings
)
INSERT INTO "public"."missings_profile" ("workspace_id", "label", "missings")
SELECT
  mp."workspace_id",
  'IQB-Standard (vor 1.16.2 #' || mp."id" || ')',
  mp."missings"
FROM "public"."missings_profile" mp
CROSS JOIN canonical_iqb_standard
WHERE mp."label" = 'IQB-Standard'
  AND mp."missings" IS DISTINCT FROM canonical_iqb_standard."missings"
ON CONFLICT ("workspace_id", "label") DO NOTHING;

WITH canonical_iqb_standard AS (
  SELECT $$[{"id":"mir","label":"missing invalid response","description":"(1) Item wurde bearbeitet und (2a) leere Antwort oder (2b) sonstwie ungültige (Spaß-)Antwort.","code":-98,"score":0},{"id":"mbi_mbo","label":"missing by omission","description":"Item wurde nicht bearbeitet aber gesehen oder es wurde nicht gesehen, aber es gibt nachfolgend gesehene oder bearbeitete Items.","code":-99,"score":0},{"id":"mnr","label":"missing not reached","description":"(1) Item wurde nicht gesehen und (2) es folgen nur nicht gesehene Items.","code":-96,"score":null},{"id":"mci","label":"missing coding impossible","description":"(1) Item müsste/könnte bearbeitet worden sein und (2) Antwort ist aufgrund technischer Probleme nicht auswertbar.","code":-97,"score":null},{"id":"mbd","label":"missing by design","description":"Antwort liegt nicht vor, weil das Item der Testperson planmäßig nicht präsentiert wurde.","code":-94,"score":null}]$$::TEXT AS missings
)
UPDATE "public"."missings_profile" mp
SET "missings" = canonical_iqb_standard."missings"
FROM canonical_iqb_standard
WHERE mp."label" = 'IQB-Standard'
  AND mp."missings" IS DISTINCT FROM canonical_iqb_standard."missings";

-- rollback -- Cannot safely restore canonicalized IQB-Standard profile variants automatically; previous variants were preserved as separate backup profiles.
