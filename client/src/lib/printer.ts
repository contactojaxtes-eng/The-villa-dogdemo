import { api } from './api'
import { formatCurrency, formatDate, getStatusLabel, groupOrderItems, cleanNotes, cleanNotesForPrint } from './utils'
import type { ComandaOrder } from '@/components/orders/ComandaPrint'
import { printUsb, buildEscPosBuffer, getUsbDevice, autoReconnectUsbDevices } from './useUsbPrinter'

export interface PrinterSettings {
  id?: string
  mode: 'browser' | 'network' | 'usb' | 'local_bridge'
  ip: string
  port: number
  paper: '58' | '80'
  name: string
  categories?: string[]
  autoPrint?: boolean
  type?: 'caja' | 'estacion'
  enabled?: boolean
}

export const paymentLabels: Record<string, string> = {
  CASH: 'Efectivo',
  EFECTIVO: 'Efectivo',
  TRANSFER: 'Transferencia',
  TRANSFERENCIA: 'Transferencia',
  NEQUI: 'Nequi',
  BANCOLOMBIA: 'Bancolombia',
  DAVIPLATA: 'Daviplata',
  CARD: 'Tarjeta / Datáfono',
  DATAFONO: 'Datáfono',
  CREDIT_CARD: 'Tarjeta de Crédito',
  DEBIT_CARD: 'Tarjeta de Débito',
  TARJETA: 'Tarjeta',
  MIXED: 'Mixto',
}

export function formatPaymentMethodLabel(order: any): string {
  const raw = String(order?.paymentMethod || 'EFECTIVO').trim().toUpperCase()
  if (raw === 'MIXED') {
    const cash = order?.cashAmount ? `$${Math.round(order.cashAmount).toLocaleString('es-CO')}` : '$0'
    const transfer = order?.transferAmount ? `$${Math.round(order.transferAmount).toLocaleString('es-CO')}` : '$0'
    return `Mixto (Ef: ${cash} / Tr: ${transfer})`
  }
  return paymentLabels[raw] || raw || 'Efectivo'
}

export interface DualPrinterSettings {
  caja: PrinterSettings
  cocina: PrinterSettings
  bar?: PrinterSettings
  printers: PrinterSettings[]
  autoPrint?: boolean
  restaurant?: any
  // compatibility fields:
  mode: 'browser' | 'network' | 'usb' | 'local_bridge'
  ip: string
  port: number
  paper: '58' | '80'
  name: string
}

export async function getPrinterSettings(): Promise<DualPrinterSettings> {
  try {
    return await api.get<DualPrinterSettings>('/print/settings')
  } catch {
    const defaultSettings: PrinterSettings = { mode: 'browser', ip: '', port: 9100, paper: '80', name: 'Comanda' }
    return {
      caja: { ...defaultSettings, name: 'Caja' },
      cocina: { ...defaultSettings, name: 'Cocina', mode: 'network', id: 'cocina', categories: [] },
      bar: { ...defaultSettings, name: 'Bar / Bebidas', mode: 'network', id: 'bar', categories: [] },
      printers: [
        { ...defaultSettings, name: 'Cocina', mode: 'network', id: 'cocina', categories: [] },
        { ...defaultSettings, name: 'Bar / Bebidas', mode: 'network', id: 'bar', categories: [] }
      ],
      autoPrint: true,
      ...defaultSettings
    }
  }
}

export function formatDisplayPhone(rawPhone?: string, altPhone?: string): string {
  const candidate = altPhone || rawPhone;
  if (!candidate) return 'N/A';
  const clean = candidate.trim();
  const digits = clean.replace(/\D/g, '');
  if (digits === '3000000000' || clean.toLowerCase().includes('mostrador')) {
    return 'Consumo en restaurante / Mostrador';
  }
  const p10 = (digits.length === 12 && digits.startsWith('57')) ? digits.slice(2) : digits;
  if (p10.length === 10 && p10.startsWith('3')) {
    return `+57 ${p10.slice(0, 3)} ${p10.slice(3, 6)} ${p10.slice(6)}`;
  }
  if (altPhone) {
    const altDigits = altPhone.replace(/\D/g, '');
    const altP10 = (altDigits.length === 12 && altDigits.startsWith('57')) ? altDigits.slice(2) : altDigits;
    if (altP10.length === 10 && altP10.startsWith('3')) {
      return `+57 ${altP10.slice(0, 3)} ${altP10.slice(3, 6)} ${altP10.slice(6)}`;
    }
  }
  if (digits.length >= 14 || /^(wa_lead_|user_|id_|c_|wamid\.)/i.test(clean)) {
    return 'WhatsApp Directo';
  }
  return clean || 'N/A';
}

export function buildPrintHtml(order: ComandaOrder, paper: string, target: 'caja' | 'cocina' = 'caja', categories?: string[], stationName?: string, allPrinters?: PrinterSettings[], restaurantInfo?: any) {
  const width = paper === '58' ? '58mm' : '80mm'
  const fullAddress = [order.customerAddress, order.addressReference].filter(Boolean).join(' — ')
  const allItems = order.items || []
  const cleanOrderNotes = (order.notes || '').replace(/^\[MOSTRADOR\]\s*/i, '').replace(/^\[PICKUP\]\s*/i, '').trim() || null
  const displayPhone = formatDisplayPhone(order.customerPhone)

  let grouped = groupOrderItems(allItems)
  if (target === 'cocina') {
    if (categories && categories.length > 0) {
      grouped = grouped.filter(item => item.menuItem?.categoryId && categories.includes(item.menuItem.categoryId))
    } else if (allPrinters && allPrinters.length > 0) {
      const claimed = new Set<string>()
      for (const p of allPrinters) {
        if (p.name === stationName || p.id === stationName) continue
        if (p.type === 'caja') continue
        if (p.enabled === false) continue
        if (p.categories && p.categories.length > 0) {
          for (const catId of p.categories) {
            claimed.add(catId)
          }
        }
      }
      grouped = grouped.filter(item => {
        const catId = item.menuItem?.categoryId
        return !catId || !claimed.has(catId)
      })
    }
  }
  const isEdited = order.isEdited || (order.createdAt && order.updatedAt && new Date(order.updatedAt).getTime() - new Date(order.createdAt).getTime() > 5000)

  if (target === 'cocina') {
    const items = grouped.map(i => {
      const specialNote = cleanNotesForPrint(i.notes, i.menuItem.name)
      let html = `<div class="item"><span class="qty">${i.quantity}x</span><span class="item-name">${i.menuItem.name}</span></div>`
      if (specialNote) {
        html += `<div class="note">⚠ ${specialNote}</div>`
      }
      if (i.additions && i.additions.length > 0) {
        html += i.additions.map(a => {
          return `<div class="addition"><span class="qty">+ ${a.quantity}x</span><span>${a.menuItem.name}</span></div>`
        }).join('')
      }
      return html
    }).join('')

    return `<!DOCTYPE html><html><head><title>${stationName?.toUpperCase() || 'COCINA'} #${order.orderNumber}</title>
<style>
@page { size: ${width} auto; margin: 2mm; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Arial', 'Helvetica', sans-serif; width:${width}; font-size:16px; color:#000; padding:3mm; }
h1 { font-size:22px; text-align:center; font-weight:900; letter-spacing:1px; }
.edit-badge { background-color:#000; color:#fff; text-align:center; font-weight:900; font-size:18px; padding:6px; margin:4px 0; border:2px solid #000; letter-spacing:1px; }
.order-num { font-size:34px; font-weight:900; text-align:center; margin:6px 0; border:2px solid #000; padding:4px; letter-spacing:2px; }
.sub { text-align:center; font-size:13px; margin-bottom:4px; font-weight:normal; }
.line { border-top:2px dashed #000; margin:6px 0; }
.lbl { font-size:13px; font-weight:900; text-transform:uppercase; letter-spacing:1px; }
.info { font-size:16px; font-weight:normal; line-height:1.3; margin:2px 0; }
.item { display:flex; gap:6px; margin:6px 0 2px 0; line-height:1.3; align-items:baseline; }
.item .qty { font-weight:900; min-width:28px; font-size:19px; }
.item .item-name { font-weight:900; font-size:19px; word-break: break-word; }
.addition { display:flex; gap:6px; margin:2px 0 2px 14px; font-size:15px; font-weight:bold; }
.addition .qty { font-weight:900; min-width:24px; }
.note { font-size:15px; font-weight:bold; margin:2px 0 4px 14px; font-style:italic; border-left:3px solid #000; padding-left:6px; }
.footer { text-align:center; font-size:13px; margin-top:10px; font-weight:900; letter-spacing:1px; }
</style></head><body>
${order.status === 'CANCELLED' ? `
<div class="edit-badge" style="background-color:#000; color:#fff; font-size:20px; font-weight:900; padding:8px;">⛔ PEDIDO CANCELADO ⛔</div>
<div class="order-num" style="font-size:32px; font-weight:900; border:3px solid #000;">PEDIDO CANCELADO #${order.orderNumber}</div>
<div style="font-weight:900; font-size:15px; margin:4px 0; border:2px solid #000; padding:4px;">MOTIVO: ${(order.cancellationReason || 'Sin motivo especificado').toUpperCase()}</div>
` : (isEdited ? `<div class="edit-badge">⚠️ PEDIDO EDITADO ⚠️</div><div class="order-num" style="font-size:32px; border:3px solid #000;">PEDIDO EDITADO #${order.orderNumber}</div>` : `<div class="order-num">#${order.orderNumber}</div>`)}
<p class="sub">${formatDate(order.createdAt)}</p>
<div class="line"></div>
<div class="lbl">Cliente</div>
<div class="info">${order.customerName} · ${displayPhone}</div>
<div class="lbl">${(order.tableId || order.orderType === 'LOCAL' || order.diningTable)
  ? `🍽️ MESA: ${(order.diningTable?.label || order.tableName || (order.tableId ? 'MESA' : 'SALÓN')).toUpperCase()}`
  : (order.orderType === 'PICKUP' ? '📍 RECOGER EN LOCAL' : '🛵 DOMICILIO')}</div>
${order.orderType === 'DELIVERY' ? `<div class="info">${fullAddress}</div>${order.zone ? `<div class="info">Barrio: ${order.zone.name}</div>` : ''}` : ''}
<div class="line"></div>
<div class="lbl" style="font-size:16px; margin-bottom:4px;">${order.status === 'CANCELLED' ? '❌ NO PREPARAR / PEDIDO CANCELADO:' : (isEdited ? '⚠️ PRODUCTOS EDITADOS (REVISAR CAMBIOS):' : '🍽 PREPARAR:')}</div>
${items}
<div class="line"></div>
${cleanOrderNotes ? `<div style="font-weight:900; font-size:16px; border:2px solid #000; padding:6px;">⚠ NOTA GENERAL:<br/>${cleanOrderNotes}</div><div class="line"></div>` : ''}
<div class="footer">${order.status === 'CANCELLED' ? `** TICKET DE CANCELACION (${stationName?.toUpperCase() || 'COCINA'}) **` : `** TICKET DE ${stationName?.toUpperCase() || 'COCINA'} ${isEdited ? '(EDITADO)' : ''} **`}</div>
</body></html>`
  } else {
    // Caja Professional Invoice
    const items = grouped.map(i => {
      const priceVal = i.price || i.unitPrice || 0
      const totalBasePrice = priceVal * i.quantity
      let html = `<div class="item" style="justify-content: space-between;">
        <div style="display:flex; gap:6px;">
          <span class="qty">${i.quantity}x</span>
          <span style="font-weight: bold;">${i.menuItem.name}${i.notes && cleanNotes(i.notes) && !i.notes.startsWith('Adición para:') ? ` (${cleanNotes(i.notes)})` : ''}</span>
        </div>
        <span style="font-weight: bold;">${formatCurrency(totalBasePrice)}</span>
      </div>`
      if (i.additions && i.additions.length > 0) {
        html += i.additions.map(a => {
          const addPriceVal = a.price || a.unitPrice || 0
          const totalAddPrice = addPriceVal * a.quantity
          return `<div class="item" style="justify-content: space-between; margin-left: 12px; font-size: 10px; opacity: 0.9;">
            <div style="display:flex; gap:6px;">
              <span class="qty">+ ${a.quantity}x</span>
              <span>${a.menuItem.name} [Adición]</span>
            </div>
            <span>${formatCurrency(totalAddPrice)}</span>
          </div>`
        }).join('')
      }
      return html
    }).join('')

  const restInfo = restaurantInfo || {
    name: 'THE VILLA DOG',
    nit: '901928696',
    address: 'Montería, Córdoba',
    phone: '310 000 0000',
  }

  return `<!DOCTYPE html><html><head><title>Factura No. ${order.invoiceNumber || order.orderNumber}</title>
<style>
@page { size: ${width} auto; margin: 2mm; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Courier New', monospace; width:${width}; font-size:11px; color:#000; padding:4mm; }
h1 { font-size:16px; text-align:center; font-weight:bold; }
.sub { text-align:center; font-size:9px; margin-bottom:6px; line-height: 1.3; }
.num { font-size:18px; font-weight:bold; text-align:center; margin:6px 0 2px 0; }
.edit-badge { background-color:#000; color:#fff; text-align:center; font-weight:bold; font-size:12px; padding:4px; margin:4px 0; }
.line { border-top:1px dashed #000; margin:6px 0; }
.lbl { font-size:9px; font-weight:bold; text-transform:uppercase; color:#555; }
.addr { font-size:11px; font-weight:bold; line-height:1.3; margin:4px 0; }
.item { display:flex; gap:6px; margin:3px 0; }
.qty { font-weight:bold; min-width:24px; }
.summary-row { display:flex; justify-content:space-between; margin:2px 0; }
.total { font-size:14px; font-weight:bold; text-align:right; margin-top:6px; display:flex; justify-content:space-between; }
.footer { text-align:center; font-size:9px; margin-top:10px; border-top: 1px dashed #000; padding-top: 6px; }
</style></head><body>
<h1>${restInfo.name}</h1>
<p class="sub">NIT: ${restInfo.nit || '901928696'}<br/>${restInfo.address}<br/>Tel: ${restInfo.phone}<br/>FACTURA DE VENTA</p>
${isEdited ? `<div class="edit-badge">⚠️ FACTURA MODIFICADA ⚠️</div>` : ''}
<div class="line"></div>
<div class="num">Factura No. ${order.invoiceNumber || order.orderNumber}</div>
<div class="sub" style="font-size:12px; font-weight:bold;">Turno #${order.orderNumber}</div>
<div class="line"></div>
<div class="lbl">Cliente</div>
<div style="font-weight: bold;">${order.customerName}</div>
<div>Tel: ${displayPhone}</div>
${(order.tableId || order.orderType === 'LOCAL' || order.diningTable) ? `
<div class="line"></div>
<div class="lbl">Mesa / Salón</div>
<div class="addr" style="font-size:14px; font-weight:bold;">${(order.diningTable?.label || (order as any).tableName || (order.tableId ? 'Mesa' : 'Salón')).toUpperCase()}</div>
` : (order.orderType === 'DELIVERY' ? `
<div class="line"></div>
<div class="lbl">Dirección de Entrega</div>
<div class="addr">${fullAddress}</div>
${(order.zone?.name || (order as any).zoneName || (order as any).barrio) ? `<div>Barrio: ${order.zone?.name || (order as any).zoneName || (order as any).barrio}</div>` : ''}
` : `
<div class="line"></div>
<div class="lbl">Entrega</div>
<div class="addr">Recoger en restaurante</div>
`)}
<div class="line"></div>
<div class="lbl">Productos</div>
${items}
<div class="line"></div>
<div class="summary-row"><span>Subtotal:</span><span>${formatCurrency(order.subtotal)}</span></div>
${order.deliveryFee > 0 ? `<div class="summary-row"><span>Domicilio:</span><span>${formatCurrency(order.deliveryFee)}</span></div>` : ''}
${order.tax > 0 ? `<div class="summary-row"><span>Impoconsumo (8%):</span><span>${formatCurrency(order.tax)}</span></div>` : ''}
<div class="line"></div>
<div class="total"><span>TOTAL:</span><span>${formatCurrency(order.total)}</span></div>
<div class="line"></div>
<div class="summary-row"><span>Método de Pago:</span><span>${paymentLabels[order.paymentMethod] || order.paymentMethod}</span></div>
<div class="summary-row"><span>Atiende:</span><span>${order.assignee?.name || order.waiter?.name || '—'}</span></div>
${(!(order.tableId || order.orderType === 'LOCAL') && (order.orderType === 'DELIVERY' || order.deliveryDriver?.name || (order as any).deliveryDriverName || (order as any).driverName || (order as any).driver?.name)) ? `<div class="summary-row"><span>Domiciliario:</span><span>${order.deliveryDriver?.name || (order as any).deliveryDriverName || (order as any).driverName || (order as any).driver?.name || 'Sin Asignar'}</span></div>` : ''}
<div class="summary-row"><span>Fecha:</span><span>${formatDate(order.createdAt)}</span></div>
<div class="footer">¡Muchas gracias por su compra!<br/>Vuelve pronto</div>
</body></html>`
  }
}

/** Construye el texto de comanda para ESC/POS (USB/Red) */
export function buildComandaText(
  order: ComandaOrder,
  target: 'caja' | 'cocina' = 'caja',
  categories?: string[],
  stationName?: string,
  allPrinters?: PrinterSettings[],
  paper: string = '80',
  restaurantInfo?: any
): string {
  const fullAddress = [order.customerAddress, order.addressReference].filter(Boolean).join(' — ')
  const allItems = order.items || []

  // Clean internal tags from notes before printing
  const cleanOrderNotes = (order.notes || '').replace(/^\[MOSTRADOR\]\s*/i, '').replace(/^\[PICKUP\]\s*/i, '').trim() || null

  let grouped = groupOrderItems(allItems)
  if (target === 'cocina') {
    if (categories && categories.length > 0) {
      grouped = grouped.filter(item => item.menuItem?.categoryId && categories.includes(item.menuItem.categoryId))
    } else if (allPrinters && allPrinters.length > 0) {
      const claimed = new Set<string>()
      for (const p of allPrinters) {
        if (p.name === stationName || p.id === stationName) continue
        if (p.type === 'caja') continue
        if (p.enabled === false) continue
        if (p.categories && p.categories.length > 0) {
          for (const catId of p.categories) {
            claimed.add(catId)
          }
        }
      }
      grouped = grouped.filter(item => {
        const catId = item.menuItem?.categoryId
        return !catId || !claimed.has(catId)
      })
    }
  }
  const lines: string[] = []
  const isEdited = order.isEdited || (order.createdAt && order.updatedAt && new Date(order.updatedAt).getTime() - new Date(order.createdAt).getTime() > 15000)

  const is80 = paper === '80'
  const width = is80 ? 48 : 32

  const pad = (text: string, length: number, align: 'left' | 'right' = 'left'): string => {
    const cleanText = text.slice(0, length)
    if (align === 'left') {
      return cleanText.padEnd(length, ' ')
    } else {
      return cleanText.padStart(length, ' ')
    }
  }

  const padLine = (left: string, right: string) => {
    const space = width - left.length - right.length
    if (space <= 0) return `${left} ${right}`
    return left + ' '.repeat(space) + right
  }

  const divider = '='.repeat(width)
  const lineDivider = '-'.repeat(width)

  if (target === 'cocina') {
    const waiterName = (order.assignee?.name || order.waiter?.name || '—').toUpperCase()
    const barrio = order.zone?.name || (order as any).zoneName || (order as any).barrio
    lines.push(
      ...(isEdited ? [
        '[CENTER][HEIGHT][BOLD]⚠️ PEDIDO EDITADO ⚠️[/BOLD][/HEIGHT][/CENTER]',
        divider,
        `[CENTER][HEIGHT][BOLD]PEDIDO EDITADO #${order.orderNumber}[/BOLD][/HEIGHT][/CENTER]`,
      ] : [
        `[CENTER][HEIGHT][BOLD]PEDIDO #${order.orderNumber}[/BOLD][/HEIGHT][/CENTER]`,
      ]),
      `Fecha: ${new Date(order.createdAt).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true })}`,
      ...(order.diningTable?.label || order.tableId || order.orderType === 'LOCAL'
        ? [`[CENTER][HEIGHT][BOLD]MESA: ${(order.diningTable?.label || (order as any).tableName || (order.tableId ? 'MESA' : 'SALÓN')).toUpperCase()}[/BOLD][/HEIGHT][/CENTER]`]
        : [`[CENTER][BOLD]TIPO: ${order.orderType === 'DELIVERY' ? 'DOMICILIO' : 'RECOGER EN LOCAL'}[/BOLD][/CENTER]`]),
      ...(order.customerName ? [`Cliente: ${order.customerName.toUpperCase()}`] : []),
      ...(order.customerPhone ? [`Teléfono: ${formatDisplayPhone(order.customerPhone, (order as any).customer?.phone)}`] : []),
      ...(!(order.tableId || order.orderType === 'LOCAL') && fullAddress ? [`Dirección: ${fullAddress.toUpperCase()}`] : []),
      ...(!(order.tableId || order.orderType === 'LOCAL') && barrio ? [`Barrio: ${barrio.toUpperCase()}`] : []),
      `Atiende: ${waiterName}`,
      divider,
      '[HEIGHT][BOLD]PRODUCTOS A PREPARAR:[/BOLD][/HEIGHT]',
      ''
    )

    for (const item of grouped) {
      const uPrice = Number(item.price || item.unitPrice || item.menuItem?.price || 0)
      const cleaned = cleanNotesForPrint(item.notes, item.menuItem?.name)

      // Si el item viene con cantidad > 1 pero la nota original pedía una porción parcial (ej: "1 sin cebolla" en 2 perros)
      const rawNotesStr = String(item.notes || '')
      const wordToNum: Record<string, number> = { 'un': 1, 'una': 1, 'uno': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5 }
      const partialMatch = rawNotesStr.match(/(?:^|\s)(\d+|un|una|uno|dos|tres|cuatro|cinco)\s+(?:sin|con|solo\s+con)\s+([a-záéíóúñ\s]+)/i)
      let partialQty = 0
      if (partialMatch) {
        const rawPart = partialMatch[1].toLowerCase()
        partialQty = parseInt(rawPart, 10) || wordToNum[rawPart] || 0
      }

      if (cleaned && partialQty > 0 && partialQty < item.quantity) {
        const pSub = uPrice * partialQty
        const pTag = uPrice > 0 ? ` ($ ${Math.round(uPrice).toLocaleString('es-CO')} c/u = $ ${Math.round(pSub).toLocaleString('es-CO')})` : ''
        lines.push(`[BOLD][HEIGHT]${partialQty} x ${item.menuItem?.name || 'Item'}${pTag}[/HEIGHT][/BOLD]`)
        lines.push(`[BOLD][HEIGHT]  ↳ NOTA: ${cleaned.toUpperCase()}[/HEIGHT][/BOLD]`)

        const remQty = item.quantity - partialQty
        const remSub = uPrice * remQty
        const remTag = uPrice > 0 ? ` ($ ${Math.round(uPrice).toLocaleString('es-CO')} c/u = $ ${Math.round(remSub).toLocaleString('es-CO')})` : ''
        lines.push(`[BOLD][HEIGHT]${remQty} x ${item.menuItem?.name || 'Item'}${remTag}[/HEIGHT][/BOLD]`)
      } else {
        const sub = uPrice * Number(item.quantity || 1)
        const priceTag = uPrice > 0 ? ` ($ ${Math.round(uPrice).toLocaleString('es-CO')} c/u = $ ${Math.round(sub).toLocaleString('es-CO')})` : ''
        lines.push(`[BOLD][HEIGHT]${item.quantity} x ${item.menuItem?.name || 'Item'}${priceTag}[/HEIGHT][/BOLD]`)
        if (item.notes && cleaned && !item.notes.startsWith('Adición para:')) {
          lines.push(`[BOLD][HEIGHT]  ↳ NOTA: ${cleaned.toUpperCase()}[/HEIGHT][/BOLD]`)
        }
      }
      if (item.additions && item.additions.length > 0) {
        for (const a of item.additions) {
          const aPrice = Number(a.price || a.unitPrice || a.menuItem?.price || 0)
          const aSub = aPrice * Number(a.quantity || 1)
          const aPriceTag = aPrice > 0 ? ` ($ ${Math.round(aPrice).toLocaleString('es-CO')} c/u = $ ${Math.round(aSub).toLocaleString('es-CO')})` : ''
          lines.push(`[BOLD][HEIGHT]  + ${a.quantity} x ${a.menuItem?.name || 'Item'}${aPriceTag}[/HEIGHT][/BOLD]`)
        }
      }
      lines.push('') // Línea en blanco para separar productos
    }

    lines.push(divider)
    lines.push(padLine('SUBTOTAL:', formatCurrency(order.subtotal || 0)))
    if (order.deliveryFee && Number(order.deliveryFee) > 0) {
      lines.push(padLine('DOMICILIO:', formatCurrency(order.deliveryFee)))
    }
    lines.push('[CENTER][BIG][BOLD]TOTAL A PAGAR:[/BOLD][/BIG][/CENTER]')
    lines.push(`[CENTER][BIG][BOLD]${formatCurrency(order.total || 0)}[/BOLD][/BIG][/CENTER]`)
    lines.push(divider)
    lines.push(padLine('FORMA DE PAGO:', formatPaymentMethodLabel(order).toUpperCase()))

    if (cleanOrderNotes) {
      lines.push(divider)
      lines.push(`[BIG][BOLD]NOTA GENERAL:[/BOLD]\n${cleanOrderNotes.toUpperCase()}[/BIG]`, divider)
    }
    lines.push(`[CENTER]** ${stationName?.toUpperCase() || 'COCINA'} TICKET **[/CENTER]`, divider)
  } else {
    // Caja Invoice (cajero / cliente)
    const formatCurrency = (val: number) => `$${Math.round(val || 0).toLocaleString('de-DE')}`
    
    const restInfo = restaurantInfo || {
      name: 'THE VILLA DOG',
      nit: '901928696',
      address: 'MONTERIA, CORDOBA',
      phone: '310 000 0000',
    }

    const barrio = order.zone?.name || (order as any).zoneName || (order as any).barrio;
    const driverName = order.deliveryDriver?.name || (order as any).deliveryDriverName || (order as any).driverName || (order as any).driver?.name;

    lines.push(
      `[CENTER][BIG][BOLD]${restInfo.name}[/BOLD][/BIG][/CENTER]`,
      `[CENTER]NIT: ${restInfo.nit}[/CENTER]`,
      `[CENTER]Dir: ${restInfo.address}[/CENTER]`,
      `[CENTER]Tel: ${restInfo.phone}[/CENTER]`,
      divider,
      `[CENTER][BIG][BOLD]PEDIDO #${order.orderNumber}[/BOLD][/BIG][/CENTER]`,
      `Factura: No. ${order.invoiceNumber || order.orderNumber}`,
      `Fecha: ${new Date(order.createdAt).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true })}`,
      divider,
      (order.tableId || order.orderType === 'LOCAL' || order.diningTable)
        ? `MESA: ${(order.diningTable?.label || (order as any).tableName || (order.tableId ? 'MESA' : 'SALÓN')).toUpperCase()}`
        : `TIPO: ${order.orderType === 'DELIVERY' ? 'DOMICILIO 🛵' : 'PASAR A RECOGER 🏠'}`,
      `Cliente: ${order.customerName.toUpperCase()}`,
      `Teléfono: ${formatDisplayPhone(order.customerPhone, (order as any).customer?.phone)}`,
      ...(!(order.tableId || order.orderType === 'LOCAL') ? [
        `Dirección: ${fullAddress ? fullAddress.toUpperCase() : 'N/A'}`,
        ...(barrio ? [`Barrio: ${barrio.toUpperCase()}`] : []),
        ...(order.orderType === 'DELIVERY' ? [`Repartidor: ${(driverName || 'SIN ASIGNAR').toUpperCase()}`] : []),
      ] : []),
      `Medio de pago: ${formatPaymentMethodLabel(order)}`,
      `Estado: ${order.paymentStatus === 'CONFIRMED' ? 'PAGADO' : 'PENDIENTE DE PAGO'}`,
      `Atendido Por: ${(order.assignee?.name || order.waiter?.name || 'CAJERO').toUpperCase()}`,
      lineDivider,
      '[BOLD]DETALLE DE PRODUCTOS:[/BOLD]',
      lineDivider
    )

    // Cabeceras de la tabla
    if (is80) {
      lines.push(
        pad('Cantidad', 8) + pad('UN', 5) + pad('Producto', 19) + pad('Precio', 8, 'right') + pad('Total', 8, 'right')
      )
    } else {
      lines.push(
        pad('Cant', 5) + pad('UN', 4) + pad('Producto', 9) + pad('Precio', 7, 'right') + pad('Total', 7, 'right')
      )
    }
    lines.push(lineDivider)

    for (const item of grouped) {
      const priceVal = item.price || item.unitPrice || 0
      const totalBasePrice = priceVal * item.quantity
      const nameStr = item.menuItem?.name || 'Item'

      const qtyStr = String(item.quantity)
      const unStr = 'Und.'
      const priceStr = formatCurrency(priceVal)
      const totalStr = formatCurrency(totalBasePrice)

      if (is80) {
        lines.push(
          pad(qtyStr, 8) + pad(unStr, 5) + pad(nameStr, 19) + pad(priceStr, 8, 'right') + pad(totalStr, 8, 'right')
        )
      } else {
        lines.push(
          pad(qtyStr, 5) + pad(unStr, 4) + pad(nameStr, 9) + pad(priceStr, 7, 'right') + pad(totalStr, 7, 'right')
        )
      }

      const cleaned = cleanNotesForPrint(item.notes, item.menuItem?.name)
      if (item.notes && cleaned && !item.notes.startsWith('Adición para:')) {
        lines.push(`   ↳ NOTA: ${cleaned.toUpperCase()}`)
      }

      if (item.additions && item.additions.length > 0) {
        for (const a of item.additions) {
          const aPrice = a.price || a.unitPrice || 0
          const totalAddPrice = aPrice * a.quantity
          const aName = `+ ${a.menuItem?.name || 'Item'}`
          const aQty = String(a.quantity)
          const aPriceStr = formatCurrency(aPrice)
          const aTotalStr = formatCurrency(totalAddPrice)

          if (is80) {
            lines.push(
              pad(aQty, 8) + pad(unStr, 5) + pad(aName, 19) + pad(aPriceStr, 8, 'right') + pad(aTotalStr, 8, 'right')
            )
          } else {
            lines.push(
              pad(aQty, 5) + pad(unStr, 4) + pad(aName, 9) + pad(aPriceStr, 7, 'right') + pad(aTotalStr, 7, 'right')
            )
          }
        }
      }
    }

    // Impuestos (INC 8%)
    const base = Math.round(order.subtotal / 1.08)
    const taxValue = Math.round(order.subtotal - base)

    lines.push(divider)
    lines.push('[CENTER][BOLD]Impuestos[/BOLD][/CENTER]')
    if (is80) {
      lines.push(pad('Nombre', 10) + pad('%', 5) + pad('Base', 17, 'right') + pad('Impuesto', 16, 'right'))
      lines.push(`INC       8%    ${pad(formatCurrency(base), 15, 'right')}    ${pad(formatCurrency(taxValue), 14, 'right')}`)
    } else {
      lines.push(pad('Nombre', 7) + pad('%', 4) + pad('Base', 11, 'right') + pad('Impuesto', 10, 'right'))
      lines.push(`INC    8% ${pad(formatCurrency(base), 9, 'right')}  ${pad(formatCurrency(taxValue), 8, 'right')}`)
    }

    lines.push(divider)
    lines.push(padLine('Subtotal:', formatCurrency(order.subtotal)))
    if (order.deliveryFee > 0) {
      lines.push(padLine('Domicilio:', formatCurrency(order.deliveryFee)))
    }
    lines.push(divider)
    lines.push('[CENTER][BIG][BOLD]VALOR A PAGAR:[/BOLD][/BIG][/CENTER]')
    lines.push(`[CENTER][BIG][BOLD]${formatCurrency(order.total)}[/BOLD][/BIG][/CENTER]`);
    lines.push(divider)

    const obsParts = [order.notes, (order as any).addressReference].filter(Boolean).map(s => String(s).trim()).filter(Boolean);
    const realObs = obsParts.join(' — ');
    lines.push(
      `Observaciones: ${realObs ? realObs.toUpperCase() : ''}`,
      lineDivider,
      `[CENTER][BIG][BOLD]Turno: ${order.orderNumber}[/BOLD][/BIG][/CENTER]`,
      divider,
      '   ¡Muchas gracias por su compra!',
      divider
    )
  }

  return lines.join('\n')
}

function printViaIframe(html: string) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('style', 'position:fixed;left:-9999px;top:0;width:0;height:0;border:0;')
  document.body.appendChild(iframe)
  const win = iframe.contentWindow
  if (!win) return
  const doc = win.document
  doc.open()
  doc.write(html)
  doc.close()
  const doPrint = () => {
    win.focus()
    win.print()
    setTimeout(() => document.body.removeChild(iframe), 800)
  }
  if (doc.readyState === 'complete') doPrint()
  else iframe.onload = doPrint
}

export function printReceiptText(rawText: string, paper: '58' | '80' = '80') {
  if (!rawText) return
  const paperWidth = paper === '58' ? '58mm' : '80mm'
  const cleanHtml = rawText
    .replace(/\[CENTER\]([\s\S]*?)\[\/CENTER\]/gi, '<div style="text-align: center;">$1</div>')
    .replace(/\[BOLD\]([\s\S]*?)\[\/BOLD\]/gi, '<b>$1</b>')
    .replace(/\[BIG\]([\s\S]*?)\[\/BIG\]/gi, '<span style="font-size: 1.22em; font-weight: bold;">$1</span>')
    .replace(/\[HEIGHT\]([\s\S]*?)\[\/HEIGHT\]/gi, '<span style="font-size: 1.1em; font-weight: bold;">$1</span>')
    .replace(/\[\/?(CENTER|BOLD|BIG|HEIGHT|CUT|DRAWER)\]/gi, '')
    .replace(/\n/g, '<br />')

  const fullHtml = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Ticket THE VILLA DOG</title>
    <style>
      @page { size: ${paperWidth} auto; margin: 0; }
      body {
        font-family: 'Courier New', monospace, sans-serif;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.3;
        width: ${paperWidth};
        margin: 0 auto;
        padding: 4mm;
        color: #000;
        background: #fff;
      }
      div { margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <div>${cleanHtml}</div>
  </body>
</html>`

  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  if (isMobile) {
    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.open()
      printWindow.document.write(fullHtml)
      printWindow.document.close()
      printWindow.focus()
      setTimeout(() => {
        printWindow.print()
      }, 300)
      return
    }
  }

  printViaIframe(fullHtml)
}

async function printSinglePrinter(
  order: ComandaOrder,
  printerConfig: PrinterSettings,
  targetId: string,
  userRole?: string,
  isAutoPrint = false,
  categories?: string[],
  allPrinters?: PrinterSettings[],
  restaurantInfo?: any,
  kickDrawer = false // added!
): Promise<{ method: 'usb' | 'network' | 'browser' | 'local_bridge'; silent: boolean; error?: string }> {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768
  const isWaiter = userRole === 'WAITER'

  // 1) Modo USB: impresión silenciosa desde el navegador via WebUSB
  if (printerConfig.mode === 'usb') {
    let device = getUsbDevice(targetId)
    if (!device) {
      console.log(`[WebUSB] Dispositivo no en memoria para ${targetId}, intentando auto-reconexión silenciosa...`)
      await autoReconnectUsbDevices([targetId])
      device = getUsbDevice(targetId)
    }

    if (device) {
      const text = buildComandaText(order, targetId === 'caja' ? 'caja' : 'cocina', categories, printerConfig.name, allPrinters, printerConfig.paper, restaurantInfo)
      let buffer = buildEscPosBuffer(text, printerConfig.paper)
      if (targetId === 'caja' && kickDrawer) {
        const kick = new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFA])
        const combined = new Uint8Array(kick.length + buffer.length)
        combined.set(kick, 0)
        combined.set(buffer, kick.length)
        buffer = combined
      }
      const result = await printUsb(buffer, targetId)
      if (result.ok) return { method: 'usb', silent: true }
      console.warn('WebUSB falló:', result.error)
      return { method: 'usb', silent: true, error: `WebUSB falló: ${result.error}` }
    } else {
      console.warn('Impresora USB no conectada.')
      return { method: 'usb', silent: true, error: `Impresora USB no conectada para ${printerConfig.name}.` }
    }
  }

  // 2) Modo Red (IP), Puente Local (Cola) o Backend Central
  if (order.id) {
    if (isAutoPrint && (printerConfig.mode === 'network' || printerConfig.mode === 'local_bridge')) {
      // El backend ya encola automáticamente el trabajo de comanda al crear o editar el pedido.
      return { method: printerConfig.mode, silent: true }
    }
    try {
      const result = await api.post<{ ok: boolean; error?: string; text?: string; paper?: '58' | '80' }>(`/print/order/${order.id}?target=${targetId}&kickDrawer=${kickDrawer}`)
      if (result.ok) {
        return { method: 'local_bridge', silent: true }
      }
      if (printerConfig.mode !== 'browser') {
        return { method: (printerConfig.mode as any) || 'local_bridge', silent: true, error: result.error }
      }
    } catch (err: any) {
      if (printerConfig.mode !== 'browser') {
        return { method: (printerConfig.mode as any) || 'local_bridge', silent: true, error: err.message || 'Error de conexión' }
      }
    }
  }

  // 3) Modo Navegador: Solo si no hay ID de pedido y no es mesera.
  // En pedidos existentes, no abrir el diálogo de PDF emergente para evitar bloquear la operación.
  if (printerConfig.mode === 'browser' && !order.id && !isWaiter) {
    printViaIframe(buildPrintHtml(order, printerConfig.paper, targetId === 'caja' ? 'caja' : 'cocina', categories, printerConfig.name, allPrinters, restaurantInfo))
    return { method: 'browser', silent: false }
  }

  return { method: printerConfig.mode, silent: true }
}

export async function printComandaSmart(
  order: ComandaOrder,
  target?: 'caja' | 'cocina',
  userRole?: string,
  isAutoPrint = false,
  kickDrawer = false
): Promise<{ method: 'usb' | 'network' | 'browser' | 'local_bridge'; silent: boolean; error?: string }> {
  const settings = await getPrinterSettings()
  const isDeliveryOrder = !order.tableId && ['DELIVERY', 'PICKUP'].includes(order.orderType)

  // En pedidos de domicilio o para llevar (o cuando se solicita factura de caja), se imprime UNA SOLA factura/comanda completa
  if (target === 'caja' || isDeliveryOrder) {
    return printSinglePrinter(order, settings.caja, 'caja', userRole, isAutoPrint, undefined, undefined, settings.restaurant, kickDrawer)
  }

  // Estaciones de preparación (Cocina/Pizzas/Bar para mesas de salón):
  const allDynamicPrinters = settings.printers && settings.printers.length > 0
    ? settings.printers
    : [
      { id: 'cocina', name: 'Cocina', mode: settings.cocina.mode, ip: settings.cocina.ip, port: settings.cocina.port, paper: settings.cocina.paper, categories: settings.cocina.categories },
      { id: 'bar', name: 'Bar / Bebidas', mode: settings.bar?.mode || 'network', ip: settings.bar?.ip || '', port: settings.bar?.port || 9100, paper: settings.bar?.paper || '80', categories: settings.bar?.categories || [] }
    ]

  const prepPrinters = allDynamicPrinters.filter(p => p.type !== 'caja')

  let overallMethod: any = 'browser'
  let overallSilent = true
  let overallError: string | undefined

  const orderChannel = 'DINING'
  const printedDestinations = new Set<string>()

  for (const printer of prepPrinters) {
    if (printer.enabled === false) continue

    const printerChannel = String((printer as any).channel || 'DINING').toUpperCase()
    if ((printer as any).channel && printerChannel !== 'BOTH' && printerChannel !== orderChannel) {
      continue
    }

    // Evitar mandar doble al mismo destino físico
    const destKey = (printer.ip || printer.name || printer.id || '').trim().toLowerCase()
    if (printedDestinations.has(destKey)) continue

    // Group items first so additions are linked to parent items!
    const grouped = groupOrderItems(order.items || [])
    let stationGrouped = grouped
    const printerCats = printer.categories || []

    if (printerCats.length > 0) {
      stationGrouped = grouped.filter(item => item.menuItem?.categoryId && printerCats.includes(item.menuItem.categoryId))
    } else {
      // Catch-all: print everything EXCEPT categories claimed by other active estacion printers
      const claimed = new Set<string>()
      for (const p of prepPrinters) {
        if (p.name === printer.name || p.id === printer.id) continue
        if (p.type === 'caja') continue
        if (p.enabled === false) continue
        const pCats = p.categories || []
        if (pCats.length > 0) {
          for (const catId of pCats) {
            claimed.add(catId)
          }
        }
      }
      stationGrouped = grouped.filter(item => {
        const catId = item.menuItem?.categoryId
        return !catId || !claimed.has(catId)
      })
    }

    if (stationGrouped.length === 0) {
      continue // Skip if no items for this station
    }

    printedDestinations.add(destKey)
    const res = await printSinglePrinter(order, printer, printer.id || 'cocina', userRole, isAutoPrint, printer.categories, prepPrinters, settings.restaurant)
    overallMethod = res.method
    if (!res.silent) overallSilent = false
    if (res.error) overallError = res.error
  }

  return { method: overallMethod, silent: overallSilent, error: overallError }
}

export function buildClosingPrintHtml(closing: any, paper: string, restaurantInfo?: any) {
  const width = paper === '58' ? '58mm' : '80mm'
  const f = (val: number) => `$${Math.round(val || 0).toLocaleString('de-DE')}`
  const d = closing._detail

  const restInfo = restaurantInfo || {
    name: 'THE VILLA DOG',
    address: 'Montería, Córdoba',
    phone: '310 000 0000',
  }

  // If we have full detail data, generate professional report
  if (d) {
    const inicialRows = d.inicialPorMetodo.map((m: any) => `<div class="r"><span>${m.label}</span><span>${f(m.value)}</span></div>`).join('')
    const ventasRows = d.ventasPorMetodo.map((m: any) => `<div class="r3"><span>${m.label}</span><span style="text-align:center">${m.count}</span><span style="text-align:right">${f(m.sales)}</span></div>`).join('')
    const detalleRows = d.ventasPorMetodo.map((m: any) => `<div class="r4"><span>${m.label}</span><span>${f(m.sales)}</span><span>${f(m.tips)}</span><span>${f(m.deliveryFees)}</span></div>`).join('')
    const gastosRows = d.gastos.items.length > 0 ? d.gastos.items.map((g: any) => `<div class="r"><span>${g.tipo}</span><span>${f(g.total)}</span></div>`).join('') : '<div class="r"><span>Sin gastos</span><span>$0</span></div>'

    return `<!DOCTYPE html><html><head><title>Comprobante Informe Diario</title>
<style>
@page { size: ${width} auto; margin: 2mm; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Courier New', monospace; width:${width}; font-size:11px; color:#000; padding:3mm; }
h1 { font-size:14px; text-align:center; font-weight:900; margin-bottom:2px; }
.sub { text-align:center; font-size:8px; line-height:1.3; margin-bottom:4px; }
.line { border-top:1px dashed #000; margin:5px 0; }
.dline { border-top:2px solid #000; margin:5px 0; }
.sec { font-size:11px; font-weight:900; text-align:center; margin:4px 0 2px; text-transform:uppercase; letter-spacing:1px; }
.r { display:flex; justify-content:space-between; margin:1.5px 0; font-size:10px; }
.r3 { display:grid; grid-template-columns:1fr 1fr 1fr; margin:1.5px 0; font-size:10px; }
.r4 { display:grid; grid-template-columns:1.2fr 1fr 0.8fr 0.8fr; margin:1.5px 0; font-size:9px; }
.r3 span:nth-child(2) { text-align:center; }
.r3 span:nth-child(3) { text-align:right; }
.r4 span:not(:first-child) { text-align:right; }
.bold { font-weight:900; }
.total-row { font-size:12px; font-weight:900; display:flex; justify-content:space-between; margin:3px 0; }
.footer { text-align:center; font-size:8px; margin-top:8px; padding-top:4px; border-top:1px dashed #000; }
</style></head><body>
<p class="sub">Comprobante Informe Diario</p>
<h1>${restInfo.name}</h1>
<p class="sub">${restInfo.address}<br/>Tel: ${restInfo.phone}</p>
<div class="dline"></div>
<div class="r bold"><span>Responsable:</span><span>${closing.user?.name || 'Cajero'}</span></div>
<div class="r"><span>Caja:</span><span>${closing.cashRegister?.name || 'Principal'}</span></div>
<div class="r"><span>Fecha Inicial:</span><span>${new Date(closing.shiftStart).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true })}</span></div>
<div class="r"><span>Fecha Final:</span><span>${new Date(closing.shiftEnd).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true })}</span></div>
<div class="r bold"><span>Transacciones:</span><span>${d.transacciones}</span></div>
<div class="r bold"><span>Valor Transacciones:</span><span>${f(d.valorTransacciones)}</span></div>
<div class="r"><span>Propinas:</span><span>${f(d.propinas)}</span></div>
<div class="dline"></div>

<div class="sec">Inicial</div>
<div class="r bold" style="font-size:9px;border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:3px"><span>Medio de pago</span><span>Inicial</span></div>
${inicialRows}
<div class="line"></div>
<div class="total-row"><span>Total</span><span>${f(closing.initialCash)}</span></div>
<div class="dline"></div>

<div class="sec">Ventas</div>
<div class="r3 bold" style="font-size:9px;border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:3px"><span>Nombre</span><span style="text-align:center">No.Trans.</span><span style="text-align:right">Sistema</span></div>
${ventasRows}
<div class="line"></div>
<div class="total-row"><span>Total (Prop. Incluida)</span><span>${f(d.valorTransacciones)}</span></div>
<div class="r"><span>Propinas</span><span>${f(d.propinas)}</span></div>
<div class="dline"></div>

<div class="sec">Detalle Ventas</div>
<div class="r4 bold" style="font-size:8px;border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:3px"><span>Nombre</span><span>Venta</span><span>Propina</span><span>Domicilio</span></div>
${detalleRows}
<div class="line"></div>
<div class="r4 bold" style="font-size:10px"><span>Total</span><span>${f(d.valorTransacciones)}</span><span>${f(d.propinas)}</span><span>${f(d.domicilios)}</span></div>
<div class="dline"></div>

<div class="sec">Impuestos</div>
<div class="r3 bold" style="font-size:9px;border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:3px"><span>Nombre</span><span style="text-align:center">Base</span><span style="text-align:right">Imp</span></div>
<div class="r3"><span>${d.impuestos.nombre}</span><span style="text-align:center">${f(d.impuestos.base)}</span><span style="text-align:right">${f(d.impuestos.impuesto)}</span></div>
<div class="line"></div>
<div class="total-row"><span>Total</span><span>${f(d.impuestos.impuesto)}</span></div>
<div class="dline"></div>

<div class="sec">Gastos</div>
<div class="r bold" style="font-size:9px;border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:3px"><span>Tipo de gasto</span><span>Total</span></div>
${gastosRows}
<div class="line"></div>
<div class="total-row"><span>Total</span><span>${f(d.gastos.total)}</span></div>
<div class="dline"></div>

<div class="sec">Resumen</div>
<div class="r bold"><span>Inicial+Ventas+Propinas+Dom.</span><span>${f(d.resumen.inicialMasVentasMasPropinas)}</span></div>
<div class="r"><span>Pagos facturas de compras</span><span>${f(d.resumen.pagosFacturas)}</span></div>
<div class="r"><span>Gastos</span><span>${f(d.resumen.gastos)}</span></div>
<div class="line"></div>
<div class="total-row"><span>Total Efectivo</span><span>${f(d.resumen.totalEfectivo)}</span></div>
<div class="total-row"><span>Debe tener</span><span>${f(d.resumen.debeTener)}</span></div>
<div class="r bold"><span>Domicilios</span><span>${f(d.resumen.domicilios)}</span></div>
<div class="dline"></div>
${closing.notes ? `<div style="font-size:9px;margin-top:3px"><b>Notas:</b><br/>${closing.notes}</div><div class="line"></div>` : ''}
<div class="footer">** COMPROBANTE INFORME DIARIO **</div>
</body></html>`
  }

// Fallback: full rich report without preloaded _detail
  const totalFact = (closing.totalSales || 0) + (closing.totalTips || 0)
  const cashSales = closing.totalCash || 0
  const expVal = closing.totalExpenses || 0
  const tipsVal = closing.totalTips || 0
  const expCash = (closing.initialCash || 0) + cashSales + tipsVal - expVal

  return `<!DOCTYPE html><html><head><title>Reporte Z - Cierre</title>
<style>
@page { size: ${width} auto; margin: 2mm; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Courier New', monospace; width:${width}; font-size:11px; color:#000; padding:4mm; }
h1 { font-size:15px; text-align:center; font-weight:bold; margin-bottom:2px; }
.sub { text-align:center; font-size:9px; margin-bottom:5px; line-height: 1.3; }
.line { border-top:1px dashed #000; margin:5px 0; }
.dline { border-top:2px solid #000; margin:5px 0; }
.summary-row { display:flex; justify-content:space-between; margin:2px 0; font-size:10px; }
.bold { font-weight:bold; }
.sec { font-size:11px; font-weight:bold; text-align:center; margin:4px 0 2px; text-transform:uppercase; }
.total { font-size:12px; font-weight:bold; display:flex; justify-content:space-between; margin:3px 0; }
.footer { text-align:center; font-size:8px; margin-top:8px; border-top: 1px dashed #000; padding-top: 5px; }
</style></head><body>
<h1>THE VILLA DOG</h1>
<p class="sub">Montería, Córdoba · Tel: 300 322 9261<br/><b>CIERRE DE CAJA — REPORTE Z</b></p>
<div class="dline"></div>
<div class="summary-row"><span>ID Cierre:</span><span>${closing.id ? closing.id.substring(0, 8) : 'N/A'}</span></div>
<div class="summary-row"><span>Cajero:</span><span>${closing.user?.name || closing.userName || 'Cajero'}</span></div>
<div class="summary-row"><span>Caja:</span><span>${closing.cashRegister?.name || closing.registerName || 'Principal'}</span></div>
<div class="summary-row"><span>Apertura:</span><span>${new Date(closing.shiftStart).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true })}</span></div>
<div class="summary-row"><span>Cierre:</span><span>${new Date(closing.shiftEnd).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true })}</span></div>
<div class="dline"></div>
<div class="total"><span>BASE INICIAL:</span><span>${f(closing.initialCash)}</span></div>
<div class="dline"></div>
<div class="sec">VENTAS POR MÉTODO</div>
<div class="summary-row"><span>Efectivo:</span><span>${f(closing.totalCash)}</span></div>
<div class="summary-row"><span>Transferencias:</span><span>${f(closing.totalTransfers)}</span></div>
${closing.totalNequi ? `<div class="summary-row" style="padding-left:8px"><span>· Nequi:</span><span>${f(closing.totalNequi)}</span></div>` : ''}
${closing.totalBancolombia ? `<div class="summary-row" style="padding-left:8px"><span>· Bancolombia:</span><span>${f(closing.totalBancolombia)}</span></div>` : ''}
${closing.totalDaviplata ? `<div class="summary-row" style="padding-left:8px"><span>· Daviplata:</span><span>${f(closing.totalDaviplata)}</span></div>` : ''}
${closing.totalCredit ? `<div class="summary-row"><span>Crédito (Fiados):</span><span>${f(closing.totalCredit)}</span></div>` : ''}
<div class="line"></div>
<div class="summary-row bold"><span>Subtotal Ventas:</span><span>${f(closing.totalSales)}</span></div>
${closing.totalTips ? `<div class="summary-row"><span>Propinas:</span><span>${f(closing.totalTips)}</span></div>` : ''}
<div class="line"></div>
<div class="total"><span>TOTAL FACTURADO:</span><span>${f(totalFact)}</span></div>
<div class="dline"></div>
<div class="sec">GASTOS DEL TURNO</div>
<div class="summary-row" style="color:red"><span>Total Egresos:</span><span>-${f(expVal)}</span></div>
<div class="dline"></div>
<div class="sec">ARQUEO DE EFECTIVO</div>
<div class="summary-row"><span>(+) Base Inicial:</span><span>${f(closing.initialCash)}</span></div>
<div class="summary-row"><span>(+) Ventas Efectivo:</span><span>${f(cashSales)}</span></div>
<div class="summary-row"><span>(+) Propinas Efectivo:</span><span>${f(tipsVal)}</span></div>
<div class="summary-row"><span>(-) Gastos Efectivo:</span><span>-${f(expVal)}</span></div>
<div class="line"></div>
<div class="total"><span>(=) EFECTIVO ESPERADO:</span><span>${f(expCash)}</span></div>
<div class="summary-row bold"><span>Diferencia / Descuadre:</span><span>${f(closing.discrepancy || 0)}</span></div>
<div class="dline"></div>
${closing.notes ? `<div style="font-size:9px;margin:3px 0"><b>Notas:</b><br/>${closing.notes}</div><div class="line"></div>` : ''}
<br/>
<div class="summary-row"><span>Firma Cajero:</span><span>_________________</span></div>
<br/>
<div class="summary-row"><span>Firma Supervisor:</span><span>_________________</span></div>
<div class="footer">** REPORTE DE CIERRE AUDITADO **<br/>Software The Villa Dog v1.0</div>
</body></html>`
}

export function buildOpeningPrintHtml(opening: any, paper: string, restaurantInfo?: any) {
  const width = paper === '58' ? '58mm' : '80mm'
  const f = (val: number) => `$${Math.round(val || 0).toLocaleString('de-DE')}`

  const restInfo = restaurantInfo || {
    name: 'THE VILLA DOG',
    address: 'Montería, Córdoba',
    phone: '300 322 9261',
  }

  return `<!DOCTYPE html><html><head><title>Apertura de Caja</title>
<style>
@page { size: ${width} auto; margin: 2mm; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Courier New', monospace; width:${width}; font-size:11px; color:#000; padding:4mm; }
h1 { font-size:15px; text-align:center; font-weight:bold; margin-bottom:2px; }
.sub { text-align:center; font-size:9px; margin-bottom:5px; line-height: 1.3; }
.dline { border-top:2px solid #000; margin:5px 0; }
.line { border-top:1px dashed #000; margin:5px 0; }
.summary-row { display:flex; justify-content:space-between; margin:2px 0; font-size:10px; }
.total { font-size:12px; font-weight:bold; display:flex; justify-content:space-between; margin:4px 0; }
.footer { text-align:center; font-size:8px; margin-top:10px; border-top: 1px dashed #000; padding-top: 5px; }
</style></head><body>
<h1>${restInfo.name}</h1>
<p class="sub">${restInfo.address} · Tel: ${restInfo.phone}<br/><b>APERTURA DE TURNO DE CAJA</b></p>
<div class="dline"></div>
<div class="summary-row"><span>ID Turno:</span><span>${opening.id ? opening.id.substring(0, 8) : 'N/A'}</span></div>
<div class="summary-row"><span>Cajero:</span><span>${opening.user?.name || opening.userName || 'Cajero'}</span></div>
<div class="summary-row"><span>Caja:</span><span>${opening.cashRegister?.name || opening.registerName || 'Principal'}</span></div>
<div class="summary-row"><span>Fecha y Hora:</span><span>${new Date(opening.shiftStart || opening.createdAt || new Date()).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true })}</span></div>
<div class="dline"></div>
<div class="total"><span>BASE INICIAL EFECTIVO:</span><span>${f(opening.initialCash || 0)}</span></div>
<div class="dline"></div>
${opening.notes ? `<div style="font-size:9px;margin:3px 0"><b>Notas:</b><br/>${opening.notes}</div><div class="line"></div>` : ''}
<br/><br/>
<div class="summary-row"><span>Firma Cajero:</span><span>_________________</span></div>
<br/>
<div class="summary-row"><span>Firma Supervisor:</span><span>_________________</span></div>
<div class="footer">** TURNO INICIADO CON ÉXITO **<br/>Software The Villa Dog v1.0</div>
</body></html>`
}

export function buildOpeningText(opening: any, paper: string = '80'): string {
  const f = (val: number) => `$${Math.round(val || 0).toLocaleString('de-DE')}`
  const width = paper === '58' ? 32 : 48

  const padLine = (left: string, right: string) => {
    const space = width - left.length - right.length
    if (space <= 0) return `${left} ${right}`
    return left + ' '.repeat(space) + right
  }

  const centerLine = (text: string) => {
    const space = Math.floor((width - text.length) / 2)
    if (space <= 0) return text
    return ' '.repeat(space) + text
  }

  const divider = '='.repeat(width)
  const lineDivider = '-'.repeat(width)

  const lines: string[] = [
    centerLine('THE VILLA DOG'),
    centerLine('Monteria, Cordoba'),
    centerLine('Tel: 300 322 9261'),
    centerLine('APERTURA DE TURNO DE CAJA'),
    divider,
    padLine('ID Turno:', opening.id ? opening.id.substring(0, 8) : 'N/A'),
    padLine('Cajero:', opening.user?.name || opening.userName || 'Cajero'),
    padLine('Caja:', opening.cashRegister?.name || opening.registerName || 'Principal'),
    padLine('Fecha y Hora:', new Date(opening.shiftStart || opening.createdAt || new Date()).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true })),
    divider,
    centerLine('FONDO INICIAL DE CAJA'),
    lineDivider,
    padLine('BASE INICIAL EN EFECTIVO:', f(opening.initialCash || 0)),
    divider,
  ]

  if (opening.notes) {
    lines.push('Notas de Apertura:', opening.notes, divider)
  }

  lines.push(
    '',
    padLine('Firma Cajero:', '_________________'),
    '',
    padLine('Firma Supervisor:', '_________________'),
    divider,
    centerLine('** TURNO INICIADO CON EXITO **'),
    centerLine('Software The Villa Dog v1.0')
  )

  return lines.join('\n')
}

export function buildClosingText(closing: any, paper: string = '80'): string {
  const f = (val: number) => `$${Math.round(val || 0).toLocaleString('de-DE')}`
  const d = closing._detail
  const width = paper === '58' ? 32 : 48

  const padLine = (left: string, right: string) => {
    const space = width - left.length - right.length
    if (space <= 0) return `${left} ${right}`
    return left + ' '.repeat(space) + right
  }

  const centerLine = (text: string) => {
    const space = Math.floor((width - text.length) / 2)
    if (space <= 0) return text
    return ' '.repeat(space) + text
  }

  const divider = '='.repeat(width)
  const lineDivider = '-'.repeat(width)

  // Calcular duración del turno
  let durationText = ''
  if (closing.shiftStart && closing.shiftEnd) {
    const diffMs = new Date(closing.shiftEnd).getTime() - new Date(closing.shiftStart).getTime()
    const hours = Math.floor(diffMs / (1000 * 60 * 60))
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
    durationText = `${hours}h ${mins}m`
  }

  const lines: string[] = [
    centerLine('THE VILLA DOG'),
    centerLine('Monteria, Cordoba'),
    centerLine('Tel: 300 322 9261'),
    centerLine('CIERRE DE CAJA — REPORTE Z'),
    divider,
    padLine('ID Cierre:', closing.id ? closing.id.substring(0, 8) : 'N/A'),
    padLine('Cajero:', closing.user?.name || closing.userName || 'Cajero'),
    padLine('Caja:', closing.cashRegister?.name || closing.registerName || 'Principal'),
    padLine('Fecha Apertura:', new Date(closing.shiftStart).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true })),
    padLine('Fecha Cierre:', new Date(closing.shiftEnd).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true })),
  ]

  if (durationText) {
    lines.push(padLine('Duracion Turno:', durationText))
  }

  lines.push(
    divider,
    padLine('BASE INICIAL EN CAJA:', f(closing.initialCash)),
    divider,
    centerLine('VENTAS POR METODO DE PAGO'),
    lineDivider
  )

  if (d && d.ventasPorMetodo && d.ventasPorMetodo.length > 0) {
    for (const m of d.ventasPorMetodo) {
      if (m.sales > 0 || m.count > 0) {
        lines.push(padLine(`  ${m.label} (${m.count} trans.):`, f(m.sales)))
      }
    }
  } else {
    lines.push(padLine('  Efectivo:', f(closing.totalCash)))
    lines.push(padLine('  Transferencias:', f(closing.totalTransfers)))
    if (closing.totalNequi) lines.push(padLine('    · Nequi:', f(closing.totalNequi)))
    if (closing.totalBancolombia) lines.push(padLine('    · Bancolombia:', f(closing.totalBancolombia)))
    if (closing.totalDaviplata) lines.push(padLine('    · Daviplata:', f(closing.totalDaviplata)))
    if (closing.totalCredit) lines.push(padLine('  Credito (Fiados):', f(closing.totalCredit)))
  }

  lines.push(
    lineDivider,
    padLine('SUBTOTAL VENTAS:', f(closing.totalSales))
  )

  if (d && d.domicilios > 0) {
    lines.push(padLine('Recargo Domicilios:', f(d.domicilios)))
  }
  if (closing.totalTips > 0) {
    lines.push(padLine('Total Propinas:', f(closing.totalTips)))
  }

  const totalFacturado = (closing.totalSales || 0) + (closing.totalTips || 0)
  lines.push(
    lineDivider,
    padLine('TOTAL FACTURADO:', f(totalFacturado))
  )

  if (d && d.transacciones) {
    lines.push(padLine('Total Pedidos Entregados:', String(d.transacciones)))
  }

  // Gastos del turno
  lines.push(
    divider,
    centerLine('GASTOS Y EGRESOS DEL TURNO'),
    lineDivider
  )

  if (d && d.gastos && d.gastos.items && d.gastos.items.length > 0) {
    for (const g of d.gastos.items) {
      lines.push(padLine(`  ${g.tipo}:`, `-${f(g.total)}`))
    }
  } else if (closing.totalExpenses > 0) {
    lines.push(padLine('  Gastos registrados:', `-${f(closing.totalExpenses)}`))
  } else {
    lines.push(padLine('  Sin gastos registrados:', '$0'))
  }

  lines.push(
    lineDivider,
    padLine('TOTAL GASTOS / EGRESOS:', `-${f(closing.totalExpenses || 0)}`)
  )

  // Arqueo y Cuadre de Efectivo
  const cashSales = closing.totalCash || 0
  const tipsCash = (closing.totalTips || 0)
  const expensesVal = (closing.totalExpenses || 0)
  const expectedCash = (closing.initialCash || 0) + cashSales + tipsCash - expensesVal

  lines.push(
    divider,
    centerLine('ARQUEO Y CUADRE DE EFECTIVO'),
    lineDivider,
    padLine('  (+) Base Inicial:', f(closing.initialCash)),
    padLine('  (+) Ventas en Efectivo:', f(cashSales)),
    padLine('  (+) Propinas Efectivo:', f(tipsCash)),
    padLine('  (-) Gastos Efectivo:', `-${f(expensesVal)}`),
    lineDivider,
    padLine('  (=) EFECTIVO ESPERADO:', f(expectedCash)),
    padLine('  DIFERENCIA / DESCUADRE:', f(closing.discrepancy || 0)),
    divider
  )

  if (closing.notes) {
    lines.push('Notas del Cierre:', closing.notes, divider)
  }

  lines.push(
    '',
    padLine('Firma Cajero:', '_________________'),
    '',
    padLine('Firma Supervisor:', '_________________'),
    divider,
    centerLine('** REPORTE DE CIERRE AUDITADO **'),
    centerLine('Software The Villa Dog v1.0')
  )

  return lines.join('\n')
}

export async function printOpeningSmart(
  opening: any,
  userRole?: string
): Promise<{ method: 'usb' | 'network' | 'browser' | 'local_bridge'; silent: boolean; error?: string }> {
  const settings = await getPrinterSettings()
  const printerConfig = settings.caja

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768
  const isWaiter = userRole === 'WAITER'

  // 1) Modo USB
  if (printerConfig.mode === 'usb') {
    let device = getUsbDevice('caja')
    if (!device) {
      await autoReconnectUsbDevices(['caja'])
      device = getUsbDevice('caja')
    }

    if (device) {
      const text = buildOpeningText(opening, printerConfig.paper)
      let buffer = buildEscPosBuffer(text, printerConfig.paper)
      const kick = new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFA])
      const combined = new Uint8Array(kick.length + buffer.length)
      combined.set(kick, 0)
      combined.set(buffer, kick.length)
      buffer = combined
      const result = await printUsb(buffer, 'caja')
      if (result.ok) return { method: 'usb', silent: true }
      return { method: 'usb', silent: true, error: `WebUSB falló: ${result.error}` }
    }
    return { method: 'usb', silent: true, error: 'USB no conectada.' }
  }

  // 2) Modo Red (IP) o Puente Local (Cola)
  if ((printerConfig.mode === 'network' || printerConfig.mode === 'local_bridge') && opening.id) {
    try {
      const result = await api.post<{ ok: boolean; error?: string }>(`/print/opening/${opening.id}`)
      return { method: printerConfig.mode, silent: true, error: result.ok ? undefined : (result.error || 'Error en servidor') }
    } catch (err: any) {
      return { method: printerConfig.mode, silent: true, error: err.message || 'Error de conexión' }
    }
  }

  // 3) Modo Navegador
  if (printerConfig.mode === 'browser') {
    if (!isMobile && !isWaiter) {
      printViaIframe(buildOpeningPrintHtml(opening, printerConfig.paper, settings.restaurant))
      return { method: 'browser', silent: false }
    }
  }

  return { method: printerConfig.mode, silent: true }
}

export async function printClosingSmart(
  closing: any,
  userRole?: string
): Promise<{ method: 'usb' | 'network' | 'browser' | 'local_bridge'; silent: boolean; error?: string }> {
  // Cargar automáticamente el detalle completo si no viene incluido
  if (!closing._detail && closing.id) {
    try {
      const detail = await api.get<any>(`/payments/closing/${closing.id}/detail`)
      if (detail) {
        closing._detail = detail
      }
    } catch (e) {
      console.warn('No se pudo precargar el detalle de cierre:', e)
    }
  }

  const settings = await getPrinterSettings()
  const printerConfig = settings.caja

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768
  const isWaiter = userRole === 'WAITER'

  // 1) Modo USB
  if (printerConfig.mode === 'usb') {
    let device = getUsbDevice('caja')
    if (!device) {
      console.log(`[WebUSB] Dispositivo no en memoria para caja, intentando auto-reconexión silenciosa...`)
      await autoReconnectUsbDevices(['caja'])
      device = getUsbDevice('caja')
    }

    if (device) {
      const text = buildClosingText(closing, printerConfig.paper)
      let buffer = buildEscPosBuffer(text, printerConfig.paper)
      const kick = new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFA])
      const combined = new Uint8Array(kick.length + buffer.length)
      combined.set(kick, 0)
      combined.set(buffer, kick.length)
      buffer = combined
      const result = await printUsb(buffer, 'caja')
      if (result.ok) return { method: 'usb', silent: true }
      return { method: 'usb', silent: true, error: `WebUSB falló: ${result.error}` }
    }
    return { method: 'usb', silent: true, error: 'USB no conectada.' }
  }

  // 2) Modo Red (IP) o Puente Local (Cola)
  if ((printerConfig.mode === 'network' || printerConfig.mode === 'local_bridge') && closing.id) {
    try {
      const result = await api.post<{ ok: boolean; error?: string }>(`/print/closing/${closing.id}`)
      return { method: printerConfig.mode, silent: true, error: result.ok ? undefined : (result.error || 'Error en servidor') }
    } catch (err: any) {
      return { method: printerConfig.mode, silent: true, error: err.message || 'Error de conexión' }
    }
  }

  // 3) Modo Navegador
  if (printerConfig.mode === 'browser') {
    if (!isMobile && !isWaiter) {
      printViaIframe(buildClosingPrintHtml(closing, printerConfig.paper, settings.restaurant))
      return { method: 'browser', silent: false }
    }
  }

  return { method: printerConfig.mode, silent: true }
}

export async function openCashDrawer(): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await getPrinterSettings()
    const printerConfig = settings.caja

    if (printerConfig.mode === 'usb') {
      let device = getUsbDevice('caja')
      if (!device) {
        console.log(`[WebUSB] Dispositivo no en memoria para abrir cajón, intentando auto-reconexión silenciosa...`)
        await autoReconnectUsbDevices(['caja'])
        device = getUsbDevice('caja')
      }

      if (device) {
        const DRAWER_KICK = new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFA])
        const result = await printUsb(DRAWER_KICK, 'caja')
        if (result.ok) return { ok: true }
        return { ok: false, error: `WebUSB falló: ${result.error}` }
      }
      return { ok: false, error: 'Impresora USB de caja no conectada. Conéctala en Configuración.' }
    }

    // Para modo Red (IP) o Puente Local (local_bridge), llamar al servidor
    const res = await api.post<{ ok: boolean; error?: string }>('/print/open-drawer')
    return { ok: res.ok, error: res.error }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Error al intentar abrir el cajón monedero.' }
  }
}
