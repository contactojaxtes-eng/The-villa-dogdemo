const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const downloadsDir = path.join(rootDir, 'client', 'public', 'downloads');
const zipFile = path.join(downloadsDir, 'TheVillaDog-Puente-Portable.zip');

const filesToZip = [
  path.join(downloadsDir, 'TheVillaDogBridge.exe'),
  path.join(downloadsDir, 'instalar_puente.bat'),
  path.join(downloadsDir, 'desinstalar_puente.bat'),
  path.join(downloadsDir, 'config.json'),
  path.join(downloadsDir, 'LEEME.txt'),
  path.join(downloadsDir, 'printer-bridge.js'),
];

console.log('Archivos a incluir en el ZIP:');
filesToZip.forEach(f => console.log(' -', path.basename(f), fs.existsSync(f) ? `(${fs.statSync(f).size} bytes)` : '[NO EXISTE]'));

if (fs.existsSync(zipFile)) {
  fs.unlinkSync(zipFile);
}

// Usamos powershell con script de escape seguro
const psScript = `
$Compress = @{
  LiteralPath = @(
    '${filesToZip[0].replace(/'/g, "''")}',
    '${filesToZip[1].replace(/'/g, "''")}',
    '${filesToZip[2].replace(/'/g, "''")}',
    '${filesToZip[3].replace(/'/g, "''")}',
    '${filesToZip[4].replace(/'/g, "''")}',
    '${filesToZip[5].replace(/'/g, "''")}'
  )
  DestinationPath = '${zipFile.replace(/'/g, "''")}'
  CompressionLevel = 'Optimal'
}
Compress-Archive @Compress -Force
`;

const psScriptFile = path.join(__dirname, 'zip-temp.ps1');
fs.writeFileSync(psScriptFile, psScript, 'utf8');

console.log('Generando archivo ZIP...');
execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${psScriptFile}"`, { stdio: 'inherit' });

if (fs.existsSync(psScriptFile)) {
  fs.unlinkSync(psScriptFile);
}

if (fs.existsSync(zipFile)) {
  const size = fs.statSync(zipFile).size;
  console.log(`[OK] Archivo ZIP generado con éxito: ${(size / (1024 * 1024)).toFixed(2)} MB`);
  // Copiar también a client/public para acceso directo
  fs.copyFileSync(zipFile, path.join(rootDir, 'client', 'public', 'TheVillaDog-Puente-Portable.zip'));
} else {
  console.error('[ERROR] No se generó el archivo ZIP.');
}
