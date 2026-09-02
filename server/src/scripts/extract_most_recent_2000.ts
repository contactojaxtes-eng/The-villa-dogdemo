import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const downloadsDir = 'C:\\Users\\Jose\\Downloads';

async function extractMostRecent2000() {
  console.log('🚀 Extrayendo los 2.000 clientes MÁS RECIENTES por fecha de actividad...');
  
  // Map phone -> latest timestamp (Date object)
  const recentPhoneMap = new Map<string, Date>();

  const cleanPhone = (str: string | null | undefined): string | null => {
    if (!str) return null;
    const digits = str.replace(/\D/g, '');
    if (digits.startsWith('573') && digits.length === 12) return digits.slice(2);
    if (digits.startsWith('3') && digits.length === 10) return digits;
    return null;
  };

  // 1. Orders sorted by createdAt descending
  try {
    const orders = await prisma.order.findMany({
      select: { customerPhone: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });
    orders.forEach(o => {
      const p = cleanPhone(o.customerPhone);
      if (p) {
        if (!recentPhoneMap.has(p) || o.createdAt > recentPhoneMap.get(p)!) {
          recentPhoneMap.set(p, o.createdAt);
        }
      }
    });
    console.log(`✓ Leídos ${orders.length} pedidos de la base de datos.`);
  } catch (err) {}

  // 2. WhatsApp Sessions sorted by lastMessageAt descending
  try {
    const sessions = await prisma.whatsAppSession.findMany({
      select: { phone: true, lastMessageAt: true },
      orderBy: { lastMessageAt: 'desc' }
    });
    sessions.forEach(s => {
      const p = cleanPhone(s.phone);
      if (p) {
        const date = s.lastMessageAt || new Date(2026, 0, 1);
        if (!recentPhoneMap.has(p) || date > recentPhoneMap.get(p)!) {
          recentPhoneMap.set(p, date);
        }
      }
    });
  } catch (err) {}

  // 3. Customers database
  try {
    const customers = await prisma.customer.findMany({
      select: { phone: true, updatedAt: true, createdAt: true }
    });
    customers.forEach(c => {
      const p = cleanPhone(c.phone);
      if (p) {
        const date = c.updatedAt || c.createdAt || new Date(2026, 0, 1);
        if (!recentPhoneMap.has(p) || date > recentPhoneMap.get(p)!) {
          recentPhoneMap.set(p, date);
        }
      }
    });
  } catch (err) {}

  // 4. Fill with remaining numbers from 00_TODOS_LOS_4200_NUMEROS_REALES_WHATSAPP.csv
  const masterPath = path.join(downloadsDir, '00_TODOS_LOS_4200_NUMEROS_REALES_WHATSAPP.csv');
  if (fs.existsSync(masterPath)) {
    const content = fs.readFileSync(masterPath, 'utf8');
    const lines = content.split('\n').slice(1);
    let fillDate = new Date(2025, 0, 1);
    lines.forEach(l => {
      const parts = l.split(';');
      const p = cleanPhone(parts[0]);
      if (p && !recentPhoneMap.has(p)) {
        recentPhoneMap.set(p, fillDate);
      }
    });
  }

  // Sort entries by date descending (NEWEST FIRST!)
  const sortedEntries = Array.from(recentPhoneMap.entries()).sort((a, b) => b[1].getTime() - a[1].getTime());

  console.log(`Total acumulado disponible: ${sortedEntries.length}`);

  // Take top 2,000 most recent
  const top2000 = sortedEntries.slice(0, 2000);

  const bom = '\uFEFF';
  const lines = [bom + 'Celular_10_Digitos;Formato_Meta_WhatsApp;Ultima_Actividad'];
  top2000.forEach(([phone, date]) => {
    const dateStr = date ? date.toISOString().split('T')[0] : 'Reciente';
    lines.push(`${phone};="57${phone}";${dateStr}`);
  });

  const outputPath = path.join(downloadsDir, '01_ULTIMOS_2000_CLIENTES_MAS_RECIENTES.csv');
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');

  console.log(`✔ ÉXITO: Guardado archivo de los 2.000 MÁS RECIENTES en: ${outputPath}`);
  await prisma.$disconnect();
}

extractMostRecent2000().catch(err => {
  console.error('Error:', err);
  prisma.$disconnect();
});
