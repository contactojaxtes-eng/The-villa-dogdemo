import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const setting = await prisma.appSetting.findUnique({ where: { key: 'gemini_api_key' } });
  const key = setting?.value?.split(',')[0]?.trim();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
  const data = await res.json();
  console.log('Available models:', data.models?.map((m: any) => m.name.replace('models/', '')));
}

main().catch(console.error).finally(() => prisma.$disconnect());
