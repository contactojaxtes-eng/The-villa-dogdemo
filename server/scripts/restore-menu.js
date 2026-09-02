const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');

async function restore() {
  console.log('Restoring menu from backup...');
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'recovered_menu.json'), 'utf8'));
  
  // Get unique categories
  const categoryNames = [...new Set(data.map(d => d.category))];
  
  const catMap = {};
  for (const cName of categoryNames) {
    const cat = await prisma.menuCategory.create({
      data: {
        name: cName,
        description: cName
      }
    });
    catMap[cName] = cat.id;
  }
  
  // Insert items
  let count = 0;
  for (const item of data) {
    await prisma.menuItem.create({
      data: {
        name: item.name,
        price: item.price,
        categoryId: catMap[item.category],
        active: true
      }
    });
    count++;
  }
  
  console.log(`Successfully restored ${count} menu items across ${categoryNames.length} categories.`);
}

restore().catch(console.error).finally(() => prisma.$disconnect());
