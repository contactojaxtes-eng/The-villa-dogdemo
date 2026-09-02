import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  const setting = await prisma.appSetting.findUnique({ where: { key: 'gemini_api_key' } });
  if (!setting || !setting.value) return;

  const keys = setting.value.split(',').map(k => k.trim()).filter(Boolean);
  const filePath = 'c:\\Users\\Jose\\Downloads\\WhatsApp Video 2026-08-29 at 11.29.58.mp4';

  if (!fs.existsSync(filePath)) {
    console.log('File does not exist');
    return;
  }

  const buffer = fs.readFileSync(filePath);
  const base64Data = buffer.toString('base64');

  for (const key of keys) {
    for (const model of ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.7-flash']) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: 'Describe con total detalle qué error o comportamiento ocurre en la pantalla en este video de DigitalOcean y transcribe cualquier audio:' },
                { inline_data: { mime_type: 'video/mp4', data: base64Data } }
              ]
            }]
          })
        });

        if (!res.ok) continue;
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          console.log('\n🎥 DESCRIPCIÓN DEL VIDEO 11.29.58:\n' + text.trim());
          return;
        }
      } catch (e: any) {}
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
