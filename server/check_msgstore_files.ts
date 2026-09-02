const fs = require('fs');
const path = require('path');

async function run() {
  const downloadsDir = 'C:/Users/Jose/Downloads';
  const files = fs.readdirSync(downloadsDir);

  console.log('=== TODOS LOS ARCHIVOS EN DESCARGAS (BUSCANDO MSGSTORE O EXTRACCIONES) ===');
  files.forEach(f => {
    if (f.toLowerCase().includes('msgstore') || f.toLowerCase().includes('wa') || f.endsWith('.db') || f.endsWith('.csv') || f.endsWith('.txt') || f.endsWith('.json')) {
      const stat = fs.statSync(path.join(downloadsDir, f));
      console.log(`- ${f} (${(stat.size / 1024).toFixed(1)} KB) - ${stat.mtime.toISOString()}`);
    }
  });
}

run().catch(e => console.error(e));
