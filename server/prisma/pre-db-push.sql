-- Preflight para instalaciones históricas creadas con `prisma db push`.
-- Crea los padres de las nuevas relaciones multisede y convierte de forma
-- explícita los índices únicos que pasan de globales a aislados por sede.
-- Es idempotente: no borra filas ni modifica datos de negocio; únicamente
-- asigna la sede principal a filas históricas que todavía no tengan siteId.

-- La columna se agrega aquí porque Railway sincroniza con `prisma db push`
-- en cada arranque. El valor por defecto mantiene el comportamiento de los
-- usuarios nuevos hasta que el bootstrap marque las cuentas administrativas
-- existentes como administradores de organización una sola vez.
ALTER TABLE IF EXISTS "users"
  ADD COLUMN IF NOT EXISTS "isOrganizationAdmin" BOOLEAN NOT NULL DEFAULT false;

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

-- Prisma no representa índices parciales en schema.prisma. Esta restricción
-- debe vivir también en el preflight que Railway ejecuta realmente para
-- impedir que una organización termine con dos sedes principales.
CREATE UNIQUE INDEX IF NOT EXISTS "sites_one_default_per_organization_idx"
ON "sites"("organizationId") WHERE "isDefault" = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sites_organizationId_fkey'
      AND conrelid = '"sites"'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE "sites"
    ADD CONSTRAINT "sites_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- El catálogo histórico también pasa a estar aislado por sede. Las filas que
-- ya existen pertenecen a la sede principal y conservan sus mismos UUID para
-- que los pedidos y comandas históricas sigan resolviendo sus productos.
DO $$
DECLARE
  principal_site_id CONSTANT TEXT := '00000000-0000-4000-8000-000000000101';
  has_duplicates BOOLEAN;
BEGIN
  IF to_regclass('public.menu_categories') IS NOT NULL THEN
    ALTER TABLE "menu_categories"
      ADD COLUMN IF NOT EXISTS "siteId" TEXT;
    UPDATE "menu_categories"
      SET "siteId" = principal_site_id
      WHERE "siteId" IS NULL;
    ALTER TABLE "menu_categories"
      ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101',
      ALTER COLUMN "siteId" SET NOT NULL;
  END IF;

  IF to_regclass('public.menu_items') IS NOT NULL THEN
    ALTER TABLE "menu_items"
      ADD COLUMN IF NOT EXISTS "siteId" TEXT;
    UPDATE "menu_items"
      SET "siteId" = principal_site_id
      WHERE "siteId" IS NULL;
    ALTER TABLE "menu_items"
      ALTER COLUMN "siteId" SET DEFAULT '00000000-0000-4000-8000-000000000101',
      ALTER COLUMN "siteId" SET NOT NULL;

    SELECT EXISTS (
      SELECT 1
      FROM "menu_items"
      WHERE "code" IS NOT NULL
      GROUP BY "siteId", "code"
      HAVING COUNT(*) > 1
    ) INTO has_duplicates;
    IF has_duplicates THEN
      RAISE EXCEPTION 'No se puede aislar el menú: existen códigos de producto duplicados en la sede principal';
    END IF;

    DROP INDEX IF EXISTS "menu_items_code_key";
    CREATE UNIQUE INDEX IF NOT EXISTS "menu_items_siteId_code_key"
      ON "menu_items"("siteId", "code");
    CREATE INDEX IF NOT EXISTS "menu_items_siteId_categoryId_active_sortOrder_idx"
      ON "menu_items"("siteId", "categoryId", "active", "sortOrder");
  END IF;

  IF to_regclass('public.menu_categories') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "menu_categories_siteId_active_sortOrder_idx"
      ON "menu_categories"("siteId", "active", "sortOrder");
  END IF;
END $$;

-- `server.js` ejecuta este archivo antes de `prisma db push`. En una base
-- histórica todavía pueden no existir las tablas que Prisma agregará en ese
-- mismo arranque; créalas aquí con la misma forma mínima para que el seed de
-- la sede principal sea realmente idempotente.
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

DO $$
BEGIN
  IF to_regclass('users') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_site_memberships_userId_fkey'
      AND conrelid = '"user_site_memberships"'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE "user_site_memberships"
    ADD CONSTRAINT "user_site_memberships_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_site_memberships_siteId_fkey'
      AND conrelid = '"user_site_memberships"'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE "user_site_memberships"
    ADD CONSTRAINT "user_site_memberships_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'site_settings_siteId_fkey'
      AND conrelid = '"site_settings"'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE "site_settings"
    ADD CONSTRAINT "site_settings_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "sites"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "user_site_memberships_siteId_active_idx"
ON "user_site_memberships"("siteId", "active");

CREATE INDEX IF NOT EXISTS "user_site_memberships_userId_active_isDefault_idx"
ON "user_site_memberships"("userId", "active", "isDefault");

-- Igual que el índice parcial de sites, db push no puede reconstruir esta
-- regla desde el esquema Prisma. Un usuario solo puede tener una sede por
-- defecto, aunque tenga acceso a varias.
CREATE UNIQUE INDEX IF NOT EXISTS "user_site_memberships_one_default_per_user_idx"
ON "user_site_memberships"("userId") WHERE "isDefault" = true;

-- Fallar de forma explícita si una instalación previa reutilizó las claves
-- naturales reservadas con otros UUID. Continuar en ese estado mezclaría dos
-- organizaciones o dos sedes bajo el mismo código.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "organizations"
    WHERE "slug" = 'the-villa-dog'
      AND "id" <> '00000000-0000-4000-8000-000000000001'
  ) OR EXISTS (
    SELECT 1
    FROM "organizations"
    WHERE "id" = '00000000-0000-4000-8000-000000000001'
      AND "slug" <> 'the-villa-dog'
  ) THEN
    RAISE EXCEPTION 'Conflicto de identidad para la organización principal The Villa Dog';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "sites"
    WHERE "organizationId" = '00000000-0000-4000-8000-000000000001'
      AND "code" = 'principal'
      AND "id" <> '00000000-0000-4000-8000-000000000101'
  ) OR EXISTS (
    SELECT 1
    FROM "sites"
    WHERE "id" = '00000000-0000-4000-8000-000000000101'
      AND (
        "organizationId" <> '00000000-0000-4000-8000-000000000001'
        OR "code" <> 'principal'
      )
  ) THEN
    RAISE EXCEPTION 'Conflicto de identidad para la sede principal The Villa Dog';
  END IF;
END $$;

INSERT INTO "organizations" (
  "id", "name", "slug", "active", "createdAt", "updatedAt"
)
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
  "id", "organizationId", "code", "name", "timezone",
  "active", "isDefault", "createdAt", "updatedAt"
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

-- Prisma detiene `db push` en modo no interactivo cuando debe sustituir un
-- índice UNIQUE, incluso si la restricción anterior (más estricta) demuestra
-- que no puede haber duplicados. Hacemos esa conversión aquí, dentro de una
-- sola transacción, después de comprobar los datos. De esta forma el arranque
-- nunca necesita `--accept-data-loss`.
DO $$
DECLARE
  principal_site_id CONSTANT TEXT := '00000000-0000-4000-8000-000000000101';
  item RECORD;
  has_duplicates BOOLEAN;
BEGIN
  FOR item IN
    SELECT *
    FROM (VALUES
      ('customers',          'customers_phone_key',                    'customers_siteId_phone_key',                    '"siteId", "phone"',                    'TRUE'),
      ('delivery_drivers',   'delivery_drivers_userId_key',            'delivery_drivers_siteId_userId_key',            '"siteId", "userId"',                   '"userId" IS NOT NULL'),
      ('orders',             'orders_clientMutationId_key',            'orders_siteId_clientMutationId_key',            '"siteId", "clientMutationId"',         '"clientMutationId" IS NOT NULL'),
      ('waiter_badges',      'waiter_badges_userId_badgeId_week_key',  'waiter_badges_siteId_userId_badgeId_week_key',  '"siteId", "userId", "badgeId", "week"', 'TRUE'),
      ('waiter_metrics',     'waiter_metrics_userId_date_key',         'waiter_metrics_siteId_userId_date_key',         '"siteId", "userId", "date"',          'TRUE'),
      ('whatsapp_sessions',  'whatsapp_sessions_phone_key',            'whatsapp_sessions_siteId_phone_key',            '"siteId", "phone"',                    'TRUE')
    ) AS conversions(table_name, old_index, new_index, unique_columns, duplicate_filter)
  LOOP
    -- En una base completamente nueva estas tablas todavía no existen. Prisma
    -- las creará a continuación con el esquema final.
    IF to_regclass(format('public.%I', item.table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS "siteId" TEXT',
      item.table_name
    );
    EXECUTE format(
      'UPDATE %I SET "siteId" = $1 WHERE "siteId" IS NULL',
      item.table_name
    ) USING principal_site_id;
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN "siteId" SET DEFAULT %L, ALTER COLUMN "siteId" SET NOT NULL',
      item.table_name,
      principal_site_id
    );

    EXECUTE format(
      'SELECT EXISTS (' ||
      'SELECT 1 FROM %I WHERE %s GROUP BY %s HAVING COUNT(*) > 1' ||
      ')',
      item.table_name,
      item.duplicate_filter,
      item.unique_columns
    ) INTO has_duplicates;

    IF has_duplicates THEN
      RAISE EXCEPTION
        'No se puede preparar multisede: existen duplicados en % para (%)',
        item.table_name,
        item.unique_columns;
    END IF;

    EXECUTE format('DROP INDEX IF EXISTS %I', item.old_index);
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (%s)',
      item.new_index,
      item.table_name,
      item.unique_columns
    );
  END LOOP;
END $$;
