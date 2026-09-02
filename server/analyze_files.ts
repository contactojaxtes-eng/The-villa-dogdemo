const fs = require('fs');
const path = require('path');

async function run() {
  const downloadsDir = 'C:/Users/Jose/Downloads';
  const files = fs.readdirSync(downloadsDir).filter((f: string) => 
    f.includes('CONTACTOS') || f.includes('contactos')
  );

  console.log('=== ARCHIVOS ENCONTRADOS EN DESCARGAS ===');
  console.log(files);

  for (const f of files) {
    const fullPath = path.join(downloadsDir, f);
    if (fs.statSync(fullPath).isFile() && (f.endsWith('.csv') || f.endsWith('.txt'))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
      
      let validCol = 0;
      let nonCol = 0;
      let invalidLength = 0;
      const sampleNonCol: string[] = [];

      lines.forEach((line: string) => {
        // extract digits
        const clean = line.replace(/\D/g, '');
        let p10 = clean;
        if (clean.length === 12 && clean.startsWith('57')) {
          p10 = clean.slice(2);
        }
        
        if (p10.length === 10 && p10.startsWith('3')) {
          // Check prefix
          // Valid Colombian mobile prefixes start with 30, 31, 32, 35
          // (300-305, 310-319, 320-324, 350-351)
          const prefix2 = p10.slice(0, 2);
          if (['30', '31', '32', '35'].includes(prefix2)) {
            validCol++;
          } else {
            nonCol++;
            if (sampleNonCol.length < 5) sampleNonCol.push(p10);
          }
        } else {
          invalidLength++;
          if (sampleNonCol.length < 5) sampleNonCol.push(clean);
        }
      });

      console.log(`\n📄 Archivo: ${f}`);
      console.log(`  Total líneas/números: ${lines.length}`);
      console.log(`  Móviles colombianos válidos (30x, 31x, 32x, 35x): ${validCol}`);
      console.log(`  Números raros / no estándar: ${nonCol + invalidLength}`);
      if (sampleNonCol.length > 0) {
        console.log(`  Ejemplos de números raros:`, sampleNonCol);
      }
    }
  }
}

run().catch(e => console.error(e));
