-- DropIndex
DROP INDEX IF EXISTS "cola_impresion_impreso_idx";

-- DropIndex
DROP INDEX IF EXISTS "orders_orderNumber_key";

-- AlterTable
ALTER TABLE "delivery_zones" ADD COLUMN IF NOT EXISTS "km" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN IF NOT EXISTS "code" TEXT,
ADD COLUMN IF NOT EXISTS "conversionFactor" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "purchaseUnit" TEXT;

-- AlterTable
ALTER TABLE "menu_categories" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "code" TEXT,
ADD COLUMN IF NOT EXISTS "comboItems" JSONB,
ADD COLUMN IF NOT EXISTS "prepTime" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'NORMAL';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cashAmount" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN IF NOT EXISTS "chatSessionId" TEXT,
ADD COLUMN IF NOT EXISTS "customerId" TEXT,
ADD COLUMN IF NOT EXISTS "deliveryDriverId" TEXT,
ADD COLUMN IF NOT EXISTS "invoiceNumber" INTEGER,
ADD COLUMN IF NOT EXISTS "transferAmount" DOUBLE PRECISION DEFAULT 0;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "cashAmount" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN IF NOT EXISTS "settlementId" TEXT,
ADD COLUMN IF NOT EXISTS "transferAmount" DOUBLE PRECISION DEFAULT 0;

-- AlterTable
ALTER TABLE "recipe_ingredients" ADD COLUMN IF NOT EXISTS "unit" TEXT,
ADD COLUMN IF NOT EXISTS "wastePercentage" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lockoutUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "mustVerifyEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "permissions" JSONB;

-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "isEdited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "reaction" TEXT,
ADD COLUMN IF NOT EXISTS "replyToContent" TEXT,
ADD COLUMN IF NOT EXISTS "replyToDirection" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nit" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "purchases" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "supplierId" TEXT NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "purchase_items" (
    "id" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "purchaseId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CustomerPayment" (
    "id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerId" TEXT NOT NULL,
    "cashRegisterId" TEXT,
    "confirmedById" TEXT,

    CONSTRAINT "CustomerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "delivery_drivers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "custom_roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT DEFAULT '#10B981',
    "icon" TEXT DEFAULT 'Shield',
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "custom_roles_code_key" ON "custom_roles"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cash_closings_userId_isOpen_idx" ON "cash_closings"("userId", "isOpen");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ingredients_code_key" ON "ingredients"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "menu_items_code_key" ON "menu_items"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_items_menuItemId_idx" ON "order_items"("menuItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_createdAt_idx" ON "orders"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_customerPhone_idx" ON "orders"("customerPhone");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_waiterId_idx" ON "orders"("waiterId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_assignedTo_idx" ON "orders"("assignedTo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_cashRegisterId_idx" ON "orders"("cashRegisterId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_deliveryDriverId_idx" ON "orders"("deliveryDriverId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_chatSessionId_idx" ON "orders"("chatSessionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payments_settlementId_idx" ON "payments"("settlementId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "stock_movements_ingredientId_idx" ON "stock_movements"("ingredientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "stock_movements_orderId_idx" ON "stock_movements"("orderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "whatsapp_messages_sessionId_idx" ON "whatsapp_messages"("sessionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "whatsapp_messages_createdAt_idx" ON "whatsapp_messages"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "whatsapp_sessions_lastMessageAt_idx" ON "whatsapp_sessions"("lastMessageAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "whatsapp_sessions_active_idx" ON "whatsapp_sessions"("active");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_customerId_fkey') THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_deliveryDriverId_fkey') THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_deliveryDriverId_fkey" FOREIGN KEY ("deliveryDriverId") REFERENCES "delivery_drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchases_supplierId_fkey') THEN
    ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_items_purchaseId_fkey') THEN
    ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_items_ingredientId_fkey') THEN
    ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomerPayment_customerId_fkey') THEN
    ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

