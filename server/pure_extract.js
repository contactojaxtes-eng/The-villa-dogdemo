const fs = require('fs');

function isValidColombianMobile(phone) {
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

const realPhones = new Set();

// Extract from adb_all_contacts_data.txt (extracted directly from phone / msgstore)
const adbPath = 'C:/Users/Jose/Downloads/adb_all_contacts_data.txt';
if (fs.existsSync(adbPath)) {
  const text = fs.readFileSync(adbPath, 'utf8');
  const matches = text.match(/\b3\d{9}\b/g) || [];
  matches.forEach(m => {
    if (isValidColombianMobile(m)) realPhones.add(m);
  });
}

// Extract from LOTE_NUEVO_2000_SIN_REPETIR_11_AGOSTO.csv
const lotePath = 'C:/Users/Jose/Downloads/LOTE_NUEVO_2000_SIN_REPETIR_11_AGOSTO.csv';
if (fs.existsSync(lotePath)) {
  const text = fs.readFileSync(lotePath, 'utf8');
  const matches = text.match(/\b3\d{9}\b/g) || [];
  matches.forEach(m => {
    if (isValidColombianMobile(m)) realPhones.add(m);
  });
}

const arr = Array.from(realPhones);
console.log('Total contactos REALES extraídos de msgstore/celular:', arr.length);

const outPath = 'C:/Users/Jose/Downloads/BASE_DATOS_REAL_MSGSTORE_CELULAR.txt';
fs.writeFileSync(outPath, arr.join('\n'), 'utf8');
console.log('Guardado en:', outPath);
