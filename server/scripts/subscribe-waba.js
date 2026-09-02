const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const settings = await prisma.appSetting.findMany({
    where: { key: { in: ['whatsapp_token'] } }
  });
  const token = settings.find(s => s.key === 'whatsapp_token')?.value;
  
  if (!token) {
    console.error('No token found in DB');
    return;
  }
  
  console.log('Token length:', token.length);
  
  // WhatsApp Business Account ID from Meta dashboard
  const wabaId = '1542344033950809';
  
  console.log(`Subscribing app to WABA ${wabaId}...`);
  
  const res = await fetch(`https://graph.facebook.com/v18.0/${wabaId}/subscribed_apps`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  
  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Response:', JSON.stringify(data, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
