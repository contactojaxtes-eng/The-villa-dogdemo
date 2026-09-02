const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting DB wipe via TRUNCATE CASCADE...');
  
  const tablesToWipe = [
    'orders',
    'order_items',
    'payments',
    'recipes',
    'menu_categories',
    'ingredients',
    'delivery_zones',
    'expense_categories',
    'recipe_ingredients',
    'stock_movements',
    'cash_closings',
    'shifts',
    'notifications',
    'whatsapp_messages',
    'whatsapp_sessions',
    'expenses',
    'waiter_metrics',
    'suppliers',
    'purchases',
    'purchase_items',
    'cola_impresion',
    'customers',
    '"CustomerPayment"',
    'menu_items',
    'delivery_drivers',
    'audit_logs',
    'error_logs'
  ];

  for (const table of tablesToWipe) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${table} CASCADE;`);
      console.log(`Wiped ${table}`);
    } catch (e) {
      console.error(`Failed to wipe ${table}:`, e.message);
    }
  }

  console.log('Wipe complete. Users, Cash Registers and Configs kept.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
