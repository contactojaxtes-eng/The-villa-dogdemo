ALTER TABLE "whatsapp_messages"
ADD COLUMN IF NOT EXISTS "orderId" TEXT;

CREATE INDEX IF NOT EXISTS "whatsapp_messages_orderId_createdAt_idx"
ON "whatsapp_messages"("orderId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'whatsapp_messages_orderId_fkey'
  ) THEN
    ALTER TABLE "whatsapp_messages"
    ADD CONSTRAINT "whatsapp_messages_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- No se enlaza historial por número ni por sesión durante la migración. Una
-- sesión puede contener varios pedidos y adivinar el vínculo expondría al
-- domiciliario mensajes de otro pedido. Desde este despliegue solo se enlazan
-- mensajes nuevos cuando existe exactamente un domicilio activo inequívoco.
