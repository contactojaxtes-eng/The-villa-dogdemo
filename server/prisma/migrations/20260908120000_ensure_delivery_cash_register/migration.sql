-- Existing installations can already contain dining registers, so the regular
-- seed does not add its default registers. Add only the missing delivery register
-- and preserve every existing register, closing and order.
UPDATE "cash_registers"
SET "active" = true
WHERE "purpose" = 'DELIVERY'
  AND NOT EXISTS (
    SELECT 1 FROM "cash_registers" WHERE "purpose" = 'DELIVERY' AND "active" = true
  );

INSERT INTO "cash_registers" (
  "id",
  "name",
  "description",
  "purpose",
  "active",
  "createdAt"
)
SELECT
  'cash-register-delivery-default',
  'Caja Domicilios',
  'Domicilios y pedidos para recoger',
  'DELIVERY',
  true,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1
  FROM "cash_registers"
  WHERE "purpose" = 'DELIVERY' AND "active" = true
);
