-- Una cuenta de usuario puede operar como domiciliario en varias sedes.
-- El perfil, la cola, los pedidos y las liquidaciones siguen siendo propios de
-- cada sede; solo se comparte la identidad usada para iniciar sesión.
DROP INDEX IF EXISTS "delivery_drivers_userId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "delivery_drivers_siteId_userId_key"
ON "delivery_drivers"("siteId", "userId");
