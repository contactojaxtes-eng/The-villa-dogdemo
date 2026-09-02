export function isAllowedOrigin(origin?: string) {
  if (!origin) return true;
  const configured = [
    ...(process.env.ALLOWED_ORIGINS || '').split(','),
    process.env.CLIENT_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined,
  ].filter((value): value is string => !!value).map(value => value.trim().replace(/\/$/, ''));
  const local = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000'];
  return [...configured, ...(process.env.NODE_ENV === 'production' ? [] : local)].includes(origin);
}

export function validateProductionEnvironment() {
  if (process.env.NODE_ENV !== 'production') return;
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 16) throw new Error('Configura un JWT_SECRET de al menos 16 caracteres');
  if (!process.env.DATABASE_URL) throw new Error('Configura DATABASE_URL');
}
