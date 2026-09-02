const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function clean(str) {
  if (!str) return '';
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

function getFlavorCode(flavor) {
  const f = clean(flavor);
  if (f.includes('JAMON Y QUESO') || f.includes('JAMON Y Q')) return 'JQ';
  if (f.includes('POLLO CHAMPI')) return 'PC';
  if (f.includes('POLLO HAWAI')) return 'PH';
  if (f.includes('POLLO JAMON')) return 'PJ';
  if (f.includes('POLLO TOCIN')) return 'PT';
  if (f.includes('POLLO SALAMI') || f.includes('SALAMI POLLO')) return 'SP';
  if (f.includes('HAWAI')) return 'HW';
  if (f.includes('SALAMI')) return 'SL';
  if (f.includes('SOLO QUESO') || f.includes('QUESO')) return 'SQ';
  if (f.includes('VEGETAL')) return 'VG';
  if (f.includes('AMERICA')) return 'AM';
  if (f.includes('4 CARNES') || f.includes('CUATRO CARNES')) return '4C';
  if (f.includes('TIO THE VILLA DOG')) return 'TN';
  if (f.includes('RANCHER')) return 'RN';
  if (f.includes('SEMI-REMONT') || f.includes('SEMI REMONT')) return 'SR';
  if (f.includes('BACANISIM')) return 'BC';
  if (f.includes('BOLOG') || f.includes('CARNE')) return 'BG';
  if (f.includes('PEPPERON')) return 'PP';
  if (f.includes('MEXICAN')) return 'MX';
  if (f.includes('THE VILLA DOG')) return 'NC';
  if (f.includes('CHAMPI')) return 'CH';
  if (f.includes('MAIZ')) return 'MZ';
  if (f.includes('TOCIN')) return 'TC';
  if (f.includes('CRIOLL')) return 'CR';
  if (f.includes('PASTOR')) return 'PS';

  const words = f.split(/\s+/).filter(w => !['DE', 'CON', 'Y', 'EL', 'LA', 'EN', 'DEL', 'PARA', 'C/'].includes(w));
  if (words.length >= 2) return words[0][0] + words[1][0];
  if (words.length === 1) return words[0].substring(0, 2);
  return 'XX';
}

function generateCodeForItem(item) {
  const cat = clean(item.category?.name || item.category || '');
  const name = clean(item.name || '');

  // 1. PIZZAS
  if (cat.includes('PIZZA')) {
    let size = '';
    if (name.includes('PERSONAL')) size = 'P';
    else if (name.includes('SEMIFAMILIAR')) size = 'S';
    else if (name.includes('MEDIANA')) size = 'M';
    else if (name.includes('FAMILIAR')) size = 'F';

    let flavorPart = name.replace(/PIZZA/g, '').replace(/- (PERSONAL|SEMIFAMILIAR|MEDIANA|FAMILIAR)/g, '').trim();
    let fCode = getFlavorCode(flavorPart);
    return `PZ${fCode}${size}`;
  }

  // 2. ADICIONALES PARA PIZZA
  if (cat.includes('ADICIONALES PARA PIZZA')) {
    let size = '';
    if (name.includes('PERSONAL')) size = 'P';
    else if (name.includes('SEMIFAMILIAR')) size = 'S';
    else if (name.includes('MEDIANA')) size = 'M';
    else if (name.includes('FAMILIAR')) size = 'F';

    let itemPart = name.replace(/ADIC\./g, '').replace(/ADICIONAL/g, '').replace(/- (PERSONAL|SEMIFAMILIAR|MEDIANA|FAMILIAR)/g, '').trim();
    let codePart = getFlavorCode(itemPart);
    return `AP${codePart}${size}`;
  }

  // 3. SUIZOS & MINI SUIZOS
  if (cat.includes('SUIZO')) {
    let prefix = cat.includes('MINI') ? 'MSZ' : 'SZ';
    let isVapor = cat.includes('VAPOR') || name.includes('VAPOR');
    let isGratinado = cat.includes('GRATINAD') || name.includes('GRATINAD');

    let mod = '';
    if (isVapor && isGratinado) mod = 'VG';
    else if (isVapor) mod = 'V';
    else if (isGratinado) mod = 'G';
    else mod = 'F';

    let content = 'NC';
    if (name.includes('CHORIZO Y BUTIFARRA') || name.includes('CHORIZO BUTIFARRA')) content = 'CB';
    else if (name.includes('SUPER CON TODO')) content = 'ST';
    else if (name.includes('CON TODO')) content = 'CT';
    else if (name.includes('CERDO')) content = 'CD';
    else if (name.includes('LOMITO')) content = 'LM';
    else if (name.includes('POLLO')) content = 'PL';
    else if (name.includes('RANCHERO')) content = 'RN';
    else if (name.includes('SUPER SUIZO')) content = 'SS';
    else if (name.includes('SENCILLO')) content = 'SN';
    else if (name.includes('THE VILLA DOG')) content = 'NC';

    return `${prefix}${content}${mod}`;
  }

  // 4. SALCHIPAPAS
  if (cat.includes('SALCHIPAPA')) {
    let prefix = 'SP';
    if (name.includes('CHORI PAPA') || name.includes('CHORIPAPA')) prefix = 'CP';
    else if (name.includes('RANCHI PAPA') || name.includes('RANCHIPAPA')) prefix = 'RP';

    let isGratinado = cat.includes('GRATINAD') || name.includes('GRATINAD');
    let mod = isGratinado ? 'G' : '';

    let content = '';
    if (prefix === 'SP') {
      if (name.includes('4 CARNES')) content = '4C';
      else if (name.includes('CHORIZO BUTIFARRA')) content = 'CB';
      else if (name.includes('CERDO')) content = 'CD';
      else if (name.includes('LOMITO')) content = 'LM';
      else if (name.includes('POLLO')) content = 'PL';
      else if (name.includes('SUPER CON TODO')) content = 'ST';
      else if (name.includes('CON TODO')) content = 'CT';
      else if (name.includes('HAWAIANA')) content = 'HW';
      else if (name.includes('SENCILLA')) content = 'SN';
      else if (name.includes('SUIZA')) content = 'SZ';
    }

    return `${prefix}${content}${mod}`;
  }

  // 5. SALVAJADAS
  if (cat.includes('SALVAJADA')) {
    let isGratinado = cat.includes('GRATINAD') || name.includes('GRATINAD');
    let mod = isGratinado ? 'G' : '';

    let size = '';
    if (name.includes('CHICA')) size = 'CH';
    else if (name.includes('EXTRALARGE')) size = 'XL';
    else if (name.includes('MATRIMONIO')) size = 'MT';
    else if (name.includes('THE VILLA DOG')) size = 'NC';
    else if (name.includes('SUPER')) size = 'SP';
    else if (name.includes('TRIO')) size = 'TR';
    else if (name.includes('SALVAJADITA')) size = 'JT';

    return `SV${size}${mod}`;
  }

  // 6. PATACONES
  if (cat.includes('PATACON')) {
    let isGratinado = cat.includes('GRATINAD') || name.includes('GRATINAD');
    let mod = isGratinado ? 'G' : '';

    let content = '';
    if (name.includes('CERDO')) content = 'CD';
    else if (name.includes('LOMITO')) content = 'LM';
    else if (name.includes('POLLO')) content = 'PL';
    else if (name.includes('RANCHERA') || name.includes('RANCHERO')) content = 'RN';
    else if (name.includes('CON TODO')) content = 'CT';
    else if (name.includes('4 CARNES')) content = '4C';

    return `PT${content}${mod}`;
  }

  // 7. MAICITOS
  if (cat.includes('MAICITO')) {
    let isGratinado = cat.includes('GRATINAD') || name.includes('GRATINAD');
    let mod = isGratinado ? 'G' : '';

    let content = '';
    if (name.includes('4 CARNES')) content = '4C';
    else if (name.includes('CERDO')) content = 'CD';
    else if (name.includes('LOMITO')) content = 'LM';
    else if (name.includes('POLLO')) content = 'PL';
    else if (name.includes('CON TODO')) content = 'CT';
    else if (name.includes('TOCINETA')) content = 'TC';

    return `MC${content}${mod}`;
  }

  // 8. PICADAS
  if (cat.includes('PICADA')) {
    let isGratinado = cat.includes('GRATINAD') || name.includes('GRATINAD');
    let mod = isGratinado ? 'G' : '';

    let content = '';
    if (name.includes('4 CARNES')) content = '4C';
    else if (name.includes('CERDO')) content = 'CD';
    else if (name.includes('LOMITO')) content = 'LM';
    else if (name.includes('POLLO')) content = 'PL';
    else if (name.includes('CON TODO')) content = 'CT';
    else if (name.includes('MIXTA')) content = 'MX';

    return `PC${content}${mod}`;
  }

  // 9. CHUZOS
  if (cat.includes('CHUZO')) {
    let isVapor = cat.includes('VAPOR') || name.includes('VAPOR');
    let mod = isVapor ? 'V' : 'F';

    let content = '';
    if (name.includes('CERDO')) content = 'CD';
    else if (name.includes('POLLO')) content = 'PL';
    else if (name.includes('RES') || name.includes('LOMITO')) content = 'LM';

    return `CZ${content}${mod}`;
  }

  // 10. ASADOS
  if (cat.includes('ASADO')) {
    let isVapor = cat.includes('VAPOR') || name.includes('VAPOR');
    let mod = isVapor ? 'V' : 'F';

    let content = 'AS';
    if (name.includes('LOMO CERDO ENCEBOLLADO') || name.includes('CERDO ENCEBOLLADO')) content = 'LCE';
    else if (name.includes('LOMO DE CERDO') || name.includes('CERDO')) content = 'LCD';
    else if (name.includes('LOMO RES ENCEBOLLADO') || name.includes('RES ENCEBOLLADO')) content = 'LRE';
    else if (name.includes('LOMO DE RES') || name.includes('RES')) content = 'LRD';
    else if (name.includes('PECHUGA GRATINADA')) content = 'PGT';
    else if (name.includes('PECHUGA A LA PLANCHA') || name.includes('PECHUGA')) content = 'PCH';

    return `${content}${mod}`;
  }

  // 11. HAMBURGUESAS & PERROS
  if (cat.includes('HAMBURGUESA')) {
    if (name.includes('COMBO')) return 'HBCB';
    if (name.includes('DOBLE CARNE')) return 'HBDC';
    if (name.includes('THE VILLA DOG')) return 'HBNC';
    if (name.includes('POLLO')) return 'HBPL';
    if (name.includes('SENCILLA')) return 'HBSN';
    if (name.includes('ESPECIAL')) return 'HBES';
    return 'HBG';
  }

  if (cat.includes('PERRO')) {
    if (name.includes('CHORI')) return 'PRCP';
    if (name.includes('COMBO')) return 'PRCB';
    if (name.includes('AMERICANO')) return 'PRAM';
    if (name.includes('POLLO')) return 'PRPL';
    if (name.includes('SUIZO')) return 'PRSZ';
    if (name.includes('ESPECIAL')) return 'PRES';
    if (name.includes('SENCILLO')) return 'PRSN';
    return 'PRR';
  }

  // 12. BEBIDAS
  if (cat.includes('BEBIDA')) {
    let size = 'P';
    if (cat.includes('FAMILIAR')) size = 'F';
    else if (cat.includes('JUNIOR')) size = 'J';

    let brand = 'BB';
    if (name.includes('COCA-COLA') || name.includes('COCA COLA')) brand = 'CC';
    else if (name.includes('POSTOBON')) brand = 'PB';
    else if (name.includes('KOLA')) brand = 'KR';
    else if (name.includes('AGUA')) brand = 'AG';
    else if (name.includes('BRETAÑA')) brand = 'BR';
    else if (name.includes('CUATRO')) brand = 'CT';
    else if (name.includes('HIT')) brand = 'HT';

    let vol = '';
    const matchVol = name.match(/(\d+(\.\d+)?)\s*(L|ML|PET)/i);
    if (matchVol) {
      vol = matchVol[1].replace('.', '');
    }

    return `${brand}${vol}${size}`;
  }

  // 13. ADICIONALES GENERALES
  if (cat.includes('ADICIONAL')) {
    const words = name.replace(/\d+/g, '').replace(/PORCION/g, '').split(/\s+/).filter(w => w.length > 2 && !['CON', 'DEL', 'PARA'].includes(w));
    let code = words.map(w => w.substring(0, 2)).join('');
    return `AD${code}`.substring(0, 7);
  }

  // General Fallback
  const cleanWords = name.split(/\s+/).filter(w => w.length > 2);
  let fallback = cleanWords.map(w => w[0]).join('');
  return (fallback || 'ITEM').substring(0, 6);
}

async function main() {
  console.log('1. Clearing existing codes...');
  await prisma.menuItem.updateMany({ data: { code: null } });

  console.log('2. Fetching items...');
  const items = await prisma.menuItem.findMany({
    include: { category: true },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }]
  });

  const generatedMap = new Map();
  const assignments = [];

  for (const item of items) {
    let code = generateCodeForItem(item);
    
    if (generatedMap.has(code)) {
      let counter = 2;
      let newCode = `${code}${counter}`;
      while (generatedMap.has(newCode)) {
        counter++;
        newCode = `${code}${counter}`;
      }
      code = newCode;
    }
    
    generatedMap.set(code, item);
    assignments.push({ id: item.id, code });
  }

  console.log(`3. Updating ${assignments.length} menu items sequentially...`);

  let count = 0;
  for (const a of assignments) {
    await prisma.menuItem.update({
      where: { id: a.id },
      data: { code: a.code }
    });
    count++;
    if (count % 50 === 0) console.log(`  Updated ${count}/${assignments.length}`);
  }

  console.log(`✅ SUCCESS: All ${assignments.length} products updated with unique uppercase codes!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
