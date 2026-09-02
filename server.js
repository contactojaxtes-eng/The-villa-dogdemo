const fs = require('fs');
const path = require('path');

const candidates = [
  path.join(__dirname, 'dist', 'main.js'),
  path.join(__dirname, 'server', 'dist', 'main.js'),
  path.join(__dirname, 'dist', 'src', 'main.js'),
  path.join(__dirname, 'server', 'dist', 'src', 'main.js'),
];

let targetFile = null;
let targetCwd = null;

for (const cand of candidates) {
  if (fs.existsSync(cand)) {
    targetFile = cand;
    targetCwd = cand.includes(path.sep + 'server' + path.sep) 
      ? path.join(__dirname, 'server') 
      : __dirname;
    break;
  }
}

if (!targetFile) {
  console.error('[Startup Error] No se encontro ningun dist/main.js compilado en:', candidates);
  process.exit(1);
}

console.log(`[Startup] Directorio de ejecucion: ${targetCwd}`);

// Sincronizar esquema de base de datos automáticamente si DATABASE_URL está presente
if (process.env.DATABASE_URL) {
  try {
    const { execSync } = require('child_process');
    console.log('[Startup] Sincronizando esquema de base de datos con Prisma...');
    execSync('npx prisma db push --skip-generate', {
      cwd: targetCwd,
      stdio: 'inherit',
      env: process.env,
    });
    console.log('[Startup] Esquema de base de datos sincronizado con éxito.');

    if (process.env.BOOTSTRAP_CURRENT_USERS === 'true') {
      const seedScript = path.join(targetCwd, 'dist', 'seed.js');
      if (fs.existsSync(seedScript)) {
        console.log('[Startup] Inicializando usuarios y menú inicial...');
        execSync(`node "${seedScript}"`, {
          cwd: targetCwd,
          stdio: 'inherit',
          env: process.env,
        });
        console.log('[Startup] Inicialización de usuarios completada.');
      }
    }
  } catch (dbErr) {
    console.warn('[Startup] Nota al sincronizar BD:', dbErr.message);
  }
}

console.log(`[Startup] Cargando backend: ${targetFile}`);

process.chdir(targetCwd);
require(targetFile);
