import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, 'backups', `backup_whatsapp_${timestamp}`);
  
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`\n========================================`);
  console.log(`CREATING WHATSAPP DATA BACKUP IN:`);
  console.log(backupDir);
  console.log(`========================================\n`);

  // 1. Export WhatsApp Sessions
  console.log('1. Exporting whatsapp_sessions...');
  const sessions = await prisma.whatsAppSession.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      assignedTo: {
        select: { id: true, name: true, email: true, role: true }
      }
    }
  });
  fs.writeFileSync(
    path.join(backupDir, 'whatsapp_sessions.json'),
    JSON.stringify(sessions, null, 2),
    'utf8'
  );
  console.log(`   ✓ Exported ${sessions.length} sessions`);

  // 2. Export WhatsApp Messages
  console.log('2. Exporting whatsapp_messages...');
  const messages = await prisma.whatsAppMessage.findMany({
    orderBy: { createdAt: 'asc' }
  });
  fs.writeFileSync(
    path.join(backupDir, 'whatsapp_messages.json'),
    JSON.stringify(messages, null, 2),
    'utf8'
  );
  console.log(`   ✓ Exported ${messages.length} messages`);

  // 3. Export App Settings
  console.log('3. Exporting app_settings...');
  const settings = await prisma.appSetting.findMany({
    orderBy: { key: 'asc' }
  });
  fs.writeFileSync(
    path.join(backupDir, 'app_settings.json'),
    JSON.stringify(settings, null, 2),
    'utf8'
  );
  console.log(`   ✓ Exported ${settings.length} app settings`);

  // 4. Export Customers
  console.log('4. Exporting customers...');
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: 'asc' }
  });
  fs.writeFileSync(
    path.join(backupDir, 'customers.json'),
    JSON.stringify(customers, null, 2),
    'utf8'
  );
  console.log(`   ✓ Exported ${customers.length} customers`);

  // 5. Unified Consolidated Snapshot
  console.log('5. Creating consolidated full backup bundle...');
  const consolidated = {
    metadata: {
      generatedAt: new Date().toISOString(),
      timestamp,
      counts: {
        sessions: sessions.length,
        messages: messages.length,
        settings: settings.length,
        customers: customers.length
      }
    },
    sessions,
    messages,
    settings,
    customers
  };

  fs.writeFileSync(
    path.join(backupDir, 'whatsapp_full_backup.json'),
    JSON.stringify(consolidated, null, 2),
    'utf8'
  );

  // Also save a latest copy in server root backups directory
  const rootLatestDir = path.join(__dirname, 'backups', 'latest');
  if (!fs.existsSync(rootLatestDir)) {
    fs.mkdirSync(rootLatestDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(rootLatestDir, 'whatsapp_full_backup.json'),
    JSON.stringify(consolidated, null, 2),
    'utf8'
  );

  console.log(`\n========================================`);
  console.log(`BACKUP COMPLETED SUCCESSFULLY!`);
  console.log(`- Sessions: ${sessions.length}`);
  console.log(`- Messages: ${messages.length}`);
  console.log(`- Settings: ${settings.length}`);
  console.log(`- Customers: ${customers.length}`);
  console.log(`Files saved at: ${backupDir}`);
  console.log(`========================================\n`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
