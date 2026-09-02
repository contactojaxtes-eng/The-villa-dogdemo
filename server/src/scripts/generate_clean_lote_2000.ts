import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const downloadsDir = 'C:\\Users\\Jose\\Downloads';

async function processBatches() {
  console.log('🔍 Extrayendo historial de envíos de ayer y hoy...');

  const cleanPhone = (str: string | null | undefined): string | null => {
    if (!str) return null;
    const digits = str.replace(/\D/g, '');
    if (digits.startsWith('573') && digits.length === 12) return digits.slice(2);
    if (digits.startsWith('3') && digits.length === 10) return digits;
    return null;
  };

  // 1. Obtener TODOS los números que YA han recibido al menos 1 mensaje de salida (OUT)
  const contactedSet = new Set<string>();

  const sessionsWithOutMsgs = await prisma.whatsAppSession.findMany({
    where: {
      messages: {
        some: {
          direction: 'OUT'
        }
      }
    },
    select: { phone: true }
  });

  sessionsWithOutMsgs.forEach(s => {
    const p = cleanPhone(s.phone);
    if (p) contactedSet.add(p);
  });

  console.log('📌 Total números que YA han recibido envíos previos (Ayer/Hoy/Histórico):', contactedSet.size);

  // 2. Extraer la base completa de contactos de todas las fuentes
  const allPhoneSet = new Set<string>();

  const customers = await prisma.customer.findMany({ select: { phone: true } });
  customers.forEach(c => { const p = cleanPhone(c.phone); if (p) allPhoneSet.add(p); });

  const sessions = await prisma.whatsAppSession.findMany({ select: { phone: true } });
  sessions.forEach(s => { const p = cleanPhone(s.phone); if (p) allPhoneSet.add(p); });

  const orders = await prisma.order.findMany({ select: { customerPhone: true } });
  orders.forEach(o => { const p = cleanPhone(o.customerPhone); if (p) allPhoneSet.add(p); });

  // Escanear archivos CSV/LevelDB en Downloads
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
            if (p) allPhoneSet.add(p);
          }
        } catch {}
      }
    });
  } catch (err) {}

  console.log('📌 Total de base de contactos total acumulada:', allPhoneSet.size);

  // 3. Filtrar números NUNCA contactados
  const uncontactedNumbers: string[] = [];
  for (const phone of allPhoneSet) {
    if (!contactedSet.has(phone)) {
      uncontactedNumbers.push(phone);
    }
  }

  uncontactedNumbers.sort();

  console.log('✅ Números 100% NUEVOS Y SIN CONTACTAR disponibles:', uncontactedNumbers.length);

  // 4. Tomar los siguientes 2,000 números totalmente limpios
  const batch2000 = uncontactedNumbers.slice(0, 2000);

  const bom = '\uFEFF';
  const newBatchPath = path.join(downloadsDir, 'LOTE_NUEVO_2000_SIN_REPETIR_11_AGOSTO.csv');
  const csvLines = [bom + 'Celular_10_Digitos;Formato_Meta_WhatsApp;Estado'];
  batch2000.forEach(p => {
    csvLines.push(`${p};="57${p}";Nuevo_Sin_Contactar`);
  });

  fs.writeFileSync(newBatchPath, csvLines.join('\n'), 'utf8');

  console.log('\n==================================================');
  console.log(`🎉 ARCHIVO GENERADO EXITOSAMENTE:`);
  console.log(`📁 Ruta: ${newBatchPath}`);
  console.log(`📊 Total números en este nuevo lote: ${batch2000.length}`);
  console.log(`==================================================\n`);

  await prisma.$disconnect();
}

processBatches().catch(err => {
  console.error(err);
  prisma.$disconnect();
});
