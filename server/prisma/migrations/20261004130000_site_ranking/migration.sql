ALTER TABLE "waiter_metrics" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "waiter_badges" ADD COLUMN IF NOT EXISTS "siteId" TEXT;

UPDATE "waiter_metrics"
SET "siteId" = '00000000-0000-4000-8000-000000000101'
WHERE "siteId" IS NULL;

UPDATE "waiter_badges"
SET "siteId" = '00000000-0000-4000-8000-000000000101'
WHERE "siteId" IS NULL;

ALTER TABLE "waiter_metrics"
ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101',
ALTER COLUMN "siteId" SET NOT NULL;

ALTER TABLE "waiter_badges"
ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101',
ALTER COLUMN "siteId" SET NOT NULL;

DROP INDEX IF EXISTS "waiter_metrics_userId_date_key";
DROP INDEX IF EXISTS "waiter_badges_userId_badgeId_week_key";

CREATE UNIQUE INDEX IF NOT EXISTS "waiter_metrics_siteId_userId_date_key"
ON "waiter_metrics"("siteId", "userId", "date");

CREATE INDEX IF NOT EXISTS "waiter_metrics_siteId_date_idx"
ON "waiter_metrics"("siteId", "date");

CREATE UNIQUE INDEX IF NOT EXISTS "waiter_badges_siteId_userId_badgeId_week_key"
ON "waiter_badges"("siteId", "userId", "badgeId", "week");

CREATE INDEX IF NOT EXISTS "waiter_badges_siteId_week_idx"
ON "waiter_badges"("siteId", "week");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'waiter_metrics_siteId_fkey'
  ) THEN
    ALTER TABLE "waiter_metrics"
    ADD CONSTRAINT "waiter_metrics_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'waiter_badges_siteId_fkey'
  ) THEN
    ALTER TABLE "waiter_badges"
    ADD CONSTRAINT "waiter_badges_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
