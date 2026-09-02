-- AlterTable with IF NOT EXISTS to ensure safety
ALTER TABLE "whatsapp_sessions" ADD COLUMN IF NOT EXISTS "waitingForAdvisor" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "whatsapp_sessions" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;

-- CreateIndex with IF NOT EXISTS
CREATE INDEX IF NOT EXISTS "whatsapp_sessions_waitingForAdvisor_idx" ON "whatsapp_sessions"("waitingForAdvisor");
CREATE INDEX IF NOT EXISTS "whatsapp_sessions_customerPhone_idx" ON "whatsapp_sessions"("customerPhone");

-- CreateTable cola_impresion for Local Bridge
CREATE TABLE IF NOT EXISTS "cola_impresion" (
    "id" SERIAL NOT NULL,
    "impresora_ip" TEXT,
    "payload" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'caja',
    "impreso" BOOLEAN NOT NULL DEFAULT false,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cola_impresion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cola_impresion_impreso_idx" ON "cola_impresion"("impreso");


