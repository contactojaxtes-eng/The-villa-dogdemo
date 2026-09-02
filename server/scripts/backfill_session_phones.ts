import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function extractPhoneFromText(text: string): string | null {
  if (!text) return null;
  
  // 1. Explicit keyword match (Tel: 300..., Cel: 300...)
  const explicitMatch = text.match(/(?:tel[eé]fono|cel(?:ular)?|m[oó]vil|n[uú]mero|num|nro|wa|llamadas?)\s*[:=-]?\s*(?:57\s*)?(3\d{2}[\s.-]?\d{3}[\s.-]?\d{4})/i);
  if (explicitMatch) {
    const digits = explicitMatch[1].replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('3')) return digits;
  }

  // 2. Generic Colombian mobile pattern (3XX XXX XXXX)
  const genericMatch = text.match(/\b(?:57\s*)?(3[0-9]{2})[\s.-]?([0-9]{3})[\s.-]?([0-9]{4})\b/);
  if (genericMatch) {
    const digits = `${genericMatch[1]}${genericMatch[2]}${genericMatch[3]}`;
    if (digits.length === 10) return digits;
  }

  return null;
}

async function main() {
  console.log('=== INICIANDO BACKFILL DE TELÉFONOS REALES EN SESIONES DE WHATSAPP ===');

  const sessions = await prisma.whatsAppSession.findMany({
    include: {
      messages: {
        where: { direction: 'IN' },
        orderBy: { createdAt: 'desc' },
        select: { content: true }
      }
    }
  });

  console.log(`Analizando ${sessions.length} sesiones...`);
  let updatedCount = 0;
  let bsuidWithPhoneCount = 0;

  for (const s of sessions) {
    const raw = (s.phone || '').trim();
    const cleanDigits = raw.replace(/\D/g, '');
    let resolvedCustomerPhone: string | null = null;

    // 1. Si es un teléfono colombiano estándar directo (10 o 12 dígitos)
    if (cleanDigits.length === 10 && cleanDigits.startsWith('3')) {
      resolvedCustomerPhone = cleanDigits;
    } else if (cleanDigits.length === 12 && cleanDigits.startsWith('573')) {
      resolvedCustomerPhone = cleanDigits.slice(2);
    } else if (cleanDigits.length >= 10 && cleanDigits.length <= 13 && !cleanDigits.startsWith('4') && !cleanDigits.startsWith('9') && !cleanDigits.startsWith('1') && !cleanDigits.startsWith('2')) {
      resolvedCustomerPhone = cleanDigits;
    } else if (cleanDigits.length === 11 && cleanDigits.startsWith('1')) {
      // Número internacional USA/Canadá (ej. 12485302707)
      resolvedCustomerPhone = cleanDigits;
    } else {
      // 2. Es un BSUID / ID técnico de Meta (14-18 dígitos, CO.xxx, @xxx):
      // Escanear los mensajes recibidos del cliente
      for (const m of s.messages) {
        const found = extractPhoneFromText(m.content);
        if (found) {
          resolvedCustomerPhone = found;
          bsuidWithPhoneCount++;
          console.log(`✨ Teléfono encontrado en chat para BSUID ${s.phone} (${s.customerName}): ${found}`);
          break;
        }
      }

      // Si no se encontró en mensajes, buscar en pedidos previos con el mismo nombre de cliente
      if (!resolvedCustomerPhone && s.customerName && !s.customerName.startsWith('@') && !s.customerName.startsWith('wa_lead_') && s.customerName !== s.phone) {
        const pastOrder = await prisma.order.findFirst({
          where: { customerName: { equals: s.customerName, mode: 'insensitive' } },
          select: { customerPhone: true },
          orderBy: { createdAt: 'desc' }
        });
        if (pastOrder && pastOrder.customerPhone) {
          const pClean = pastOrder.customerPhone.replace(/\D/g, '');
          const p10 = (pClean.length === 12 && pClean.startsWith('57')) ? pClean.slice(2) : pClean;
          if (p10.length === 10 && p10.startsWith('3')) {
            resolvedCustomerPhone = p10;
            console.log(`📦 Teléfono vinculado desde pedido para ${s.customerName}: ${p10}`);
          }
        }
      }
    }

    if (resolvedCustomerPhone && s.customerPhone !== resolvedCustomerPhone) {
      await prisma.whatsAppSession.update({
        where: { id: s.id },
        data: { customerPhone: resolvedCustomerPhone }
      });
      updatedCount++;
    }
  }

  console.log(`\n=== BACKFILL COMPLETADO ===`);
  console.log(`Total sesiones actualizadas con customerPhone: ${updatedCount}`);
  console.log(`Total BSUIDs/IDs donde se extrajo el teléfono real: ${bsuidWithPhoneCount}`);
}

main().finally(() => prisma.$disconnect());
