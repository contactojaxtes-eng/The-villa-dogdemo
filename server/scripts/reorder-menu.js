const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const categoryOrder = [
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

const pizzaClasicasBases = [
  'Pizza Solo Queso',
  'Pizza Jamón y Queso',
  'Pizza Salami',
  'Pizza Hawaiana',
  'Pizza con Pollo',
  'Pizza con Tocineta',
  'Pizza Maíz y Queso',
  'Pizza con Pepperoni',
  'Pizza con Chorizo',
  'Pizza Vegetales',
  'Pizza con Champiñones'
];

const pizzaEspecialidadesBases = [
  'Pizza Pollo Jamón',
  'Pizza Ranchera',
  'Pizza Pollo Tocineta',
  'Pizza Pollo Hawaiana',
  'Pizza Pollo Champiñones',
  'Pizza Americana',
  'Pizza Especial Tío The Villa Dog',
  'Pizza Salami Pollo',
  'Pizza Especial 4 Carnes',
  'Pizza Semi-Remontada'
];

const adicionalesPizzaBases = [
  'Adic. Queso Mozzarella',
  'Adic. Jamón',
  'Adic. Pollo',
  'Adic. Salami',
  'Adic. Ranchera',
  'Adic. Chorizo',
  'Adic. Tocineta',
  'Adic. Pepperoni',
  'Adic. Maíz Tierno',
  'Adic. Piña',
  'Adic. Champiñones',
  'Adic. Cebolla',
  'Adic. Pimentón',
  'Adic. Tomate',
  'Borde Relleno Queso',
  'Borde Relleno Bocadillo',
  'Borde Relleno Mixto'
];

const perrosBases = [
  'Perro Super The Villa Dog',
  'Perro Ítalo Suizo',
  'Perro Especial The Villa Dog',
  'Combo Perro',
  'Perro Ítalo Ranchero',
  'Perro Suizo',
  'Perro Americano',
  'Perro con Pollo',
  'Perro Escocés',
  'Perro Ranchero',
  'Perro Gemelo',
  'Perro con Tocineta',
  'Chori Perro',
  'Perro Suizito',
  'Perro Sencillo'
];

const hamburguesasBases = [
  'Súper Especial The Villa Dog',
  'Especial The Villa Dog',
  'Combo Hamburguesa',
  'Ranchera Especial',
  'Hamburguesa Mixta',
  'Doble Carne',
  'Hamburguesa Sencilla',
  'Hamburguesa con Pollo'
];

const pataconesBases = [
  'Señor The Villa Dog Patacón',
  'Patacón con Todo',
  'Patacón Trifásico',
  'Patacón Suizo al Gratín',
  'Patacón Mixto',
  'Patacón con Lomito',
  'Patacón con Cerdo',
  'Patacón con Pollo',
  'Patacón Suiza Chorizo Butifarra',
  'Patacón Pollo y Ranchera',
  'Patacón con Ranchera'
];

const salvajadasBases = [
  'Salvajada Chica',
  'Salvajada Matrimonio',
  'Salvajada Trío',
  'Salvajada Súper',
  'Salvajada The Villa Dog',
  'Salvajada Extralarge',
  'Salvajadita'
];

const suizosFrancesasBases = [
  'Suizo Especial The Villa Dog',
  'Suizo Súper con Todo',
  'Suizo con Todo',
  'Suizo Especial con Lomito',
  'Suizo Especial con Cerdo',
  'Suizo Especial con Pollo',
  'Suizo Ranchero',
  'Súper Suizo',
  'Suizo Chorizo y Butifarra'
];

const miniSuizosBases = [
  'Mini Suizo con Lomito (Francesa)',
  'Mini Suizo con Cerdo (Francesa)',
  'Mini Suizo con Pollo (Francesa)',
  'Mini Suizo Sencillo (Francesa)',
  'Mini Suizo con Lomito (Vapor)',
  'Mini Suizo con Cerdo (Vapor)',
  'Mini Suizo con Pollo (Vapor)',
  'Mini Suizo Sencillo (Vapor)'
];

const suizosVaporBases = [
  'Suizo Esp. The Villa Dog (Vapor)',
  'Suizo Súper con Todo (Vapor)',
  'Suizo con Todo (Vapor)',
  'Suizo Esp. Lomito (Vapor)',
  'Suizo Esp. Cerdo (Vapor)',
  'Suizo Esp. Pollo (Vapor)',
  'Suizo Ranchero (Vapor)',
  'Súper Suizo (Vapor)',
  'Suizo Chorizo Butifarra (Vapor)'
];

const picadasBases = [
  'Picada Súper Especial The Villa Dog',
  'Picada Especial The Villa Dog',
  'Picada Súper con Todo',
  'Picada con Todo',
  'Picada Escocesa',
  'Picada 4 Carnes',
  'Picada Trifásica',
  'Picada Mixta',
  'Picada con Lomito',
  'Picada con Cerdo',
  'Picada con Pollo',
  'Picada Suiza Chorizo Butifarra',
  'Picada Pollo y Ranchera',
  'Picada con Ranchera'
];

const maicitosBases = [
  'Maicito 4 Carnes',
  'Maicito con Todo',
  'Maicito Trifásico',
  'Maicito Ranchera y Pollo',
  'Maicito Hawaiano',
  'Maicito con Ranchera',
  'Maicito con Lomito',
  'Maicito con Cerdo',
  'Maicito con Pollo',
  'Maíz Americano Sencillo'
];

const salchipapasBases = [
  'Salchipapa Súper con Todo',
  'Salchipapa con Todo',
  'Salchipapa 4 Carnes',
  'Salchipapa Hawaiana',
  'Salchipapa Suiza',
  'Salchipapa con Lomito',
  'Salchipapa con Cerdo',
  'Salchipapa con Pollo',
  'Salchipapa Chorizo Butifarra',
  'Ranchi Papa',
  'Chori Papa',
  'Salchipapa Sencilla'
];

const chuzosBases = [
  'Chuzo de Cerdo (Francesa/Patacón)',
  'Chuzo de Pollo (Francesa/Patacón)',
  'Chuzo de Cerdo (Vapor)',
  'Chuzo de Pollo (Vapor)'
];

const asadosFrancesasBases = [
  'Lomo Fino de Res 300g',
  'Lomo Fino de Res Encebollado',
  'Lomo de Res 300g',
  'Lomo de Res Encebollado',
  'Lomo de Cerdo 300g',
  'Lomo de Cerdo Encebollado',
  'Pechuga 300g',
  'Pechuga Encebollada Gratinada',
  'Pechuga Encebollada',
  'Porción Res 200g',
  'Porción Cerdo 200g',
  'Porción Pechuga 200g'
];

const asadosVaporBases = [
  'Lomo Fino de Res 300g (Vapor)',
  'Lomo Fino Res Encebollado (Vapor)',
  'Lomo de Res 300g (Vapor)',
  'Lomo de Res Encebollado (Vapor)',
  'Lomo de Cerdo 300g (Vapor)',
  'Lomo Cerdo Encebollado (Vapor)',
  'Pechuga 300g (Vapor)',
  'Pechuga Enceb. Gratinada (Vapor)',
  'Pechuga Encebollada (Vapor)',
  'Porción Res 200g (Vapor)',
  'Porción Cerdo 200g (Vapor)',
  'Porción Pechuga 200g (Vapor)'
];

const adicionalesGeneralesBases = [
  '1 Salchicha Súper Perro',
  'Porción Salchicha Manguera 113g',
  '1 Salchicha Ranchera',
  '1 Salchicha Suiza',
  'Media Salchicha Suiza',
  '1 Porción Butifarra',
  '1 Chorizo de Ternera',
  'Porción Tocineta 100g',
  'Papas a la Francesa 180g',
  'Papas al Vapor 300g',
  'Porción Jamón 50g',
  'Porción Maíz 100g',
  'Patacones 7 Ud',
  'Carne Hamburguesa 100g',
  'Pollo Hamburguesa 130g',
  'Pollo en Trocitos 130g',
  'Cerdo en Trocitos 130g',
  'Lomito en Trocitos 120g'
];

const bebidasFamiliarBases = [
  'Coca-Cola 3L PET',
  'Manzana Postobón 3.125L',
  'Gaseosa Postobón 1.5L',
  'Coca-Cola 1.5L',
  'Kola Román 1.5L',
  'Cuatro 1.5L',
  'Jugo Hit 1L'
];

const bebidasPersonalBases = [
  'Gaseosa Postobón 400ml',
  'Coca-Cola 400ml',
  'Cuatro 400ml',
  'Kola Román 400ml',
  'Jugo Hit 500ml',
  'Bretaña 300ml',
  'Agua 600ml'
];

const bebidasJuniorBases = [
  'Gaseosa Postobón 250ml',
  'Coca-Cola 250ml',
  'Kola Román 250ml',
  'Agua 300ml'
];

function getSizeOrder(name) {
  const n = name.toLowerCase();
  if (n.includes('personal')) return 0;
  if (n.includes('mediana')) return 1;
  if (n.includes('semifamiliar')) return 2;
  if (n.includes('familiar') || n.includes('extralarge') || n.includes('extragrande')) return 3;
  return 0;
}

function getBaseIndex(name, basesList) {
  for (let i = 0; i < basesList.length; i++) {
    const base = basesList[i].toLowerCase();
    const cleanName = name.toLowerCase();
    if (cleanName.startsWith(base) || cleanName.includes(base)) {
      return i;
    }
  }
  return 999;
}

async function main() {
  console.log('🔄 === ORDENAMIENTO DE MENÚ THE VILLA DOG ===\n');

  const dbCategories = await prisma.menuCategory.findMany();
  console.log(`Categorías encontradas en DB: ${dbCategories.length}`);

  for (const cat of dbCategories) {
    const normName = cat.name.trim();
    let orderIndex = categoryOrder.indexOf(normName);
    if (orderIndex === -1) {
      orderIndex = categoryOrder.findIndex(c => c.toLowerCase() === normName.toLowerCase());
    }
    if (orderIndex === -1) {
      orderIndex = categoryOrder.length + 10;
    }

    await prisma.menuCategory.update({
      where: { id: cat.id },
      data: { sortOrder: orderIndex, active: normName !== 'jose' }
    });
    console.log(`🏷️  Categoría "${normName}" -> sortOrder: ${orderIndex}`);
  }

  const finalCategories = await prisma.menuCategory.findMany({
    orderBy: { sortOrder: 'asc' }
  });

  for (const cat of finalCategories) {
    const items = await prisma.menuItem.findMany({
      where: { categoryId: cat.id }
    });

    if (items.length === 0) continue;

    console.log(`\n📦 Ordenando items para categoría: "${cat.name}" (${items.length} items)...`);

    let basesList = [];
    let isPizzaType = false;

    switch (cat.name) {
      case 'Pizzas Clásicas':
        basesList = pizzaClasicasBases;
        isPizzaType = true;
        break;
      case 'Pizzas Especialidades':
        basesList = pizzaEspecialidadesBases;
        isPizzaType = true;
        break;
      case 'Adicionales para Pizza':
        basesList = adicionalesPizzaBases;
        isPizzaType = true;
        break;
      case 'Perros Calientes':
        basesList = perrosBases;
        break;
      case 'Hamburguesas':
        basesList = hamburguesasBases;
        break;
      case 'Patacones Rellenos':
      case 'Patacones Gratinados':
        basesList = pataconesBases;
        break;
      case 'Salvajadas':
      case 'Salvajadas Gratinadas':
        basesList = salvajadasBases;
        break;
      case 'Suizos c/ Papas Francesas':
      case 'Suizos c/ Papas Francesas Gratinados':
        basesList = suizosFrancesasBases;
        break;
      case 'Mini Suizos c/ Papas Francesas':
      case 'Mini Suizos c/ Papas Francesas Gratinados':
      case 'Mini Suizos c/ Papas al Vapor':
      case 'Mini Suizos c/ Papas al Vapor Gratinados':
        basesList = miniSuizosBases;
        break;
      case 'Suizos c/ Papas al Vapor':
      case 'Suizos c/ Papas al Vapor Gratinados':
        basesList = suizosVaporBases;
        break;
      case 'Picadas':
      case 'Picadas Gratinadas':
        basesList = picadasBases;
        break;
      case 'Maicitos':
      case 'Maicitos Gratinados':
        basesList = maicitosBases;
        break;
      case 'Salchipapas':
      case 'Salchipapas Gratinadas':
        basesList = salchipapasBases;
        break;
      case 'Chuzos c/ Papas Francesas':
      case 'Chuzos c/ Papas al Vapor':
        basesList = chuzosBases;
        break;
      case 'Asados c/ Papas Francesas':
        basesList = asadosFrancesasBases;
        break;
      case 'Asados c/ Papas al Vapor':
        basesList = asadosVaporBases;
        break;
      case 'Adicionales':
        basesList = adicionalesGeneralesBases;
        break;
      case 'Bebidas Familiar':
        basesList = bebidasFamiliarBases;
        break;
      case 'Bebidas Personal':
        basesList = bebidasPersonalBases;
        break;
      case 'Bebidas Junior':
        basesList = bebidasJuniorBases;
        break;
    }

    const sortedItems = [...items].sort((a, b) => {
      const idxA = getBaseIndex(a.name, basesList);
      const idxB = getBaseIndex(b.name, basesList);

      if (idxA !== idxB) {
        return idxA - idxB;
      }

      if (isPizzaType) {
        return getSizeOrder(a.name) - getSizeOrder(b.name);
      } else {
        const aGrat = a.name.toLowerCase().includes('gratinado') || a.name.toLowerCase().includes('gratín');
        const bGrat = b.name.toLowerCase().includes('gratinado') || b.name.toLowerCase().includes('gratín');
        if (aGrat !== bGrat) {
          return aGrat ? 1 : -1;
        }
      }

      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < sortedItems.length; i++) {
      const item = sortedItems[i];
      await prisma.menuItem.update({
        where: { id: item.id },
        data: { sortOrder: i }
      });
    }

    console.log(`  ✅ ${sortedItems.length} items ordenados.`);
  }

  console.log('\n🌟 === REORDENAMIENTO COMPLETADO CON ÉXITO ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
