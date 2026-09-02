import fs from 'fs';
import path from 'path';
import readline from 'readline';

/**
 * Script para extraer números de teléfono de archivos de WhatsApp msgstore.db / crypt14 / crypt15
 * Creado por Antigravity para The Villa Dog
 */

async function extractNumbersFromWhatsAppDb() {
  console.log('\n======================================================');
  console.log('  🚀 EXTRACTOR OFFLINE DE CONTACTOS WHATSAPP - THE VILLA DOG');
  console.log('======================================================\n');

  // Buscar archivos msgstore en la carpeta actual o en Downloads/Desktop/Connected Phone
  const userHome = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Jose';
  const possiblePaths = [
    path.join(process.cwd(), 'msgstore.db'),
    path.join(process.cwd(), 'msgstore.db.crypt14'),
    path.join(process.cwd(), 'msgstore.db.crypt15'),
    path.join(userHome, 'Downloads', 'msgstore.db'),
    path.join(userHome, 'Downloads', 'msgstore.db.crypt15'),
    path.join(userHome, 'Downloads', 'msgstore.db.crypt14'),
    path.join(userHome, 'Desktop', 'msgstore.db'),
    path.join(userHome, 'Desktop', 'msgstore.db.crypt15'),
    path.join(userHome, 'Desktop', 'msgstore.db.crypt14'),
  ];

  let targetFilePath: string | null = null;

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      targetFilePath = p;
      break;
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askPath = () =>
    new Promise<string>((resolve) => {
      if (targetFilePath) {
        console.log(`\n📌 Se encontró automáticamente el archivo en:\n   ${targetFilePath}`);
        rl.question('\n¿Deseas procesar este archivo? (S/n o escribe la ruta de otro archivo): ', (ans) => {
          if (ans.trim().toLowerCase() === 'n' || (ans.trim() !== '' && ans.trim().toLowerCase() !== 's' && ans.trim().toLowerCase() !== 'si')) {
            rl.question('Ingresa la ruta completa del archivo msgstore: ', (customPath) => {
              resolve(customPath.trim().replace(/^["']|["']$/g, ''));
            });
          } else {
            resolve(targetFilePath!);
          }
        });
      } else {
        rl.question('Ingresa la ruta del archivo msgstore (ejemplo: C:\\Users\\Jose\\Downloads\\msgstore.db): ', (customPath) => {
          resolve(customPath.trim().replace(/^["']|["']$/g, ''));
        });
      }
    });

  const filePath = await askPath();
  rl.close();

  if (!fs.existsSync(filePath)) {
    console.error(`\n❌ Error: El archivo "${filePath}" no existe.`);
    return;
  }

  console.log(`\n🔍 Analizando archivo de base de datos (${(fs.statSync(filePath).size / (1024 * 1024)).toFixed(2)} MB)...`);

  const buffer = fs.readFileSync(filePath);
  const extractedNumbers = new Set<string>();

  // Process entire buffer in 32MB text chunks using binary encoding to preserve byte alignment
  const chunkSize = 32 * 1024 * 1024;
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    const chunkEnd = Math.min(offset + chunkSize, buffer.length);
    const chunkStr = buffer.toString('latin1', offset, chunkEnd);

    // Patrón 1: Identificadores JID de WhatsApp (ej: 573125749586@s.whatsapp.net o @c.us o @g.us)
    const jidRegex = /\b(573\d{9}|3\d{9})@(s\.whatsapp\.net|c\.us|g\.us)\b/g;
    let match: RegExpExecArray | null;

    while ((match = jidRegex.exec(chunkStr)) !== null) {
      const rawNum = match[1];
      const cleanNum = rawNum.slice(-10);
      if (cleanNum.startsWith('3')) {
        extractedNumbers.add(cleanNum);
      }
    }

    // Patrón 2: Búsqueda binaria de cadenas de números colombianos de 10 dígitos que empiezan por 3
    const phoneRegex = /\b(57)?(3\d{9})\b/g;
    while ((match = phoneRegex.exec(chunkStr)) !== null) {
      const cleanNum = match[2];
      if (cleanNum.startsWith('3')) {
        extractedNumbers.add(cleanNum);
      }
    }
  }

  if (extractedNumbers.size === 0) {
    console.log('\n⚠️ No se encontraron números legibles en texto plano en este archivo.');
    console.log('💡 Si el archivo está cifrado (.crypt14/.crypt15), desencríptalo primero con el archivo key de WhatsApp.');
    return;
  }

  // Generar CSV Maestro y Lotes Diarios de 2.000 (Columna única limpia)
  const numberList = Array.from(extractedNumbers);
  const downloadsDir = path.join(userHome, 'Downloads');
  
  const masterLines = ['Telefono', ...numberList];
  const outputMasterPath = path.join(downloadsDir, 'contactos_MAESTRO_todos.csv');
  fs.writeFileSync(outputMasterPath, masterLines.join('\n'), 'utf-8');

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

extractNumbersFromWhatsAppDb().catch(console.error);
