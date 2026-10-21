import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { DEFAULT_ROLE_PERMISSIONS } from './auth/permissions.constant';
import {
  DEFAULT_ORGANIZATION,
  DEFAULT_SITE,
  DEFAULT_SITE_ID,
} from './common/multisite.constants';

// ============================================================================
// GUARDAS DE SEGURIDAD OBLIGATORIAS
// ============================================================================
if (process.env.APP_ENV !== 'demo') {
  console.error('⛔ SEGURIDAD: demo-seed abortado. APP_ENV no es "demo".');
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL || '';
if (!dbUrl.toLowerCase().includes('demo')) {
  console.error('⛔ SEGURIDAD: demo-seed abortado. DATABASE_URL no apunta a una base con "demo" en su nombre.');
  process.exit(1);
}

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.DEMO_USERS_PASSWORD || 'demo1234';

// 1. Catálogo de Roles del Sistema
const roleCatalog = [
  { code: 'SUPERADMIN', name: 'Super Administrador', color: '#7A1F2B', icon: 'Crown', isSystem: true },
  { code: 'ADMIN', name: 'Administrador Demo', color: '#F97316', icon: 'ShieldCheck', isSystem: true },
  { code: 'CASHIER', name: 'Cajero Demo', color: '#FBBF24', icon: 'Wallet', isSystem: true },
  { code: 'DELIVERY_MANAGER', name: 'Gestor Domicilios Demo', color: '#8B5CF6', icon: 'MessageCircle', isSystem: true },
  { code: 'DISPATCHER', name: 'Despachador Demo', color: '#0EA5E9', icon: 'Bike', isSystem: true },
  { code: 'WAITER', name: 'Mesero Demo', color: '#3B82F6', icon: 'UtensilsCrossed', isSystem: true },
  { code: 'KITCHEN', name: 'Cocinero Demo', color: '#10B981', icon: 'ChefHat', isSystem: true },
];

// 2. Usuarios 100% Sintéticos para la Demostración
const demoUsers = [
  {
    email: 'admin@demo.local',
    name: 'Administrador Demo',
    role: 'ADMIN',
    isOrganizationAdmin: true,
    phone: '3000000001',
  },
  {
    email: 'cajero@demo.local',
    name: 'Cajero Demo',
    role: 'CASHIER',
    isOrganizationAdmin: false,
    phone: '3000000002',
  },
  {
    email: 'mesero@demo.local',
    name: 'Mesero Demo',
    role: 'WAITER',
    isOrganizationAdmin: false,
    phone: '3000000003',
  },
  {
    email: 'cocina@demo.local',
    name: 'Cocinero Demo',
    role: 'KITCHEN',
    isOrganizationAdmin: false,
    phone: '3000000004',
  },
  {
    email: 'domicilios@demo.local',
    name: 'Gestor Domicilios Demo',
    role: 'DELIVERY_MANAGER',
    isOrganizationAdmin: false,
    phone: '3000000005',
  },
];

// 3. Menú y Productos Ficticios
const demoMenuData = [
  {
    name: 'Perros Calientes',
    description: 'Especialidades clásicas y gratinadas de la casa',
    sortOrder: 1,
    items: [
      { name: 'Perro Clásico Demo', price: 12000, code: 'PER-001', sortOrder: 1, prepTime: 8 },
      { name: 'Perro Especial Gratinado Demo', price: 16000, code: 'PER-002', sortOrder: 2, prepTime: 10 },
      { name: 'Perro Suizo Doble Salchicha Demo', price: 19000, code: 'PER-003', sortOrder: 3, prepTime: 12 },
    ],
  },
  {
    name: 'Hamburguesas Artesanales',
    description: 'Carnes premium con queso y tocineta',
    sortOrder: 2,
    items: [
      { name: 'Hamburguesa Clásica Demo', price: 18000, code: 'HAM-001', sortOrder: 1, prepTime: 12 },
      { name: 'Hamburguesa BBQ Crispy Bacon Demo', price: 22000, code: 'HAM-002', sortOrder: 2, prepTime: 15 },
      { name: 'Hamburguesa Doble Carne Especial Demo', price: 26000, code: 'HAM-003', sortOrder: 3, prepTime: 15 },
    ],
  },
  {
    name: 'Bebidas y Gaseosas',
    description: 'Refrescantes bebidas y jugos naturales',
    sortOrder: 3,
    items: [
      { name: 'Gaseosa Personal 400ml Demo', price: 4500, code: 'BEB-001', sortOrder: 1, prepTime: 2 },
      { name: 'Jugo Natural en Agua Demo', price: 6000, code: 'BEB-002', sortOrder: 2, prepTime: 5 },
      { name: 'Cerveza Club Colombia Demo', price: 7000, code: 'BEB-003', sortOrder: 3, prepTime: 2 },
    ],
  },
  {
    name: 'Acompañamientos y Adiciones',
    description: 'Porciones adicionales para compartir',
    sortOrder: 4,
    items: [
      { name: 'Papas a la Francesa Demo', price: 8000, code: 'ADI-001', sortOrder: 1, prepTime: 8 },
      { name: 'Aros de Cebolla Crocantes Demo', price: 9000, code: 'ADI-002', sortOrder: 2, prepTime: 8 },
    ],
  },
];

// 4. Zonas de Entrega de Demostración
const demoZones = [
  { name: 'Zona Centro Demo', zoneGroup: 'Centro', rate: 3000, siteId: DEFAULT_SITE_ID },
  { name: 'Barrio El Recreo Demo', zoneGroup: 'Centro', rate: 3500, siteId: DEFAULT_SITE_ID },
  { name: 'Barrio La Castellana Demo', zoneGroup: 'Norte', rate: 4500, siteId: DEFAULT_SITE_ID },
  { name: 'Barrio Los Laureles Demo', zoneGroup: 'Sur', rate: 4500, siteId: DEFAULT_SITE_ID },
  { name: 'Barrio La Pradera Demo', zoneGroup: 'Oriente', rate: 5000, siteId: DEFAULT_SITE_ID },
];

export async function runDemoSeed() {
  console.log('🚀 Iniciando siembra sintética para Entorno Demo...');

  // 1. Asegurar Organización y Sede
  await prisma.organization.upsert({
    where: { id: DEFAULT_ORGANIZATION.id },
    create: {
      ...DEFAULT_ORGANIZATION,
      active: true,
    },
    update: { active: true },
  });

  await prisma.site.upsert({
    where: { id: DEFAULT_SITE.id },
    create: {
      ...DEFAULT_SITE,
      name: 'Sede Principal (Demostración)',
      active: true,
      isDefault: true,
    },
    update: {
      name: 'Sede Principal (Demostración)',
      active: true,
      isDefault: true,
    },
  });
  console.log('✅ Organización y Sede Principal Demo verificadas.');

  // 2. Roles del Sistema
  for (const role of roleCatalog) {
    await prisma.customRole.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        color: role.color,
        icon: role.icon,
        permissions: DEFAULT_ROLE_PERMISSIONS[role.code] || [],
        isSystem: role.isSystem,
        active: true,
      },
      create: {
        ...role,
        permissions: DEFAULT_ROLE_PERMISSIONS[role.code] || [],
        active: true,
      },
    });
  }
  console.log('✅ Roles demo configurados.');

  // 3. Crear Usuarios Demo
  const createdUsers: Record<string, any> = {};
  const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const user of demoUsers) {
    const created = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        password: hashedPassword,
        role: user.role,
        isOrganizationAdmin: user.isOrganizationAdmin,
        phone: user.phone,
        active: true,
        permissions: DEFAULT_ROLE_PERMISSIONS[user.role] || [],
        mustVerifyEmail: false,
        emailVerified: true,
        lastActiveSiteId: DEFAULT_SITE_ID,
      },
      create: {
        name: user.name,
        email: user.email,
        password: hashedPassword,
        role: user.role,
        isOrganizationAdmin: user.isOrganizationAdmin,
        phone: user.phone,
        active: true,
        permissions: DEFAULT_ROLE_PERMISSIONS[user.role] || [],
        mustVerifyEmail: false,
        emailVerified: true,
        lastActiveSiteId: DEFAULT_SITE_ID,
      },
    });

    await prisma.userSiteMembership.upsert({
      where: {
        userId_siteId: {
          userId: created.id,
          siteId: DEFAULT_SITE_ID,
        },
      },
      update: {
        role: user.role,
        permissions: DEFAULT_ROLE_PERMISSIONS[user.role] || [],
        active: true,
        isDefault: true,
      },
      create: {
        userId: created.id,
        siteId: DEFAULT_SITE_ID,
        role: user.role,
        permissions: DEFAULT_ROLE_PERMISSIONS[user.role] || [],
        active: true,
        isDefault: true,
      },
    });

    createdUsers[user.role] = created;
  }
  console.log('✅ Usuarios Demo creados con contraseñas seguras.');

  // 4. Zonas de Entrega
  await prisma.deliveryZone.deleteMany({ where: { siteId: DEFAULT_SITE_ID } });
  for (const zone of demoZones) {
    await prisma.deliveryZone.create({ data: zone });
  }
  const createdZones = await prisma.deliveryZone.findMany({ where: { siteId: DEFAULT_SITE_ID } });
  console.log(`✅ ${createdZones.length} Zonas de entrega registradas.`);

  // 5. Categorías y Productos
  await prisma.menuItem.deleteMany({ where: { siteId: DEFAULT_SITE_ID } });
  await prisma.menuCategory.deleteMany({ where: { siteId: DEFAULT_SITE_ID } });

  const createdCategories: any[] = [];
  const createdMenuItems: any[] = [];

  for (const cat of demoMenuData) {
    const createdCat = await prisma.menuCategory.create({
      data: {
        name: cat.name,
        description: cat.description,
        sortOrder: cat.sortOrder,
        active: true,
        siteId: DEFAULT_SITE_ID,
      },
    });
    createdCategories.push(createdCat);

    for (const item of cat.items) {
      const createdItem = await prisma.menuItem.create({
        data: {
          name: item.name,
          code: item.code,
          price: item.price,
          sortOrder: item.sortOrder,
          categoryId: createdCat.id,
          active: true,
          type: 'NORMAL',
          prepTime: item.prepTime,
          siteId: DEFAULT_SITE_ID,
        },
      });
      createdMenuItems.push(createdItem);
    }
  }
  console.log(`✅ Menú Demo creado: ${createdCategories.length} categorías y ${createdMenuItems.length} productos.`);

  // 6. Estaciones de Cocina
  await prisma.kitchenStation.deleteMany({ where: { siteId: DEFAULT_SITE_ID } });
  const catPerros = createdCategories.find(c => c.name.includes('Perros'));
  const catHamburguesas = createdCategories.find(c => c.name.includes('Hamburguesas'));
  const kitchenUser = createdUsers['KITCHEN'];

  const stationsData = [
    {
      name: 'Estación Perros Calientes (Demo)',
      color: '#EF4444',
      priority: 1,
      categories: catPerros ? [catPerros.id] : [],
    },
    {
      name: 'Estación Hamburguesas (Demo)',
      color: '#F97316',
      priority: 2,
      categories: catHamburguesas ? [catHamburguesas.id] : [],
    },
    {
      name: 'Cocina General (Demo)',
      color: '#10B981',
      priority: 3,
      categories: createdCategories.map(c => c.id),
    },
  ];

  const createdStations: any[] = [];
  for (const s of stationsData) {
    const st = await prisma.kitchenStation.create({
      data: {
        name: s.name,
        color: s.color,
        priority: s.priority,
        active: true,
        siteId: DEFAULT_SITE_ID,
        categories: { connect: s.categories.map(id => ({ id })) },
        users: kitchenUser ? { connect: [{ id: kitchenUser.id }] } : undefined,
      },
    });
    createdStations.push(st);
  }
  console.log(`✅ ${createdStations.length} Estaciones de cocina demo creadas.`);

  // 7. Caja Registradora y Turno Abierto (para demostración de cobro)
  await prisma.cashRegister.deleteMany({ where: { siteId: DEFAULT_SITE_ID } });
  const register = await prisma.cashRegister.create({
    data: {
      name: 'Caja Salón Demo',
      description: 'Caja principal para demostración',
      purpose: 'DINING',
      siteId: DEFAULT_SITE_ID,
      managerId: createdUsers['ADMIN']?.id,
      active: true,
    },
  });

  const shiftStart = new Date();
  shiftStart.setHours(shiftStart.getHours() - 3);

  const activeClosing = await prisma.cashClosing.create({
    data: {
      siteId: DEFAULT_SITE_ID,
      cashRegisterId: register.id,
      userId: createdUsers['CASHIER']?.id || createdUsers['ADMIN']?.id,
      shiftStart,
      initialCash: 150000,
      isOpen: true,
      notes: 'Turno de demostración abierto para pruebas',
    },
  });
  console.log('✅ Caja Registradora y Turno Abierto configurados.');

  // 8. Mesas de Salón
  await prisma.diningTable.deleteMany({ where: { siteId: DEFAULT_SITE_ID } });
  const tableData = [
    { label: 'Mesa 1', status: 'OPEN' },
    { label: 'Mesa 2', status: 'OPEN' },
    { label: 'Mesa 3', status: 'OPEN' },
    { label: 'Mesa 4', status: 'OPEN' },
    { label: 'Mesa 5', status: 'OPEN' },
    { label: 'Mesa 6', status: 'OPEN' },
  ];

  const createdTables: any[] = [];
  for (const t of tableData) {
    const table = await prisma.diningTable.create({
      data: {
        label: t.label,
        status: t.status,
        siteId: DEFAULT_SITE_ID,
        openedById: createdUsers['WAITER']?.id || createdUsers['ADMIN']?.id,
        cashRegisterId: register.id,
        cashClosingId: activeClosing.id,
      },
    });
    createdTables.push(table);
  }
  console.log(`✅ ${createdTables.length} Mesas registradas.`);

  // 9. Clientes Ficticios
  await prisma.customer.deleteMany({ where: { siteId: DEFAULT_SITE_ID } });
  const demoCustomersData = [
    { name: 'Cliente Ejemplo 01', phone: '3000000001', address: 'Calle 10 # 20-30, Barrio El Recreo' },
    { name: 'Cliente Ejemplo 02', phone: '3000000002', address: 'Cra 6 # 45-12, Barrio La Castellana' },
    { name: 'Cliente Ejemplo 03', phone: '3000000003', address: 'Calle 24 # 15-40, Barrio Centro' },
  ];

  const createdCustomers: any[] = [];
  for (const c of demoCustomersData) {
    const customer = await prisma.customer.create({
      data: { ...c, siteId: DEFAULT_SITE_ID },
    });
    createdCustomers.push(customer);
  }
  console.log(`✅ ${createdCustomers.length} Clientes sintéticos creados.`);

  // 10. Ventas Históricas de Demostración (para gráficos de Dashboard)
  const waiterId = createdUsers['WAITER']?.id || createdUsers['ADMIN']?.id;
  const cashierId = createdUsers['CASHIER']?.id || createdUsers['ADMIN']?.id;

  const now = new Date();
  for (let i = 1; i <= 12; i++) {
    const pastTime = new Date(now.getTime() - (i * 3.5 * 3600 * 1000));
    const isCash = i % 2 === 0;
    const total = 28000 + (i * 4500);

    const histOrder = await prisma.order.create({
      data: {
        orderNumber: 1000 + i,
        invoiceNumber: 1000 + i,
        customerAddress: demoCustomersData[(i - 1) % 3].address,
        orderType: i % 3 === 0 ? 'DELIVERY' : 'DINING',
        status: 'DELIVERED',
        kitchenStatus: 'SERVED',
        total,
        subtotal: total,
        paymentMethod: isCash ? 'CASH' : 'TRANSFER',
        paymentStatus: 'PAID',
        cashAmount: isCash ? total : 0,
        transferAmount: isCash ? 0 : total,
        siteId: DEFAULT_SITE_ID,
        waiterId,
        cashRegisterId: register.id,
        cashClosingId: activeClosing.id,
        createdAt: pastTime,
        updatedAt: pastTime,
        sentToKitchenAt: pastTime,
        servedAt: pastTime,
        customerName: demoCustomersData[(i - 1) % 3].name,
        customerPhone: demoCustomersData[(i - 1) % 3].phone,
      },
    });

    const item1 = createdMenuItems[(i * 2) % createdMenuItems.length];
    const item2 = createdMenuItems[(i * 3 + 1) % createdMenuItems.length];

    await prisma.orderItem.createMany({
      data: [
        {
          orderId: histOrder.id,
          menuItemId: item1.id,
          quantity: 1,
          unitPrice: item1.price,
          totalPrice: item1.price,
        },
        {
          orderId: histOrder.id,
          menuItemId: item2.id,
          quantity: 1,
          unitPrice: item2.price,
          totalPrice: item2.price,
        },
      ],
    });

    await prisma.payment.create({
      data: {
        orderId: histOrder.id,
        amount: total,
        method: isCash ? 'CASH' : 'TRANSFER',
        cashAmount: isCash ? total : 0,
        transferAmount: isCash ? 0 : total,
        status: 'CONFIRMED',
        confirmedBy: cashierId,
        confirmedAt: pastTime,
        createdAt: pastTime,
      },
    });
  }
  console.log('✅ 12 Pedidos históricos creados con métricas para Dashboard.');

  // 11. Pedido 1: En Cocina (Para demostrar vista de Cocina y KDS)
  const kitchenOrderTime = new Date(now.getTime() - 8 * 60 * 1000);
  const p1 = createdMenuItems.find(m => m.code === 'PER-002') || createdMenuItems[0];
  const p2 = createdMenuItems.find(m => m.code === 'HAM-001') || createdMenuItems[1];
  const p3 = createdMenuItems.find(m => m.code === 'BEB-001') || createdMenuItems[2];

  const orderCocina = await prisma.order.create({
    data: {
      orderNumber: 201,
      customerAddress: 'Mesa 1 (Salón)',
      orderType: 'DINING',
      status: 'CONFIRMED',
      kitchenStatus: 'IN_PREPARATION',
      total: p1.price + p2.price + (p3.price * 2),
      subtotal: p1.price + p2.price + (p3.price * 2),
      paymentMethod: 'CASH',
      paymentStatus: 'PENDING',
      siteId: DEFAULT_SITE_ID,
      waiterId,
      tableId: createdTables[0]?.id,
      cashRegisterId: register.id,
      cashClosingId: activeClosing.id,
      sentToKitchenAt: kitchenOrderTime,
      createdAt: kitchenOrderTime,
      customerName: 'Mesa 1 (Demostración)',
      customerPhone: '3000000000',
    },
  });

  const itemOrder1 = await prisma.orderItem.create({
    data: {
      orderId: orderCocina.id,
      menuItemId: p1.id,
      quantity: 1,
      unitPrice: p1.price,
      totalPrice: p1.price,
      notes: 'Sin cebolla, bien tostado',
    },
  });

  const itemOrder2 = await prisma.orderItem.create({
    data: {
      orderId: orderCocina.id,
      menuItemId: p2.id,
      quantity: 1,
      unitPrice: p2.price,
      totalPrice: p2.price,
      notes: 'Término medio',
    },
  });

  const itemOrder3 = await prisma.orderItem.create({
    data: {
      orderId: orderCocina.id,
      menuItemId: p3.id,
      quantity: 2,
      unitPrice: p3.price,
      totalPrice: p3.price * 2,
      notes: 'Bien frías',
    },
  });

  // Ticket para Estación de Perros
  const stPerros = createdStations.find(s => s.name.includes('Perros')) || createdStations[0];
  const ticketPerros = await prisma.kitchenTicket.create({
    data: {
      orderId: orderCocina.id,
      tableId: createdTables[0]?.id,
      stationId: stPerros.id,
      status: 'NEW',
      siteId: DEFAULT_SITE_ID,
      createdAt: kitchenOrderTime,
    },
  });
  await prisma.kitchenTicketItem.create({
    data: {
      ticketId: ticketPerros.id,
      orderItemId: itemOrder1.id,
      menuItemId: p1.id,
      quantity: 1,
      nameSnapshot: p1.name,
      notes: 'Sin cebolla, bien tostado',
    },
  });

  // Ticket para Estación de Hamburguesas
  const stHamburguesas = createdStations.find(s => s.name.includes('Hamburguesas')) || createdStations[1] || createdStations[0];
  const ticketHam = await prisma.kitchenTicket.create({
    data: {
      orderId: orderCocina.id,
      tableId: createdTables[0]?.id,
      stationId: stHamburguesas.id,
      status: 'NEW',
      siteId: DEFAULT_SITE_ID,
      createdAt: kitchenOrderTime,
    },
  });
  await prisma.kitchenTicketItem.create({
    data: {
      ticketId: ticketHam.id,
      orderItemId: itemOrder2.id,
      menuItemId: p2.id,
      quantity: 1,
      nameSnapshot: p2.name,
      notes: 'Término medio',
    },
  });
  console.log('✅ Pedido #201 activo en Cocina con tickets en estaciones.');

  // 12. Pedido 2: Listo para Cobrar en Caja
  const readyOrderTime = new Date(now.getTime() - 18 * 60 * 1000);
  const p4 = createdMenuItems.find(m => m.code === 'HAM-002') || createdMenuItems[0];
  const p5 = createdMenuItems.find(m => m.code === 'ADI-001') || createdMenuItems[1];

  const orderReady = await prisma.order.create({
    data: {
      orderNumber: 202,
      customerAddress: 'Mesa 4 (Salón)',
      orderType: 'DINING',
      status: 'CONFIRMED',
      kitchenStatus: 'READY',
      total: p4.price + p5.price,
      subtotal: p4.price + p5.price,
      paymentMethod: 'CASH',
      paymentStatus: 'PENDING',
      siteId: DEFAULT_SITE_ID,
      waiterId,
      tableId: createdTables[3]?.id,
      cashRegisterId: register.id,
      cashClosingId: activeClosing.id,
      sentToKitchenAt: readyOrderTime,
      servedAt: new Date(now.getTime() - 2 * 60 * 1000),
      createdAt: readyOrderTime,
      customerName: 'Mesa 4 (Demostración)',
      customerPhone: '3000000000',
    },
  });

  await prisma.orderItem.createMany({
    data: [
      {
        orderId: orderReady.id,
        menuItemId: p4.id,
        quantity: 1,
        unitPrice: p4.price,
        totalPrice: p4.price,
      },
      {
        orderId: orderReady.id,
        menuItemId: p5.id,
        quantity: 1,
        unitPrice: p5.price,
        totalPrice: p5.price,
      },
    ],
  });
  console.log('✅ Pedido #202 Listo para Cobro en Caja registrado.');

  // 13. Pedido 3: Domicilio Ficticio
  const deliveryTime = new Date(now.getTime() - 12 * 60 * 1000);
  const p6 = createdMenuItems.find(m => m.code === 'PER-003') || createdMenuItems[0];
  const deliveryZone = createdZones[1] || createdZones[0];

  const orderDelivery = await prisma.order.create({
    data: {
      orderNumber: 203,
      customerAddress: createdCustomers[0]?.address || 'Calle 10 # 20-30, Barrio El Recreo',
      orderType: 'DELIVERY',
      status: 'CONFIRMED',
      kitchenStatus: 'IN_PREPARATION',
      total: p6.price + deliveryZone.rate,
      subtotal: p6.price,
      deliveryFee: deliveryZone.rate,
      paymentMethod: 'TRANSFER',
      paymentStatus: 'PENDING',
      siteId: DEFAULT_SITE_ID,
      waiterId,
      zoneId: deliveryZone.id,
      customerId: createdCustomers[0]?.id,
      cashRegisterId: register.id,
      cashClosingId: activeClosing.id,
      sentToKitchenAt: deliveryTime,
      createdAt: deliveryTime,
      customerName: createdCustomers[0]?.name || 'Cliente Ejemplo 01',
      customerPhone: createdCustomers[0]?.phone || '3000000001',
    },
  });

  await prisma.orderItem.create({
    data: {
      orderId: orderDelivery.id,
      menuItemId: p6.id,
      quantity: 1,
      unitPrice: p6.price,
      totalPrice: p6.price,
      notes: 'Timbrar al portón negro',
    },
  });
  console.log('✅ Pedido #203 Domicilio ficticio registrado.');

  console.log('\n========================================================');
  console.log('🎉 ¡SIEMBRA DE DATOS SINTÉTICOS COMPLETADA CON ÉXITO!');
  console.log('========================================================');
  console.log('Credenciales de acceso para la demostración:');
  console.log(`- Admin:       admin@demo.local       (Clave: ${DEMO_PASSWORD})`);
  console.log(`- Cajero:      cajero@demo.local      (Clave: ${DEMO_PASSWORD})`);
  console.log(`- Mesero:      mesero@demo.local      (Clave: ${DEMO_PASSWORD})`);
  console.log(`- Cocinero:    cocina@demo.local      (Clave: ${DEMO_PASSWORD})`);
  console.log(`- Domicilios:  domicilios@demo.local  (Clave: ${DEMO_PASSWORD})`);
  console.log('========================================================\n');
}

if (require.main === module) {
  runDemoSeed()
    .catch(err => {
      console.error('Error durante la siembra demo:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
