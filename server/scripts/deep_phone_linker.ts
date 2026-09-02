import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function extractPhoneFromText(text: string): string | null {
  if (!text) return null;
  // 1. Explicit phone label
  const explicit = text.match(/(?:tel[eé]fono|cel(?:ular)?|m[oó]vil|n[uú]mero|num|nro|wa|llamadas?)\s*[:=-]?\s*(?:57\s*)?(3\d{2}[\s.-]?\d{3}[\s.-]?\d{4})/i);
  if (explicit) {
    const d = explicit[1].replace(/\D/g, '');
    if (d.length === 10 && d.startsWith('3')) return d;
  }

  // 2. Standalone line with 10 digits
  const lines = text.split(/[\r\n]+/);
  for (const line of lines) {
    const lDigits = line.trim().replace(/\D/g, '');
    if (lDigits.length === 10 && lDigits.startsWith('3')) return lDigits;
    if (lDigits.length === 12 && lDigits.startsWith('573')) return lDigits.slice(2);
  }

  // 3. Generic 10 digit Colombian mobile pattern
  const generic = text.match(/\b(?:57\s*)?(3[0-9]{2})[\s.-]?([0-9]{3})[\s.-]?([0-9]{4})\b/);
  if (generic) {
    const d = generic[1] + generic[2] + generic[3];
    if (d.length === 10) return d;
  }

  return null;
}

async function main() {
  console.log('=== INICIANDO VINCULACIÓN PROFUNDA DE TELÉFONOS EN SESIONES ===');

  const sessions = await prisma.whatsAppSession.findMany({
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 30
      }
    }
  });

  console.log(`Analizando ${sessions.length} sesiones...`);
  let updatedCount = 0;

  for (const s of sessions) {
    let callable: string | null = (s as any).customerPhone || null;

    // 1. If s.phone is already a standard phone (10 or 12 digits)
    const cleanDigits = (s.phone || '').replace(/\D/g, '');
    if (!callable) {
      if (cleanDigits.length === 10 && cleanDigits.startsWith('3')) {
        callable = cleanDigits;
      } else if (cleanDigits.length === 12 && cleanDigits.startsWith('573')) {
        callable = cleanDigits.slice(2);
      } else if (cleanDigits.length === 11 && cleanDigits.startsWith('1')) {
        callable = cleanDigits;
      }
    }

    // 2. If name starts with @ and contains a phone number (e.g. @12485302707 or @3001234567)
    if (!callable && s.customerName) {
      const nameDigits = s.customerName.replace(/\D/g, '');
      if (nameDigits.length === 10 && nameDigits.startsWith('3')) {
        callable = nameDigits;
      } else if (nameDigits.length === 12 && nameDigits.startsWith('573')) {
        callable = nameDigits.slice(2);
      } else if (nameDigits.length === 11 && nameDigits.startsWith('1')) {
        callable = nameDigits;
      }
    }

    // 3. Scan all messages in session
    if (!callable && s.messages) {
      for (const m of s.messages) {
        const found = extractPhoneFromText(m.content);
        if (found) {
          callable = found;
          break;
        }
      }
    }

    // 4. Try matching with Customer table by name
    if (!callable && s.customerName && s.customerName.length >= 3 && !s.customerName.startsWith('@') && !/^\d+$/.test(s.customerName)) {
      const cust = await prisma.customer.findFirst({
        where: { name: { equals: s.customerName.trim(), mode: 'insensitive' } }
      });
      if (cust?.phone) {
        const cDigits = cust.phone.replace(/\D/g, '');
        if (cDigits.length === 10 && cDigits.startsWith('3')) {
          callable = cDigits;
        }
      }
    }

    // 5. Try matching with Order table by exact customerName
    if (!callable && s.customerName && s.customerName.length >= 3 && !s.customerName.startsWith('@') && !/^\d+$/.test(s.customerName)) {
      const order = await prisma.order.findFirst({
        where: {
          customerName: { equals: s.customerName.trim(), mode: 'insensitive' },
          customerPhone: { not: s.phone }
        },
        orderBy: { createdAt: 'desc' }
      });
      if (order?.customerPhone) {
        const oDigits = order.customerPhone.replace(/\D/g, '');
        if (oDigits.length === 10 && oDigits.startsWith('3')) {
          callable = oDigits;
        }
      }
    }

    if (callable && callable !== (s as any).customerPhone) {
      await prisma.whatsAppSession.update({
        where: { id: s.id },
        data: { customerPhone: callable }
      });
      updatedCount++;
      console.log(`✅ [${s.customerName || 'Cliente'}] (${s.phone}) -> Teléfono: ${callable}`);
    }
  }

  console.log(`=== VINCULACIÓN COMPLETADA: ${updatedCount} sesiones vinculadas ===`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
