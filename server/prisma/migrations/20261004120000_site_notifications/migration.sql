ALTER TABLE "notifications"
ADD COLUMN IF NOT EXISTS "siteId" TEXT;

UPDATE "notifications"
SET "siteId" = '00000000-0000-4000-8000-000000000101'
WHERE "siteId" IS NULL;

ALTER TABLE "notifications"
ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101',
ALTER COLUMN "siteId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_siteId_fkey'
  ) THEN
    ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "notifications_siteId_userId_read_createdAt_idx"
ON "notifications"("siteId", "userId", "read", "createdAt");
