const BASE_URL = process.argv.find(a => a.startsWith('--target='))?.split('=')[1]
  || process.env.API_URL
  || 'https://the-villa-dog-backend-production.up.railway.app';

async function apiRequest(path, method = 'GET', body = null, token = null) {
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  const fullPath = cleanPath.startsWith('/api') ? cleanPath : `/api${cleanPath}`;
  const url = `${BASE_URL}${fullPath}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`[${res.status}] ${data?.message || res.statusText || 'Error en petición'}`);
  }
  return data;
}

async function login(email, password) {
  const res = await apiRequest('/auth/login', 'POST', { email, password });
  return res.accessToken;
}

async function main() {
  console.log('====================================================');
  console.log('🧹 THE VILLA DOG - LIMPIEZA DE DATOS DE PRUEBA');
  console.log(`🌐 Objetivo: ${BASE_URL}`);
  console.log('====================================================\n');

  // Intentar con credenciales de superadmin o admin
  const candidates = [
    { email: 'superadmin@thevilladog.local', pass: 'Admin123!' },
    { email: 'superadmin@thevilladog.local', pass: '1234' },
    { email: 'admin@thevilladog.local', pass: '1234' },
    { email: 'admin@thevilladog.local', pass: 'admin123' },
  ];

  let token = null;
  let userEmail = null;

  for (const c of candidates) {
    try {
      token = await login(c.email, c.pass);
      userEmail = c.email;
      console.log(`✓ Autenticado como ${c.email}`);
      break;
    } catch (e) {
      // probar siguiente
    }
  }

  if (!token) {
    console.error('❌ No se pudo autenticar con ninguna credencial por defecto.');
    process.exit(1);
  }

  console.log('\n⏳ Ejecutando limpieza de ventas y pedidos de prueba...');
  try {
    const result = await apiRequest('/superadmin/maintenance/reset-test-sales', 'POST', {}, token);
    console.log('\n✅ ¡LIMPIEZA EXITOSA!');
    console.log('Mensaje:', result.message);
    console.log('Resumen de registros eliminados:');
    console.table(result.summary);
  } catch (err) {
    console.error('❌ Error al ejecutar reset:', err.message);
    process.exit(1);
  }
}

main();
