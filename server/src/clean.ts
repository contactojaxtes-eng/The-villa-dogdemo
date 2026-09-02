import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const defaultStocks: Record<string, number> = {
  'Queso Mozzarella': 10000,
  'Jamón': 5000,
  'Pollo Pechuga': 5000,
  'Salami': 3000,
  'Pepperoni': 2000,
  'Tocineta Ahumada': 2000,
  'Chorizo de Ternera': 100,
  'Salchicha Long': 150,
  'Salchicha Suiza Premium': 50,
  'Salchicha Ranchera': 60,
  'Butifarra': 80,
  'Carne Hamburguesa 100g': 80,
  'Lomo de Res': 5000,
  'Cerdo Magro': 5000,
  'Papa (francesa)': 20000,
  'Papa (vapor)': 15000,
  'Plátano (patacón)': 100,
  'Maíz Tierno': 3000,
  'Piña': 2000,
  'Champiñones': 1500,
  'Queso Costeño': 5000,
  'Masa de Pizza': 100,
  'Pan Hamburguesa': 80,
  'Pan Perro': 100,
  'Empaque Domicilio': 200,
  'Salsa The Villa Dog': 5000,
  'Cervecero': 80,
};

async function main() {
  console.log('🧹 Iniciando limpieza de transacciones de The Villa Dog...');

  try {
    // 1. WhatsApp messages & sessions
    console.log('- Eliminando WhatsApp messages & sessions...');
    await prisma.whatsAppMessage.deleteMany({});
    await prisma.whatsAppSession.deleteMany({});

    // 2. Notifications
    console.log('- Eliminando notificaciones...');
    await prisma.notification.deleteMany({});

    // 3. Shifts
    console.log('- Eliminando turnos (shifts)...');
    await prisma.shift.deleteMany({});

    // 4. Waiter metrics & badges
    console.log('- Eliminando waiter metrics & badges...');
    await prisma.waiterBadge.deleteMany({});
    await prisma.waiterMetric.deleteMany({});

    // 5. Expenses
    console.log('- Eliminando gastos (expenses)...');
    await prisma.expense.deleteMany({});

    // 6. Cash closings (turnos de caja)
    console.log('- Eliminando cierres de caja (cash closings)...');
    await prisma.cashClosing.deleteMany({});

    // 7. Stock movements
    console.log('- Eliminando movimientos de inventario...');
    await prisma.stockMovement.deleteMany({});

    // 8. Payments
    console.log('- Eliminando pagos...');
    await prisma.payment.deleteMany({});

    // 9. Orders & Order items
    console.log('- Eliminando pedidos (orders) y comandas...');
    await prisma.orderItem.deleteMany({});
    await prisma.order.deleteMany({});

    // 10. Restaurar stock de ingredientes
    console.log('- Restaurando stock de ingredientes...');
    for (const [name, stock] of Object.entries(defaultStocks)) {
      await prisma.ingredient.updateMany({
        where: { name },
        data: { stock },
      });
    }

    console.log('✅ Base de datos limpiada correctamente. Pedidos, turnos y gastos en 0.');
  } catch (err) {
    console.error('❌ Error durante la limpieza:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
