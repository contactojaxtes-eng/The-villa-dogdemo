const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const p = new PrismaClient();

async function run() {
  const templateMsgs = await p.whatsAppMessage.findMany({
    where: { messageType: 'template' },
    select: { session: { select: { phone: true } } }
  });
  
  const phonesWithTemplate = new Set<string>();
  for (const m of templateMsgs) {
    const phone = m.session?.phone ? m.session.phone.replace(/\D/g, '').slice(-10) : '';
    if (phone.length === 10) phonesWithTemplate.add(phone);
  }

  const orders = await p.order.findMany({ select: { customerPhone: true } });
  const orderPhones: string[] = [];
  for (const o of orders) {
    const clean = (o.customerPhone || '').replace(/\D/g, '');
    if (clean.length >= 10 && clean.startsWith('3')) orderPhones.push(clean.slice(-10));
  }

  const sessions = await p.whatsAppSession.findMany({ select: { phone: true } });
  const sessionPhones: string[] = [];
  for (const s of sessions) {
    const clean = (s.phone || '').replace(/\D/g, '');
    if (clean.length >= 10 && clean.startsWith('3')) sessionPhones.push(clean.slice(-10));
  }

  const allRealPhones = [...new Set([...orderPhones, ...sessionPhones])];
  const pendingRealPhones = allRealPhones.filter(phone => !phonesWithTemplate.has(phone));

  const outputPath = 'C:/Users/Jose/Downloads/CLIENTES_REALES_PENDIENTES_THE VILLA DOG.txt';
  fs.writeFileSync(outputPath, pendingRealPhones.join('\n'), 'utf8');

  console.log('✅ Archivo corregido con newlines reales!');
  console.log('Total clientes reales pendientes:', pendingRealPhones.length);

  await p.$disconnect();
}

run().catch(e => console.error(e));
