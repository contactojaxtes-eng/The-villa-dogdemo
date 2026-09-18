-- Portal privado de domiciliarios: una cuenta de acceso opcional por perfil.
ALTER TABLE "delivery_drivers"
  ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "delivery_drivers_userId_key"
  ON "delivery_drivers"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'delivery_drivers_userId_fkey'
  ) THEN
    ALTER TABLE "delivery_drivers"
      ADD CONSTRAINT "delivery_drivers_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;