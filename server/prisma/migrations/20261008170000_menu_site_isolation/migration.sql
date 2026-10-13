-- Isolate the editable catalog by site while preserving existing menu and order IDs.
ALTER TABLE "menu_categories"
  ADD COLUMN IF NOT EXISTS "siteId" TEXT;

ALTER TABLE "menu_items"
  ADD COLUMN IF NOT EXISTS "siteId" TEXT;

UPDATE "menu_categories"
SET "siteId" = '00000000-0000-4000-8000-000000000101'
WHERE "siteId" IS NULL;

UPDATE "menu_items"
SET "siteId" = '00000000-0000-4000-8000-000000000101'
WHERE "siteId" IS NULL;

ALTER TABLE "menu_categories"
  ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101',
  ALTER COLUMN "siteId" SET NOT NULL;

ALTER TABLE "menu_items"
  ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101',
  ALTER COLUMN "siteId" SET NOT NULL;

DROP INDEX IF EXISTS "menu_items_code_key";
CREATE UNIQUE INDEX IF NOT EXISTS "menu_items_siteId_code_key"
  ON "menu_items"("siteId", "code");

CREATE INDEX IF NOT EXISTS "menu_categories_siteId_active_sortOrder_idx"
  ON "menu_categories"("siteId", "active", "sortOrder");
CREATE INDEX IF NOT EXISTS "menu_items_siteId_categoryId_active_sortOrder_idx"
  ON "menu_items"("siteId", "categoryId", "active", "sortOrder");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'menu_categories_siteId_fkey'
      AND conrelid = '"menu_categories"'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE "menu_categories"
      ADD CONSTRAINT "menu_categories_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "sites"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'menu_items_siteId_fkey'
      AND conrelid = '"menu_items"'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE "menu_items"
      ADD CONSTRAINT "menu_items_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "sites"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
