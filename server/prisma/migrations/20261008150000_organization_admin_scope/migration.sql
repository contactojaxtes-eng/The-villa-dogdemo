-- Se conserva la cuenta administrativa histórica y se distingue del ADMIN
-- operativo que se cree dentro de una sede.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "isOrganizationAdmin" BOOLEAN NOT NULL DEFAULT false;
