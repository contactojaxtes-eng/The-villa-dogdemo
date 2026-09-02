import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding The Villa Dog database con menú real...');

  const adminPassword = await bcrypt.hash('admin123', 10);
  const cajaPassword = await bcrypt.hash('caja123', 10);

  const demoUsers = [
    { email: 'jose@thevilladog.local', name: 'Jose Martinez', role: 'SUPERADMIN', password: adminPassword, phone: '3000000002' },
    { email: 'admin@thevilladog.local', name: 'Administrador', role: 'ADMIN', password: adminPassword, phone: '3000000000' },
    { email: 'cajero@thevilladog.local', name: 'Cajero Principal', role: 'CASHIER', password: cajaPassword, phone: '3005555555' },
    { email: 'cajero2@thevilladog.local', name: 'Cajero Turno', role: 'CASHIER', password: cajaPassword, phone: '3005555556' },
    { email: 'domicilios@thevilladog.local', name: 'Gestor Domicilios', role: 'DELIVERY_MANAGER', password: cajaPassword, phone: '3006666666' },
  ];

  // Delete the old redundant superadmin if it exists
  await prisma.user.deleteMany({
    where: { email: 'superadmin@thevilladog.local' }
  });

  for (const u of demoUsers) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, password: u.password, phone: u.phone, active: true },
      create: { name: u.name, email: u.email, password: u.password, role: u.role, phone: u.phone, active: true },
    });
  }

  const admin = await prisma.user.findUnique({ where: { email: 'admin@thevilladog.local' } });

  await prisma.user.updateMany({
    where: { role: { in: ['WAITER', 'COOK'] } },
    data: { active: false },
  });

  const cajero = await prisma.user.findUnique({ where: { email: 'cajero@thevilladog.local' } });

  // ══════════════════════════════════════════════════════════════
  // CATEGORÍAS DE GASTO
  // ══════════════════════════════════════════════════════════════
  const expenseCategories = [
    { name: 'Gasolina', description: 'Combustible para motos de domicilio' },
    { name: 'Mantenimiento', description: 'Mantenimiento de motos y vehículos' },
    { name: 'Insumos', description: 'Insumos de cocina y empaques' },
    { name: 'Nómina', description: 'Pago de salarios y comisiones' },
    { name: 'Servicios', description: 'Agua, luz, internet, gas' },
    { name: 'Imprevistos', description: 'Gastos no planeados' },
    { name: 'Publicidad', description: 'Marketing y promociones' },
    { name: 'Administrativo', description: 'Papelería, licencias, impuestos' },
  ];

  for (const cat of expenseCategories) {
    await prisma.expenseCategory.upsert({
      where: { id: cat.name.toLowerCase().replace(/\s/g, '-') },
      update: {},
      create: { id: cat.name.toLowerCase().replace(/\s/g, '-'), ...cat },
    });
  }

  // ══════════════════════════════════════════════════════════════
  // LIMPIAR MENÚ DE PRUEBA EXISTENTE
  // ══════════════════════════════════════════════════════════════
  console.log('Limpiando menú de prueba...');

  // Primero limpiar recetas e ingredientes de prueba (dependen de menuItems)
  await prisma.recipeIngredient.deleteMany({});
  await prisma.recipe.deleteMany({});
  await prisma.stockMovement.deleteMany({});
  await prisma.ingredient.deleteMany({});

  // Ahora limpiar los ítems del menú (no borrar los que están en pedidos, solo desactivar)
  // Pero como son de prueba y no hay pedidos reales, podemos borrarlos
  const existingOrderItems = await prisma.orderItem.count();
  if (existingOrderItems === 0) {
    await prisma.menuItem.deleteMany({});
    await prisma.menuCategory.deleteMany({});
  } else {
    // Si hay pedidos, desactivar en vez de borrar
    await prisma.menuItem.updateMany({ data: { active: false } });
    await prisma.menuCategory.updateMany({ data: { active: false } });
  }

  // ══════════════════════════════════════════════════════════════
  // MENÚ REAL DE THE VILLA DOG - CATEGORÍAS
  // ══════════════════════════════════════════════════════════════
  console.log('Creando categorías del menú real...');

  const upsertCategory = async (name: string, description: string, sortOrder: number) => {
    const existing = await prisma.menuCategory.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } }
    });
    if (existing) {
      return prisma.menuCategory.update({
        where: { id: existing.id },
        data: { active: true, description, sortOrder }
      });
    }
    return prisma.menuCategory.create({
      data: { name, description, sortOrder }
    });
  };

  const catPizzasClasicas = await upsertCategory('Pizzas Clásicas', 'Pizza Sabor The Villa Dog - Receta Original', 0);
  const catPizzasEspeciales = await upsertCategory('Pizzas Especialidades', 'Nuestras combinaciones premium', 1);
  const catAdicionalesPizza = await upsertCategory('Adicionales para Pizza', 'Personaliza tu pizza con toppings extras', 2);
  const catPerros = await upsertCategory('Perros Calientes', 'Con vegetales y papa triturada', 3);
  const catHamburguesas = await upsertCategory('Hamburguesas', 'Con vegetales frescos', 4);
  
  const catPatacones = await upsertCategory('Patacones Rellenos', 'Con vegetales, papa triturada y queso costeño', 5);
  const catPataconesGrat = await upsertCategory('Patacones Gratinados', 'Con vegetales, papa triturada y queso mozzarella gratinado', 6);
  
  const catSalvajadas = await upsertCategory('Salvajadas', 'Con vegetales, papas a la francesa, queso costeño y papa triturada', 7);
  const catSalvajadasGrat = await upsertCategory('Salvajadas Gratinadas', 'Salvajadas con queso mozzarella gratinado', 8);
  
  const catSuizosFrancesa = await upsertCategory('Suizos c/ Papas Francesas', 'Con salchicha suiza premium y papas a la francesa', 9);
  const catSuizosFrancesaGrat = await upsertCategory('Suizos c/ Papas Francesas Gratinados', 'Suizos con papas a la francesa y queso gratinado', 10);
  
  const catMiniSuizosFrancesa = await upsertCategory('Mini Suizos c/ Papas Francesas', 'Versión mini con salchicha suiza y papas a la francesa', 11);
  const catMiniSuizosFrancesaGrat = await upsertCategory('Mini Suizos c/ Papas Francesas Gratinados', 'Mini suizos con papas a la francesa gratinados', 12);
  
  const catSuizosVapor = await upsertCategory('Suizos c/ Papas al Vapor', 'Con salchicha suiza premium y papas al vapor', 13);
  const catSuizosVaporGrat = await upsertCategory('Suizos c/ Papas al Vapor Gratinados', 'Suizos con papas al vapor y queso gratinado', 14);
  
  const catMiniSuizosVapor = await upsertCategory('Mini Suizos c/ Papas al Vapor', 'Versión mini con salchicha suiza y papas al vapor', 15);
  const catMiniSuizosVaporGrat = await upsertCategory('Mini Suizos c/ Papas al Vapor Gratinados', 'Mini suizos con papas al vapor gratinados', 16);
  
  const catPicadas = await upsertCategory('Picadas', 'Con vegetales, papa triturada y queso costeño', 17);
  const catPicadasGrat = await upsertCategory('Picadas Gratinadas', 'Picadas con queso mozzarella gratinado', 18);
  
  const catMaicitos = await upsertCategory('Maicitos', 'Con vegetales, queso costeño y papa triturada', 19);
  const catMaicitosGrat = await upsertCategory('Maicitos Gratinados', 'Maicitos con queso mozzarella gratinado', 20);
  
  const catSalchipapas = await upsertCategory('Salchipapas', 'Con papas a la francesa, vegetales y queso costeño', 21);
  const catSalchipapasGrat = await upsertCategory('Salchipapas Gratinadas', 'Salchipapas con queso mozzarella gratinado', 22);
  
  const catChuzosFrancesa = await upsertCategory('Chuzos c/ Papas Francesas', 'Chuzos con patacones o papas a la francesa', 23);
  const catChuzosVapor = await upsertCategory('Chuzos c/ Papas al Vapor', 'Chuzos con papas al vapor', 24);
  
  const catAsadosFrancesa = await upsertCategory('Asados c/ Papas Francesas', 'Carnes asadas con papas a la francesa', 25);
  const catAsadosVapor = await upsertCategory('Asados c/ Papas al Vapor', 'Carnes asadas con papas al vapor', 26);
  const catAdicionales = await upsertCategory('Adicionales', 'Porciones extras y acompañamientos', 27);
  const catBebidasFamiliar = await upsertCategory('Bebidas Familiar', 'Presentaciones familiares', 28);
  const catBebidasPersonal = await upsertCategory('Bebidas Personal', 'Presentaciones personales', 29);
  const catBebidasJunior = await upsertCategory('Bebidas Junior', 'Presentaciones pequeñas', 30);

  // ══════════════════════════════════════════════════════════════
  // MENÚ REAL DE THE VILLA DOG - PRODUCTOS
  // ══════════════════════════════════════════════════════════════
  console.log('Creando productos del menú real...');

  // Helper para crear ítems de pizza con 4 tamaños
  const pizzaItem = (name: string, desc: string, personal: number, mediana: number, semi: number, familiar: number, catId: string) => {
    const isHawaiana = name.toLowerCase().includes('hawaiana');
    const imgPath = isHawaiana ? '/images/pizza_hawaiana.png' : '/images/pizza.png';
    return [
      { name: `${name} - Personal`, description: desc, price: personal, categoryId: catId, image: imgPath },
      { name: `${name} - Mediana`, description: desc, price: mediana, categoryId: catId, image: imgPath },
      { name: `${name} - Semifamiliar`, description: desc, price: semi, categoryId: catId, image: imgPath },
      { name: `${name} - Familiar`, description: desc, price: familiar, categoryId: catId, image: imgPath },
    ];
  };

  // Helper para ítems con variante Normal/Gratinado
  const normalGrat = (name: string, desc: string, normal: number, gratinado: number, catIdNormal: string, catIdGratinado: string) => {
    let img: string | null = null;
    if (catIdNormal === catPatacones.id) {
      img = (name.toLowerCase().includes('todo') || name.toLowerCase().includes('niche')) ? '/images/patacon_todo.png' : '/images/patacon.png';
    } else if (catIdNormal === catSalvajadas.id) {
      img = (name.toLowerCase().includes('niche') || name.toLowerCase().includes('salvajada') || name.toLowerCase().includes('trío') || name.toLowerCase().includes('súper')) ? '/images/salchipapa_salvajada.png' : '/images/salchipapa.png';
    } else if (
      catIdNormal === catSuizosFrancesa.id ||
      catIdNormal === catMiniSuizosFrancesa.id ||
      catIdNormal === catSuizosVapor.id ||
      catIdNormal === catMiniSuizosVapor.id
    ) {
      img = '/images/suizo_papas.png';
    } else if (catIdNormal === catPicadas.id) {
      img = (name.toLowerCase().includes('niche') || name.toLowerCase().includes('especial')) ? '/images/picada_especial.png' : '/images/picada.png';
    } else if (catIdNormal === catMaicitos.id) {
      img = '/images/maicitos.png';
    } else if (catIdNormal === catSalchipapas.id) {
      img = '/images/salchipapa.png';
    }

    return [
      { name: `${name}`, description: desc, price: normal, categoryId: catIdNormal, image: img },
      { name: `${name} Gratinado`, description: desc, price: gratinado, categoryId: catIdGratinado, image: img },
    ];
  };

  const allItems: { name: string; description: string; price: number; categoryId: string; image?: string | null }[] = [];

  // ── PIZZAS CLÁSICAS ──
  allItems.push(
    ...pizzaItem('Pizza Solo Queso', 'Queso mozzarella', 12500, 20000, 36600, 54000, catPizzasClasicas.id),
    ...pizzaItem('Pizza Jamón y Queso', 'Queso mozzarella y jamón', 15500, 26000, 45000, 67000, catPizzasClasicas.id),
    ...pizzaItem('Pizza Salami', 'Queso mozzarella y salami', 17600, 27500, 51000, 75600, catPizzasClasicas.id),
    ...pizzaItem('Pizza Hawaiana', 'Queso mozzarella, jamón y piña en trocitos', 18000, 30000, 51500, 76000, catPizzasClasicas.id),
    ...pizzaItem('Pizza con Pollo', 'Queso mozzarella y pollo en trocitos a la plancha', 17500, 27000, 50500, 72500, catPizzasClasicas.id),
    ...pizzaItem('Pizza con Tocineta', 'Queso mozzarella y tocineta ahumada', 16500, 26000, 48600, 70000, catPizzasClasicas.id),
    ...pizzaItem('Pizza Maíz y Queso', 'Queso mozzarella y maíz tierno', 15900, 24500, 43500, 64500, catPizzasClasicas.id),
    ...pizzaItem('Pizza con Pepperoni', 'Queso mozzarella y pepperoni', 18700, 29000, 54500, 80500, catPizzasClasicas.id),
    ...pizzaItem('Pizza con Chorizo', 'Queso mozzarella y chorizo', 16600, 25400, 47500, 70500, catPizzasClasicas.id),
    ...pizzaItem('Pizza Vegetales', 'Queso mozzarella, champiñones, tomate, cebolla, pimentón, orégano', 17500, 27500, 51000, 75000, catPizzasClasicas.id),
    ...pizzaItem('Pizza con Champiñones', 'Queso mozzarella y champiñones', 16800, 26500, 47500, 69000, catPizzasClasicas.id),
  );

  // ── PIZZAS ESPECIALIDADES ──
  allItems.push(
    ...pizzaItem('Pizza Pollo Jamón', 'Queso mozzarella, jamón y pollo en trocitos a la plancha', 20000, 33000, 58600, 85500, catPizzasEspeciales.id),
    ...pizzaItem('Pizza Ranchera', 'Queso mozzarella, jamón y ranchera', 21100, 31600, 56500, 84000, catPizzasEspeciales.id),
    ...pizzaItem('Pizza Pollo Tocineta', 'Queso mozzarella, pollo en trocitos y tocineta ahumada', 21500, 31000, 58500, 84000, catPizzasEspeciales.id),
    ...pizzaItem('Pizza Pollo Hawaiana', 'Queso mozzarella, pollo en trocitos a la plancha y piña', 22600, 37000, 65100, 94500, catPizzasEspeciales.id),
    ...pizzaItem('Pizza Pollo Champiñones', 'Queso mozzarella, pollo en trocitos a la plancha y champiñones', 20500, 31500, 69000, 84500, catPizzasEspeciales.id),
    ...pizzaItem('Pizza Americana', 'Queso mozzarella, maíz tierno y pollo en trocitos a la plancha', 20000, 30500, 57500, 81000, catPizzasEspeciales.id),
    ...pizzaItem('Pizza Especial Tío The Villa Dog', 'Queso mozzarella, pollo, jamón, ranchera, piña en trocitos', 28600, 40500, 78500, 112000, catPizzasEspeciales.id),
    ...pizzaItem('Pizza Salami Pollo', 'Queso mozzarella, salami y pollo en trocitos a la plancha', 20500, 33000, 61500, 87000, catPizzasEspeciales.id),
    ...pizzaItem('Pizza Especial 4 Carnes', 'Queso mozzarella, jamón, salami, pollo y chorizo', 24500, 39000, 76500, 110000, catPizzasEspeciales.id),
    ...pizzaItem('Pizza Semi-Remontada', 'Mozzarella, jamón, pollo, salami, tocineta, chorizo, maíz, cebolla, piña', 35200, 50500, 98500, 138000, catPizzasEspeciales.id),
  );

  // ── ADICIONALES PARA PIZZA ──
  const pizzaAddons = [
    ...pizzaItem('Adic. Queso Mozzarella', 'Porción extra de queso mozzarella', 6000, 12000, 24000, 36000, catAdicionalesPizza.id),
    ...pizzaItem('Adic. Jamón', 'Porción extra de jamón', 3000, 6000, 8200, 13200, catAdicionalesPizza.id),
    ...pizzaItem('Adic. Pollo', 'Pollo en trocitos a la plancha', 4600, 6800, 13600, 18500, catAdicionalesPizza.id),
    ...pizzaItem('Adic. Salami', 'Porción extra de salami', 5100, 7200, 14400, 21600, catAdicionalesPizza.id),
    ...pizzaItem('Adic. Ranchera', 'Ranchera premium', 5600, 5600, 11200, 16800, catAdicionalesPizza.id),
    ...pizzaItem('Adic. Chorizo', 'Porción extra de chorizo', 4100, 5400, 10800, 16200, catAdicionalesPizza.id),
    ...pizzaItem('Adic. Tocineta', 'Porción extra de tocineta', 4000, 6000, 12000, 16000, catAdicionalesPizza.id),
    ...pizzaItem('Adic. Pepperoni', 'Porción extra de pepperoni', 6200, 8800, 17600, 26400, catAdicionalesPizza.id),
    ...pizzaItem('Adic. Maíz Tierno', 'Porción extra de maíz tierno', 3400, 4400, 6800, 10200, catAdicionalesPizza.id),
    ...pizzaItem('Adic. Piña', 'Piña en trocitos', 2500, 3800, 6300, 8800, catAdicionalesPizza.id),
    ...pizzaItem('Adic. Champiñones', 'Porción extra de champiñones', 4300, 6400, 10600, 14800, catAdicionalesPizza.id),
    ...pizzaItem('Adic. Cebolla', 'Cebolla blanca', 1000, 1000, 2000, 3000, catAdicionalesPizza.id),
    ...pizzaItem('Adic. Pimentón', 'Pimentón rojo', 1000, 1000, 2000, 3000, catAdicionalesPizza.id),
    ...pizzaItem('Adic. Tomate', 'Tomate rojo', 1000, 2000, 3000, 5000, catAdicionalesPizza.id),
    ...pizzaItem('Borde Relleno Queso', 'Borde relleno de queso', 8000, 10000, 17000, 24000, catAdicionalesPizza.id),
    ...pizzaItem('Borde Relleno Bocadillo', 'Borde relleno de bocadillo', 6000, 8000, 12000, 16000, catAdicionalesPizza.id),
    ...pizzaItem('Borde Relleno Mixto', 'Borde relleno mixto (queso + bocadillo)', 9000, 12000, 19000, 27000, catAdicionalesPizza.id),
  ];
  allItems.push(...pizzaAddons);

  // ── PERROS CALIENTES ──
  allItems.push(
    { name: 'Perro Super The Villa Dog', description: 'Salchicha long, pollo, chorizo, butifarra, tocineta, jamón, queso costeño y mozzarella', price: 22100, categoryId: catPerros.id, image: '/images/perro_super.png' },
    { name: 'Perro Ítalo Suizo', description: 'Salchicha suiza, tocineta, jamón, salami, queso costeño y mozzarella', price: 15900, categoryId: catPerros.id },
    { name: 'Perro Especial The Villa Dog', description: 'Salchicha ranchera premium, suiza, jamón, queso costeño y mozzarella', price: 15500, categoryId: catPerros.id, image: '/images/perro_super.png' },
    { name: 'Combo Perro', description: 'Perro sencillo + papas a la francesa + gaseosa', price: 15000, categoryId: catPerros.id },
    { name: 'Perro Ítalo Ranchero', description: 'Salchicha ranchera premium, tocineta, jamón, queso costeño y mozzarella', price: 12900, categoryId: catPerros.id },
    { name: 'Perro Suizo', description: 'Salchicha suiza, salami, queso costeño y mozzarella', price: 13700, categoryId: catPerros.id },
    { name: 'Perro Americano', description: 'Salchicha long, suiza, queso costeño y mozzarella', price: 10900, categoryId: catPerros.id },
    { name: 'Perro con Pollo', description: 'Salchicha long, pechuga en trocitos, queso costeño y mozzarella', price: 11700, categoryId: catPerros.id },
    { name: 'Perro Escocés', description: 'Salchicha long, maíz tierno, salami, jamón, queso costeño y mozzarella', price: 10600, categoryId: catPerros.id },
    { name: 'Perro Ranchero', description: 'Salchicha ranchera premium, jamón, queso costeño y mozzarella', price: 11700, categoryId: catPerros.id },
    { name: 'Perro Gemelo', description: '2 salchichas long, queso costeño y doble mozzarella', price: 10100, categoryId: catPerros.id },
    { name: 'Perro con Tocineta', description: 'Salchicha long, tocineta ahumada, queso costeño y mozzarella', price: 9000, categoryId: catPerros.id },
    { name: 'Chori Perro', description: 'Salchicha long, chorizo de ternera, queso costeño y mozzarella', price: 10500, categoryId: catPerros.id },
    { name: 'Perro Suizito', description: 'Media salchicha suiza, queso costeño y mozzarella', price: 8900, categoryId: catPerros.id },
    { name: 'Perro Sencillo', description: 'Salchicha long, jamón, queso costeño y mozzarella', price: 7800, categoryId: catPerros.id },
  );

  // ── HAMBURGUESAS ──
  allItems.push(
    { name: 'Súper Especial The Villa Dog', description: 'Carne, pollo, cerdo, tocineta, jamón y queso mozzarella', price: 23700, categoryId: catHamburguesas.id, image: '/images/hamburguesa_especial.png' },
    { name: 'Especial The Villa Dog', description: 'Carne, pollo, tocineta, jamón y queso mozzarella', price: 19100, categoryId: catHamburguesas.id, image: '/images/hamburguesa_especial.png' },
    { name: 'Combo Hamburguesa', description: '1 hamburguesa sencilla + papas a la francesa + gaseosa', price: 20100, categoryId: catHamburguesas.id },
    { name: 'Ranchera Especial', description: 'Carne, ranchera, tocineta, jamón y queso mozzarella', price: 20100, categoryId: catHamburguesas.id },
    { name: 'Hamburguesa Mixta', description: 'Carne, pollo y queso mozzarella', price: 16900, categoryId: catHamburguesas.id },
    { name: 'Doble Carne', description: '2 carnes, doble queso mozzarella', price: 16900, categoryId: catHamburguesas.id },
    { name: 'Hamburguesa Sencilla', description: 'Carne, tocineta, jamón y queso mozzarella', price: 13500, categoryId: catHamburguesas.id },
    { name: 'Hamburguesa con Pollo', description: 'Filete de pechuga a la parrilla y queso mozzarella', price: 11300, categoryId: catHamburguesas.id },
  );

  // ── PATACONES RELLENOS y GRATINADOS ──
  allItems.push(
    ...normalGrat('Señor The Villa Dog Patacón', 'Pollo, lomo de res, cerdo, suiza, ranchera, cervecero, aguacate, nachos y maíz', 51000, 56000, catPatacones.id, catPataconesGrat.id),
    ...normalGrat('Patacón con Todo', 'Pollo, lomo de res, suiza, chorizo y butifarra', 29800, 33800, catPatacones.id, catPataconesGrat.id),
    ...normalGrat('Patacón Trifásico', 'Filete de pechuga, cerdo magro y lomo de res', 25700, 29700, catPatacones.id, catPataconesGrat.id),
    { name: 'Patacón Suizo al Gratín', description: 'Con salchicha suiza premium y queso mozzarella gratinado', price: 22500, categoryId: catPataconesGrat.id },
    ...normalGrat('Patacón Mixto', 'Filete de pechuga y lomo de res', 21100, 25100, catPatacones.id, catPataconesGrat.id),
    ...normalGrat('Patacón con Lomito', 'Lomo de res en trocitos', 22000, 26000, catPatacones.id, catPataconesGrat.id),
    ...normalGrat('Patacón con Cerdo', 'Cerdo magro en trocitos', 20200, 24200, catPatacones.id, catPataconesGrat.id),
    ...normalGrat('Patacón con Pollo', 'Filete de pechuga en trocitos', 20200, 24200, catPatacones.id, catPataconesGrat.id),
    ...normalGrat('Patacón Suiza Chorizo Butifarra', 'Suiza, chorizo y butifarra', 19700, 23700, catPatacones.id, catPataconesGrat.id),
    ...normalGrat('Patacón Pollo y Ranchera', 'Filete de pechuga y salchicha ranchera premium', 21200, 25200, catPatacones.id, catPataconesGrat.id),
    ...normalGrat('Patacón con Ranchera', 'Salchicha ranchera premium', 22200, 26200, catPatacones.id, catPataconesGrat.id),
  );

  // ── SALVAJADAS ──
  allItems.push(
    ...normalGrat('Salvajada Chica', 'Pollo, chorizo, butifarra, salchicha, cervecero', 27000, 32000, catSalvajadas.id, catSalvajadasGrat.id),
    ...normalGrat('Salvajada Matrimonio', 'Pollo, chorizo, butifarra, salchicha, cervecero y maíz tierno', 34000, 39000, catSalvajadas.id, catSalvajadasGrat.id),
    ...normalGrat('Salvajada Trío', 'Pollo, cerdo, chorizo, butifarra, cervecero y salchicha', 39400, 45000, catSalvajadas.id, catSalvajadasGrat.id),
    ...normalGrat('Salvajada Súper', 'Pollo, cerdo, chorizo, butifarra, cervecero y salchicha', 55500, 65000, catSalvajadas.id, catSalvajadasGrat.id),
    ...normalGrat('Salvajada The Villa Dog', 'Cerdo, pollo, salchicha, chorizo, cervecero y butifarra', 77500, 89500, catSalvajadas.id, catSalvajadasGrat.id),
    ...normalGrat('Salvajada Extralarge', 'Cerdo, pollo, suiza, chorizo, butifarra, salchicha, cervecero y maíz', 106500, 121500, catSalvajadas.id, catSalvajadasGrat.id),
    ...normalGrat('Salvajadita', 'Suiza, chorizo, butifarra y salchicha', 24200, 29200, catSalvajadas.id, catSalvajadasGrat.id),
  );

  // ── SUIZOS CON PAPAS FRANCESAS ──
  allItems.push(
    ...normalGrat('Suizo Especial The Villa Dog', 'Pollo, lomito, cerdo, suiza, chorizo, cervecero, butifarra y cebolla', 78500, 90500, catSuizosFrancesa.id, catSuizosFrancesaGrat.id),
    ...normalGrat('Suizo Súper con Todo', 'Pollo, cerdo, suiza, chorizo, cervecero, butifarra y cebolla', 45000, 50000, catSuizosFrancesa.id, catSuizosFrancesaGrat.id),
    ...normalGrat('Suizo con Todo', 'Pollo, lomito, suiza, chorizo, butifarra y cebolla', 36500, 41500, catSuizosFrancesa.id, catSuizosFrancesaGrat.id),
    ...normalGrat('Suizo Especial con Lomito', 'Salchicha suiza premium y lomo de res en trocitos', 25000, 29000, catSuizosFrancesa.id, catSuizosFrancesaGrat.id),
    ...normalGrat('Suizo Especial con Cerdo', 'Salchicha suiza premium y cerdo magro en trocitos', 24100, 28100, catSuizosFrancesa.id, catSuizosFrancesaGrat.id),
    ...normalGrat('Suizo Especial con Pollo', 'Salchicha suiza premium y filete de pechuga en trocitos', 24100, 28100, catSuizosFrancesa.id, catSuizosFrancesaGrat.id),
    ...normalGrat('Suizo Ranchero', 'Salchicha suiza, ranchera premium, tocineta y jamón', 24000, 28000, catSuizosFrancesa.id, catSuizosFrancesaGrat.id),
    ...normalGrat('Súper Suizo', 'Salchicha suiza premium', 19500, 23500, catSuizosFrancesa.id, catSuizosFrancesaGrat.id),
    ...normalGrat('Suizo Chorizo y Butifarra', 'Suiza con chorizo y butifarra', 20700, 24700, catSuizosFrancesa.id, catSuizosFrancesaGrat.id),
  );

  // ── MINI SUIZOS (Papas Francesas) ──
  allItems.push(
    ...normalGrat('Mini Suizo con Lomito (Francesa)', 'Mini con salchicha suiza y lomo de res', 18200, 21200, catMiniSuizosFrancesa.id, catMiniSuizosFrancesaGrat.id),
    ...normalGrat('Mini Suizo con Cerdo (Francesa)', 'Mini con salchicha suiza y cerdo', 17300, 20300, catMiniSuizosFrancesa.id, catMiniSuizosFrancesaGrat.id),
    ...normalGrat('Mini Suizo con Pollo (Francesa)', 'Mini con salchicha suiza y pechuga', 17300, 20300, catMiniSuizosFrancesa.id, catMiniSuizosFrancesaGrat.id),
    ...normalGrat('Mini Suizo Sencillo (Francesa)', 'Mini con salchicha suiza premium', 12700, 15700, catMiniSuizosFrancesa.id, catMiniSuizosFrancesaGrat.id),
  );

  // ── SUIZOS CON PAPAS AL VAPOR ──
  allItems.push(
    ...normalGrat('Suizo Esp. The Villa Dog (Vapor)', 'Pollo, lomito, cerdo, suiza, chorizo, cervecero, butifarra y cebolla', 74600, 86600, catSuizosVapor.id, catSuizosVaporGrat.id),
    ...normalGrat('Suizo Súper con Todo (Vapor)', 'Pollo, cerdo, suiza, chorizo, cervecero, butifarra y cebolla', 40600, 45600, catSuizosVapor.id, catSuizosVaporGrat.id),
    ...normalGrat('Suizo con Todo (Vapor)', 'Pollo, lomito, suiza, chorizo, butifarra y cebolla', 33700, 38700, catSuizosVapor.id, catSuizosVaporGrat.id),
    ...normalGrat('Suizo Esp. Lomito (Vapor)', 'Salchicha suiza y lomo de res', 24000, 28000, catSuizosVapor.id, catSuizosVaporGrat.id),
    ...normalGrat('Suizo Esp. Cerdo (Vapor)', 'Salchicha suiza y cerdo magro', 21900, 25900, catSuizosVapor.id, catSuizosVaporGrat.id),
    ...normalGrat('Suizo Esp. Pollo (Vapor)', 'Salchicha suiza y filete de pechuga', 21900, 25900, catSuizosVapor.id, catSuizosVaporGrat.id),
    ...normalGrat('Suizo Ranchero (Vapor)', 'Suiza, ranchera, tocineta y jamón', 21800, 25800, catSuizosVapor.id, catSuizosVaporGrat.id),
    ...normalGrat('Súper Suizo (Vapor)', 'Salchicha suiza premium', 17300, 21300, catSuizosVapor.id, catSuizosVaporGrat.id),
    ...normalGrat('Suizo Chorizo Butifarra (Vapor)', 'Suiza con chorizo y butifarra', 18500, 22500, catSuizosVapor.id, catSuizosVaporGrat.id),
  );

  // ── MINI SUIZOS (Papas al Vapor) ──
  allItems.push(
    ...normalGrat('Mini Suizo con Lomito (Vapor)', 'Mini con salchicha suiza y lomo de res', 17200, 20200, catMiniSuizosVapor.id, catMiniSuizosVaporGrat.id),
    ...normalGrat('Mini Suizo con Cerdo (Vapor)', 'Mini con salchicha suiza y cerdo', 16300, 19300, catMiniSuizosVapor.id, catMiniSuizosVaporGrat.id),
    ...normalGrat('Mini Suizo con Pollo (Vapor)', 'Mini con salchicha suiza y pechuga', 16300, 19300, catMiniSuizosVapor.id, catMiniSuizosVaporGrat.id),
    ...normalGrat('Mini Suizo Sencillo (Vapor)', 'Mini con salchicha suiza premium', 11700, 14700, catMiniSuizosVapor.id, catMiniSuizosVaporGrat.id),
  );

  // ── PICADAS ──
  allItems.push(
    ...normalGrat('Picada Súper Especial The Villa Dog', 'Pollo, lomito, cerdo, suiza, ranchera, chorizo, cervecero, butifarra, maíz', 101000, 116000, catPicadas.id, catPicadasGrat.id),
    ...normalGrat('Picada Especial The Villa Dog', 'Pollo, lomito, cerdo, suiza, chorizo, cervecero y butifarra', 72500, 84500, catPicadas.id, catPicadasGrat.id),
    ...normalGrat('Picada Súper con Todo', 'Pollo, cerdo, suiza, chorizo, cervecero y butifarra', 44000, 49000, catPicadas.id, catPicadasGrat.id),
    ...normalGrat('Picada con Todo', 'Pollo, lomito, suiza, chorizo y butifarra', 35500, 40500, catPicadas.id, catPicadasGrat.id),
    ...normalGrat('Picada Escocesa', 'Pollo, lomito, cerdo, suiza y maíz tierno', 39000, 44000, catPicadas.id, catPicadasGrat.id),
    ...normalGrat('Picada 4 Carnes', 'Pollo, lomito, cerdo y chorizo', 37000, 42000, catPicadas.id, catPicadasGrat.id),
    ...normalGrat('Picada Trifásica', 'Lomo de res, cerdo y filete de pechuga', 25900, 29900, catPicadas.id, catPicadasGrat.id),
    ...normalGrat('Picada Mixta', 'Lomo de res and filete de pechuga', 21300, 25300, catPicadas.id, catPicadasGrat.id),
    ...normalGrat('Picada con Lomito', 'Lomo de res en trocitos', 22200, 26200, catPicadas.id, catPicadasGrat.id),
    ...normalGrat('Picada con Cerdo', 'Cerdo magro en trocitos', 20400, 24400, catPicadas.id, catPicadasGrat.id),
    ...normalGrat('Picada con Pollo', 'Filete de pechuga en trocitos', 20400, 24400, catPicadas.id, catPicadasGrat.id),
    ...normalGrat('Picada Suiza Chorizo Butifarra', 'Suiza, chorizo y butifarra', 19900, 23900, catPicadas.id, catPicadasGrat.id),
    ...normalGrat('Picada Pollo y Ranchera', 'Pollo and ranchera premium', 21400, 25400, catPicadas.id, catPicadasGrat.id),
    ...normalGrat('Picada con Ranchera', 'Salchicha ranchera premium', 22400, 26400, catPicadas.id, catPicadasGrat.id),
  );

  // ── MAICITOS ──
  allItems.push(
    ...normalGrat('Maicito 4 Carnes', 'Maíz tierno, pollo, lomito, chorizo y cerdo', 33000, 38000, catMaicitos.id, catMaicitosGrat.id),
    ...normalGrat('Maicito con Todo', 'Maíz tierno, pollo, lomito, suiza, chorizo y butifarra', 34500, 39500, catMaicitos.id, catMaicitosGrat.id),
    ...normalGrat('Maicito Trifásico', 'Maíz tierno, pollo, lomito y cerdo', 27100, 32100, catMaicitos.id, catMaicitosGrat.id),
    ...normalGrat('Maicito Ranchera y Pollo', 'Maíz tierno, ranchera y pollo', 22700, 26800, catMaicitos.id, catMaicitosGrat.id),
    ...normalGrat('Maicito con Ranchera', 'Maíz tierno y ranchera', 18100, 22100, catMaicitos.id, catMaicitosGrat.id),
    ...normalGrat('Maicito con Lomito', 'Maíz tierno y res en trocitos', 17900, 21900, catMaicitos.id, catMaicitosGrat.id),
    ...normalGrat('Maicito con Cerdo', 'Maíz tierno y cerdo en trocitos', 17100, 21100, catMaicitos.id, catMaicitosGrat.id),
    ...normalGrat('Maicito con Pollo', 'Maíz tierno y pollo en trocitos', 17100, 21100, catMaicitos.id, catMaicitosGrat.id),
    ...normalGrat('Maicito Hawaiano', 'Maíz tierno, tocineta, jamón y piña', 21000, 25000, catMaicitos.id, catMaicitosGrat.id),
    ...normalGrat('Maíz Americano Sencillo', 'Maíz americano sencillo', 12500, 16500, catMaicitos.id, catMaicitosGrat.id),
  );

  // ── SALCHIPAPAS ──
  allItems.push(
    ...normalGrat('Salchipapa Súper con Todo', 'Salchicha, chorizo, butifarra, suiza, pechuga y cerdo', 44000, 49000, catSalchipapas.id, catSalchipapasGrat.id),
    ...normalGrat('Salchipapa con Todo', 'Salchicha, chorizo, butifarra, pechuga y lomo de res', 33800, 38800, catSalchipapas.id, catSalchipapasGrat.id),
    ...normalGrat('Salchipapa 4 Carnes', 'Salchicha, pechuga, lomo de res y cerdo', 33600, 38600, catSalchipapas.id, catSalchipapasGrat.id),
    ...normalGrat('Salchipapa Hawaiana', 'Salchicha, tocineta, jamón y piña', 21800, 25800, catSalchipapas.id, catSalchipapasGrat.id),
    ...normalGrat('Salchipapa Suiza', 'Con salchicha suiza premium', 18700, 22700, catSalchipapas.id, catSalchipapasGrat.id),
    ...normalGrat('Salchipapa con Lomito', 'Salchicha y lomo de res', 20000, 24000, catSalchipapas.id, catSalchipapasGrat.id),
    ...normalGrat('Salchipapa con Cerdo', 'Salchicha y cerdo magro', 19100, 23100, catSalchipapas.id, catSalchipapasGrat.id),
    ...normalGrat('Salchipapa con Pollo', 'Salchicha y filete de pechuga', 19100, 23100, catSalchipapas.id, catSalchipapasGrat.id),
    ...normalGrat('Salchipapa Chorizo Butifarra', 'Salchicha, chorizo y butifarra', 19400, 23400, catSalchipapas.id, catSalchipapasGrat.id),
    ...normalGrat('Ranchi Papa', 'Con salchicha ranchera premium', 22400, 26400, catSalchipapas.id, catSalchipapasGrat.id),
    ...normalGrat('Chori Papa', 'Con chorizo de ternera premium', 16600, 20600, catSalchipapas.id, catSalchipapasGrat.id),
    ...normalGrat('Salchipapa Sencilla', 'Salchicha manguera premium', 14500, 18500, catSalchipapas.id, catSalchipapasGrat.id),
  );

  // ── CHUZOS ──
  allItems.push(
    { name: 'Chuzo de Cerdo (Francesa/Patacón)', description: 'Cerdo magro con patacones o papas a la francesa', price: 13300, categoryId: catChuzosFrancesa.id },
    { name: 'Chuzo de Pollo (Francesa/Patacón)', description: 'Filete de pechuga con patacones o papas a la francesa', price: 13300, categoryId: catChuzosFrancesa.id },
    { name: 'Chuzo de Cerdo (Vapor)', description: 'Cerdo magro con papas al vapor', price: 11600, categoryId: catChuzosVapor.id },
    { name: 'Chuzo de Pollo (Vapor)', description: 'Filete de pechuga con papas al vapor', price: 11600, categoryId: catChuzosVapor.id },
  );

  // ── ASADOS CON PAPAS FRANCESAS ──
  allItems.push(
    { name: 'Lomo Fino de Res 300g', description: 'Lomo fino de res x300g antes de asar', price: 32000, categoryId: catAsadosFrancesa.id },
    { name: 'Lomo Fino de Res Encebollado', description: 'Lomo fino de res encebollado', price: 34000, categoryId: catAsadosFrancesa.id },
    { name: 'Lomo de Res 300g', description: 'Lomo de res 300g antes de asar', price: 25500, categoryId: catAsadosFrancesa.id },
    { name: 'Lomo de Res Encebollado', description: 'Lomo de res encebollado', price: 27500, categoryId: catAsadosFrancesa.id },
    { name: 'Lomo de Cerdo 300g', description: 'Lomo de cerdo x300g antes de asar', price: 24000, categoryId: catAsadosFrancesa.id },
    { name: 'Lomo de Cerdo Encebollado', description: 'Lomo de cerdo encebollado', price: 26000, categoryId: catAsadosFrancesa.id },
    { name: 'Pechuga 300g', description: 'Pechuga x300g antes de asar', price: 22000, categoryId: catAsadosFrancesa.id },
    { name: 'Pechuga Encebollada Gratinada', description: 'Pechuga encebollada y gratinada', price: 28000, categoryId: catAsadosFrancesa.id },
    { name: 'Pechuga Encebollada', description: 'Pechuga encebollada', price: 22500, categoryId: catAsadosFrancesa.id },
    { name: 'Porción Res 200g', description: 'Porción de carne de res x200g antes de asar', price: 18600, categoryId: catAsadosFrancesa.id },
    { name: 'Porción Cerdo 200g', description: 'Porción cerdo x200g antes de asar', price: 16500, categoryId: catAsadosFrancesa.id },
    { name: 'Porción Pechuga 200g', description: 'Porción pechuga x200g antes de asar', price: 15500, categoryId: catAsadosFrancesa.id },
  );

  // ── ASADOS CON PAPAS AL VAPOR ──
  allItems.push(
    { name: 'Lomo Fino de Res 300g (Vapor)', description: 'Lomo fino de res x300g antes de asar', price: 29800, categoryId: catAsadosVapor.id },
    { name: 'Lomo Fino Res Encebollado (Vapor)', description: 'Lomo fino de res encebollado', price: 31800, categoryId: catAsadosVapor.id },
    { name: 'Lomo de Res 300g (Vapor)', description: 'Lomo de res 300g antes de asar', price: 23300, categoryId: catAsadosVapor.id },
    { name: 'Lomo de Res Encebollado (Vapor)', description: 'Lomo de res encebollado', price: 25300, categoryId: catAsadosVapor.id },
    { name: 'Lomo de Cerdo 300g (Vapor)', description: 'Lomo de cerdo x300g antes de asar', price: 21800, categoryId: catAsadosVapor.id },
    { name: 'Lomo Cerdo Encebollado (Vapor)', description: 'Lomo de cerdo encebollado', price: 23800, categoryId: catAsadosVapor.id },
    { name: 'Pechuga 300g (Vapor)', description: 'Pechuga x300g antes de asar', price: 20300, categoryId: catAsadosVapor.id },
    { name: 'Pechuga Enceb. Gratinada (Vapor)', description: 'Pechuga encebollada y gratinada', price: 26300, categoryId: catAsadosVapor.id },
    { name: 'Pechuga Encebollada (Vapor)', description: 'Pechuga encebollada', price: 24000, categoryId: catAsadosVapor.id },
    { name: 'Porción Res 200g (Vapor)', description: 'Porción de carne de res x200g', price: 17000, categoryId: catAsadosVapor.id },
    { name: 'Porción Cerdo 200g (Vapor)', description: 'Porción cerdo x200g', price: 15000, categoryId: catAsadosVapor.id },
    { name: 'Porción Pechuga 200g (Vapor)', description: 'Porción pechuga x200g', price: 14000, categoryId: catAsadosVapor.id },
  );

  // ── ADICIONALES GENERALES ──
  allItems.push(
    { name: '1 Salchicha Súper Perro', description: 'Salchicha para perro', price: 2000, categoryId: catAdicionales.id },
    { name: 'Porción Salchicha Manguera 113g', description: 'Salchicha manguera premium', price: 3200, categoryId: catAdicionales.id },
    { name: '1 Salchicha Ranchera', description: 'Salchicha ranchera premium', price: 5600, categoryId: catAdicionales.id },
    { name: '1 Salchicha Suiza', description: 'Salchicha suiza premium completa', price: 7500, categoryId: catAdicionales.id },
    { name: 'Media Salchicha Suiza', description: 'Media salchicha suiza', price: 4000, categoryId: catAdicionales.id },
    { name: '1 Porción Butifarra', description: 'Porción de butifarra', price: 3300, categoryId: catAdicionales.id },
    { name: '1 Chorizo de Ternera', description: 'Chorizo de ternera premium', price: 2700, categoryId: catAdicionales.id },
    { name: 'Porción Tocineta 100g', description: 'Porción de tocineta 100g', price: 4000, categoryId: catAdicionales.id },
    { name: 'Papas a la Francesa 180g', description: 'Porción de papas a la francesa 180g', price: 5400, categoryId: catAdicionales.id },
    { name: 'Papas al Vapor 300g', description: 'Porción de papas al vapor 300g', price: 3000, categoryId: catAdicionales.id },
    { name: 'Porción Jamón 50g', description: 'Porción de jamón 50g', price: 3000, categoryId: catAdicionales.id },
    { name: 'Porción Maíz 100g', description: 'Porción de maíz x100g', price: 3400, categoryId: catAdicionales.id },
    { name: 'Patacones 7 Ud', description: 'Porción de patacones 7 unidades', price: 5400, categoryId: catAdicionales.id },
    { name: 'Carne Hamburguesa 100g', description: '1 carne de hamburguesa 100g', price: 4600, categoryId: catAdicionales.id },
    { name: 'Pollo Hamburguesa 130g', description: '1 porción de pollo de hamburguesa 130g', price: 4600, categoryId: catAdicionales.id },
    { name: 'Pollo en Trocitos 130g', description: '1 porción de pollo en trocitos 130g', price: 4600, categoryId: catAdicionales.id },
    { name: 'Cerdo en Trocitos 130g', description: 'Porción de cerdo en trocitos x130g', price: 4600, categoryId: catAdicionales.id },
    { name: 'Lomito en Trocitos 120g', description: 'Porción de lomito en trocitos x120g', price: 5500, categoryId: catAdicionales.id },
  );

  // ── BEBIDAS FAMILIAR ──
  allItems.push(
    { name: 'Coca-Cola 3L PET', description: 'Coca-Cola 3 litros PET', price: 15600, categoryId: catBebidasFamiliar.id },
    { name: 'Manzana Postobón 3.125L', description: 'Manzana Postobón 3.125 litros PET', price: 13000, categoryId: catBebidasFamiliar.id },
    { name: 'Gaseosa Postobón 1.5L', description: 'Gaseosa Postobón 1.5 litros PET', price: 7800, categoryId: catBebidasFamiliar.id },
    { name: 'Coca-Cola 1.5L', description: 'Coca-Cola 1.5 litros PET', price: 8600, categoryId: catBebidasFamiliar.id },
    { name: 'Kola Román 1.5L', description: 'Kola Román 1.5 litros NR', price: 7800, categoryId: catBebidasFamiliar.id },
    { name: 'Cuatro 1.5L', description: 'Cuatro 1.5 litros', price: 7800, categoryId: catBebidasFamiliar.id },
    { name: 'Jugo Hit 1L', description: 'Jugo Hit Tetra 1 litro', price: 7000, categoryId: catBebidasFamiliar.id },
  );

  // ── BEBIDAS PERSONAL ──
  allItems.push(
    { name: 'Gaseosa Postobón 400ml', description: 'Gaseosas Postobón PET 400', price: 3800, categoryId: catBebidasPersonal.id },
    { name: 'Coca-Cola 400ml', description: 'Coca-Cola PET 400', price: 4200, categoryId: catBebidasPersonal.id },
    { name: 'Cuatro 400ml', description: 'Cuatro PET 400', price: 3800, categoryId: catBebidasPersonal.id },
    { name: 'Kola Román 400ml', description: 'Kola Román PET 400', price: 3800, categoryId: catBebidasPersonal.id },
    { name: 'Jugo Hit 500ml', description: 'Jugo Hit 500ml', price: 4200, categoryId: catBebidasPersonal.id },
    { name: 'Bretaña 300ml', description: 'Bretaña 300ml', price: 3600, categoryId: catBebidasPersonal.id },
    { name: 'Agua 600ml', description: 'Agua botella 600ml', price: 2800, categoryId: catBebidasPersonal.id },
  );

  // ── BEBIDAS JUNIOR ──
  allItems.push(
    { name: 'Gaseosa Postobón 250ml', description: 'Gaseosa Postobón PET 250', price: 2500, categoryId: catBebidasJunior.id },
    { name: 'Coca-Cola 250ml', description: 'Coca-Cola PET 250', price: 2800, categoryId: catBebidasJunior.id },
    { name: 'Kola Román 250ml', description: 'Kola Román PET 250', price: 2500, categoryId: catBebidasJunior.id },
    { name: 'Agua 300ml', description: 'Agua botella 300ml', price: 1200, categoryId: catBebidasJunior.id },
  );

  // ══════════════════════════════════════════════════════════════
  // INSERTAR TODOS LOS ITEMS
  // ══════════════════════════════════════════════════════════════
  console.log(`Insertando ${allItems.length} productos del menú real...`);

  const categoryItemCounts = new Map<string, number>();

  for (const item of allItems) {
    let img = item.image;
    if (!img) {
      if (item.categoryId === catPerros.id) img = '/images/perro.png';
      else if (item.categoryId === catHamburguesas.id) img = '/images/hamburguesa.png';
      else if (item.categoryId === catChuzosFrancesa.id || item.categoryId === catChuzosVapor.id) img = '/images/chuzo.png';
      else if (item.categoryId === catAsadosFrancesa.id || item.categoryId === catAsadosVapor.id) {
        const lowerName = item.name.toLowerCase();
        if (lowerName.includes('pechuga')) {
          img = '/images/pechuga_asada.png';
        } else if (lowerName.includes('lomo')) {
          img = '/images/lomo_asado.png';
        } else {
          img = '/images/asado.png';
        }
      }
      else if (item.categoryId === catBebidasPersonal.id || item.categoryId === catBebidasFamiliar.id || item.categoryId === catBebidasJunior.id) img = '/images/bebidas.png';
      else if (item.categoryId === catAdicionales.id) img = '/images/salchipapa.png';
    }

    const count = categoryItemCounts.get(item.categoryId) || 0;
    categoryItemCounts.set(item.categoryId, count + 1);
    const itemSortOrder = count;

    // Generar un código único
    const catPrefix = item.categoryId.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'C') || 'PRD';
    const code = `${catPrefix}-${String(count + 1).padStart(3, '0')}`;

    const existingItem = await prisma.menuItem.findFirst({
      where: {
        name: { equals: item.name, mode: 'insensitive' },
        categoryId: item.categoryId,
      },
    });

    if (existingItem) {
      await prisma.menuItem.update({
        where: { id: existingItem.id },
        data: {
          active: true,
          description: item.description,
          price: item.price,
          image: img,
          sortOrder: itemSortOrder,
          code: existingItem.code || code, // Asignar código si no tiene
        },
      });
    } else {
      await prisma.menuItem.create({
        data: {
          name: item.name,
          description: item.description,
          price: item.price,
          categoryId: item.categoryId,
          image: img,
          sortOrder: itemSortOrder,
          code, // Guardar el código generado
        },
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // BARRIOS DE MONTERÍA
  // ══════════════════════════════════════════════════════════════
  const monteriaBarrios: { name: string; rate: number; zoneGroup: string }[] = [
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
    { name: 'Morindó', zoneGroup: 'Sur', rate: 4500 },
    { name: 'Los Laureles', zoneGroup: 'Sur', rate: 4500 },
    { name: 'Villa Fátima', zoneGroup: 'Sur', rate: 5000 },
    { name: 'La Castellana', zoneGroup: 'Sur', rate: 5000 },
    { name: 'San Antonio', zoneGroup: 'Oriente', rate: 5000 },
    { name: 'El Edén', zoneGroup: 'Oriente', rate: 5500 },
    { name: 'Bruselas', zoneGroup: 'Oriente', rate: 5500 },
    { name: 'La Ribera', zoneGroup: 'Occidente', rate: 5000 },
    { name: 'San José', zoneGroup: 'Occidente', rate: 5000 },
    { name: 'Ciudad Jardín', zoneGroup: 'Occidente', rate: 5500 },
    { name: 'Pueblo Nuevo', zoneGroup: 'Periferia', rate: 6000 },
    { name: 'El Tambo', zoneGroup: 'Periferia', rate: 6000 },
    { name: 'Los Cocos', zoneGroup: 'Periferia', rate: 6500 },
    { name: 'La Ribera Norte', zoneGroup: 'Periferia', rate: 6500 },
  ];

  const zoneCount = await prisma.deliveryZone.count();
  if (zoneCount === 0) {
    for (const zone of monteriaBarrios) {
      await prisma.deliveryZone.create({ data: zone });
    }
  }

  // Cajas registradoras
  const registerCount = await prisma.cashRegister.count();
  if (registerCount === 0) {
    await prisma.cashRegister.createMany({
      data: [
        { name: 'Caja Principal', description: 'Mostrador principal del restaurante', managerId: cajero?.id },
        { name: 'Caja Domicilios', description: 'Operadores de pedidos WhatsApp', managerId: admin?.id },
      ],
    });
  }

  // Ingredientes reales de THE VILLA DOG
  const ingCount = await prisma.ingredient.count();
  if (ingCount === 0) {
    const ingredients = [
      { name: 'Queso Mozzarella', unit: 'g', stock: 10000, minStock: 2000, costPerUnit: 28 },
      { name: 'Jamón', unit: 'g', stock: 5000, minStock: 1000, costPerUnit: 22 },
      { name: 'Pollo Pechuga', unit: 'g', stock: 5000, minStock: 1000, costPerUnit: 18 },
      { name: 'Salami', unit: 'g', stock: 3000, minStock: 500, costPerUnit: 35 },
      { name: 'Pepperoni', unit: 'g', stock: 2000, minStock: 500, costPerUnit: 42 },
      { name: 'Tocineta Ahumada', unit: 'g', stock: 2000, minStock: 500, costPerUnit: 38 },
      { name: 'Chorizo de Ternera', unit: 'unidad', stock: 100, minStock: 20, costPerUnit: 2700 },
      { name: 'Salchicha Long', unit: 'unidad', stock: 150, minStock: 30, costPerUnit: 1500 },
      { name: 'Salchicha Suiza Premium', unit: 'unidad', stock: 50, minStock: 10, costPerUnit: 5500 },
      { name: 'Salchicha Ranchera', unit: 'unidad', stock: 60, minStock: 15, costPerUnit: 4200 },
      { name: 'Butifarra', unit: 'unidad', stock: 80, minStock: 20, costPerUnit: 2500 },
      { name: 'Carne Hamburguesa 100g', unit: 'unidad', stock: 80, minStock: 15, costPerUnit: 3500 },
      { name: 'Lomo de Res', unit: 'g', stock: 5000, minStock: 1000, costPerUnit: 32 },
      { name: 'Cerdo Magro', unit: 'g', stock: 5000, minStock: 1000, costPerUnit: 20 },
      { name: 'Papa (francesa)', unit: 'g', stock: 20000, minStock: 5000, costPerUnit: 3 },
      { name: 'Papa (vapor)', unit: 'g', stock: 15000, minStock: 3000, costPerUnit: 3 },
      { name: 'Plátano (patacón)', unit: 'unidad', stock: 100, minStock: 20, costPerUnit: 800 },
      { name: 'Maíz Tierno', unit: 'g', stock: 3000, minStock: 500, costPerUnit: 8 },
      { name: 'Piña', unit: 'g', stock: 2000, minStock: 400, costPerUnit: 5 },
      { name: 'Champiñones', unit: 'g', stock: 1500, minStock: 300, costPerUnit: 18 },
      { name: 'Queso Costeño', unit: 'g', stock: 5000, minStock: 1000, costPerUnit: 20 },
      { name: 'Masa de Pizza', unit: 'unidad', stock: 100, minStock: 20, costPerUnit: 2500 },
      { name: 'Pan Hamburguesa', unit: 'unidad', stock: 80, minStock: 15, costPerUnit: 1200 },
      { name: 'Pan Perro', unit: 'unidad', stock: 100, minStock: 20, costPerUnit: 800 },
      { name: 'Empaque Domicilio', unit: 'unidad', stock: 200, minStock: 30, costPerUnit: 800 },
      { name: 'Salsa The Villa Dog', unit: 'ml', stock: 5000, minStock: 1000, costPerUnit: 5 },
      { name: 'Cervecero', unit: 'unidad', stock: 80, minStock: 15, costPerUnit: 2200 },
    ];
    for (const ing of ingredients) {
      await prisma.ingredient.create({ data: ing });
    }
  }

  const badgeCount = await prisma.badge.count();
  if (badgeCount === 0) {
    const badges = [
      { name: 'Rey de Ventas', description: 'Mayor ventas de la semana', icon: 'Trophy', condition: 'top-sales-week', pointsRequired: 100 },
      { name: 'Más Rápido', description: 'Menor tiempo promedio de entrega', icon: 'Zap', condition: 'fastest-delivery', pointsRequired: 80 },
      { name: 'Favorito del Cliente', description: 'Mejor calificación promedio', icon: 'Star', condition: 'top-rated', pointsRequired: 80 },
      { name: 'Racha de 5', description: '5 días consecutivos con más de 10 domicilios', icon: 'Flame', condition: 'five-day-streak', pointsRequired: 120 },
      { name: 'Novato del Mes', description: 'Mejor mesero nuevo del mes', icon: 'Award', condition: 'rookie-month', pointsRequired: 50 },
      { name: 'Propina Máxima', description: 'Más propinas acumuladas', icon: 'DollarSign', condition: 'top-tips', pointsRequired: 70 },
    ];
    for (const badge of badges) {
      await prisma.badge.create({ data: badge });
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  ✅ Seed completado con menú REAL de THE VILLA DOG');
  console.log(`  📋 ${allItems.length} productos del menú cargados`);
  console.log('  🏷️  20 categorías creadas');
  console.log('  🧑‍🍳 27 ingredientes de inventario');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('CREDENCIALES:');
  console.log('  SuperAdmin:  jose@thevilladog.local / admin123');
  console.log('  Admin:       admin@thevilladog.local / admin123');
  console.log('  Cajeros:     cajero@thevilladog.local, cajero2@thevilladog.local / caja123');
  console.log('  Domicilios:  domicilios@thevilladog.local / caja123');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
