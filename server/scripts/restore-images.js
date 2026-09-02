const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');

async function restoreImages() {
  console.log('Restoring images...');
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'recovered_images.json'), 'utf8'));
  
  let count = 0;
  for (const item of data) {
    const dbItems = await prisma.menuItem.findMany({
      where: { name: item.name }
    });
    
    for (const dbItem of dbItems) {
      await prisma.menuItem.update({
        where: { id: dbItem.id },
        data: { image: item.image }
      });
      count++;
    }
  }
  console.log(`Successfully updated ${count} images.`);
}

restoreImages().catch(console.error).finally(() => prisma.$disconnect());
