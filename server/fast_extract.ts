const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const p = new PrismaClient();

function isValidColombianMobile(phone: string): boolean {
  const clean = phone.replace(/\D/g, '');
  const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
  if (p10.length !== 10) return false;
  if (!p10.startsWith('3')) return false;

  const p3Num = parseInt(p10.slice(0, 3), 10);
  if (p3Num >= 300 && p3Num <= 305) return true;
  if (p3Num >= 310 && p3Num <= 319) return true;
  if (p3Num >= 320 && p3Num <= 324) return true;
  if (p3Num >= 350 && p3Num <= 351) return true;

  return false;
}

async function run() {
  const realPhoneNumbers = new Set<string>();

  // 1. Extract from ADB phone dump (extracted from phone / msgstore)
  const adbPath = 'C:/Users/Jose/Downloads/adb_all_contacts_data.txt';
  if (fs.existsSync(adbPath)) {
    const lines = fs.readFileSync(adbPath, 'utf8').split('\n');
    for (const l of lines) {
      const match = l.match(/\b(3\d{9})\b/);
      if (match && isValidColombianMobile(match[1])) {
        realPhoneNumbers.add(match[1]);
      }
    }
  }

  // 2. Extract from The Villa Dog PostgreSQL Database (Orders & Sessions)
  const orders = await p.order.findMany({ select: { customerPhone: true } });
  orders.forEach((o: any) => {
    if (!o.customerPhone) return;
    const clean = o.customerPhone.replace(/\D/g, '');
    const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
    if (isValidColombianMobile(p10)) {
      realPhoneNumbers.add(p10);
    }
  });

  const sessions = await p.whatsAppSession.findMany({ select: { phone: true } });
  sessions.forEach((s: any) => {
    if (!s.phone) return;
    const clean = s.phone.replace(/\D/g, '');
    const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
    if (isValidColombianMobile(p10)) {
      realPhoneNumbers.add(p10);
    }
  });

  const allRealArray = Array.from(realPhoneNumbers);

  console.log('=== CONTACTOS 100% REALES EXTRAÍDOS DEL TELÉFONO / MSGSTORE Y BASE DE DATOS ===');
  console.log(`Total números reales colombianos (celular real): ${allRealArray.length}`);

  const pathFull = 'C:/Users/Jose/Downloads/BASE_DATOS_REAL_MSGSTORE_Y_SISTEMA.txt';
  fs.writeFileSync(pathFull, allRealArray.join('\n'), 'utf8');

  console.log(`\nArchivo guardado: ${pathFull}`);

  await p.$disconnect();
}

run().catch(e => console.error(e));
