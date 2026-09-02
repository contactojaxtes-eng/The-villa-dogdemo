const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rawApiKey = await prisma.setting.findUnique({where: {key: 'gemini_api_key'}});
  const apiKeys = rawApiKey.value.split(',').map(k => k.trim()).filter(k => k.length > 0);
  const key = apiKeys[0];
  
  const text = 'Cliente: 2 asados con papas francesas, 1 sin ensalada y 1 gaseosa personal\nNombre: Alexi\nTel: 3218166128\nDireccion: Cra 11A #38-30 Centro';
  
  const normalize = (str) => {
    if (!str) return '';
    return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim();
  };
  
  const STOP_WORDS = new Set(['un', 'una', 'uno', 'unos', 'unas', 'el', 'la', 'lo', 'los', 'las', 'de', 'del', 'al', 'con', 'sin', 'por', 'para', 'y', 'o', 'quiero', 'quieran', 'quieren', 'quieras', 'pedir', 'pedido', 'niche', 'super', 'sabor', 'autentico', 'monteria', 'colombia', 'adicion', 'adiciones', 'adicional', 'adicionales', 'dame', 'trae', 'pon', 'ponle', 'agrega', 'agregale', 'hola', 'buenas', 'tardes', 'noches', 'dias', 'gracias', 'porfa', 'porfavor', 'otro', 'otra', 'otros', 'otras', 'este', 'esta', 'estos', 'estas', 'eso', 'esa', 'personal', 'mediana', 'familiar', 'semifamiliar', 'grande', 'pequena', 'porcion']);
  
  const cleanText = normalize(text);
  const words = cleanText.split(/\s+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w));
  
  const dbItems = await prisma.menuItem.findMany({
    where: { active: true },
    include: { category: { select: { name: true } } }
  });
  
  let filteredItems = dbItems;
  if (words.length > 0) {
    filteredItems = dbItems.filter(item => {
      const baseName = item.name.split('(')[0];
      const itemNameClean = normalize(baseName);
      const catNameClean = normalize(item.category?.name || '');
      
      const hasNameMatch = words.some(word => itemNameClean.includes(word));
      if (hasNameMatch) return true;
      if (catNameClean.includes('adicionales') || catNameClean.includes('bebida') || catNameClean.includes('gaseosa')) {
        return true;
      }
      return false;
    });
  }
  
  if (filteredItems.length === 0) {
    filteredItems = dbItems;
  }
  
  const menuSummary = filteredItems.map(i => `[ID:${i.id}] ${i.name} (${i.category?.name || 'General'})`).join('\n');
  
  const prompt = `Eres el extractor de pedidos de The Villa Dog en Montería. Analiza el texto de WhatsApp y devuelve un JSON estructurado con los productos del menú y datos del cliente.
  
Menú:
${menuSummary}

Reglas: 1. Mapea al ID exacto del plato.
Esquema JSON a devolver:
{ "items": [ { "menuItemId": "ID", "quantity": 1, "preference": "detalles", "notes": "modificaciones", "additions": ["ID_ADICIONAL"] } ], "detectedOrderType": "delivery"|"pickup"|null, "paymentMethod": "CASH"|"TRANSFER"|null, "independentNotes": [], "customerName": "string|null", "customerPhone": "string|null", "customerAddress": "string|null" }

Texto del chat:
${text}
Responde SOLO con el JSON válido. Sin markdown ni explicaciones.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${key}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.0 }
  };
  
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}
main();
