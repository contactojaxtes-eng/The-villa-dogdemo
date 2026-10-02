export interface SanitizedOrderNote {
  note: string;
  partialQty: number;
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};

const INSTRUCTION_MARKER = /(?:únicamente|unicamente|solo|solamente)\s+con\b|\b(?:sin|con|poco|más|mas|extra|bien)\b|\bpapas?\s+al\s+vapor\b|\b(?:salsas?(?:\s+de\s+[a-záéíóúñ]+)?|tártara|tartara|piña|pina|cebolla|queso|ripio|papas?|suero|mayonesa|mostaza|ketchup|rosada|ajo)(?:\s+y\s+(?:tártara|tartara|piña|pina|cebolla|queso|ripio|papas?|suero|mayonesa|mostaza|ketchup|rosada|ajo))*\s+aparte\b/i;

function normalizeForComparison(value: string): string {
  return value
    .toLocaleLowerCase('es-CO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function productNamePattern(productName: string): RegExp | null {
  const words = productName.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return new RegExp(`\\b${words.map(escapeRegExp).join('\\s+')}\\b`, 'gi');
}

function parsePartialQuantity(rawNote: string, totalQty?: number): number {
  const match = rawNote.match(
    /(?:^|[,;]\s*|\s)(\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?=(?:(?:únicamente|unicamente|solo|solamente)\s+con|sin|con|poco|más|mas|extra|bien|papas?\s+al\s+vapor)\b)/i,
  );
  if (!match) return 0;

  const token = normalizeForComparison(match[1]);
  const parsed = Number.parseInt(token, 10) || NUMBER_WORDS[token] || 0;
  if (parsed <= 0) return 0;

  if (typeof totalQty === 'number' && Number.isFinite(totalQty)) {
    const safeTotal = Math.max(1, Math.trunc(totalQty));
    return parsed < safeTotal ? parsed : 0;
  }

  return parsed;
}

function removeOperationalTail(value: string): string {
  const operationalBoundary = value.search(
    /(?:\s+(?:y\s+)?|\s*[,;:\-–—]\s*)(?:(?:el|la|los|las|mi|mis|tu|tus|su|sus)\s+)?(?:a\s+domicilio\b|para\s+(?:domicilio|llevar|recoger|retirar|las?\s+\d|el\s+\d|hoy|mañana)\b|(?:m[eé]todo\s+de\s+pago|pago|pagar|direcci[oó]n|barrio|tel[eé]fono|celular|whatsapp|hora|entrega|recoger|domicilio)\b|(?:en\s+efectivo|por\s+transferencia|con\s+transferencia)\b)/i,
  );
  const withoutOperationalTail = operationalBoundary >= 0
    ? value.slice(0, operationalBoundary)
    : value;

  const sentenceBoundary = withoutOperationalTail.search(/[.!?\n\r|]/);
  return sentenceBoundary >= 0
    ? withoutOperationalTail.slice(0, sentenceBoundary)
    : withoutOperationalTail;
}

function isSafeKitchenInstruction(value: string): boolean {
  const normalized = normalizeForComparison(value);
  if (!normalized) return false;

  if (!/^(?:(?:unicamente|solo|solamente) con|sin|con|poco|mas|extra|bien|papas? al vapor|(?:salsas?(?: de [a-z]+)?|tartara|pina|cebolla|queso|ripio|papas?|suero|mayonesa|mostaza|ketchup|rosada|ajo)(?: y (?:tartara|pina|cebolla|queso|ripio|papas?|suero|mayonesa|mostaza|ketchup|rosada|ajo))* aparte)\b/.test(normalized)) {
    return false;
  }

  if (/\b(?:hola|buenos dias|buenas tardes|buenas noches|gracias|por favor|amor|gusto|ustedes|usted)\b/.test(normalized)) {
    return false;
  }

  if (/\b(?:alguien|asesor|asesora|agente|persona|ayuda|demora|espera|problema|inconveniente|respuesta|mensaje|chat|llamada|comunicacion)\b/.test(normalized)) {
    return false;
  }

  if (/^(?:con|sin)\s+(?:mi|mis|tu|tus|su|sus|nuestro|nuestra|nuestros|nuestras)(?:\s|$)/.test(normalized)) {
    return false;
  }

  if (/\b(?:efectivo|transferencia|nequi|daviplata|bancolombia|tarjeta|dat[aá]fono|contraentrega|metodo de pago|pago)\b/.test(normalized)) {
    return false;
  }

  if (/\b(?:mil|cambio|devuelta|vuelto)\b/.test(normalized) || /^(?:con|sin)\s+\d/.test(normalized)) {
    return false;
  }

  if (/\b(?:pedido|cliente|factura|cuenta)\b/.test(normalized)) {
    return false;
  }

  if (/\b(?:direccion|barrio|calle|carrera|avenida|diagonal|transversal|telefono|celular|whatsapp|domicilio|recoger|retirar|referencia|porton|casa|apartamento|apto|nombre|indicacion|llamar|llegar)\b/.test(normalized)) {
    return false;
  }

  if (/\b(?:hoy|manana|hora|a las? \d|\d{1,2}:\d{2})\b/.test(normalized)) {
    return false;
  }

  if (/\b\d{7,}\b/.test(normalized) || /\$\s*\d/.test(value)) {
    return false;
  }

  if (/\b(?:de|del|con|sin|para|y|e|o)\s*$/.test(normalized)) {
    return false;
  }

  if (/^(?:con|sin)\s+(?:el|la|los|las|un|una)$/.test(normalized)) {
    return false;
  }

  return true;
}

/**
 * Keeps only an explicit kitchen/preparation instruction from an AI or local
 * order parser result. Customer, delivery, payment and scheduling data belongs
 * to their dedicated order fields and must never leak into an item note.
 */
export function sanitizeOrderNote(
  rawNote: string | null | undefined,
  productName: string | null | undefined,
  totalQty?: number,
): SanitizedOrderNote {
  const raw = String(rawNote || '').replace(/\s+/g, ' ').trim();
  if (!raw) return { note: '', partialQty: 0 };

  const normalizedRaw = normalizeForComparison(raw);
  const initialMarker = raw.match(INSTRUCTION_MARKER);
  const paymentBeforeMarker = raw.search(/\b(?:m[eé]todo\s+de\s+pago|pago|pagar|efectivo|transferencia|nequi|daviplata|bancolombia|cambio|devuelta|vuelto)\b/i);
  if (paymentBeforeMarker >= 0 && initialMarker?.index !== undefined && paymentBeforeMarker < initialMarker.index) {
    return { note: '', partialQty: 0 };
  }
  if (/\b(?:metodo de pago|pago|pagar|efectivo|transferencia|nequi|daviplata|bancolombia|direccion|telefono|celular|whatsapp)\b/.test(normalizedRaw)
    && !/\b(?:sin|con|poco|mas|extra|bien|aparte)\b[^,;.!?]{1,80}(?:,|;|\.|!|\?|$)/.test(normalizedRaw)) {
    return { note: '', partialQty: 0 };
  }

  const partialQty = parsePartialQuantity(raw, totalQty);
  let working = raw;

  const productPattern = productNamePattern(String(productName || ''));
  if (productPattern) {
    working = working.replace(productPattern, ' ');
  }

  const marker = working.match(INSTRUCTION_MARKER);
  if (marker?.index === undefined) {
    return { note: '', partialQty: 0 };
  }

  let note = removeOperationalTail(working.slice(marker.index))
    .replace(/^(?:\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+/i, '')
    .replace(/(?:\s*[,;:\-–—]?\s*(?:y\s+)?(?:(?:(?:muchas|much[ií]simas|mil)\s+)?gracias|por\s+favor|porfa|si\s+(?:se\s+)?puede(?:s)?(?:\s+(?:por\s+favor|porfa))?))+\s*$/i, '')
    .replace(/^[,;:\-–—\s]+|[,;:\-–—\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!isSafeKitchenInstruction(note)) {
    return { note: '', partialQty: 0 };
  }

  note = note.charAt(0).toLocaleUpperCase('es-CO') + note.slice(1);
  return { note, partialQty };
}
