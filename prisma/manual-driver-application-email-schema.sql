-- Driver application emails must be unique regardless of capitalization.
-- This deliberately stops if duplicate historical applications still exist.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "DriverApplication"
    GROUP BY lower("email")
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Case-insensitive duplicate DriverApplication emails exist. Resolve duplicates before creating the unique index.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "DriverApplication_email_lower_key"
  ON "DriverApplication" (lower("email"));
