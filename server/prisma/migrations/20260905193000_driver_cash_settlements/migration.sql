CREATE TABLE IF NOT EXISTS "driver_settlements" (
  "id" TEXT NOT NULL,
  "expectedCash" DOUBLE PRECISION NOT NULL,
  "receivedCash" DOUBLE PRECISION NOT NULL,
  "difference" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "driverId" TEXT NOT NULL,
  "cashClosingId" TEXT NOT NULL,
  "receivedById" TEXT NOT NULL,
  CONSTRAINT "driver_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "driver_settlements_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "delivery_drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "driver_settlements_cashClosingId_fkey" FOREIGN KEY ("cashClosingId") REFERENCES "cash_closings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "driver_settlements_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "orders"
ADD COLUMN IF NOT EXISTS "driverSettlementId" TEXT;

CREATE INDEX IF NOT EXISTS "driver_settlements_driverId_createdAt_idx"
ON "driver_settlements"("driverId", "createdAt");

CREATE INDEX IF NOT EXISTS "driver_settlements_cashClosingId_createdAt_idx"
ON "driver_settlements"("cashClosingId", "createdAt");

CREATE INDEX IF NOT EXISTS "orders_driverSettlementId_idx"
ON "orders"("driverSettlementId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_driverSettlementId_fkey'
  ) THEN
    ALTER TABLE "orders"
    ADD CONSTRAINT "orders_driverSettlementId_fkey"
    FOREIGN KEY ("driverSettlementId") REFERENCES "driver_settlements"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
