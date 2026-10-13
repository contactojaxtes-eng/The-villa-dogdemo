-- Reconcile the migration history with schema.prisma after replacing global
-- operational indexes with their site-scoped equivalents.
DROP INDEX IF EXISTS "cash_closings_cashRegisterId_isOpen_idx";
DROP INDEX IF EXISTS "cash_closings_userId_isOpen_idx";
DROP INDEX IF EXISTS "cash_registers_purpose_active_idx";
DROP INDEX IF EXISTS "cola_impresion_impreso_id_idx";
DROP INDEX IF EXISTS "dining_tables_status_idx";
DROP INDEX IF EXISTS "driver_settlements_cashClosingId_createdAt_idx";
DROP INDEX IF EXISTS "driver_settlements_driverId_createdAt_idx";
DROP INDEX IF EXISTS "kitchen_stations_active_idx";
DROP INDEX IF EXISTS "kitchen_tickets_status_idx";
DROP INDEX IF EXISTS "orders_createdAt_idx";
DROP INDEX IF EXISTS "orders_orderType_createdAt_idx";
DROP INDEX IF EXISTS "orders_orderType_status_createdAt_idx";
DROP INDEX IF EXISTS "orders_status_idx";
DROP INDEX IF EXISTS "whatsapp_sessions_active_assignedToId_lastMessageAt_idx";
DROP INDEX IF EXISTS "whatsapp_sessions_active_idx";
DROP INDEX IF EXISTS "whatsapp_sessions_active_lastMessageAt_idx";
DROP INDEX IF EXISTS "whatsapp_sessions_customerPhone_idx";
DROP INDEX IF EXISTS "whatsapp_sessions_lastMessageAt_idx";
DROP INDEX IF EXISTS "whatsapp_sessions_waitingForAdvisor_idx";

ALTER TABLE "organizations"
  ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "sites"
  ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "user_site_memberships"
  ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "site_settings"
  ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "whatsapp_accounts"
  ALTER COLUMN "updatedAt" DROP DEFAULT;
