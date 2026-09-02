-- Compatible with installations initialized with prisma db push before migrations were introduced.
ALTER TABLE "transfer_proofs" ADD COLUMN IF NOT EXISTS "fileBase64" TEXT;
