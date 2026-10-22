const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
if (process.env.DATABASE_URL && process.env.DEMO_MODE !== 'true') {
  try {
    const prismaCli = path.join(
      targetCwd,
      'node_modules',
      'prisma',
      'build',
      'index.js',
    );
    const prismaSchema = path.join(targetCwd, 'prisma', 'schema.prisma');
    const preflightSql = path.join(targetCwd, 'prisma', 'pre-db-push.sql');

    if (!fs.existsSync(prismaCli)) {
      throw new Error(`No se encontró Prisma CLI en ${prismaCli}`);
    }
    if (!fs.existsSync(prismaSchema) || !fs.existsSync(preflightSql)) {
      throw new Error('Falta schema.prisma o el preflight de base de datos');
    }

    console.log('[Startup] Verificando organización y sede principal...');
    execFileSync(
      process.execPath,
      [
        prismaCli,
        'db',
        'execute',
        '--file',
        preflightSql,
        '--schema',
        prismaSchema,
      ],
      {
        cwd: targetCwd,
        stdio: 'inherit',
        env: process.env,
      },
    );

    console.log('[Startup] Sincronizando esquema de base de datos con Prisma...');
    execFileSync(
      process.execPath,
      [prismaCli, 'db', 'push', '--skip-generate', '--schema', prismaSchema],
      {
        cwd: targetCwd,
        stdio: 'inherit',
        env: process.env,
      },
    );
    console.log('[Startup] Esquema de base de datos sincronizado con éxito.');

    if (process.env.BOOTSTRAP_CURRENT_USERS === 'true') {
      const seedScript = path.join(targetCwd, 'dist', 'seed.js');
      if (fs.existsSync(seedScript)) {
        console.log('[Startup] Inicializando usuarios y menú inicial...');
        execFileSync(process.execPath, [seedScript], {
          cwd: targetCwd,
          stdio: 'inherit',
          env: process.env,
        });
        console.log('[Startup] Inicialización de usuarios completada.');
      }
    }
  } catch (dbErr) {
    console.error('[Startup Error] No se pudo preparar la base de datos:', dbErr.message);
    process.exit(1);
  }
}

console.log(`[Startup] Cargando backend: ${targetFile}`);

process.chdir(targetCwd);
require(targetFile);
