const fs = require('fs');

const items = JSON.parse(fs.readFileSync('./all_menu_items.json', 'utf8'));

// Helper to sanitize words
function clean(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function generateCode(item) {
  const cat = clean(item.category);
  const name = clean(item.name);
  
  // Let's inspect category types
  // 1. PIZZAS
  if (cat.includes('PIZZA')) {
    let prefix = 'PZ';
    let size = '';
    if (name.includes('PERSONAL')) size = 'P';
    else if (name.includes('SEMIFAMILIAR')) size = 'S';
    else if (name.includes('MEDIANA')) size = 'M';
    else if (name.includes('FAMILIAR')) size = 'F';

    // Flavor extraction
    let flavor = name.replace(/PIZZA/g, '').replace(/- (PERSONAL|SEMIFAMILIAR|MEDIANA|FAMILIAR)/g, '').trim();
    let fCode = '';
    const words = flavor.split(/\s+/).filter(w => !['DE', 'CON', 'Y', 'EL', 'LA', 'EN'].includes(w));
    if (words.length === 1) {
      fCode = words[0].substring(0, 3);
    } else if (words.length === 2) {
      fCode = words[0][0] + words[1].substring(0, 2);
    } else if (words.length >= 3) {
      fCode = words.map(w => w[0]).join('').substring(0, 3);
    }
    return `${prefix}${fCode}${size}`;
  }

  // Fallback default generator for testing
  const words = name.split(/\s+/).filter(w => !['DE', 'CON', 'Y', 'EL', 'LA', 'C/', 'AL', 'DEL', 'PARA'].includes(w));
  let code = words.map(w => w[0]).join('');
  return code;
}

console.log("Total items:", items.length);
