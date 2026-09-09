const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const clientPublic = path.join(rootDir, 'client', 'public');
const downloadsDir = path.join(clientPublic, 'downloads');
const scriptsDir = path.join(rootDir, 'scripts');

if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

console.log('[Build Bridge] 1. Preparando scripts...');
const sourceBridgeJs = path.join(clientPublic, 'printer-bridge.js');
const seaPrepConfig = path.join(scriptsDir, 'sea-bridge-config.json');
const seaBlob = path.join(scriptsDir, 'sea-bridge.blob');
const targetExe = path.join(downloadsDir, 'TheVillaDogBridge.exe');
const legacyExe = path.join(downloadsDir, 'Instalar-Impresion-TheVillaDog.exe');

// Configuración SEA para Node
fs.writeFileSync(seaPrepConfig, JSON.stringify({
  main: sourceBridgeJs,
  output: seaBlob,
  disableExperimentalSEAWarning: true
}, null, 2));

console.log('[Build Bridge] 2. Generando blob SEA de Node.js...');
execSync(`node --experimental-sea-config "${seaPrepConfig}"`, { stdio: 'inherit' });

if (!fs.existsSync(seaBlob)) {
  console.error('[Build Bridge] Error: No se generó sea-bridge.blob');
  process.exit(1);
}

console.log('[Build Bridge] 3. Copiando runtime Node.js nativo...');
const nodeExec = process.execPath;
fs.copyFileSync(nodeExec, targetExe);

console.log('[Build Bridge] 4. Inyectando código del puente en el ejecutable...');
execSync(`npx --yes postject "${targetExe}" NODE_SEA_BLOB "${seaBlob}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, { stdio: 'inherit' });

// También actualizar legacyExe para compatibilidad retroactiva
fs.copyFileSync(targetExe, legacyExe);

console.log('[Build Bridge] 5. Verificando ejecutable...');
try {
  const check = execSync(`"${targetExe}" --version`, { encoding: 'utf8', timeout: 5000 });
  console.log('[Build Bridge] Verificación exitosa:', check.trim());
} catch (err) {
  console.warn('[Build Bridge] Nota al verificar salida:', err.message);
}

// Limpiar archivos temporales
try { fs.unlinkSync(seaPrepConfig); } catch {}
try { fs.unlinkSync(seaBlob); } catch {}

console.log('[Build Bridge] Proceso finalizado. Archivo creado en:', targetExe);
