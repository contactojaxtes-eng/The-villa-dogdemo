import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

async function analyzeVideo(filePath: string, title: string) {
  console.log(`\n==================================================`);
  console.log(`ANALIZANDO VIDEO: ${title} (${filePath})`);
  console.log(`==================================================`);

  const setting = await prisma.appSetting.findUnique({ where: { key: 'gemini_api_key' } });
  if (!setting || !setting.value) {
    console.log('No Gemini API key in DB');
    return;
  }

  const keys = setting.value.split(',').map(k => k.trim()).filter(Boolean);
  if (!fs.existsSync(filePath)) {
    console.log('File does not exist:', filePath);
    return;
  }

  const buffer = fs.readFileSync(filePath);
  const base64Data = buffer.toString('base64');

  for (const key of keys) {
    for (const model of ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash']) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                {
                  text: 'Analiza con extremo detalle este video del sistema POS/Chat de WhatsApp. Describe exactamente:\n1. Qué cliente o número/ID se muestra en la pantalla.\n2. Qué acción realiza la persona (qué escribe, qué botones presiona).\n3. Qué mensaje de error, alerta o comportamiento aparece en pantalla.\n4. Transcribe cualquier voz o audio que se escuche en el video.'
                },
                { inline_data: { mime_type: 'video/mp4', data: base64Data } }
              ]
            }]
          })
        });

        if (!res.ok) {
          const err = await res.text();
          // console.log(`Model ${model} failed:`, err.slice(0, 100));
          continue;
        }
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          console.log(`\n🎥 RESULTADO DEL VIDEO (${title}):\n` + text.trim());
          return;
        }
      } catch (err: any) {
        // continue
      }
    }
  }
}

async function main() {
  await analyzeVideo('c:\\Users\\Jose\\Downloads\\WhatsApp Video 2026-08-30 at 20.53.28.mp4', 'Video 20.53.28');
  await analyzeVideo('c:\\Users\\Jose\\Downloads\\WhatsApp Video 2026-08-30 at 20.55.08.mp4', 'Video 20.55.08');
}

main().catch(console.error).finally(() => prisma.$disconnect());
