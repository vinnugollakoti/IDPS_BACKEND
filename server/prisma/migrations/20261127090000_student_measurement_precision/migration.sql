-- Existing whole centimetres and kilograms convert exactly. Avoid waiting behind long-running work.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';
ALTER TABLE "Student"
  ALTER COLUMN "height" TYPE DOUBLE PRECISION USING "height"::double precision,
  ALTER COLUMN "weight" TYPE DOUBLE PRECISION USING "weight"::double precision;
COMMIT;
