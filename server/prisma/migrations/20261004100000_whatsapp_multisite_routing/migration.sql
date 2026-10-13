-- Registro de enrutamiento Meta por sede. Solo contiene identificadores
-- públicos y nombres de variables de entorno; nunca copia tokens reales.
CREATE TABLE IF NOT EXISTS "whatsapp_accounts" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "phoneNumberId" TEXT NOT NULL,
  "businessAccountId" TEXT,
  "displayPhoneNumber" TEXT,
  "accessTokenEnvKey" TEXT,
  "verifyTokenEnvKey" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_accounts_siteId_key"
ON "whatsapp_accounts"("siteId");

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_accounts_phoneNumberId_key"
ON "whatsapp_accounts"("phoneNumberId");

CREATE INDEX IF NOT EXISTS "whatsapp_accounts_active_idx"
ON "whatsapp_accounts"("active");

CREATE INDEX IF NOT EXISTS "whatsapp_accounts_businessAccountId_idx"
ON "whatsapp_accounts"("businessAccountId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_accounts_siteId_fkey'
  ) THEN
    ALTER TABLE "whatsapp_accounts"
    ADD CONSTRAINT "whatsapp_accounts_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- La cuenta ya existente pertenece exclusivamente a la sede principal.
-- Los secretos siguen donde están durante la transición; este registro solo
-- permite resolver metadata.phone_number_id sin cambiar el flujo actual.
INSERT INTO "whatsapp_accounts" (
  "id", "siteId", "phoneNumberId", "businessAccountId",
  "displayPhoneNumber", "active", "createdAt", "updatedAt"
)
SELECT
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000101',
  TRIM(phone_id."value"),
  NULLIF(TRIM(COALESCE(business_id."value", '')), ''),
  NULLIF(TRIM(COALESCE(business_phone."value", '')), ''),
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "app_settings" phone_id
LEFT JOIN "app_settings" business_id
  ON business_id."key" = 'whatsapp_business_account_id'
LEFT JOIN "app_settings" business_phone
  ON business_phone."key" = 'whatsapp_business_phone'
WHERE phone_id."key" = 'whatsapp_phone_id'
  AND TRIM(phone_id."value") <> ''
ON CONFLICT DO NOTHING;

-- Una misma persona puede escribir a números Meta de sedes distintas. La
-- identidad queda aislada por (siteId, phone), preservando todos los chats
-- históricos en la principal.
ALTER TABLE "whatsapp_sessions"
ADD COLUMN IF NOT EXISTS "siteId" TEXT;

UPDATE "whatsapp_sessions"
SET "siteId" = '00000000-0000-4000-8000-000000000101'
WHERE "siteId" IS NULL;

ALTER TABLE "whatsapp_sessions"
ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101',
ALTER COLUMN "siteId" SET NOT NULL;

DROP INDEX IF EXISTS "whatsapp_sessions_phone_key";

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_sessions_siteId_phone_key"
ON "whatsapp_sessions"("siteId", "phone");

CREATE INDEX IF NOT EXISTS "whatsapp_sessions_siteId_lastMessageAt_idx"
ON "whatsapp_sessions"("siteId", "lastMessageAt");

CREATE INDEX IF NOT EXISTS "whatsapp_sessions_siteId_active_idx"
ON "whatsapp_sessions"("siteId", "active");

CREATE INDEX IF NOT EXISTS "whatsapp_sessions_siteId_waitingForAdvisor_idx"
ON "whatsapp_sessions"("siteId", "waitingForAdvisor");

CREATE INDEX IF NOT EXISTS "whatsapp_sessions_siteId_customerPhone_idx"
ON "whatsapp_sessions"("siteId", "customerPhone");

CREATE INDEX IF NOT EXISTS "whatsapp_sessions_siteId_active_lastMessageAt_idx"
ON "whatsapp_sessions"("siteId", "active", "lastMessageAt");

CREATE INDEX IF NOT EXISTS "whatsapp_sessions_siteId_active_assignedToId_lastMessageAt_idx"
ON "whatsapp_sessions"("siteId", "active", "assignedToId", "lastMessageAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_sessions_siteId_fkey'
  ) THEN
    ALTER TABLE "whatsapp_sessions"
    ADD CONSTRAINT "whatsapp_sessions_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
