import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const downloadsDir = 'C:\\Users\\Jose\\Downloads';

async function generate7CleanBatches() {
  console.log('🚀 Iniciando extracción y formateo maestro para Excel...');
  const phoneSet = new Set<string>();

  const cleanPhone = (str: string | null | undefined): string | null => {
    if (!str) return null;
    const digits = str.replace(/\D/g, '');
    if (digits.startsWith('573') && digits.length === 12) return digits.slice(2); // Return 10-digit 3XXXXXXXXX
    if (digits.startsWith('3') && digits.length === 10) return digits; // Return 10-digit 3XXXXXXXXX
    return null;
  };

  // 1. Prisma DB (Customer, Session, Order)
  try {
    const customers = await prisma.customer.findMany({ select: { phone: true } });
    customers.forEach(c => { const p = cleanPhone(c.phone); if (p) phoneSet.add(p); });

    const sessions = await prisma.whatsAppSession.findMany({ select: { phone: true } });
    sessions.forEach(s => { const p = cleanPhone(s.phone); if (p) phoneSet.add(p); });

    const orders = await prisma.order.findMany({ select: { customerPhone: true } });
    orders.forEach(o => { const p = cleanPhone(o.customerPhone); if (p) phoneSet.add(p); });
  } catch (err) {
    console.error('Error Prisma DB:', err);
  }

  // 2. Scan all CSV files in Downloads
  try {
    const files = fs.readdirSync(downloadsDir);
    files.forEach(f => {
      if (f.endsWith('.csv') || f.endsWith('.txt') || f.endsWith('.vcf')) {
        const full = path.join(downloadsDir, f);
        try {
          const content = fs.readFileSync(full, 'utf8');
          const matches = content.matchAll(/(?:57)?(3[0125]\d{8})\b/g);
          for (const m of matches) {
            const p = cleanPhone(m[1]);
            if (p) phoneSet.add(p);
          }
        } catch {}
      }
    });
  } catch (err) {}

  // 3. Scan Chrome LevelDB / Local Storage for WhatsApp Web
  const chromeStorage = 'C:\\Users\\Jose\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\IndexedDB';
  if (fs.existsSync(chromeStorage)) {
    try {
      const sub = fs.readdirSync(chromeStorage, { recursive: true }) as string[];
      sub.forEach(f => {
        if (typeof f === 'string' && (f.endsWith('.ldb') || f.endsWith('.log'))) {
          const full = path.join(chromeStorage, f);
          try {
            const buf = fs.readFileSync(full);
            const str = buf.toString('latin1');
            const matches = str.matchAll(/(?:57)?(3[0125]\d{8})@/g);
            for (const m of matches) {
              const p = cleanPhone(m[1]);
              if (p) phoneSet.add(p);
            }
          } catch {}
        }
      });
    } catch {}
  }

  const sortedCellular = Array.from(phoneSet).sort();

  console.log(`\n========================================`);
  console.log(`TOTAL NÚMEROS REALES ÚNICOS ENCONTRADOS: ${sortedCellular.length}`);
  console.log(`========================================\n`);

  const bom = '\uFEFF';

  // Generate Master CSV formatted for Excel (Semi-colon separated + 10-digit number + text format)
  const masterExcelPath = path.join(downloadsDir, '00_CONTACTOS_REALES_TODOS_EXCEL.csv');
  const masterLines = [bom + 'Celular_10_Digitos;Formato_Meta_WhatsApp;Estado'];
  sortedCellular.forEach(p => {
    masterLines.push(`${p};="57${p}";Listo`);
  });
  fs.writeFileSync(masterExcelPath, masterLines.join('\n'), 'utf8');
  console.log(`✔ Guardado archivo maestro Excel: ${masterExcelPath}`);

  // Generate 7 (or total needed) Batch CSV Files of 2,000 items each
  const batchSize = 2000;
  const totalBatches = Math.max(7, Math.ceil(sortedCellular.length / batchSize));

  for (let i = 0; i < totalBatches; i++) {
    const start = i * batchSize;
    const end = Math.min(start + batchSize, sortedCellular.length);
    const batch = sortedCellular.slice(start, end);

    const numStr = batch.length > 0 ? `${batch.length}_numeros` : 'disponible_para_whatsapp_web';
    const batchFileName = `contactos_reales_lote_${i + 1}_de_${totalBatches}_(${numStr}).csv`;
    const batchFilePath = path.join(downloadsDir, batchFileName);

    const bLines = [bom + 'Celular_10_Digitos;Formato_Meta_WhatsApp'];
    batch.forEach(p => {
      bLines.push(`${p};="57${p}"`);
    });

    fs.writeFileSync(batchFilePath, bLines.join('\n'), 'utf8');
    console.log(`✔ Guardado Lote ${i + 1}/${totalBatches}: ${batchFileName} (${batch.length} números)`);
  }

  await prisma.$disconnect();
}

generate7CleanBatches().catch(err => {
  console.error('Error:', err);
  prisma.$disconnect();
});
