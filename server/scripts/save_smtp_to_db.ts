import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = 'notificaciones@thevilladog.local';
  const pass = 'https://script.google.com/macros/s/AKfycbx1DtAMgP5tywPdgE9ki_DXK7Qd7VknpayVQdY6UplmDewm0zmPkDG4MxH8KQpbQW85kA/exec';
  const host = 'script.google.com';
  const port = '443';

  const settings = [
    { key: 'smtp_host', value: host },
    { key: 'smtp_port', value: port },
    { key: 'smtp_user', value: user },
    { key: 'smtp_pass', value: pass },
    { key: 'smtp_from', value: `The Villa Dog <${user}>` },
  ];

  for (const s of settings) {
    await prisma.appSetting.upsert({
      where: { key: s.key },
      create: s,
      update: { value: s.value },
    });
  }

  console.log('✅ Google Apps Script URL saved directly to Aiven PostgreSQL!');
  const all = await prisma.appSetting.findMany({ where: { key: { startsWith: 'smtp_' } } });
  console.log(all);
}

main().finally(() => prisma.$disconnect());
