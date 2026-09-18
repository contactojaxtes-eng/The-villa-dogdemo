ALTER TABLE "orders"
ADD COLUMN IF NOT EXISTS "originalPaymentMethod" TEXT;

UPDATE "orders"
SET "originalPaymentMethod" = "paymentMethod"
WHERE "originalPaymentMethod" IS NULL;
