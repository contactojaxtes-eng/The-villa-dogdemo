const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rawApiKey = await prisma.setting.findUnique({where: {key: 'gemini_api_key'}});
  const apiKeys = rawApiKey.value.split(',').map(k => k.trim()).filter(k => k.length > 0);
  const key = apiKeys[0];

  const text = 'Asados\n11:12 a. m.\n¡Excelente elección! Tenemos cortes deliciosos con papita al vapor o francesa. Por ejemplo, la porción de pechuga te sale en $14.000 y el lomo de res en $23.300. 😋\n¿Cuál te antojamos hoy y con qué acompañamiento los prefieres? 🥩\n11:12 a. m.\nNo tiene más asados?\n11:13 a. m.\n¡Claro que sí, tenemos más opciones! 😋 También tenemos lomo de cerdo (desde $15.000), porción de res ($17.000), pechuga y lomo encebollados o gratinados.\nDime cuál te llama la atención y te paso todos los detalles para que lo disfrutes hoy. 🥩✨\n11:13 a. m.\nQuiero ver los gratinados\n11:13 a. m.\n¡Por supuesto! 😋 En los asados tenemos la pechuga encebollada gratinada con papas al vapor en $26.300 (o con francesa en $28.000).\n¿Te antojamos de una vez con esa opción o prefieres mirar otro plato? 🧀✨\n11:13 a. m.\nMe regala gratinado con papas al vapor por favor\nDomicilio: Cra 11A #38-30 Centro\nTel: 3218166128\nNombre: Alexi';

  const dbItems = await prisma.menuItem.findMany({
    where: { active: true },
    include: { category: { select: { name: true } } }
  });

  const menuSummary = dbItems.map(i => `[ID:${i.id}] ${i.name} (${i.category?.name || 'General'})`).join('\n');

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
