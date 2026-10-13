-- Expand phase: keep existing customers attached to the principal site while
-- the application starts sending an explicit siteId. The default allows
-- legacy writers to continue during the transition.
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "siteId" TEXT;

UPDATE "customers"
SET "siteId" = '00000000-0000-4000-8000-000000000101'
WHERE "siteId" IS NULL;

ALTER TABLE "customers"
  ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101',
  ALTER COLUMN "siteId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_siteId_fkey') THEN
    ALTER TABLE "customers"
      ADD CONSTRAINT "customers_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "sites"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS "customers_phone_key";
CREATE UNIQUE INDEX IF NOT EXISTS "customers_siteId_phone_key"
  ON "customers"("siteId", "phone");
CREATE INDEX IF NOT EXISTS "customers_siteId_active_idx"
  ON "customers"("siteId", "active");
CREATE INDEX IF NOT EXISTS "customers_siteId_createdAt_idx"
  ON "customers"("siteId", "createdAt");
