const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const p = new PrismaClient();

async function run() {
  const today = new Date('2026-08-12T00:00:00.000Z');

  // 1. Get ALL phones that received a template today (the 1,141 that were "sent" but not delivered)
  const sentToday = await p.whatsAppMessage.findMany({
    where: {
      messageType: 'template',
      direction: 'OUT',
      createdAt: { gte: today },
    },
    include: { session: { select: { phone: true } } },
  });

  const sentTodayPhones = new Set<string>();
  sentToday.forEach((m: any) => {
    const clean = (m.session?.phone || '').replace(/\D/g, '');
    const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
    if (p10.length === 10) sentTodayPhones.add(p10);
  });
  console.log(`Plantillas enviadas hoy (intentadas): ${sentToday.length}`);
  console.log(`Teléfonos únicos a los que se les envió hoy: ${sentTodayPhones.size}`);

  // 2. Get ALL phones from historical template sends (before today)
  const sentBefore = await p.whatsAppMessage.findMany({
    where: {
      messageType: 'template',
      direction: 'OUT',
      createdAt: { lt: today },
    },
    include: { session: { select: { phone: true } } },
  });

  const sentBeforePhones = new Set<string>();
  sentBefore.forEach((m: any) => {
    const clean = (m.session?.phone || '').replace(/\D/g, '');
    const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
    if (p10.length === 10) sentBeforePhones.add(p10);
  });
  console.log(`Teléfonos únicos con plantilla ANTES de hoy: ${sentBeforePhones.size}`);

  // 3. Get ALL unique phones from order history (the real contact database)
  const orders = await p.order.findMany({
    select: { customerPhone: true },
  });

  const allOrderPhones = new Set<string>();
  orders.forEach((o: any) => {
    const clean = (o.customerPhone || '').replace(/\D/g, '');
    const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
    if (p10.length === 10 && p10.startsWith('3')) allOrderPhones.add(p10);
  });

  // 4. Get ALL unique phones from WhatsApp sessions
  const sessions = await p.whatsAppSession.findMany({
    select: { phone: true },
  });

  const allSessionPhones = new Set<string>();
  sessions.forEach((s: any) => {
    const clean = (s.phone || '').replace(/\D/g, '');
    const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
    if (p10.length === 10 && p10.startsWith('3')) allSessionPhones.add(p10);
  });

  // 5. Also read the master CSV file if it exists
  const csvPath = 'C:/Users/Jose/Downloads/00_CONTACTOS_REALES_ORDEN_EXACTO_WHATSAPP.csv';
  const csvPhones = new Set<string>();
  if (fs.existsSync(csvPath)) {
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const lines = csvContent.split('\n');
    for (const line of lines) {
      const match = line.match(/(\d{10,12})/);
      if (match) {
        let num = match[1].replace(/\D/g, '');
        if (num.length === 12 && num.startsWith('57')) num = num.slice(2);
        if (num.length === 10 && num.startsWith('3')) csvPhones.add(num);
      }
    }
    console.log(`Contactos en CSV maestro: ${csvPhones.size}`);
  }

  // 6. Merge all sources into one master set
  const allContacts = new Set<string>();
  allOrderPhones.forEach(p => allContacts.add(p));
  allSessionPhones.forEach(p => allContacts.add(p));
  csvPhones.forEach(p => allContacts.add(p));
  console.log(`\nTotal contactos únicos (todas las fuentes): ${allContacts.size}`);

  // 7. All phones that ever received a template (today + before)
  const allTemplateSent = new Set<string>();
  sentTodayPhones.forEach(p => allTemplateSent.add(p));
  sentBeforePhones.forEach(p => allTemplateSent.add(p));
  console.log(`Total que ya recibieron alguna plantilla: ${allTemplateSent.size}`);

  // 8. Filter: contacts that NEVER received any template
  const neverReceived: string[] = [];
  allContacts.forEach(phone => {
    if (!allTemplateSent.has(phone)) {
      neverReceived.push(phone);
    }
  });
  console.log(`Contactos que NUNCA recibieron plantilla: ${neverReceived.length}`);

  // 9. Save the clean list
  const outputPath = 'C:/Users/Jose/Downloads/CONTACTOS_PENDIENTES_SIN_PLANTILLA.txt';
  fs.writeFileSync(outputPath, neverReceived.join('\n'), 'utf8');
  console.log(`\nArchivo guardado: ${outputPath}`);
  console.log(`Total contactos listos para enviar: ${neverReceived.length}`);

  // 10. Also save the list of those sent today (for reference)
  const todayList = Array.from(sentTodayPhones);
  const todayPath = 'C:/Users/Jose/Downloads/CONTACTOS_ENVIADOS_HOY_12AGO.txt';
  fs.writeFileSync(todayPath, todayList.join('\n'), 'utf8');
  console.log(`\nLista de enviados hoy guardada: ${todayPath} (${todayList.length} contactos)`);

  await p.$disconnect();
}

run().catch(e => console.error(e));
