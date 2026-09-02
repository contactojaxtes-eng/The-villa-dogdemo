import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const downloadsDir = 'C:\\Users\\Jose\\Downloads';

async function exportAllNumbersByRecency() {
  console.log('🚀 Generando archivo maestro ordenado por RECENCIA (los chats más recientes primero)...');

  // Maintain array of phones to preserve exact recency order + Set for deduplication
  const orderedPhones: { phone: string; date: Date }[] = [];
  const seenPhoneSet = new Set<string>();

  const cleanPhone = (str: string | null | undefined): string | null => {
    if (!str) return null;
    const digits = str.replace(/\D/g, '');
    if (digits.startsWith('573') && digits.length === 12) return digits.slice(2);
    if (digits.startsWith('3') && digits.length === 10) return digits;
    return null;
  };

  const addPhoneWithDate = (phoneStr: string | null | undefined, date: Date) => {
    const p = cleanPhone(phoneStr);
    if (p && !seenPhoneSet.has(p)) {
      seenPhoneSet.add(p);
      orderedPhones.push({ phone: p, date });
    }
  };

  // 1. WhatsApp Sessions (Chats en vivo ordenados por el mensaje más reciente)
  try {
    const sessions = await prisma.whatsAppSession.findMany({
      select: { phone: true, lastMessageAt: true, createdAt: true },
      orderBy: { lastMessageAt: 'desc' }
    });
    sessions.forEach(s => {
      addPhoneWithDate(s.phone, s.lastMessageAt || s.createdAt || new Date());
    });
    console.log(`✓ Leídas ${sessions.length} sesiones de WhatsApp por fecha de mensaje`);
  } catch (err) {}

  // 2. Historial de Pedidos (Ordenados por fecha de creación desc)
  try {
    const orders = await prisma.order.findMany({
      select: { customerPhone: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });
    orders.forEach(o => {
      addPhoneWithDate(o.customerPhone, o.createdAt || new Date());
    });
    console.log(`✓ Leídos ${orders.length} pedidos ordenados por fecha de creación`);
  } catch (err) {}

  // 3. Clientes guardados en la BD
  try {
    const customers = await prisma.customer.findMany({
      select: { phone: true, updatedAt: true, createdAt: true },
      orderBy: { updatedAt: 'desc' }
    });
    customers.forEach(c => {
      addPhoneWithDate(c.phone, c.updatedAt || c.createdAt || new Date(2026, 0, 1));
    });
  } catch (err) {}

  // 4. Archivos extraídos de WhatsApp Desktop / Navegador
  const masterPath = path.join(downloadsDir, '00_TODOS_LOS_4200_NUMEROS_REALES_WHATSAPP.csv');
  if (fs.existsSync(masterPath)) {
    const content = fs.readFileSync(masterPath, 'utf8');
    const lines = content.split('\n').slice(1);
    lines.forEach((l, index) => {
      const parts = l.split(';');
      // Preservar el orden asignando una fecha relativa
      const fakeDate = new Date(2026, 0, 1 - index);
      addPhoneWithDate(parts[0], fakeDate);
    });
  }

  console.log(`\n========================================`);
  console.log(`TOTAL NÚMEROS REALES ORDENADOS POR RECENCIA: ${orderedPhones.length}`);
  console.log(`========================================\n`);

  const bom = '\uFEFF';
  const lines = [bom + 'Orden_Reciente;Celular_10_Digitos;Formato_Meta_WhatsApp;Fecha_Ultima_Actividad'];

  orderedPhones.forEach((item, index) => {
    const dateStr = item.date ? item.date.toISOString().split('T')[0] : 'Reciente';
    lines.push(`${index + 1};${item.phone};="57${item.phone}";${dateStr}`);
  });

  const outputPath = path.join(downloadsDir, '00_TODOS_LOS_NUMEROS_REALES_ORDENADOS_POR_RECENCIA.csv');
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');

  console.log(`✔ Archivo ordenado por recencia guardado en: ${outputPath}`);

  // Muestra de los primeros 10
  console.log('Muestra de los 10 chats/pedidos más recientes (primeros en el archivo):');
  orderedPhones.slice(0, 10).forEach((item, idx) => {
    console.log(`  #${idx + 1}: ${item.phone} (${item.date ? item.date.toISOString().split('T')[0] : ''})`);
  });

  await prisma.$disconnect();
}

exportAllNumbersByRecency().catch(err => {
  console.error('Error:', err);
  prisma.$disconnect();
});
