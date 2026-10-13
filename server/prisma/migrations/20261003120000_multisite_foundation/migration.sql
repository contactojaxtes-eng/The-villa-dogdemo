CREATE TABLE IF NOT EXISTS "organizations" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_key"
ON "organizations"("slug");

CREATE INDEX IF NOT EXISTS "organizations_active_idx"
ON "organizations"("active");

CREATE TABLE IF NOT EXISTS "sites" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'America/Bogota',
  "address" TEXT,
  "phone" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sites_organizationId_code_key"
ON "sites"("organizationId", "code");

CREATE INDEX IF NOT EXISTS "sites_organizationId_active_idx"
ON "sites"("organizationId", "active");

CREATE INDEX IF NOT EXISTS "sites_active_isDefault_idx"
ON "sites"("active", "isDefault");

CREATE UNIQUE INDEX IF NOT EXISTS "sites_one_default_per_organization_idx"
ON "sites"("organizationId") WHERE "isDefault" = true;

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "lastActiveSiteId" TEXT;

CREATE INDEX IF NOT EXISTS "users_lastActiveSiteId_idx"
ON "users"("lastActiveSiteId");

CREATE TABLE IF NOT EXISTS "user_site_memberships" (
  "userId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "permissions" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_site_memberships_pkey" PRIMARY KEY ("userId", "siteId")
);

CREATE INDEX IF NOT EXISTS "user_site_memberships_siteId_active_idx"
ON "user_site_memberships"("siteId", "active");

CREATE INDEX IF NOT EXISTS "user_site_memberships_userId_active_isDefault_idx"
ON "user_site_memberships"("userId", "active", "isDefault");

CREATE UNIQUE INDEX IF NOT EXISTS "user_site_memberships_one_default_per_user_idx"
ON "user_site_memberships"("userId") WHERE "isDefault" = true;

CREATE TABLE IF NOT EXISTS "site_settings" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "site_settings_siteId_key_key"
ON "site_settings"("siteId", "key");

CREATE INDEX IF NOT EXISTS "site_settings_siteId_idx"
ON "site_settings"("siteId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sites_organizationId_fkey') THEN
    ALTER TABLE "sites"
    ADD CONSTRAINT "sites_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_lastActiveSiteId_fkey') THEN
    ALTER TABLE "users"
    ADD CONSTRAINT "users_lastActiveSiteId_fkey"
    FOREIGN KEY ("lastActiveSiteId") REFERENCES "sites"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_site_memberships_userId_fkey') THEN
    ALTER TABLE "user_site_memberships"
    ADD CONSTRAINT "user_site_memberships_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_site_memberships_siteId_fkey') THEN
    ALTER TABLE "user_site_memberships"
    ADD CONSTRAINT "user_site_memberships_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_settings_siteId_fkey') THEN
    ALTER TABLE "site_settings"
    ADD CONSTRAINT "site_settings_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "organizations" ("id", "name", "slug", "active", "createdAt", "updatedAt")
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'The Villa Dog',
  'the-villa-dog',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "sites" (
  "id", "organizationId", "code", "name", "timezone", "active", "isDefault", "createdAt", "updatedAt"
)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'principal',
  'Sede Principal',
  'America/Bogota',
  true,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "user_site_memberships" (
  "userId", "siteId", "role", "permissions", "active", "isDefault", "createdAt", "updatedAt"
)
SELECT
  u."id",
  '00000000-0000-4000-8000-000000000101',
  u."role",
  u."permissions",
  u."active",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users" u
ON CONFLICT ("userId", "siteId") DO NOTHING;

UPDATE "users"
SET "lastActiveSiteId" = '00000000-0000-4000-8000-000000000101'
WHERE "lastActiveSiteId" IS NULL;

-- Conservar la configuración histórica de grupos de barrios en la sede
-- principal antes de empezar a guardar ese catálogo por sede.
INSERT INTO "site_settings" ("id", "siteId", "key", "value", "updatedAt")
SELECT
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000101',
  'delivery_zone_groups',
  a."value",
  CURRENT_TIMESTAMP
FROM "app_settings" a
WHERE a."key" = 'delivery_zone_groups'
ON CONFLICT ("siteId", "key") DO NOTHING;

-- Las entidades operativas existentes pertenecen a la sede principal. Las
-- columnas se agregan con respaldo y valor por defecto para que el despliegue
-- sea compatible con los datos actuales y con procesos heredados durante la
-- transición por módulos.
ALTER TABLE "delivery_zones" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "cash_registers" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "cash_closings" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "expense_categories" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "CustomerPayment" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "cola_impresion" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "delivery_drivers" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "driver_settlements" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "dining_tables" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "kitchen_stations" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "kitchen_tickets" ADD COLUMN IF NOT EXISTS "siteId" TEXT;

UPDATE "delivery_zones" SET "siteId" = '00000000-0000-4000-8000-000000000101' WHERE "siteId" IS NULL;
UPDATE "cash_registers" SET "siteId" = '00000000-0000-4000-8000-000000000101' WHERE "siteId" IS NULL;
UPDATE "cash_closings" SET "siteId" = '00000000-0000-4000-8000-000000000101' WHERE "siteId" IS NULL;
UPDATE "expense_categories" SET "siteId" = '00000000-0000-4000-8000-000000000101' WHERE "siteId" IS NULL;
UPDATE "expenses" SET "siteId" = '00000000-0000-4000-8000-000000000101' WHERE "siteId" IS NULL;
UPDATE "CustomerPayment" SET "siteId" = '00000000-0000-4000-8000-000000000101' WHERE "siteId" IS NULL;
UPDATE "orders" SET "siteId" = '00000000-0000-4000-8000-000000000101' WHERE "siteId" IS NULL;
UPDATE "cola_impresion" SET "siteId" = '00000000-0000-4000-8000-000000000101' WHERE "siteId" IS NULL;
UPDATE "delivery_drivers" SET "siteId" = '00000000-0000-4000-8000-000000000101' WHERE "siteId" IS NULL;
UPDATE "driver_settlements" SET "siteId" = '00000000-0000-4000-8000-000000000101' WHERE "siteId" IS NULL;
UPDATE "dining_tables" SET "siteId" = '00000000-0000-4000-8000-000000000101' WHERE "siteId" IS NULL;
UPDATE "kitchen_stations" SET "siteId" = '00000000-0000-4000-8000-000000000101' WHERE "siteId" IS NULL;
UPDATE "kitchen_tickets" SET "siteId" = '00000000-0000-4000-8000-000000000101' WHERE "siteId" IS NULL;

ALTER TABLE "delivery_zones" ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101', ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "cash_registers" ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101', ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "cash_closings" ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101', ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "expense_categories" ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101', ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "expenses" ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101', ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "CustomerPayment" ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101', ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101', ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "cola_impresion" ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101', ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "delivery_drivers" ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101', ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "driver_settlements" ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101', ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "dining_tables" ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101', ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "kitchen_stations" ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101', ALTER COLUMN "siteId" SET NOT NULL;
ALTER TABLE "kitchen_tickets" ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101', ALTER COLUMN "siteId" SET NOT NULL;

DO $$
DECLARE
  table_name TEXT;
  constraint_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'delivery_zones', 'cash_registers', 'cash_closings', 'expense_categories',
    'expenses', 'CustomerPayment', 'orders', 'cola_impresion', 'delivery_drivers',
    'driver_settlements', 'dining_tables', 'kitchen_stations', 'kitchen_tickets'
  ]
  LOOP
    constraint_name := table_name || '_siteId_fkey';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = constraint_name) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
        table_name,
        constraint_name
      );
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS "delivery_zones_siteId_active_idx" ON "delivery_zones"("siteId", "active");
CREATE INDEX IF NOT EXISTS "cash_registers_siteId_purpose_active_idx" ON "cash_registers"("siteId", "purpose", "active");
CREATE INDEX IF NOT EXISTS "cash_closings_siteId_userId_isOpen_idx" ON "cash_closings"("siteId", "userId", "isOpen");
CREATE INDEX IF NOT EXISTS "cash_closings_siteId_cashRegisterId_isOpen_idx" ON "cash_closings"("siteId", "cashRegisterId", "isOpen");
CREATE INDEX IF NOT EXISTS "expense_categories_siteId_active_idx" ON "expense_categories"("siteId", "active");
CREATE INDEX IF NOT EXISTS "expenses_siteId_createdAt_idx" ON "expenses"("siteId", "createdAt");
CREATE INDEX IF NOT EXISTS "expenses_siteId_categoryId_idx" ON "expenses"("siteId", "categoryId");
CREATE INDEX IF NOT EXISTS "CustomerPayment_siteId_createdAt_idx" ON "CustomerPayment"("siteId", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomerPayment_siteId_cashRegisterId_createdAt_idx" ON "CustomerPayment"("siteId", "cashRegisterId", "createdAt");
CREATE INDEX IF NOT EXISTS "orders_siteId_createdAt_idx" ON "orders"("siteId", "createdAt");
CREATE INDEX IF NOT EXISTS "orders_siteId_status_idx" ON "orders"("siteId", "status");
CREATE INDEX IF NOT EXISTS "orders_siteId_orderNumber_createdAt_idx" ON "orders"("siteId", "orderNumber", "createdAt");
CREATE INDEX IF NOT EXISTS "orders_siteId_invoiceNumber_idx" ON "orders"("siteId", "invoiceNumber");
CREATE INDEX IF NOT EXISTS "orders_siteId_orderType_createdAt_idx" ON "orders"("siteId", "orderType", "createdAt");
CREATE INDEX IF NOT EXISTS "orders_siteId_orderType_status_createdAt_idx" ON "orders"("siteId", "orderType", "status", "createdAt");
DROP INDEX IF EXISTS "orders_clientMutationId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "orders_siteId_clientMutationId_key" ON "orders"("siteId", "clientMutationId");
CREATE INDEX IF NOT EXISTS "cola_impresion_site_impreso_id_idx" ON "cola_impresion"("siteId", "impreso", "id");
CREATE INDEX IF NOT EXISTS "delivery_drivers_siteId_active_idx" ON "delivery_drivers"("siteId", "active");
CREATE INDEX IF NOT EXISTS "driver_settlements_siteId_driverId_createdAt_idx" ON "driver_settlements"("siteId", "driverId", "createdAt");
CREATE INDEX IF NOT EXISTS "driver_settlements_siteId_cashClosingId_createdAt_idx" ON "driver_settlements"("siteId", "cashClosingId", "createdAt");
CREATE INDEX IF NOT EXISTS "dining_tables_siteId_status_idx" ON "dining_tables"("siteId", "status");
CREATE INDEX IF NOT EXISTS "kitchen_stations_siteId_active_idx" ON "kitchen_stations"("siteId", "active");
CREATE INDEX IF NOT EXISTS "kitchen_tickets_siteId_status_idx" ON "kitchen_tickets"("siteId", "status");
