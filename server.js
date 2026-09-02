const fs = require('fs');
const path = require('path');

try {
  require('v8').setFlagsFromString('--max_old_space_size=4096');
} catch (e) {}

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
console.log(`[Startup] Cargando backend: ${targetFile}`);

process.chdir(targetCwd);
require(targetFile);
