const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const p = new PrismaClient();

function isValidColombianMobile(phone: string): boolean {
  const clean = phone.replace(/\D/g, '');
  const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
  if (p10.length !== 10) return false;
  if (!p10.startsWith('3')) return false;

  const p3Num = parseInt(p10.slice(0, 3), 10);
  
  // Strict CRC Colombia prefixes:
  // 300-305 (Tigo, Movistar, Virgin)
  // 310-319 (Claro, Movistar)
  // 320-324 (Claro, ETB)
  // 350-351 (WOM)
  if (p3Num >= 300 && p3Num <= 305) return true;
  if (p3Num >= 310 && p3Num <= 319) return true;
  if (p3Num >= 320 && p3Num <= 324) return true;
  if (p3Num >= 350 && p3Num <= 351) return true;

  return false;
}

async function run() {
  // 1. Get numbers from database orders
  const orders = await p.order.findMany({ select: { customerPhone: true } });
  // 2. Get numbers from database WhatsApp sessions
  const sessions = await p.whatsAppSession.findMany({ select: { phone: true } });
  // 3. Get template messages already sent
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

  const validRealPhones = new Set<string>();

  // Add DB orders
  orders.forEach((o: any) => {
    if (!o.customerPhone) return;
    const clean = o.customerPhone.replace(/\D/g, '');
    const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
    if (isValidColombianMobile(p10)) {
      validRealPhones.add(p10);
    }
  });

  // Add DB sessions
  sessions.forEach((s: any) => {
    if (!s.phone) return;
    const clean = s.phone.replace(/\D/g, '');
    const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
    if (isValidColombianMobile(p10)) {
      validRealPhones.add(p10);
    }
  });

  // Convert to array
  const allRealArray = Array.from(validRealPhones);

  // Filter out those already sent template
  const pendingRealArray = allRealArray.filter(p => !sentPhonesSet.has(p));

  console.log(`=== REVISION Y LIMPIEZA DE BASE DE DATOS REAL ===`);
  console.log(`Total números reales válidos en la DB de The Villa Dog: ${allRealArray.length}`);
  console.log(`Ya recibieron plantilla previamente: ${allRealArray.length - pendingRealArray.length}`);
  console.log(`Pendientes REALES por enviar (NUNCA han recibido plantilla): ${pendingRealArray.length}`);

  // Save full clean list of REAL valid phones
  const pathFull = 'C:/Users/Jose/Downloads/00_TODOS_LOS_CONTACTOS_REALES_COLOMBIA_THE VILLA DOG.txt';
  fs.writeFileSync(pathFull, allRealArray.join('\n'), 'utf8');

  // Save pending clean list of REAL valid phones
  const pathPending = 'C:/Users/Jose/Downloads/00_CONTACTOS_PENDIENTES_REALES_VERIFICADOS.txt';
  fs.writeFileSync(pathPending, pendingRealArray.join('\n'), 'utf8');

  console.log(`\nArchivos guardados correctamente en Descargas:`);
  console.log(`1. ${pathFull} (${allRealArray.length} números reales colombianos)`);
  console.log(`2. ${pathPending} (${pendingRealArray.length} números reales pendientes)`);

  await p.$disconnect();
}

run().catch(e => console.error(e));
