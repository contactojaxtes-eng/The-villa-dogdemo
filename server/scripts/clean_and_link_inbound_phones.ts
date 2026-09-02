import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const BLACKLIST_PHONES = new Set([
  '3233003094', // The Villa Dog Nequi
  '3000000000', // Default mostrador
  '3103623532', // Domiciliario Yefiri
  '3028469323', // Domiciliario Mauricio
  '3127862233', // Domiciliario Santiago
  '3108776660', // Checking
]);

function extractPhoneFromInboundText(text: string): string | null {
  if (!text) return null;
  // 1. Explicit phone label
  const explicit = text.match(/(?:tel[eé]fono|cel(?:ular)?|m[oó]vil|n[uú]mero|num|nro|wa|llamadas?)\s*[:=-]?\s*(?:57\s*)?(3\d{2}[\s.-]?\d{3}[\s.-]?\d{4})/i);
  if (explicit) {
    const d = explicit[1].replace(/\D/g, '');
    if (d.length === 10 && d.startsWith('3') && !BLACKLIST_PHONES.has(d)) return d;
  }

  // 2. Standalone line with 10 digits
  const lines = text.split(/[\r\n]+/);
  for (const line of lines) {
    const lDigits = line.trim().replace(/\D/g, '');
    if (lDigits.length === 10 && lDigits.startsWith('3') && !BLACKLIST_PHONES.has(lDigits)) return lDigits;
    if (lDigits.length === 12 && lDigits.startsWith('573') && !BLACKLIST_PHONES.has(lDigits.slice(2))) return lDigits.slice(2);
  }

  // 3. Generic 10 digit Colombian mobile pattern
  const generic = text.match(/\b(?:57\s*)?(3[0-9]{2})[\s.-]?([0-9]{3})[\s.-]?([0-9]{4})\b/);
  if (generic) {
    const d = generic[1] + generic[2] + generic[3];
    if (d.length === 10 && !BLACKLIST_PHONES.has(d)) return d;
  }

  return null;
}

async function main() {
  console.log('=== LIMPIANDO Y VINCULANDO NÚMEROS REALES DE ENTRADA (IN) ===');

  // 1. Reset blacklisted phones
  const cleared = await prisma.whatsAppSession.updateMany({
    where: {
      customerPhone: { in: ['3233003094', '3000000000', '3103623532', '3028469323'] }
    },
    data: { customerPhone: null }
  });
  console.log(`Sesiones con números de restaurante/domiciliario reseteadas: ${cleared.count}`);

  const sessions = await prisma.whatsAppSession.findMany({
    include: {
      messages: {
        where: { direction: 'IN' },
        orderBy: { createdAt: 'desc' },
        take: 30
      }
    }
  });

  let linkedCount = 0;

  for (const s of sessions) {
    let callable: string | null = (s as any).customerPhone || null;

    // Direct phone check
    const cleanDigits = (s.phone || '').replace(/\D/g, '');
    if (!callable) {
      if (cleanDigits.length === 10 && cleanDigits.startsWith('3') && !BLACKLIST_PHONES.has(cleanDigits)) {
        callable = cleanDigits;
      } else if (cleanDigits.length === 12 && cleanDigits.startsWith('573') && !BLACKLIST_PHONES.has(cleanDigits.slice(2))) {
        callable = cleanDigits.slice(2);
      } else if (cleanDigits.length === 11 && cleanDigits.startsWith('1')) {
        callable = cleanDigits;
      }
    }

    // Name has phone
    if (!callable && s.customerName) {
      const nameDigits = s.customerName.replace(/\D/g, '');
      if (nameDigits.length === 10 && nameDigits.startsWith('3') && !BLACKLIST_PHONES.has(nameDigits)) {
        callable = nameDigits;
      } else if (nameDigits.length === 12 && nameDigits.startsWith('573') && !BLACKLIST_PHONES.has(nameDigits.slice(2))) {
        callable = nameDigits.slice(2);
      } else if (nameDigits.length === 11 && nameDigits.startsWith('1')) {
        callable = nameDigits;
      }
    }

    // Scan only INCOMING messages sent by the customer
    if (!callable && s.messages) {
      for (const m of s.messages) {
        const found = extractPhoneFromInboundText(m.content);
        if (found) {
          callable = found;
          break;
        }
      }
    }

    if (callable && callable !== (s as any).customerPhone) {
      await prisma.whatsAppSession.update({
        where: { id: s.id },
        data: { customerPhone: callable }
      });
      linkedCount++;
      console.log(`✅ [${s.customerName || 'Cliente'}] (${s.phone}) -> Teléfono Real: ${callable}`);
    }
  }

  console.log(`=== PROCESO COMPLETADO: ${linkedCount} sesiones vinculadas ===`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
