import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: any): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : Number(amount || 0);
  const formatted = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(isNaN(num) ? 0 : num);
  return `$ ${formatted}`;
}

export function formatThousandsInput(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const rawDigits = value.toString().replace(/\D/g, '');
  if (!rawDigits) return '';
  const num = parseInt(rawDigits, 10);
  return new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
}

export function parseThousandsInput(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const rawDigits = value.toString().replace(/\D/g, '');
  return parseInt(rawDigits, 10) || 0;
}

export function formatDate(date: any): string {
  if (!date) return '—'
  try {
    const d = new Date(date)
    if (isNaN(d.getTime())) return '—'
    return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(d)
  } catch {
    return '—'
  }
}

export function formatDateShort(date: any): string {
  if (!date) return '—'
  try {
    const d = new Date(date)
    if (isNaN(d.getTime())) return '—'
    return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' }).format(d)
  } catch {
    return '—'
  }
}

export function formatTimeOnly(date: any): string {
  if (!date) return '—'
  try {
    const d = new Date(date)
    if (isNaN(d.getTime())) return '—'
    return new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Bogota' }).format(d)
  } catch {
    return '—'
  }
}

export function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    PENDING: '#f59e0b',
    PREPARING: '#3b82f6',
    READY: '#10b981',
    IN_ROUTE: '#8b5cf6',
    DELIVERED: '#F97316',
    CANCELLED: '#ef4444',
    CONFIRMED: '#10b981',
    REJECTED: '#ef4444',
  }
  return colors[status] || '#6b7280'
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: 'Pendiente',
    PREPARING: 'Preparando',
    READY: 'Listo',
    IN_ROUTE: 'En ruta',
    DELIVERED: 'Entregado',
    CANCELLED: 'Cancelado',
    CASH: 'Efectivo',
    TRANSFER: 'Transferencia',
    NEQUI: 'Nequi',
    BANCOLOMBIA: 'Bancolombia',
    DAVIPLATA: 'Daviplata',
    CREDIT: 'Crédito',
    CORTESIA: 'Cortesía',
    CONFIRMED: 'Confirmado',
    REJECTED: 'Rechazado',
  }
  return labels[status] || status
}

export function getItemRawNote(notes?: string | null): string {
  if (!notes) return ''
  return notes.replace(/\s?\(#[\w-]+\)/g, '')
}

export function cleanNotes(notes?: string | null, productName?: string): string {
  if (!notes) return ''
  try {
    let cleaned = notes.replace(/\s?\(#[\w-]+\)/g, '').trim()
    if (!cleaned) return ''

    // 0. Eliminar frases afectivas, saludos, despedidas o palabras de chat que nada tienen que ver con la cocina
    const chatFluff = /\b(te\s+amo|te\s+quiero|te\s+adoro|bebe|bebecito|bebesito|bebesita|mi\s+amor|mi\s+vida|mi\s+cielo|mi\s+rey|mi\s+reina|amor|reina|rey|princesa|cariño|linda|lindo|hermoso|hermosa|corazon|vida|parce|parcero|hermano|amigo|amiga|vecino|vecina|por\s*fa(?:vor)?|porfa|por\s+fa|muchas\s+gracias|gracias|buen\s+dia|buenas\s+tardes|buenas\s+noches|buenas|hola|saludos|atentamente|chao|adios)\b/gi
    cleaned = cleaned.replace(chatFluff, ' ')

    // Eliminar verbos y peticiones conversacionales ("me regala", "me da", "deme", "regalame", etc.)
    const orderVerbs = /\b(me\s+regala[sn]?|me\s+da[sn]?|regalame|deme|mande(?:me)?|envie(?:me)?|traiga(?:me)?|quiero|quisiera|haga(?:me)?\s+el\s+favor|favor)\b/gi
    cleaned = cleaned.replace(orderVerbs, ' ')

    // Quitar repeticiones de cantidades y nombres de producto dentro de la nota (ej: "2 perro sencillos 1 sin cebolla" -> "sin cebolla")
    cleaned = cleaned.replace(/\b\d+\s+(?:perro|hamburguesa|pizza|salchipapa|desgranado|suizo)s?\s*(?:sencill[oa]s?|especial(?:es)?|gratina[do]s?|mixt[oa]s?|personal(?:es)?|familiar(?:es)?)?/gi, ' ')
    cleaned = cleaned.replace(/\b\d+\s+(sin|con)\b/gi, '$1')

    // 1. Quitar precios, signos de pesos y valores monetarios (ej: "$ 17.300", "($ 17.300)", "$34.600", "$ 4.000")
    cleaned = cleaned
      .replace(/\(\s*\$\s*[\d.,]+\s*\)/gi, '')
      .replace(/\[\s*\$\s*[\d.,]+\s*\]/gi, '')
      .replace(/\$\s*[\d.,]+/g, '')
      .replace(/\b\d{1,3}(?:\.\d{3})+(?:\s*(?:pesos|cop|mil|k))?\b/gi, '')
      .replace(/\b\d{4,}(?:\s*(?:pesos|cop|mil|k))?\b/gi, '')

    // 2. Si se proporciona el nombre del producto, remover repeticiones del nombre o variantes del plato
    if (productName) {
      const parenMatches = productName.match(/\(([^)]+)\)/g) || []
      for (const p of parenMatches) {
        const inside = p.replace(/[()]/g, '').trim()
        if (inside.length > 2) {
          cleaned = cleaned.replace(new RegExp(`\\b${inside.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi'), '')
        }
      }
      const cleanProdName = productName.replace(/\([^)]+\)/g, '').trim()
      if (cleanProdName.length > 2) {
        cleaned = cleaned.replace(new RegExp(`\\b${cleanProdName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi'), '')
      }
    }

    // 3. Limpiar delimitadores y frases conversacionales de asesores/bot
    cleaned = cleaned
      .split(/\s*[—–\-|,]\s*/)
      .map(chunk => chunk.trim())
      .filter(chunk => {
        if (!chunk || chunk.length < 2) return false
        if (/^[\d\s.,$()\-—]+$/.test(chunk)) return false
        
        const normChunk = chunk.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
        
        // Descartar frases del bot/asesor o explicaciones de productos
        if (
          normChunk.startsWith('tengo la') ||
          normChunk.startsWith('tengo el') ||
          normChunk.startsWith('tengo los') ||
          normChunk.startsWith('tenemos la') ||
          normChunk.startsWith('tenemos el') ||
          normChunk.startsWith('tenemos los') ||
          normChunk.startsWith('te ofrezco') ||
          normChunk.startsWith('te recomiendo') ||
          normChunk.startsWith('viene con') ||
          normChunk.startsWith('opcion') ||
          normChunk.startsWith('variante') ||
          normChunk.startsWith('el combo') ||
          normChunk.startsWith('la salvajada') ||
          normChunk.includes('para 1 persona') ||
          normChunk.includes('para 2 persona') ||
          normChunk.includes('para 3 persona') ||
          normChunk.includes('para 4 persona') ||
          normChunk.includes('para 5 persona') ||
          normChunk.includes('para 6 persona') ||
          normChunk.includes('para cuantas') ||
          normChunk.startsWith('hola') ||
          normChunk.startsWith('buenas') ||
          normChunk.startsWith('con gusto') ||
          normChunk.startsWith('un momento')
        ) {
          return false
        }

        if (/^(valor|total|precio|domicilio|subtotal|papas francesa|papas francesas|papas vapor|papas al vapor)$/i.test(chunk)) return false
        return true
      })
      .join(' — ')
      .trim()

    return cleaned
  } catch {
    return (notes || '').replace(/\s?\(#[\w-]+\)/g, '').trim()
  }
}

export function cleanNotesForPrint(notes?: string | null, productName?: string): string {
  if (!notes) return ''
  try {
    let cleaned = cleanNotes(notes, productName)
    if (!cleaned) return ''
    if (cleaned.startsWith('Adición para:')) return ''

    const normCleaned = cleaned.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const normProduct = (productName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

    // 1. Ignorar si la nota es idéntica o sólo repite el nombre del producto
    if (normProduct && (normCleaned === normProduct || normCleaned === `1 x ${normProduct}` || normCleaned === `nota: ${normProduct}`)) {
      return ''
    }

    // 2. Descartar frases descriptivas de chat, promociones o descripciones de porciones
    if (
      normCleaned.startsWith('tengo la') ||
      normCleaned.startsWith('tengo el') ||
      normCleaned.startsWith('tenemos la') ||
      normCleaned.startsWith('tenemos el') ||
      normCleaned.startsWith('te ofrezco') ||
      normCleaned.startsWith('el combo') ||
      normCleaned.startsWith('la salvajada') ||
      normCleaned.startsWith('variante') ||
      normCleaned.startsWith('opcion') ||
      normCleaned.includes('para 1 persona') ||
      normCleaned.includes('para 2 persona') ||
      normCleaned.includes('para 3 persona') ||
      normCleaned.includes('para 4 persona') ||
      normCleaned.includes('para 5 persona')
    ) {
      const match = cleaned.match(/\b(sin\s+[\w\s]+|con\s+papas\s+[\w\s]+|salsa\s+[\w\s]+|bien\s+asada|termino\s+medio|jugo\s+en\s+[\w]+)\b/i)
      if (match) return match[0].trim()
      return ''
    }

    // 3. Si contiene una instrucción explícita de cocina (sin cebolla, sin salsa, con tártara, etc.), extraerla directamente
    const specificInstruction = cleaned.match(/\b(sin\s+[\w\s]+|con\s+[\w\s]+|aparte|bien\s+asada|bien\s+cocid[oa]|termino\s+medio|papas?\s+[\w\s]+|salsa\s+[\w\s]+)\b/i)
    if (specificInstruction) {
      return specificInstruction[0].trim()
    }

    return cleaned
  } catch {
    return ''
  }
}

export function groupOrderItems<T extends { name?: string; menuItem?: { name: string }; notes?: string | null }>(items: T[]): (T & { additions: T[] })[] {
  if (!Array.isArray(items)) return []
  const baseItems: any[] = []
  const additions: T[] = []

  for (const item of items) {
    if (!item) continue
    const notesStr = item.notes || ''
    if (notesStr.startsWith('Adición para:')) {
      additions.push(item)
    } else {
      baseItems.push({ ...item, additions: [] })
    }
  }

  for (const add of additions) {
    if (!add) continue
    const notesStr = add.notes || ''
    const tagMatch = notesStr.match(/\(#[\w-]+\)/)
    let parent: any = null

    if (tagMatch) {
      const tag = tagMatch[0]
      parent = baseItems.find(bi => bi && (bi.notes || '').includes(tag))
    }

    if (!parent) {
      const parentName = notesStr.replace('Adición para:', '').replace(/\s*\(#[\w-]+\)/g, '').trim().toLowerCase()
      parent = baseItems.find(bi => {
        if (!bi) return false
        const name = bi.menuItem?.name || bi.name || ''
        return name.toLowerCase().trim() === parentName
      })
    }

    if (parent) {
      if (!Array.isArray(parent.additions)) parent.additions = []
      parent.additions.push(add)
    } else {
      baseItems.push({ ...add, additions: [] })
    }
  }

  return baseItems
}

export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) == a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1) // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  if (target.includes(query)) return true;
  
  const queryWords = query.split(/\s+/).filter(w => w.length > 2);
  const targetWords = target.split(/\s+/);
  
  // If the query has multiple words, we require AT LEAST ONE significant word to fuzzy match
  // or we can require ALL query words to fuzzy match. Let's require all query words to match.
  if (queryWords.length === 0) return false;

  for (const qw of queryWords) {
    let matched = false;
    for (const tw of targetWords) {
      if (tw.includes(qw)) {
        matched = true;
        break;
      }
      // Allow 1 typo for words of 3-5 chars, 2 typos for 6+ chars
      const maxTypos = qw.length > 5 ? 2 : 1;
      if (tw.length > 2 && levenshteinDistance(qw, tw) <= maxTypos) {
        matched = true;
        break;
      }
    }
    if (!matched) return false; // Every query word must match something
  }
  
  return true;
}
