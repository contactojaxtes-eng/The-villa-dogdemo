import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const setting = await prisma.appSetting.findUnique({ where: { key: 'gemini_api_key' } });
  if (!setting?.value) {
    console.log('No gemini key');
    return;
  }
  const key = setting.value.split(',')[0].trim();
  const audioData = fs.readFileSync('C:\\Users\\Jose\\.gemini\\antigravity-ide\\brain\\b91c365c-0071-4df4-9e0f-455887087725\\video_audio.wav');
  const base64Audio = audioData.toString('base64');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: "Transcribe exactamente y describe lo que se dice en este audio en español:" },
          { inlineData: { mimeType: "audio/wav", data: base64Audio } }
        ]
      }]
    })
  });
  const data = await response.json();
  console.log('Transcription:\n', data?.candidates?.[0]?.content?.parts?.[0]?.text);
  await prisma.$disconnect();
}

main().catch(console.error);
