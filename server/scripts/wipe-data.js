const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting data wipe...');

  // Delete transactional data
  await prisma.kitchenQueueItem.deleteMany();
  await prisma.orderItemModifier.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.orderEvent.deleteMany();
  await prisma.orderDelivery.deleteMany();
  await prisma.order.deleteMany();

  await prisma.cashClosing.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.cashRegister.deleteMany();

  // Delete customers
  await prisma.customerAddress.deleteMany();
  await prisma.customer.deleteMany();

  // Delete Inventory
  await prisma.inventoryMovement.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.recipeIngredient.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.inventoryCategory.deleteMany();

  // Delete Menu
  await prisma.modifierOption.deleteMany();
  await prisma.modifierGroup.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.menuCategory.deleteMany();

  // Delete logistics
  await prisma.deliveryZone.deleteMany();
  
  // Others
  await prisma.notification.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.waiterBadge.deleteMany();
  await prisma.waiterMetric.deleteMany();

  console.log('Wipe complete. Users, Printers and System Configs remain intact.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
