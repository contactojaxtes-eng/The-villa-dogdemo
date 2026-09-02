const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const p = new PrismaClient();

// Valid Colombian mobile prefixes
// 300-305, 310-319, 320-324, 350-351
function isValidColombianMobile(phone: string): boolean {
  const clean = phone.replace(/\D/g, '');
  const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
  if (p10.length !== 10) return false;
  if (!p10.startsWith('3')) return false;

  const prefix3 = p10.slice(0, 3);
  const p3Num = parseInt(prefix3, 10);
  
  // Valid ranges: 300-305, 310-319, 320-324, 350-351
  if (p3Num >= 300 && p3Num <= 305) return true;
  if (p3Num >= 310 && p3Num <= 319) return true;
  if (p3Num >= 320 && p3Num <= 324) return true;
  if (p3Num >= 350 && p3Num <= 351) return true;

  return false;
}

async function run() {
  console.log('=== ANALIZANDO BASE DE DATOS REAL DEL SISTEMA ===');

  // 1. Database Orders
  const orders = await p.order.findMany({ select: { customerPhone: true, customerName: true } });
  let dbOrderValid = 0;
  let dbOrderInvalid = 0;
  const dbOrderInvalidSamples: string[] = [];
  const validDbOrderPhones = new Set<string>();

  orders.forEach((o: any) => {
    if (!o.customerPhone) return;
    const clean = o.customerPhone.replace(/\D/g, '');
    const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
    if (isValidColombianMobile(p10)) {
      dbOrderValid++;
      validDbOrderPhones.add(p10);
    } else {
      dbOrderInvalid++;
      if (dbOrderInvalidSamples.length < 10) dbOrderInvalidSamples.push(`${o.customerName}: ${o.customerPhone}`);
    }
  });

  console.log(`\n📦 Pedidos en la Base de Datos (${orders.length} pedidos):`);
  console.log(`  Teléfonos VÁLIDOS colombianos en pedidos: ${dbOrderValid} (Únicos: ${validDbOrderPhones.size})`);
  console.log(`  Teléfonos INVÁLIDOS en pedidos: ${dbOrderInvalid}`);
  if (dbOrderInvalidSamples.length > 0) {
    console.log('  Muestras de teléfonos inválidos en pedidos:', dbOrderInvalidSamples);
  }

  // 2. Database Sessions
  const sessions = await p.whatsAppSession.findMany({ select: { phone: true, customerName: true } });
  let dbSessionValid = 0;
  let dbSessionInvalid = 0;
  const validDbSessionPhones = new Set<string>();

  sessions.forEach((s: any) => {
    if (!s.phone) return;
    const clean = s.phone.replace(/\D/g, '');
    const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
    if (isValidColombianMobile(p10)) {
      dbSessionValid++;
      validDbSessionPhones.add(p10);
    } else {
      dbSessionInvalid++;
    }
  });

  console.log(`\n💬 Sesiones de WhatsApp en Base de Datos (${sessions.length} sesiones):`);
  console.log(`  Teléfonos VÁLIDOS colombianos en sesiones: ${dbSessionValid} (Únicos: ${validDbSessionPhones.size})`);
  console.log(`  Teléfonos INVÁLIDOS en sesiones: ${dbSessionInvalid}`);

  // 3. Inspect CSV file: 00_CONTACTOS_REALES_ORDEN_EXACTO_WHATSAPP.csv
  const csvPath = 'C:/Users/Jose/Downloads/00_CONTACTOS_REALES_ORDEN_EXACTO_WHATSAPP.csv';
  let csvTotal = 0;
  let csvValid = 0;
  let csvFake = 0;
  const csvFakeSamples: string[] = [];
  const validCsvPhones = new Set<string>();

  if (fs.existsSync(csvPath)) {
    const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
    lines.forEach((l: string) => {
      const parts = l.split(';');
      if (parts.length >= 2) {
        const phone = parts[1].trim().replace(/\D/g, '');
        if (phone.length === 10) {
          csvTotal++;
          if (isValidColombianMobile(phone)) {
            csvValid++;
            validCsvPhones.add(phone);
          } else {
            csvFake++;
            if (csvFakeSamples.length < 15) csvFakeSamples.push(phone);
          }
        }
      }
    });
  }

  console.log(`\n📄 Archivo CSV 00_CONTACTOS_REALES_ORDEN_EXACTO_WHATSAPP.csv:`);
  console.log(`  Total números en CSV: ${csvTotal}`);
  console.log(`  Móviles colombianos REALES y EXISTENTES (300-305, 310-319, 320-324, 350-351): ${csvValid}`);
  console.log(`  Móviles FALSOS/INVENTADOS (prefijos inexistentes 325-329, 352-359, etc.): ${csvFake}`);
  if (csvFakeSamples.length > 0) {
    console.log('  Ejemplos de prefijos FALSOS encontrados en el CSV:', csvFakeSamples);
  }

  // Combine DB Real Phones
  const allRealDbPhones = new Set<string>([...validDbOrderPhones, ...validDbSessionPhones]);
  console.log(`\n🎯 TOTAL REAL DE TELÉFONOS VÁLIDOS DE CLIENTES EN BASE DE DATOS: ${allRealDbPhones.size}`);

  await p.$disconnect();
}

run().catch(e => console.error(e));
