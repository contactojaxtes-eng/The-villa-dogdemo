import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as http from 'http';

dotenv.config();

const prisma = new PrismaClient();
const API_URL = process.env.API_URL || 'http://localhost:3000/api';

async function simulate() {
  console.log('Starting The Villa Dog Load Simulation...');
  
  // Find a test user (SUPERADMIN)
  const admin = await prisma.user.findFirst({ where: { role: 'SUPERADMIN' } });
  if (!admin) throw new Error('No SUPERADMIN found to run simulation');
  
  console.log(`Using user: ${admin.name} (${admin.email})`);
  
  console.log('Fetching active menu items...');
  const items = await prisma.menuItem.findMany({ where: { active: true }, take: 10 });
  if (items.length === 0) throw new Error('No menu items found');
  
  const zone = await prisma.deliveryZone.findFirst();
}

simulate()
  .then(() => {
    console.log('Simulation complete.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Simulation failed:', err);
    process.exit(1);
  });
