const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const newCategoryOrder = [
  'Pizzas Clásicas',
  'Pizzas Especialidades',
  'Adicionales para Pizza',
  'Perros Calientes',
  'Hamburguesas',
  'Patacones Rellenos',
  'Patacones Gratinados',
  'Salvajadas',
  'Salvajadas Gratinadas',
  'Suizos c/ Papas Francesas',
  'Suizos c/ Papas Francesas Gratinados',
  'Mini Suizos c/ Papas Francesas',
  'Mini Suizos c/ Papas Francesas Gratinados',
  'Suizos c/ Papas al Vapor',
  'Suizos c/ Papas al Vapor Gratinados',
  'Mini Suizos c/ Papas al Vapor',
  'Mini Suizos c/ Papas al Vapor Gratinados',
  'Picadas',
  'Picadas Gratinadas',
  'Maicitos',
  'Maicitos Gratinados',
  'Salchipapas',
  'Salchipapas Gratinadas',
  'Chuzos c/ Papas Francesas',
  'Chuzos c/ Papas al Vapor',
  'Asados c/ Papas Francesas',
  'Asados c/ Papas al Vapor',
  'Adicionales',
  'Bebidas Familiar',
  'Bebidas Personal',
  'Bebidas Junior'
];

async function main() {
  console.log('🏗️  === MIGRACIÓN DE CATEGORÍAS THE VILLA DOG ===\n');

  // Helper to get or create a category
  const getOrCreateCategory = async (name, description) => {
    let cat = await prisma.menuCategory.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } }
    });
    if (!cat) {
      cat = await prisma.menuCategory.create({
        data: { name, description }
      });
      console.log(`🆕 Creada categoría: "${name}" (${cat.id})`);
    } else {
      console.log(`ℹ️  Categoría existente: "${name}" (${cat.id})`);
    }
    return cat;
  };

  // 1. Crear las nuevas categorías requeridas
  const catPataconesNorm = await getOrCreateCategory('Patacones Rellenos', 'Con vegetales, papa triturada y queso costeño');
  const catPataconesGrat = await getOrCreateCategory('Patacones Gratinados', 'Con vegetales, papa triturada y queso mozzarella gratinado');
  
  const catSalvajadasNorm = await getOrCreateCategory('Salvajadas', 'Con vegetales, papas a la francesa, queso costeño y papa triturada');
  const catSalvajadasGrat = await getOrCreateCategory('Salvajadas Gratinadas', 'Salvajadas con queso mozzarella gratinado');
  
  const catSuizosFranNorm = await getOrCreateCategory('Suizos c/ Papas Francesas', 'Con salchicha suiza premium y papas a la francesa');
  const catSuizosFranGrat = await getOrCreateCategory('Suizos c/ Papas Francesas Gratinados', 'Suizos con papas a la francesa y queso gratinado');
  
  const catMiniSuizosFranNorm = await getOrCreateCategory('Mini Suizos c/ Papas Francesas', 'Versión mini con salchicha suiza y papas a la francesa');
  const catMiniSuizosFranGrat = await getOrCreateCategory('Mini Suizos c/ Papas Francesas Gratinados', 'Mini suizos con papas a la francesa gratinados');
  
  const catSuizosVapNorm = await getOrCreateCategory('Suizos c/ Papas al Vapor', 'Con salchicha suiza premium y papas al vapor');
  const catSuizosVapGrat = await getOrCreateCategory('Suizos c/ Papas al Vapor Gratinados', 'Suizos con papas al vapor y queso gratinado');
  
  const catMiniSuizosVapNorm = await getOrCreateCategory('Mini Suizos c/ Papas al Vapor', 'Versión mini con salchicha suiza y papas al vapor');
  const catMiniSuizosVapGrat = await getOrCreateCategory('Mini Suizos c/ Papas al Vapor Gratinados', 'Mini suizos con papas al vapor gratinados');
  
  const catPicadasNorm = await getOrCreateCategory('Picadas', 'Con vegetales, papa triturada y queso costeño');
  const catPicadasGrat = await getOrCreateCategory('Picadas Gratinadas', 'Picadas con queso mozzarella gratinado');
  
  const catMaicitosNorm = await getOrCreateCategory('Maicitos', 'Con vegetales, queso costeño y papa triturada');
  const catMaicitosGrat = await getOrCreateCategory('Maicitos Gratinados', 'Maicitos con queso mozzarella gratinado');
  
  const catSalchipapasNorm = await getOrCreateCategory('Salchipapas', 'Con papas a la francesa, vegetales y queso costeño');
  const catSalchipapasGrat = await getOrCreateCategory('Salchipapas Gratinadas', 'Salchipapas con queso mozzarella gratinado');
  
  const catChuzosFran = await getOrCreateCategory('Chuzos c/ Papas Francesas', 'Chuzos con patacones o papas a la francesa');
  const catChuzosVap = await getOrCreateCategory('Chuzos c/ Papas al Vapor', 'Chuzos con papas al vapor');

  // 2. Redistribuir items en el menú
  console.log('\n📦 Redistribuyendo productos...');

  // Patacones Rellenos
  let res = await prisma.menuItem.updateMany({
    where: {
      categoryId: catPataconesNorm.id,
      OR: [
        { name: { contains: 'gratinado', mode: 'insensitive' } },
        { name: { contains: 'gratín', mode: 'insensitive' } }
      ]
    },
    data: { categoryId: catPataconesGrat.id }
  });
  console.log(`➡️  Movidos ${res.count} patacones a "Patacones Gratinados"`);

  // Salvajadas
  res = await prisma.menuItem.updateMany({
    where: {
      categoryId: catSalvajadasNorm.id,
      name: { contains: 'gratinado', mode: 'insensitive' }
    },
    data: { categoryId: catSalvajadasGrat.id }
  });
  console.log(`➡️  Movidos ${res.count} salvajadas a "Salvajadas Gratinadas"`);

  // Suizos c/ Papas Francesas
  res = await prisma.menuItem.updateMany({
    where: {
      categoryId: catSuizosFranNorm.id,
      name: { contains: 'gratinado', mode: 'insensitive' }
    },
    data: { categoryId: catSuizosFranGrat.id }
  });
  console.log(`➡️  Movidos ${res.count} suizos francesa a "Suizos c/ Papas Francesas Gratinados"`);

  // Suizos c/ Papas al Vapor
  res = await prisma.menuItem.updateMany({
    where: {
      categoryId: catSuizosVapNorm.id,
      name: { contains: 'gratinado', mode: 'insensitive' }
    },
    data: { categoryId: catSuizosVapGrat.id }
  });
  console.log(`➡️  Movidos ${res.count} suizos vapor a "Suizos c/ Papas al Vapor Gratinados"`);

  // Picadas
  res = await prisma.menuItem.updateMany({
    where: {
      categoryId: catPicadasNorm.id,
      name: { contains: 'gratinado', mode: 'insensitive' }
    },
    data: { categoryId: catPicadasGrat.id }
  });
  console.log(`➡️  Movidos ${res.count} picadas a "Picadas Gratinadas"`);

  // Maicitos
  res = await prisma.menuItem.updateMany({
    where: {
      categoryId: catMaicitosNorm.id,
      name: { contains: 'gratinado', mode: 'insensitive' }
    },
    data: { categoryId: catMaicitosGrat.id }
  });
  console.log(`➡️  Movidos ${res.count} maicitos a "Maicitos Gratinados"`);

  // Salchipapas
  res = await prisma.menuItem.updateMany({
    where: {
      categoryId: catSalchipapasNorm.id,
      name: { contains: 'gratinado', mode: 'insensitive' }
    },
    data: { categoryId: catSalchipapasGrat.id }
  });
  console.log(`➡️  Movidos ${res.count} salchipapas a "Salchipapas Gratinadas"`);

  // Mini Suizos (Manejo de la categoría antigua "Mini Suizos")
  const oldMiniSuizosCat = await prisma.menuCategory.findFirst({
    where: { name: 'Mini Suizos' }
  });
  if (oldMiniSuizosCat) {
    // Francesa - Normal
    res = await prisma.menuItem.updateMany({
      where: {
        categoryId: oldMiniSuizosCat.id,
        name: { contains: '(Francesa)', mode: 'insensitive' },
        NOT: { name: { contains: 'gratinado', mode: 'insensitive' } }
      },
      data: { categoryId: catMiniSuizosFranNorm.id }
    });
    console.log(`➡️  Movidos ${res.count} mini suizos francesa normal`);

    // Francesa - Gratinado
    res = await prisma.menuItem.updateMany({
      where: {
        categoryId: oldMiniSuizosCat.id,
        name: { contains: '(Francesa)', mode: 'insensitive' },
        name: { contains: 'gratinado', mode: 'insensitive' }
      },
      data: { categoryId: catMiniSuizosFranGrat.id }
    });
    console.log(`➡️  Movidos ${res.count} mini suizos francesa gratinados`);

    // Vapor - Normal
    res = await prisma.menuItem.updateMany({
      where: {
        categoryId: oldMiniSuizosCat.id,
        name: { contains: '(Vapor)', mode: 'insensitive' },
        NOT: { name: { contains: 'gratinado', mode: 'insensitive' } }
      },
      data: { categoryId: catMiniSuizosVapNorm.id }
    });
    console.log(`➡️  Movidos ${res.count} mini suizos vapor normal`);

    // Vapor - Gratinado
    res = await prisma.menuItem.updateMany({
      where: {
        categoryId: oldMiniSuizosCat.id,
        name: { contains: '(Vapor)', mode: 'insensitive' },
        name: { contains: 'gratinado', mode: 'insensitive' }
      },
      data: { categoryId: catMiniSuizosVapGrat.id }
    });
    console.log(`➡️  Movidos ${res.count} mini suizos vapor gratinados`);

    // Eliminar la categoría antigua si quedó vacía
    const count = await prisma.menuItem.count({ where: { categoryId: oldMiniSuizosCat.id } });
    if (count === 0) {
      await prisma.menuCategory.delete({ where: { id: oldMiniSuizosCat.id } });
      console.log(`🗑️  Eliminada categoría vacía antigua "Mini Suizos"`);
    } else {
      console.log(`⚠️  La categoría antigua "Mini Suizos" todavía contiene ${count} items.`);
    }
  }

  // Chuzos (Manejo de la categoría antigua "Chuzos")
  const oldChuzosCat = await prisma.menuCategory.findFirst({
    where: { name: 'Chuzos' }
  });
  if (oldChuzosCat) {
    // Francesa
    res = await prisma.menuItem.updateMany({
      where: {
        categoryId: oldChuzosCat.id,
        name: { contains: 'Francesa', mode: 'insensitive' }
      },
      data: { categoryId: catChuzosFran.id }
    });
    console.log(`➡️  Movidos ${res.count} chuzos a "Chuzos c/ Papas Francesas"`);

    // Vapor
    res = await prisma.menuItem.updateMany({
      where: {
        categoryId: oldChuzosCat.id,
        name: { contains: 'Vapor', mode: 'insensitive' }
      },
      data: { categoryId: catChuzosVap.id }
    });
    console.log(`➡️  Movidos ${res.count} chuzos a "Chuzos c/ Papas al Vapor"`);

    // Eliminar la categoría antigua si quedó vacía
    const count = await prisma.menuItem.count({ where: { categoryId: oldChuzosCat.id } });
    if (count === 0) {
      await prisma.menuCategory.delete({ where: { id: oldChuzosCat.id } });
      console.log(`🗑️  Eliminada categoría vacía antigua "Chuzos"`);
    } else {
      console.log(`⚠️  La categoría antigua "Chuzos" todavía contiene ${count} items.`);
    }
  }

  // 3. Actualizar orden de las categorías
  console.log('\n🏷️  Ordenando categorías...');
  const allCats = await prisma.menuCategory.findMany();
  for (const cat of allCats) {
    let orderIndex = newCategoryOrder.indexOf(cat.name);
    if (orderIndex === -1) {
      orderIndex = newCategoryOrder.findIndex(c => c.toLowerCase() === cat.name.toLowerCase());
    }
    if (orderIndex === -1) {
      orderIndex = newCategoryOrder.length + 10;
    }
    await prisma.menuCategory.update({
      where: { id: cat.id },
      data: { sortOrder: orderIndex, active: cat.name !== 'jose' }
    });
    console.log(`   "${cat.name}" -> sortOrder: ${orderIndex}`);
  }

  console.log('\n🌟 === MIGRACIÓN DE CATEGORÍAS COMPLETADA ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
