import fs from 'fs';
import path from 'path';

/**
 * Extractor Directo de Chrome LevelDB de WhatsApp Web
 * Escanea el almacenamiento local no cifrado de Chrome en la PC
 * Creado por Antigravity para The Villa Dog
 */

async function extractFromChromeWhatsAppLevelDb() {
  console.log('\n======================================================');
  console.log('  🚀 EXTRACTOR DE CONTACTOS CHROME LEVELDB - THE VILLA DOG');
  console.log('======================================================\n');

  const userHome = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Jose';
  
  // Posibles rutas del IndexedDB de WhatsApp Web en Chrome / Edge / Brave / Opera
  const chromePaths = [
    path.join(userHome, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'IndexedDB', 'https_web.whatsapp.com_0.indexeddb.leveldb'),
    path.join(userHome, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Profile 1', 'IndexedDB', 'https_web.whatsapp.com_0.indexeddb.leveldb'),
    path.join(userHome, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data', 'Default', 'IndexedDB', 'https_web.whatsapp.com_0.indexeddb.leveldb'),
    path.join(userHome, 'AppData', 'Roaming', 'Opera Software', 'Opera Stable', 'IndexedDB', 'https_web.whatsapp.com_0.indexeddb.leveldb'),
  ];

  let targetDir: string | null = null;
  for (const p of chromePaths) {
    if (fs.existsSync(p)) {
      targetDir = p;
      break;
    }
  }

  if (!targetDir) {
    // Si no está en la ruta por defecto, buscar en AppData/Local/Google/Chrome/User Data/
    const baseChromeDir = path.join(userHome, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
    if (fs.existsSync(baseChromeDir)) {
      const items = fs.readdirSync(baseChromeDir);
      for (const item of items) {
        const candidate = path.join(baseChromeDir, item, 'IndexedDB', 'https_web.whatsapp.com_0.indexeddb.leveldb');
        if (fs.existsSync(candidate)) {
          targetDir = candidate;
          break;
        }
      }
    }
  }

  if (!targetDir || !fs.existsSync(targetDir)) {
    console.log('❌ No se encontró la carpeta de base de datos local de WhatsApp Web en Chrome.');
    console.log('💡 Abre WhatsApp Web en Chrome al menos una vez en esta computadora y vuelve a ejecutar este comando.');
    return;
  }

  console.log(`📌 Base de Datos Local de Chrome detectada en:\n   ${targetDir}\n`);

  const files = fs.readdirSync(targetDir);
  const ldbFiles = files.filter(f => f.endsWith('.ldb') || f.endsWith('.log'));

  console.log(`🔍 Escaneando ${ldbFiles.length} archivos de almacenamiento de Chrome...`);

  const extractedNumbers = new Set<string>();

  for (const file of ldbFiles) {
    const filePath = path.join(targetDir, file);
    try {
      const buffer = fs.readFileSync(filePath);

      // Escanear en bloques latin1 para no romper alineación de bytes
      const chunkSize = 16 * 1024 * 1024;
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const chunkEnd = Math.min(offset + chunkSize, buffer.length);
        const chunkStr = buffer.toString('latin1', offset, chunkEnd);

        // Regex para identificadores JID de WhatsApp (ej: 573125749586@c.us o @s.whatsapp.net)
        const jidRegex = /\b(573\d{9}|3\d{9})@(c\.us|s\.whatsapp\.net)\b/g;
        let match: RegExpExecArray | null;

        while ((match = jidRegex.exec(chunkStr)) !== null) {
          const cleanNum = match[1].slice(-10);
          if (cleanNum.startsWith('3')) {
            extractedNumbers.add(cleanNum);
          }
        }
      }
    } catch (err) {
      // Archivo en uso por Chrome, continuar con el siguiente
    }
  }

  if (extractedNumbers.size === 0) {
    console.log('\n⚠️ No se hallaron números en la caché de Chrome. Asegúrate de cerrar Chrome o refrescar WhatsApp Web.');
    return;
  }

  const numberList = Array.from(extractedNumbers);
  const downloadsDir = path.join(userHome, 'Downloads');
  
  // 1. Guardar Maestro Completo (Columna única limpia de 10 dígitos)
  const masterLines = ['Telefono', ...numberList];
  const outputMasterPath = path.join(downloadsDir, 'contactos_MAESTRO_todos.csv');
  fs.writeFileSync(outputMasterPath, masterLines.join('\n'), 'utf-8');

  // 2. Dividir automáticamente en Lotes de 2.000 directamente en la carpeta de Descargas
  const BATCH_SIZE = 2000;
  const batchFiles: string[] = [];

  for (let i = 0; i < numberList.length; i += BATCH_SIZE) {
    const chunk = numberList.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batchLines = ['Telefono', ...chunk];
    const fileName = `lote_${batchNum}_${chunk.length}_contactos.csv`;
    const batchPath = path.join(downloadsDir, fileName);
    fs.writeFileSync(batchPath, batchLines.join('\n'), 'utf-8');
    batchFiles.push(batchPath);
  }

  console.log('\n======================================================');
  console.log(`  🎉 ¡ÉXITO TOTAL! SE EXTRAJERON ${numberList.length} TELÉFONOS ÚNICOS`);
  console.log('======================================================');
  console.log(`\n📁 Archivo Maestro Completo:\n   ${outputMasterPath}\n`);
  console.log(`📦 Lotes diarios listos de 2.000 en 2.000:`);
  batchFiles.forEach((bf, idx) => {
    console.log(`   - Día ${idx + 1}: ${bf}`);
  });
  console.log('\n======================================================\n');
}

extractFromChromeWhatsAppLevelDb().catch(console.error);
