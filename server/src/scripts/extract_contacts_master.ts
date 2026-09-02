import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const downloadsDir = 'C:\\Users\\Jose\\Downloads';

async function extractMasterContacts() {
  console.log('🚀 Iniciando extractor maestro de contactos...');
  const phoneSet = new Set<string>();

  const cleanPhone = (phoneStr: string | null | undefined): string | null => {
    if (!phoneStr) return null;
    const digits = phoneStr.replace(/\D/g, '');
    if (digits.startsWith('573') && digits.length === 12) return digits;
    if (digits.startsWith('3') && digits.length === 10) return '57' + digits;
    if (digits.length === 10 && (digits.startsWith('30') || digits.startsWith('31') || digits.startsWith('32') || digits.startsWith('35'))) {
      return '57' + digits;
    }
    return null;
  };

  // 1. Extraer desde la base de datos del sistema THE VILLA DOG (Clientes, Sesiones WhatsApp, Pedidos)
  try {
    const customers = await prisma.customer.findMany({ select: { phone: true } });
    customers.forEach(c => {
      const p = cleanPhone(c.phone);
      if (p) phoneSet.add(p);
    });
    console.log(`✓ Encontrados en base de datos Clientes: ${customers.length} registros`);

    const sessions = await prisma.whatsAppSession.findMany({ select: { phone: true } });
    sessions.forEach(s => {
      const p = cleanPhone(s.phone);
      if (p) phoneSet.add(p);
    });
    console.log(`✓ Encontrados en Sesiones de WhatsApp: ${sessions.length} chats`);

    const orders = await prisma.order.findMany({ select: { customerPhone: true } });
    orders.forEach(o => {
      const p = cleanPhone(o.customerPhone);
      if (p) phoneSet.add(p);
    });
    console.log(`✓ Encontrados en historial de Pedidos: ${orders.length} pedidos`);
  } catch (err) {
    console.error('Error consultando base de datos Prisma:', err);
  }

  // 2. Extraer desde archivos previos en Descargas
  const csvFiles = [
    'contactos_whatsapp_chrome_extraidos.csv',
    'contactos_whatsapp_COMPLETO.csv'
  ];

  csvFiles.forEach(fileName => {
    const filePath = path.join(downloadsDir, fileName);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const matches = content.matchAll(/(?:57)?(3\d{9})/g);
        for (const match of matches) {
          const p = cleanPhone(match[1]);
          if (p) phoneSet.add(p);
        }
        console.log(`✓ Extraídos números desde archivo ${fileName}`);
      } catch (err) {
        console.error(`Error leyendo ${fileName}:`, err);
      }
    }
  });

  // 3. Buscar en Chrome / Edge IndexedDB / LevelDB local de WhatsApp Web si existe
  const userProfileDir = 'C:\\Users\\Jose\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\IndexedDB';
  if (fs.existsSync(userProfileDir)) {
    try {
      const files = fs.readdirSync(userProfileDir, { recursive: true }) as string[];
      files.forEach(file => {
        if (typeof file === 'string' && (file.endsWith('.ldb') || file.endsWith('.log'))) {
          const fullPath = path.join(userProfileDir, file);
          try {
            const buf = fs.readFileSync(fullPath);
            const text = buf.toString('binary');
            const matches = text.matchAll(/(?:573\d{9}|c\.us\/573\d{9}|@s\.whatsapp\.net)/g);
            for (const match of matches) {
              const p = cleanPhone(match[0]);
              if (p) phoneSet.add(p);
            }
          } catch {}
        }
      });
    } catch {}
  }

  const sortedPhones = Array.from(phoneSet).sort();

  console.log(`\n========================================`);
  console.log(`TOTAL NÚMEROS ÚNICOS CONSOLIDADOS: ${sortedPhones.length}`);
  console.log(`========================================\n`);

  // Guardar CSV Completo
  const masterCsvPath = path.join(downloadsDir, 'contactos_whatsapp_COMPLETO.csv');
  const masterLines = ['Telefono,Formato_WhatsApp,Estado'];
  sortedPhones.forEach(phone => {
    masterLines.push(`${phone},+${phone},Listo`);
  });
  fs.writeFileSync(masterCsvPath, masterLines.join('\n'), 'utf8');
  console.log(`✔ Archivo consolidado guardado: ${masterCsvPath}`);

  // Subdividir en bloques de 2,000 números
  const batchSize = 2000;
  const totalBatches = Math.ceil(sortedPhones.length / batchSize) || 1;

  for (let i = 0; i < totalBatches; i++) {
    const start = i * batchSize;
    const end = Math.min(start + batchSize, sortedPhones.length);
    const batch = sortedPhones.slice(start, end);

    const batchFileName = `contactos_whatsapp_parte_${i + 1}_de_${totalBatches}_(${batch.length}_numeros).csv`;
    const batchFilePath = path.join(downloadsDir, batchFileName);

    const batchLines = ['Telefono,Formato_WhatsApp'];
    batch.forEach(phone => {
      batchLines.push(`${phone},+${phone}`);
    });

    fs.writeFileSync(batchFilePath, batchLines.join('\n'), 'utf8');
    console.log(`✔ Archivo dividido ${i + 1}/${totalBatches}: ${batchFileName} (${batch.length} números)`);
  }

  await prisma.$disconnect();
}

extractMasterContacts().catch(err => {
  console.error('Fatal error:', err);
  prisma.$disconnect();
});
