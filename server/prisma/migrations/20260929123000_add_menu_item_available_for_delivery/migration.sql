-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "availableForDelivery" BOOLEAN NOT NULL DEFAULT true;
