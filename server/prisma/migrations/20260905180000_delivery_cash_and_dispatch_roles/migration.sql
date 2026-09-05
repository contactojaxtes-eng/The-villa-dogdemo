-- Identify the operational purpose of every cash register.
ALTER TABLE "cash_registers"
ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'GENERAL';

-- Classify an existing delivery register without touching other registers.
UPDATE "cash_registers"
SET "purpose" = 'DELIVERY'
WHERE "purpose" = 'GENERAL'
  AND LOWER("name") LIKE '%domicil%';

-- Link every order to the exact shift that received it.
ALTER TABLE "orders"
ADD COLUMN IF NOT EXISTS "cashClosingId" TEXT;

CREATE INDEX IF NOT EXISTS "cash_registers_purpose_active_idx"
ON "cash_registers"("purpose", "active");

CREATE INDEX IF NOT EXISTS "orders_cashClosingId_idx"
ON "orders"("cashClosingId");

CREATE INDEX IF NOT EXISTS "cash_closings_cashRegisterId_isOpen_idx"
ON "cash_closings"("cashRegisterId", "isOpen");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_cashClosingId_fkey'
  ) THEN
    ALTER TABLE "orders"
    ADD CONSTRAINT "orders_cashClosingId_fkey"
    FOREIGN KEY ("cashClosingId") REFERENCES "cash_closings"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
