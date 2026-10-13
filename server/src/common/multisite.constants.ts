export const DEFAULT_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_SITE_ID = '00000000-0000-4000-8000-000000000101';
export const WHATSAPP_META_PREFLIGHT_VERIFIED_AT_KEY = 'whatsapp_meta_preflight_verified_at';

export const DEFAULT_ORGANIZATION = {
  id: DEFAULT_ORGANIZATION_ID,
  name: 'The Villa Dog',
  slug: 'the-villa-dog',
} as const;

export const DEFAULT_SITE = {
  id: DEFAULT_SITE_ID,
  organizationId: DEFAULT_ORGANIZATION_ID,
  code: 'principal',
  name: 'Sede Principal',
  timezone: 'America/Bogota',
} as const;
