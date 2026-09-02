const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seed() {
  console.log('Seeding data...');
  try {
    const category = await prisma.category.create({
      data: {
        name: 'Pizzas Especiales',
        slug: 'pizzas-especiales',
        description: 'Pizzas con ingredientes premium',
        isActive: true,
      }
    });
    
    await prisma.product.create({
      data: {
        name: 'Pizza The Villa Dog Familiar',
        slug: 'pizza-niche-familiar',
        description: 'La especialidad de la casa con 5 carnes.',
        price: 35000,
        categoryId: category.id,
        isActive: true,
        stock: 50,
      }
    });

    await prisma.ingredient.create({
      data: {
        name: 'Queso Mozzarella',
        unit: 'GR',
        currentStock: 5000,
        minimumStock: 1000,
        costPerUnit: 15,
      }
    });

    console.log('Data seeded successfully!');
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
seed();
