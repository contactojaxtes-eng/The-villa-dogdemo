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
    // 1. Quitar identificadores internos (#...) y vínculos de adiciones
    let cleaned = notes.replace(/\s?\(#[\w-]+\)/g, '').trim()
    if (!cleaned) return ''
    if (/^adici[oó]n\s+para:/i.test(cleaned)) return ''

    // 2. Quitar etiquetas internas de enrutamiento y formato
    cleaned = cleaned.replace(/\[\/?(PARA LLEVAR|MESA|MOSTRADOR|PICKUP|BIG|BOLD|HEIGHT|CENTER)\]/gi, '').trim()
    if (!cleaned) return ''

    // 3. Quitar precios formateados entre corchetes o paréntesis como ($ 15.000) o [$ 4.000]
    cleaned = cleaned
      .replace(/\(\s*\$\s*[\d.,]+\s*\)/gi, '')
      .replace(/\[\s*\$\s*[\d.,]+\s*\]/gi, '')
      .trim()

    // 4. Si la nota resultante es únicamente el nombre exacto del producto repetido, se descarta
    if (productName) {
      const normCleaned = cleaned.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
      const normProduct = productName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
      if (normCleaned === normProduct || normCleaned === `1 x ${normProduct}` || normCleaned === `nota: ${normProduct}`) {
        return ''
      }
    }

    // 5. Normalizar espacios múltiples y limpiar signos sobrantes en los extremos
    cleaned = cleaned.replace(/[ \t]+/g, ' ').replace(/^[—–\-|,.\s]+|[—–\-|,.\s]+$/g, '').trim()
    return cleaned
  } catch {
    return (notes || '').replace(/\s?\(#[\w-]+\)/g, '').trim()
  }
}

export function cleanNotesForPrint(notes?: string | null, productName?: string): string {
  if (!notes) return ''
  try {
    const cleaned = cleanNotes(notes, productName)
    if (!cleaned) return ''
    if (cleaned.startsWith('Adición para:')) return ''
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
    const notesStr = (item.notes || '').trim()
    const nameStr = (item.name || item.menuItem?.name || '').trim().toLowerCase()
    const isAdd = /adici[oó]n\s+para:/i.test(notesStr) || notesStr.startsWith('para:') || nameStr.startsWith('adición') || nameStr.startsWith('adicion')
    if (isAdd) {
      additions.push(item)
    } else {
      baseItems.push({ ...item, additions: [] })
    }
  }

  for (const add of additions) {
    if (!add) continue
    const notesStr = (add.notes || '').trim()
    const tagMatch = notesStr.match(/\(#[\w-]+\)/)
    let parent: any = null

    if (tagMatch) {
      const tag = tagMatch[0]
      parent = baseItems.find(bi => bi && (bi.notes || '').includes(tag))
    }

    if (!parent) {
      const parentName = notesStr
        .replace(/^(?:adici[oó]n\s+)?para:\s*/i, '')
        .replace(/\[(?:para llevar|mesa)\]/gi, '')
        .replace(/\s*\(#[\w-]+\)/g, '')
        .trim()
        .toLowerCase()

      parent = baseItems.find(bi => {
        if (!bi) return false
        const name = (bi.menuItem?.name || bi.name || '').trim().toLowerCase()
        return name === parentName
      })

      if (!parent && parentName) {
        parent = baseItems.find(bi => {
          if (!bi) return false
          const name = (bi.menuItem?.name || bi.name || '').trim().toLowerCase()
          return name.includes(parentName) || parentName.includes(name)
        })
      }

      if (!parent && baseItems.length === 1) {
        parent = baseItems[0]
      }
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
