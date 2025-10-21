-- liquibase formatted sql

-- changeset jurei733:0
-- comment: Add PRIMARY KEY constraint to response.id to enable foreign key references

ALTER TABLE "public"."response" ADD PRIMARY KEY ("id");
-- rollback ALTER TABLE "public"."response" DROP CONSTRAINT IF EXISTS response_pkey;

-- changeset jurei733:1
CREATE TABLE "public"."coding_job_unit" (
                                          "id" SERIAL PRIMARY KEY,
                                          "coding_job_id" INTEGER NOT NULL,
                                          "response_id" INTEGER NOT NULL,
                                          "unit_name" VARCHAR(255) NOT NULL,
                                          "unit_alias" VARCHAR(255),
                                          "variable_id" VARCHAR(255) NOT NULL,
                                          "variable_anchor" VARCHAR(255) NOT NULL,
                                          "booklet_name" VARCHAR(255) NOT NULL,
                                          "person_login" VARCHAR(255) NOT NULL,
                                          "person_code" VARCHAR(255) NOT NULL,
                                          "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
                                          CONSTRAINT "fk_coding_job_unit_coding_job" FOREIGN KEY ("coding_job_id") REFERENCES "public"."coding_job" ("id") ON DELETE CASCADE,
                                          CONSTRAINT "fk_coding_job_unit_response" FOREIGN KEY ("response_id") REFERENCES "public"."response" ("id") ON DELETE CASCADE
);

CREATE INDEX "idx_coding_job_unit_coding_job_id" ON "public"."coding_job_unit" ("coding_job_id");
CREATE INDEX "idx_coding_job_unit_response_id" ON "public"."coding_job_unit" ("response_id");

-- rollback DROP TABLE IF EXISTS "public"."coding_job_unit";


-- changeset jurei733:2
-- comment: Add code-related columns to coding_job_unit table

ALTER TABLE coding_job_unit
  ADD COLUMN code INTEGER NULL;

ALTER TABLE coding_job_unit
  ADD COLUMN score INTEGER NULL;

-- rollback ALTER TABLE coding_job_unit DROP COLUMN score;
-- rollback ALTER TABLE coding_job_unit DROP COLUMN code;

-- liquibase formatted sql

-- changeset jurei733:3
-- comment: Optimize text columns with bounded lengths to varchar for better space efficiency

-- Change response table columns from TEXT to VARCHAR with appropriate lengths
ALTER TABLE "public"."response" ALTER COLUMN "variableid" TYPE VARCHAR(255);
-- rollback ALTER TABLE "public"."response" ALTER COLUMN "variableid" TYPE TEXT;

ALTER TABLE "public"."response" ALTER COLUMN "status" TYPE VARCHAR(255);
-- rollback ALTER TABLE "public"."response" ALTER COLUMN "status" TYPE TEXT;

ALTER TABLE "public"."response" ALTER COLUMN "status_v1" TYPE VARCHAR(255);
-- rollback ALTER TABLE "public"."response" ALTER COLUMN "status_v1" TYPE TEXT;

ALTER TABLE "public"."response" ALTER COLUMN "status_v2" TYPE VARCHAR(255);
-- rollback ALTER TABLE "public"."response" ALTER COLUMN "status_v2" TYPE TEXT;

ALTER TABLE "public"."response" ALTER COLUMN "status_v3" TYPE VARCHAR(255);
-- rollback ALTER TABLE "public"."response" ALTER COLUMN "status_v3" TYPE TEXT;

-- Change unit table columns from TEXT to VARCHAR(100)
ALTER TABLE "public"."unit" ALTER COLUMN "name" TYPE VARCHAR(100);
-- rollback ALTER TABLE "public"."unit" ALTER COLUMN "name" TYPE TEXT;

ALTER TABLE "public"."unit" ALTER COLUMN "alias" TYPE VARCHAR(100);
-- rollback ALTER TABLE "public"."unit" ALTER COLUMN "alias" TYPE TEXT;

-- changeset jurei733:4
-- comment: Downgrade bigint ID columns to integer where max ID < 2^31 (saves 4 bytes per row)

-- Downgrade response.unitid from bigint to integer
ALTER TABLE "public"."response" ALTER COLUMN "unitid" TYPE INTEGER;
-- rollback ALTER TABLE "public"."response" ALTER COLUMN "unitid" TYPE BIGINT;

-- Downgrade unit.bookletid from bigint to integer
ALTER TABLE "public"."unit" ALTER COLUMN "bookletid" TYPE INTEGER;
-- rollback ALTER TABLE "public"."unit" ALTER COLUMN "bookletid" TYPE BIGINT;

-- Downgrade booklet.infoid from bigint to integer
ALTER TABLE "public"."booklet" ALTER COLUMN "infoid" TYPE INTEGER;
-- rollback ALTER TABLE "public"."booklet" ALTER COLUMN "infoid" TYPE BIGINT;

-- Downgrade booklet.personid from bigint to integer
ALTER TABLE "public"."booklet" ALTER COLUMN "personid" TYPE INTEGER;
-- rollback ALTER TABLE "public"."booklet" ALTER COLUMN "personid" TYPE BIGINT;

-- Downgrade bookletlog.bookletid from bigint to integer
ALTER TABLE "public"."bookletlog" ALTER COLUMN "bookletid" TYPE INTEGER;
-- rollback ALTER TABLE "public"."bookletlog" ALTER COLUMN "bookletid" TYPE BIGINT;

-- Downgrade unitlog.unitid from bigint to integer
ALTER TABLE "public"."unitlog" ALTER COLUMN "unitid" TYPE INTEGER;
-- rollback ALTER TABLE "public"."unitlog" ALTER COLUMN "unitid" TYPE BIGINT;

-- Downgrade unit_tag.unitId from bigint to integer
ALTER TABLE "public"."unit_tag" ALTER COLUMN "unitId" TYPE INTEGER;
-- rollback ALTER TABLE "public"."unit_tag" ALTER COLUMN "unitId" TYPE BIGINT;

-- Downgrade unit_note.unitId from bigint to integer
ALTER TABLE "public"."unit_note" ALTER COLUMN "unitId" TYPE INTEGER;
-- rollback ALTER TABLE "public"."unit_note" ALTER COLUMN "unitId" TYPE BIGINT;

-- changeset jurei733:5
-- Migrate existing status string values to numeric values using the responseStatesNumericMap
UPDATE "public"."response" SET "status" = 0 WHERE "status" = 'UNSET';
UPDATE "public"."response" SET "status" = 1 WHERE "status" = 'NOT_REACHED';
UPDATE "public"."response" SET "status" = 2 WHERE "status" = 'DISPLAYED';
UPDATE "public"."response" SET "status" = 3 WHERE "status" = 'VALUE_CHANGED';
UPDATE "public"."response" SET "status" = 4 WHERE "status" = 'DERIVE_ERROR';
UPDATE "public"."response" SET "status" = 5 WHERE "status" = 'CODING_COMPLETE';
UPDATE "public"."response" SET "status" = 6 WHERE "status" = 'NO_CODING';
UPDATE "public"."response" SET "status" = 7 WHERE "status" = 'INVALID';
UPDATE "public"."response" SET "status" = 8 WHERE "status" = 'CODING_INCOMPLETE';
UPDATE "public"."response" SET "status" = 9 WHERE "status" = 'CODING_ERROR';
UPDATE "public"."response" SET "status" = 10 WHERE "status" = 'PARTLY_DISPLAYED';
UPDATE "public"."response" SET "status" = 11 WHERE "status" = 'DERIVE_PENDING';
UPDATE "public"."response" SET "status" = 12 WHERE "status" = 'INTENDED_INCOMPLETE';
UPDATE "public"."response" SET "status" = 13 WHERE "status" = 'CODE_SELECTION_PENDING';

UPDATE "public"."response" SET "status_v1" = 0 WHERE "status_v1" = 'UNSET';
UPDATE "public"."response" SET "status_v1" = 1 WHERE "status_v1" = 'NOT_REACHED';
UPDATE "public"."response" SET "status_v1" = 2 WHERE "status_v1" = 'DISPLAYED';
UPDATE "public"."response" SET "status_v1" = 3 WHERE "status_v1" = 'VALUE_CHANGED';
UPDATE "public"."response" SET "status_v1" = 4 WHERE "status_v1" = 'DERIVE_ERROR';
UPDATE "public"."response" SET "status_v1" = 5 WHERE "status_v1" = 'CODING_COMPLETE';
UPDATE "public"."response" SET "status_v1" = 6 WHERE "status_v1" = 'NO_CODING';
UPDATE "public"."response" SET "status_v1" = 7 WHERE "status_v1" = 'INVALID';
UPDATE "public"."response" SET "status_v1" = 8 WHERE "status_v1" = 'CODING_INCOMPLETE';
UPDATE "public"."response" SET "status_v1" = 9 WHERE "status_v1" = 'CODING_ERROR';
UPDATE "public"."response" SET "status_v1" = 10 WHERE "status_v1" = 'PARTLY_DISPLAYED';
UPDATE "public"."response" SET "status_v1" = 11 WHERE "status_v1" = 'DERIVE_PENDING';
UPDATE "public"."response" SET "status_v1" = 12 WHERE "status_v1" = 'INTENDED_INCOMPLETE';
UPDATE "public"."response" SET "status_v1" = 13 WHERE "status_v1" = 'CODE_SELECTION_PENDING';

UPDATE "public"."response" SET "status_v2" = 0 WHERE "status_v2" = 'UNSET';
UPDATE "public"."response" SET "status_v2" = 1 WHERE "status_v2" = 'NOT_REACHED';
UPDATE "public"."response" SET "status_v2" = 2 WHERE "status_v2" = 'DISPLAYED';
UPDATE "public"."response" SET "status_v2" = 3 WHERE "status_v2" = 'VALUE_CHANGED';
UPDATE "public"."response" SET "status_v2" = 4 WHERE "status_v2" = 'DERIVE_ERROR';
UPDATE "public"."response" SET "status_v2" = 5 WHERE "status_v2" = 'CODING_COMPLETE';
UPDATE "public"."response" SET "status_v2" = 6 WHERE "status_v2" = 'NO_CODING';
UPDATE "public"."response" SET "status_v2" = 7 WHERE "status_v2" = 'INVALID';
UPDATE "public"."response" SET "status_v2" = 8 WHERE "status_v2" = 'CODING_INCOMPLETE';
UPDATE "public"."response" SET "status_v2" = 9 WHERE "status_v2" = 'CODING_ERROR';
UPDATE "public"."response" SET "status_v2" = 10 WHERE "status_v2" = 'PARTLY_DISPLAYED';
UPDATE "public"."response" SET "status_v2" = 11 WHERE "status_v2" = 'DERIVE_PENDING';
UPDATE "public"."response" SET "status_v2" = 12 WHERE "status_v2" = 'INTENDED_INCOMPLETE';
UPDATE "public"."response" SET "status_v2" = 13 WHERE "status_v2" = 'CODE_SELECTION_PENDING';

UPDATE "public"."response" SET "status_v3" = 0 WHERE "status_v3" = 'UNSET';
UPDATE "public"."response" SET "status_v3" = 1 WHERE "status_v3" = 'NOT_REACHED';
UPDATE "public"."response" SET "status_v3" = 2 WHERE "status_v3" = 'DISPLAYED';
UPDATE "public"."response" SET "status_v3" = 3 WHERE "status_v3" = 'VALUE_CHANGED';
UPDATE "public"."response" SET "status_v3" = 4 WHERE "status_v3" = 'DERIVE_ERROR';
UPDATE "public"."response" SET "status_v3" = 5 WHERE "status_v3" = 'CODING_COMPLETE';
UPDATE "public"."response" SET "status_v3" = 6 WHERE "status_v3" = 'NO_CODING';
UPDATE "public"."response" SET "status_v3" = 7 WHERE "status_v3" = 'INVALID';
UPDATE "public"."response" SET "status_v3" = 8 WHERE "status_v3" = 'CODING_INCOMPLETE';
UPDATE "public"."response" SET "status_v3" = 9 WHERE "status_v3" = 'CODING_ERROR';
UPDATE "public"."response" SET "status_v3" = 10 WHERE "status_v3" = 'PARTLY_DISPLAYED';
UPDATE "public"."response" SET "status_v3" = 11 WHERE "status_v3" = 'DERIVE_PENDING';
UPDATE "public"."response" SET "status_v3" = 12 WHERE "status_v3" = 'INTENDED_INCOMPLETE';
UPDATE "public"."response" SET "status_v3" = 13 WHERE "status_v3" = 'CODE_SELECTION_PENDING';

-- rollback UPDATE "public"."response" SET "status" = 'UNSET'              WHERE "status" = '0';
-- rollback UPDATE "public"."response" SET "status" = 'NOT_REACHED'        WHERE "status" = '1';
-- rollback UPDATE "public"."response" SET "status" = 'DISPLAYED'          WHERE "status" = '2';
-- rollback UPDATE "public"."response" SET "status" = 'VALUE_CHANGED'      WHERE "status" = '3';
-- rollback UPDATE "public"."response" SET "status" = 'DERIVE_ERROR'       WHERE "status" = '4';
-- rollback UPDATE "public"."response" SET "status" = 'CODING_COMPLETE'    WHERE "status" = '5';
-- rollback UPDATE "public"."response" SET "status" = 'NO_CODING'          WHERE "status" = '6';
-- rollback UPDATE "public"."response" SET "status" = 'INVALID'            WHERE "status" = '7';
-- rollback UPDATE "public"."response" SET "status" = 'CODING_INCOMPLETE'  WHERE "status" = '8';
-- rollback UPDATE "public"."response" SET "status" = 'CODING_ERROR'       WHERE "status" = '9';
-- rollback UPDATE "public"."response" SET "status" = 'PARTLY_DISPLAYED'   WHERE "status" = '10';
-- rollback UPDATE "public"."response" SET "status" = 'DERIVE_PENDING'     WHERE "status" = '11';
-- rollback UPDATE "public"."response" SET "status" = 'INTENDED_INCOMPLETE' WHERE "status" = '12';
-- rollback UPDATE "public"."response" SET "status" = 'CODE_SELECTION_PENDING' WHERE "status" = '13';

-- rollback UPDATE "public"."response" SET "status_v1" = 'UNSET'              WHERE "status_v1" = '0';
-- rollback UPDATE "public"."response" SET "status_v1" = 'NOT_REACHED'        WHERE "status_v1" = '1';
-- rollback UPDATE "public"."response" SET "status_v1" = 'DISPLAYED'          WHERE "status_v1" = '2';
-- rollback UPDATE "public"."response" SET "status_v1" = 'VALUE_CHANGED'      WHERE "status_v1" = '3';
-- rollback UPDATE "public"."response" SET "status_v1" = 'DERIVE_ERROR'       WHERE "status_v1" = '4';
-- rollback UPDATE "public"."response" SET "status_v1" = 'CODING_COMPLETE'    WHERE "status_v1" = '5';
-- rollback UPDATE "public"."response" SET "status_v1" = 'NO_CODING'          WHERE "status_v1" = '6';
-- rollback UPDATE "public"."response" SET "status_v1" = 'INVALID'            WHERE "status_v1" = '7';
-- rollback UPDATE "public"."response" SET "status_v1" = 'CODING_INCOMPLETE'  WHERE "status_v1" = '8';
-- rollback UPDATE "public"."response" SET "status_v1" = 'CODING_ERROR'       WHERE "status_v1" = '9';
-- rollback UPDATE "public"."response" SET "status_v1" = 'PARTLY_DISPLAYED'   WHERE "status_v1" = '10';
-- rollback UPDATE "public"."response" SET "status_v1" = 'DERIVE_PENDING'     WHERE "status_v1" = '11';
-- rollback UPDATE "public"."response" SET "status_v1" = 'INTENDED_INCOMPLETE' WHERE "status_v1" = '12';
-- rollback UPDATE "public"."response" SET "status_v1" = 'CODE_SELECTION_PENDING' WHERE "status_v1" = '13';

-- rollback UPDATE "public"."response" SET "status_v2" = 'UNSET'              WHERE "status_v2" = '0';
-- rollback UPDATE "public"."response" SET "status_v2" = 'NOT_REACHED'        WHERE "status_v2" = '1';
-- rollback UPDATE "public"."response" SET "status_v2" = 'DISPLAYED'          WHERE "status_v2" = '2';
-- rollback UPDATE "public"."response" SET "status_v2" = 'VALUE_CHANGED'      WHERE "status_v2" = '3';
-- rollback UPDATE "public"."response" SET "status_v2" = 'DERIVE_ERROR'       WHERE "status_v2" = '4';
-- rollback UPDATE "public"."response" SET "status_v2" = 'CODING_COMPLETE'    WHERE "status_v2" = '5';
-- rollback UPDATE "public"."response" SET "status_v2" = 'NO_CODING'          WHERE "status_v2" = '6';
-- rollback UPDATE "public"."response" SET "status_v2" = 'INVALID'            WHERE "status_v2" = '7';
-- rollback UPDATE "public"."response" SET "status_v2" = 'CODING_INCOMPLETE'  WHERE "status_v2" = '8';
-- rollback UPDATE "public"."response" SET "status_v2" = 'CODING_ERROR'       WHERE "status_v2" = '9';
-- rollback UPDATE "public"."response" SET "status_v2" = 'PARTLY_DISPLAYED'   WHERE "status_v2" = '10';
-- rollback UPDATE "public"."response" SET "status_v2" = 'DERIVE_PENDING'     WHERE "status_v2" = '11';
-- rollback UPDATE "public"."response" SET "status_v2" = 'INTENDED_INCOMPLETE' WHERE "status_v2" = '12';
-- rollback UPDATE "public"."response" SET "status_v2" = 'CODE_SELECTION_PENDING' WHERE "status_v2" = '13';

-- rollback UPDATE "public"."response" SET "status_v3" = 'UNSET'              WHERE "status_v3" = '0';
-- rollback UPDATE "public"."response" SET "status_v3" = 'NOT_REACHED'        WHERE "status_v3" = '1';
-- rollback UPDATE "public"."response" SET "status_v3" = 'DISPLAYED'          WHERE "status_v3" = '2';
-- rollback UPDATE "public"."response" SET "status_v3" = 'VALUE_CHANGED'      WHERE "status_v3" = '3';
-- rollback UPDATE "public"."response" SET "status_v3" = 'DERIVE_ERROR'       WHERE "status_v3" = '4';
-- rollback UPDATE "public"."response" SET "status_v3" = 'CODING_COMPLETE'    WHERE "status_v3" = '5';
-- rollback UPDATE "public"."response" SET "status_v3" = 'NO_CODING'          WHERE "status_v3" = '6';
-- rollback UPDATE "public"."response" SET "status_v3" = 'INVALID'            WHERE "status_v3" = '7';
-- rollback UPDATE "public"."response" SET "status_v3" = 'CODING_INCOMPLETE'  WHERE "status_v3" = '8';
-- rollback UPDATE "public"."response" SET "status_v3" = 'CODING_ERROR'       WHERE "status_v3" = '9';
-- rollback UPDATE "public"."response" SET "status_v3" = 'PARTLY_DISPLAYED'   WHERE "status_v3" = '10';
-- rollback UPDATE "public"."response" SET "status_v3" = 'DERIVE_PENDING'     WHERE "status_v3" = '11';
-- rollback UPDATE "public"."response" SET "status_v3" = 'INTENDED_INCOMPLETE' WHERE "status_v3" = '12';
-- rollback UPDATE "public"."response" SET "status_v3" = 'CODE_SELECTION_PENDING' WHERE "status_v3" = '13';


-- changeset jurei733:6
-- comment: Change response table status, status_v1, and status_v2 columns from VARCHAR to SMALLINT after migrating existing string values to integers

-- Change status column from VARCHAR to SMALLINT
ALTER TABLE "public"."response" ALTER COLUMN "status" TYPE SMALLINT USING status::SMALLINT;
-- rollback ALTER TABLE "public"."response" ALTER COLUMN "status" TYPE VARCHAR(255);

-- Change status_v1 column from VARCHAR to SMALLINT
ALTER TABLE "public"."response" ALTER COLUMN "status_v1" TYPE SMALLINT USING status_v1::SMALLINT;
-- rollback ALTER TABLE "public"."response" ALTER COLUMN "status_v1" TYPE VARCHAR(255);

-- Change status_v2 column from VARCHAR to SMALLINT
ALTER TABLE "public"."response" ALTER COLUMN "status_v2" TYPE SMALLINT USING status_v2::SMALLINT;
-- rollback ALTER TABLE "public"."response" ALTER COLUMN "status_v2" TYPE VARCHAR(255);

-- changeset jurei733:7
-- comment: Allow code_v1 and score_v1 to be nullable, matching the TypeORM entity definition
ALTER TABLE "public"."response" ALTER COLUMN "code_v1" DROP NOT NULL;
ALTER TABLE "public"."response" ALTER COLUMN "score_v1" DROP NOT NULL;

-- rollback ALTER TABLE "public"."response" ALTER COLUMN "code_v1" SET NOT NULL;
-- rollback ALTER TABLE "public"."response" ALTER COLUMN "score_v1" SET NOT NULL;
