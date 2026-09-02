const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const p = new PrismaClient();

function isValidColombianMobile(phone: string): boolean {
  const clean = phone.replace(/\D/g, '');
  const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
  if (p10.length !== 10) return false;
  if (!p10.startsWith('3')) return false;

  const p3Num = parseInt(p10.slice(0, 3), 10);
  // Strict CRC Colombia mobile prefixes
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
    const content = fs.readFileSync(adbPath, 'utf8');
    const matches = content.match(/\b\d{10,12}\b/g) || [];
    matches.forEach(m => {
      const clean = m.replace(/\D/g, '');
      const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
      if (isValidColombianMobile(p10)) {
        realPhoneNumbers.add(p10);
      }
    });
  }

  // 2. Extract from LOTE_NUEVO_2000_SIN_REPETIR_11_AGOSTO.csv
  const lotePath = 'C:/Users/Jose/Downloads/LOTE_NUEVO_2000_SIN_REPETIR_11_AGOSTO.csv';
  if (fs.existsSync(lotePath)) {
    const content = fs.readFileSync(lotePath, 'utf8');
    const matches = content.match(/\b\d{10,12}\b/g) || [];
    matches.forEach(m => {
      const clean = m.replace(/\D/g, '');
      const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
      if (isValidColombianMobile(p10)) {
        realPhoneNumbers.add(p10);
      }
    });
  }

  // 3. Extract from The Villa Dog PostgreSQL Database (Orders & Sessions)
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

  // 4. Get all templates sent so far
  const sentTemplates = await p.whatsAppMessage.findMany({
    where: { messageType: 'template', direction: 'OUT' },
    include: { session: { select: { phone: true } } }
  });

  const sentPhonesSet = new Set<string>();
  sentTemplates.forEach((m: any) => {
    const clean = (m.session?.phone || '').replace(/\D/g, '');
    const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
    if (p10.length === 10) sentPhonesSet.add(p10);
  });

  const allRealArray = Array.from(realPhoneNumbers);
  const pendingRealArray = allRealArray.filter(p => !sentPhonesSet.has(p));

  console.log('=== CONTACTOS 100% EXTRAÍDOS DEL CELULAR / MSGSTORE + BASE DE DATOS ===');
  console.log(`Total contactos reales verificados: ${allRealArray.length}`);
  console.log(`Contactos que ya recibieron plantilla: ${allRealArray.length - pendingRealArray.length}`);
  console.log(`Contactos pendientes por enviar: ${pendingRealArray.length}`);

  const pathFull = 'C:/Users/Jose/Downloads/BASE_DATOS_REAL_MSGSTORE_Y_SISTEMA.txt';
  fs.writeFileSync(pathFull, allRealArray.join('\n'), 'utf8');

  const pathPending = 'C:/Users/Jose/Downloads/PENDIENTES_REALES_MSGSTORE_Y_SISTEMA.txt';
  fs.writeFileSync(pathPending, pendingRealArray.join('\n'), 'utf8');

  console.log(`\nArchivos guardados en Descargas:`);
  console.log(`- ${pathFull}`);
  console.log(`- ${pathPending}`);

  await p.$disconnect();
}

run().catch(e => console.error(e));
