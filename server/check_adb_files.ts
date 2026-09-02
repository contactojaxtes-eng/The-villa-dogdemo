const fs = require('fs');
const path = require('path');

function isValidColombianMobile(phone: string): boolean {
  const clean = phone.replace(/\D/g, '');
  const p10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean;
  if (p10.length !== 10) return false;
  if (!p10.startsWith('3')) return false;

  const p3Num = parseInt(p10.slice(0, 3), 10);
  if (p3Num >= 300 && p3Num <= 305) return true;
  if (p3Num >= 310 && p3Num <= 319) return true;
  if (p3Num >= 320 && p3Num <= 324) return true;
  if (p3Num >= 350 && p3Num <= 351) return true;

  return false;
}

async function run() {
  const downloadsDir = 'C:/Users/Jose/Downloads';
  const targetFiles = [
    '00_TODOS_LOS_4200_NUMEROS_REALES_WHATSAPP.csv',
    'LOTE_NUEVO_2000_SIN_REPETIR_11_AGOSTO.csv',
    'adb_all_contacts_data.txt',
    'adb_raw_contacts_ALL.txt',
    '00_MAESTRO_WHATSAPP_DESKTOP_TODOS.csv'
  ];

  for (const f of targetFiles) {
    const p = path.join(downloadsDir, f);
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, 'utf8');
    const lines = content.split('\n');

    let valid = 0;
    let invalid = 0;
    const invalidSamples: string[] = [];

    lines.forEach((l: string) => {
      // Find 10-12 digit numbers
      const matches = l.match(/\b\d{10,12}\b/g);
      if (matches) {
        matches.forEach(m => {
          if (isValidColombianMobile(m)) {
            valid++;
          } else {
            invalid++;
            if (invalidSamples.length < 5) invalidSamples.push(m);
          }
        });
      }
    });

    console.log(`\n📄 Archivo: ${f}`);
    console.log(`  Válidos colombianos: ${valid}`);
    console.log(`  Inválidos/Raros: ${invalid}`);
    if (invalidSamples.length > 0) {
      console.log(`  Muestras inválidos:`, invalidSamples);
    }
  }
}

run().catch(e => console.error(e));
