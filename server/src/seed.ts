import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { DEFAULT_ROLE_PERMISSIONS } from './auth/permissions.constant';

if (process.env.NODE_ENV === 'production' && process.env.BOOTSTRAP_CURRENT_USERS !== 'true') {
  throw new Error('Para inicializar la base nueva con los usuarios actuales, establece BOOTSTRAP_CURRENT_USERS=true una sola vez.');
}

const prisma = new PrismaClient();

// 1. Usuarios solicitados por el cliente
const initialUsers = [
  // SuperAdmin y Admin
  { email: 'admin@thevilladog.local', name: 'Super Administrador', role: 'SUPERADMIN', password: '1234', phone: '3000000001' },
  { email: 'adminv@thevilladog.local', name: 'Administrador Principal', role: 'ADMIN', password: '123456', phone: '3000000002' },

  // Meseros / Meseras
  { email: 'daniela@thevilladog.local', name: 'Daniela', role: 'WAITER', password: 'daniela', phone: '3001110001' },
  { email: 'jhoana@thevilladog.local', name: 'Jhoana', role: 'WAITER', password: '1234', phone: '3001110002' },
  { email: 'karol@thevilladog.local', name: 'Karol', role: 'WAITER', password: '1234', phone: '3001110003' },
  { email: 'liliana@thevilladog.local', name: 'Liliana', role: 'WAITER', password: 'liliana', phone: '3001110004' },
  { email: 'rosa@thevilladog.local', name: 'Rosa', role: 'WAITER', password: 'rosa', phone: '3001110005' },
  { email: 'shelly@thevilladog.local', name: 'Shelly', role: 'WAITER', password: 'shelly', phone: '3001110006' },
  { email: 'prueba@thevilladog.local', name: 'Prueba Mesero', role: 'WAITER', password: '1234', phone: '3001110007' },

  // Cocineros (Por Estación)
  { email: 'jose@thevilladog.local', name: 'Jose (Perros Salón)', role: 'KITCHEN', password: 'jose', phone: '3002220001' },
  { email: 'juan@thevilladog.local', name: 'Juan (Perros Salón)', role: 'KITCHEN', password: 'juan', phone: '3002220002' },
  { email: 'terry@thevilladog.local', name: 'Terry (Hamburguesas Salón)', role: 'KITCHEN', password: 'terry', phone: '3002220003' },
  { email: 'pruebap@thevilladog.local', name: 'Prueba Perros (Domicilios)', role: 'KITCHEN', password: '1234', phone: '3002220004' },
  { email: 'pruebah@thevilladog.local', name: 'Prueba Hamburguesas (Domicilios)', role: 'KITCHEN', password: '1234', phone: '3002220005' },
  { email: 'admin_cocina@thevilladog.local', name: 'Admin Cocina General', role: 'KITCHEN', password: '123456', phone: '3002220006' },
  { email: 'pedro@thevilladog.local', name: 'Pedro (Perros Calientes)', role: 'KITCHEN', password: '123456', phone: '3002220007' },
  { email: 'hamburguesas@thevilladog.local', name: 'Cocinero Hamburguesas', role: 'KITCHEN', password: '123456', phone: '3002220008' },

  // Gestores de Pedidos / Domicilios
  { email: 'camila@thevilladog.local', name: 'Camila', role: 'DELIVERY_MANAGER', password: 'camila', phone: '3003330001' },
  { email: 'yanet@thevilladog.local', name: 'Yanet', role: 'DELIVERY_MANAGER', password: 'yanet', phone: '3003330002' },
  { email: 'juliana@thevilladog.local', name: 'Juliana', role: 'DELIVERY_MANAGER', password: 'juliana', phone: '3003330003' },
  { email: 'laura@thevilladog.local', name: 'Laura', role: 'DELIVERY_MANAGER', password: 'laura', phone: '3003330004' },
  { email: 'josed@thevilladog.local', name: 'Jose D.', role: 'DELIVERY_MANAGER', password: 'josed', phone: '3003330005' },
];

// 2. Categorías del Menú
const menuCategoriesData = [
  {
    name: 'Perros Calientes',
    description: 'Deliciosos perros calientes tradicionales y especiales',
    sortOrder: 1,
    items: [
      { name: 'Perro Sencillo', price: 3500, code: 'PER-001', sortOrder: 1 },
      { name: 'Perro Gratinado', price: 4500, code: 'PER-002', sortOrder: 2 },
      { name: 'Perro Doble Salchicha', price: 5000, code: 'PER-003', sortOrder: 3 },
      { name: 'Perro Sencillo Doble Salchicha', price: 5000, code: 'PER-004', sortOrder: 4 },
      { name: 'Perro Doble Salchicha Gratinado', price: 6000, code: 'PER-005', sortOrder: 5 },
      { name: 'Perro Gratinado Doble Salchicha', price: 6000, code: 'PER-006', sortOrder: 6 },
      { name: 'Perro Especial', price: 7000, code: 'PER-007', sortOrder: 7 },
      { name: 'Perro Especial Doble Salchicha', price: 7000, code: 'PER-008', sortOrder: 8 },
    ],
  },
  {
    name: 'Hamburguesas',
    description: 'Hamburguesas artesanales con el mejor sabor',
    sortOrder: 2,
    items: [
      { name: 'Hamburguesa Sencilla', price: 5000, code: 'HAM-001', sortOrder: 1 },
      { name: 'Hamburguesa Gratinada', price: 6000, code: 'HAM-002', sortOrder: 2 },
      { name: 'Hamburguesa Doble', price: 7000, code: 'HAM-003', sortOrder: 3 },
      { name: 'Hamburguesa Especial', price: 7000, code: 'HAM-004', sortOrder: 4 },
      { name: 'Hamburguesa Doble Gratinada', price: 8000, code: 'HAM-005', sortOrder: 5 },
      { name: 'Hamburguesa Especial Doble Carne', price: 9000, code: 'HAM-006', sortOrder: 6 },
    ],
  },
  {
    name: 'Gaseosas y Bebidas',
    description: 'Bebidas personales, plásticas y familiares',
    sortOrder: 3,
    items: [
      { name: 'Coca Cola Vidrio 250 ml', price: 2500, code: 'BEB-001', sortOrder: 1 },
      { name: 'Colombiana Vidrio 250 ml', price: 2500, code: 'BEB-002', sortOrder: 2 },
      { name: 'Manzana Vidrio 250 ml', price: 2500, code: 'BEB-003', sortOrder: 3 },
      { name: 'Uva Vidrio 250 ml', price: 2500, code: 'BEB-004', sortOrder: 4 },
      { name: 'Naranjada Vidrio 250 ml', price: 2500, code: 'BEB-005', sortOrder: 5 },
      { name: 'Coca Cola 400 ml', price: 4000, code: 'BEB-006', sortOrder: 6 },
      { name: 'Coca Cola Zero 400 ml', price: 4000, code: 'BEB-007', sortOrder: 7 },
      { name: 'Manzana Postobón 400 ml', price: 4000, code: 'BEB-008', sortOrder: 8 },
      { name: 'Kola Román 400 ml', price: 4000, code: 'BEB-009', sortOrder: 9 },
      { name: 'Colombiana 400 ml', price: 4000, code: 'BEB-010', sortOrder: 10 },
      { name: 'Coca Cola 1.5 L', price: 8000, code: 'BEB-011', sortOrder: 11 },
      { name: 'Manzana Postobón 1.5 L', price: 8000, code: 'BEB-012', sortOrder: 12 },
      { name: 'Kola Román 1.5 L', price: 8000, code: 'BEB-013', sortOrder: 13 },
      { name: 'Colombiana 1.5 L', price: 8000, code: 'BEB-014', sortOrder: 14 },
      { name: 'Coca Cola 2.5 L', price: 10000, code: 'BEB-015', sortOrder: 15 },
      { name: 'Manzana Postobón 2.5 L', price: 10000, code: 'BEB-016', sortOrder: 16 },
      { name: 'Colombiana 2.5 L', price: 10000, code: 'BEB-017', sortOrder: 17 },
    ],
  },
  {
    name: 'Jugos y Agua',
    description: 'Jugos naturales y agua embotellada',
    sortOrder: 4,
    items: [
      { name: 'Hit Mango 400 ml', price: 4000, code: 'JUG-001', sortOrder: 1 },
      { name: 'Hit Tropical 400 ml', price: 4000, code: 'JUG-002', sortOrder: 2 },
      { name: 'Hit Mora 400 ml', price: 4000, code: 'JUG-003', sortOrder: 3 },
      { name: 'Hit Naranja Piña 400 ml', price: 4000, code: 'JUG-004', sortOrder: 4 },
      { name: 'Agua Cristal 300 ml', price: 1000, code: 'JUG-005', sortOrder: 5 },
    ],
  },
  {
    name: 'Adiciones',
    description: 'Adiciones extras para tus comidas',
    sortOrder: 5,
    items: [
      { name: 'Adición de Queso', price: 1500, code: 'ADI-001', sortOrder: 1 },
      { name: 'Adición de Tocineta', price: 1000, code: 'ADI-002', sortOrder: 2 },
    ],
  },
];

// 3. Estaciones de cocina
const kitchenStationsData = [
  { name: 'Perros Calientes (Salón)', color: '#EF4444', priority: 1 },
  { name: 'Hamburguesas (Salón)', color: '#F97316', priority: 2 },
  { name: 'Perros Calientes (Domicilios)', color: '#EC4899', priority: 3 },
  { name: 'Hamburguesas (Domicilios)', color: '#8B5CF6', priority: 4 },
  { name: 'Cocina General', color: '#10B981', priority: 5 },
];

const roleCatalog = [
  { code: 'SUPERADMIN', name: 'Super Administrador', color: '#7A1F2B', icon: 'Crown', isSystem: true },
  { code: 'ADMIN', name: 'Administrador', color: '#F97316', icon: 'ShieldCheck', isSystem: true },
  { code: 'CASHIER', name: 'Cajero', color: '#FBBF24', icon: 'Wallet', isSystem: true },
  { code: 'DELIVERY_MANAGER', name: 'Gestora de Domicilios', color: '#8B5CF6', icon: 'MessageCircle', isSystem: true },
  { code: 'DISPATCHER', name: 'Despachador de Domicilios', color: '#0EA5E9', icon: 'Bike', isSystem: true },
  { code: 'WAITER', name: 'Mesero', color: '#3B82F6', icon: 'UtensilsCrossed', isSystem: true },
  { code: 'KITCHEN', name: 'Cocinero', color: '#10B981', icon: 'ChefHat', isSystem: true },
];

const defaultZones = [
  { name: 'Centro', zoneGroup: 'Centro', rate: 3000 },
  { name: 'El Recreo', zoneGroup: 'Centro', rate: 3500 },
  { name: 'La Granja', zoneGroup: 'Centro', rate: 3500 },
  { name: 'Buenos Aires Norte', zoneGroup: 'Centro', rate: 4000 },
  { name: 'Buenos Aires Sur', zoneGroup: 'Centro', rate: 4000 },
  { name: 'Los Olivos', zoneGroup: 'Norte', rate: 4500 },
  { name: 'El Cable', zoneGroup: 'Norte', rate: 4500 },
  { name: 'La Pradera', zoneGroup: 'Norte', rate: 5000 },
  { name: 'El Dorado', zoneGroup: 'Norte', rate: 5000 },
  { name: 'San Carlos', zoneGroup: 'Norte', rate: 5000 },
  { name: 'Morindo', zoneGroup: 'Sur', rate: 4500 },
  { name: 'Los Laureles', zoneGroup: 'Sur', rate: 4500 },
  { name: 'Villa Fatima', zoneGroup: 'Sur', rate: 5000 },
  { name: 'La Castellana', zoneGroup: 'Sur', rate: 5000 },
  { name: 'San Antonio', zoneGroup: 'Oriente', rate: 5000 },
  { name: 'El Eden', zoneGroup: 'Oriente', rate: 5500 },
  { name: 'Bruselas', zoneGroup: 'Oriente', rate: 5500 },
  { name: 'La Ribera', zoneGroup: 'Occidente', rate: 5000 },
  { name: 'San Jose', zoneGroup: 'Occidente', rate: 5000 },
  { name: 'Ciudad Jardin', zoneGroup: 'Occidente', rate: 5500 },
  { name: 'Pueblo Nuevo', zoneGroup: 'Periferia', rate: 6000 },
  { name: 'El Tambo', zoneGroup: 'Periferia', rate: 6000 },
  { name: 'Los Cocos', zoneGroup: 'Periferia', rate: 6500 },
  { name: 'La Ribera Norte', zoneGroup: 'Periferia', rate: 6500 },
];

async function main() {
  console.log('🚀 Iniciando configuración inicial de The Villa Dog...');

  if (await prisma.user.count() || await prisma.order.count() || await prisma.menuItem.count()) {
    console.log('La base ya contiene datos. No se modificaron usuarios, contraseñas ni ventas.');
    return;
  }

  // Roles del sistema
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
  console.log('✅ Roles del sistema registrados.');

  // Crear usuarios
  for (const user of initialUsers) {
    const hashedPassword = await bcrypt.hash(user.password, 10);
    await prisma.user.create({
      data: {
        name: user.name,
        email: user.email,
        password: hashedPassword,
        role: user.role,
        phone: user.phone,
        active: true,
        permissions: DEFAULT_ROLE_PERMISSIONS[user.role] || [],
        mustVerifyEmail: false,
        emailVerified: true,
      },
    });
  }
  console.log(`✅ ${initialUsers.length} Usuarios creados exitosamente.`);

  // Crear Categorías y Productos
  let totalItemsCount = 0;
  for (const cat of menuCategoriesData) {
    const createdCat = await prisma.menuCategory.create({
      data: {
        name: cat.name,
        description: cat.description,
        sortOrder: cat.sortOrder,
        active: true,
      },
    });

    for (const item of cat.items) {
      await prisma.menuItem.create({
        data: {
          name: item.name,
          code: item.code,
          price: item.price,
          sortOrder: item.sortOrder,
          categoryId: createdCat.id,
          active: true,
          type: 'NORMAL',
          prepTime: 10,
        },
      });
      totalItemsCount++;
    }
  }
  console.log(`✅ ${menuCategoriesData.length} Categorías y ${totalItemsCount} Productos del Menú creados.`);

  // Crear Estaciones de Cocina y vincular platos y cocineros
  const catPerros = await prisma.menuCategory.findFirst({ where: { name: 'Perros Calientes' } });
  const catHamburguesas = await prisma.menuCategory.findFirst({ where: { name: 'Hamburguesas' } });
  const allCats = await prisma.menuCategory.findMany({});

  const uJose = await prisma.user.findFirst({ where: { email: 'jose@thevilladog.local' } });
  const uJuan = await prisma.user.findFirst({ where: { email: 'juan@thevilladog.local' } });
  const uPedro = await prisma.user.findFirst({ where: { email: 'pedro@thevilladog.local' } });
  const uTerry = await prisma.user.findFirst({ where: { email: 'terry@thevilladog.local' } });
  const uBurguer = await prisma.user.findFirst({ where: { email: 'hamburguesas@thevilladog.local' } });
  const uPruebap = await prisma.user.findFirst({ where: { email: 'pruebap@thevilladog.local' } });
  const uPruebah = await prisma.user.findFirst({ where: { email: 'pruebah@thevilladog.local' } });
  const uAdminCocina = await prisma.user.findFirst({ where: { email: 'admin_cocina@thevilladog.local' } });

  const stationsSetup = [
    {
      name: 'Perros Calientes (Salón)',
      color: '#EF4444',
      priority: 1,
      categories: catPerros ? [{ id: catPerros.id }] : [],
      users: [uJose, uJuan, uPedro].filter(Boolean).map(u => ({ id: u!.id })),
    },
    {
      name: 'Hamburguesas (Salón)',
      color: '#F97316',
      priority: 2,
      categories: catHamburguesas ? [{ id: catHamburguesas.id }] : [],
      users: [uTerry, uBurguer].filter(Boolean).map(u => ({ id: u!.id })),
    },
    {
      name: 'Perros Calientes (Domicilios)',
      color: '#EC4899',
      priority: 3,
      categories: catPerros ? [{ id: catPerros.id }] : [],
      users: [uPruebap].filter(Boolean).map(u => ({ id: u!.id })),
    },
    {
      name: 'Hamburguesas (Domicilios)',
      color: '#8B5CF6',
      priority: 4,
      categories: catHamburguesas ? [{ id: catHamburguesas.id }] : [],
      users: [uPruebah].filter(Boolean).map(u => ({ id: u!.id })),
    },
    {
      name: 'Cocina General',
      color: '#10B981',
      priority: 5,
      categories: allCats.map(c => ({ id: c.id })),
      users: [uAdminCocina].filter(Boolean).map(u => ({ id: u!.id })),
    },
  ];

  for (const s of stationsSetup) {
    await prisma.kitchenStation.create({
      data: {
        name: s.name,
        color: s.color,
        priority: s.priority,
        active: true,
        categories: { connect: s.categories },
        users: { connect: s.users },
      },
    });
  }
  console.log(`✅ ${stationsSetup.length} Estaciones de cocina creadas y vinculadas.`);

  // Cajas
  const admin = await prisma.user.findUnique({ where: { email: 'admin@thevilladog.local' } });
  if ((await prisma.cashRegister.count()) === 0) {
    await prisma.cashRegister.createMany({
      data: [
        { name: 'Caja Principal (Salón)', description: 'Mostrador principal del restaurante', purpose: 'DINING', managerId: admin?.id },
        { name: 'Caja Domicilios', description: 'Operadores de pedidos y entregas', purpose: 'DELIVERY', managerId: admin?.id },
      ],
    });
  }

  // Zonas de Montería
  if ((await prisma.deliveryZone.count()) === 0) {
    await prisma.deliveryZone.createMany({ data: defaultZones });
  }

  console.log('\n✨ ¡Configuración completada con éxito!');
  console.log('----------------------------------------------------');
  console.log(`🛎️ Meseros: daniela, jhoana, karol, liliana, rosa, shelly, prueba`);
  console.log(`🍳 Cocina: jose, juan, terry, pruebap, pruebah, admin_cocina, pedro, hamburguesas`);
  console.log(`🛵 Gestores Domicilios: camila, yanet, juliana, laura, josed`);
  console.log('----------------------------------------------------');
}

main()
  .catch((error) => {
    console.error('Seed error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
