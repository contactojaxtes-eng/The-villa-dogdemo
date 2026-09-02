export function isAllowedOrigin(origin?: string) {
  if (!origin) return true;
  const configured = (process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const local = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000'];
  return [...configured, ...(process.env.NODE_ENV === 'production' ? [] : local)].includes(origin);
}

export function validateProductionEnvironment() {
  if (process.env.NODE_ENV !== 'production') return;
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32 || /change.me|example/i.test(secret)) throw new Error('Configura un JWT_SECRET nuevo y aleatorio de al menos 32 caracteres');
  if (!process.env.DATABASE_URL) throw new Error('Configura una base de datos nueva en DATABASE_URL');
  if (!process.env.CLIENT_URL?.startsWith('https://')) throw new Error('CLIENT_URL debe usar HTTPS en producción');
  const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim());
  if (!origins.length || origins.some(origin => !origin.startsWith('https://') || origin.includes('*'))) throw new Error('Configura ALLOWED_ORIGINS con los orígenes HTTPS exactos');
}
