import { formatCurrency, formatDate, getStatusLabel, groupOrderItems, cleanNotes } from '@/lib/utils'

interface ComandaItem {
  quantity: number
  menuItem: { name: string; categoryId?: string; code?: string }
  notes?: string | null
  price?: number
  unitPrice?: number
  additions?: any[]
}

export interface ComandaOrder {
  id?: string
  orderNumber: number
  invoiceNumber?: number | null
  orderType?: 'DELIVERY' | 'PICKUP' | string
  customerName: string
  customerPhone: string
  customerAddress: string
  addressReference?: string | null
  notes?: string | null
  subtotal: number
  tax: number
  deliveryFee: number
  total: number
  paymentMethod: string
  createdAt: string
  updatedAt?: string
  status: string
  zone?: { name: string; zoneGroup?: string } | null
  assignee?: { name: string } | null
  waiter?: { name: string } | null
  deliveryDriver?: { name: string; phone?: string } | null
  deliveryDriverName?: string | null
  items?: ComandaItem[]
  isEdited?: boolean
  cancellationReason?: string | null
}

const paymentLabels: Record<string, string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  MIXED: 'Mixto',
  NEQUI: 'Nequi',
  BANCOLOMBIA: 'Bancolombia',
  DAVIPLATA: 'Daviplata',
}

export function printComanda(order: ComandaOrder) {
  const win = window.open('', '_blank', 'width=400,height=600')
  if (!win) return

  const fullAddress = [order.customerAddress, order.addressReference].filter(Boolean).join(' — ')

  win.document.write(`
    <!DOCTYPE html>
    <html><head><title>Comanda #${order.orderNumber}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Courier New', monospace; width: 80mm; padding: 8mm; font-size: 12px; color: #000; }
      .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 8px; margin-bottom: 8px; }
      .header h1 { font-size: 18px; letter-spacing: 2px; }
      .header p { font-size: 10px; margin-top: 4px; }
      .order-num { font-size: 24px; font-weight: bold; text-align: center; margin: 8px 0; }
      .section { margin: 8px 0; padding: 6px 0; border-bottom: 1px dashed #ccc; }
      .label { font-weight: bold; font-size: 10px; text-transform: uppercase; color: #555; }
      .value { font-size: 13px; margin-top: 2px; }
      .address { font-size: 14px; font-weight: bold; line-height: 1.4; }
      .item { display: flex; justify-content: space-between; margin: 4px 0; }
      .item-name { flex: 1; }
      .item-qty { font-weight: bold; margin-right: 8px; }
      .total { font-size: 16px; font-weight: bold; text-align: right; margin-top: 8px; }
      .footer { text-align: center; margin-top: 12px; font-size: 10px; border-top: 2px dashed #000; padding-top: 8px; }
      .badge { display: inline-block; background: #000; color: #fff; padding: 2px 6px; font-size: 10px; margin: 2px; }
      @media print { body { width: 80mm; } }
    </style></head><body>
    <div class="header">
      <h1>THE VILLA DOG</h1>
      <p>Sabor Auténtico · Montería, Córdoba</p>
    ${order.status === 'CANCELLED' ? `
      <div style="background-color:#000; color:#fff; text-align:center; padding:8px; font-size:18px; font-weight:bold; margin:6px 0; border:2px solid #000;">
        ⛔ PEDIDO CANCELADO #${order.orderNumber} ⛔
      </div>
      ${(order as any).cancellationReason ? `<div style="text-align:center; font-weight:bold; font-size:12px; margin-bottom:8px; border:1px solid #000; padding:4px;">MOTIVO: ${(order as any).cancellationReason.toUpperCase()}</div>` : ''}
    ` : ((order.isEdited || (order.createdAt && order.updatedAt && new Date(order.updatedAt).getTime() - new Date(order.createdAt).getTime() > 5000)) ? `
      <div style="background-color:#000; color:#fff; text-align:center; padding:6px; font-size:16px; font-weight:bold; margin:6px 0; border:2px solid #000;">
        ⚠️ PEDIDO EDITADO #${order.orderNumber} ⚠️
      </div>
    ` : `<div class="order-num">#${order.orderNumber}</div>`)}
    <div style="text-align:center;margin-bottom:8px;">
      <span class="badge">${getStatusLabel(order.status)}</span>
      <span class="badge">${paymentLabels[order.paymentMethod] || order.paymentMethod}</span>
    </div>
    <div class="section">
      <div class="label">Cliente</div>
      <div class="value">${order.customerName}</div>
      <div class="value">${(() => {
        const raw = (order.customerPhone || '').trim();
        const digits = raw.replace(/\D/g, '');
        if (digits === '3000000000' || raw.toLowerCase().includes('mostrador')) return 'Consumo en restaurante / Mostrador';
        const p10 = (digits.length === 12 && digits.startsWith('57')) ? digits.slice(2) : digits;
        if (p10.length === 10 && p10.startsWith('3')) return `+57 ${p10.slice(0, 3)} ${p10.slice(3, 6)} ${p10.slice(6)}`;
        if (digits.length >= 14 || /^(wa_lead_|user_|id_|c_|wamid\.)/i.test(raw)) return 'WhatsApp Directo (Sin celular)';
        return raw || 'N/A';
      })()}</div>
    </div>
    <div class="section">
      <div class="label">Dirección de entrega</div>
      <div class="address">${fullAddress}</div>
      ${order.zone ? `<div class="value" style="margin-top:4px;">Barrio: ${order.zone.name}${order.zone.zoneGroup ? ` (${order.zone.zoneGroup})` : ''}</div>` : ''}
    </div>
    <div class="section">
      <div class="label">Productos</div>
      ${groupOrderItems(order.items || []).map(i => `
        <div class="item">
          <span class="item-qty">${i.quantity}x</span>
          <span class="item-name" style="font-weight: bold;">${i.menuItem.code ? `[${i.menuItem.code}] ` : ''}${i.menuItem.name}${i.notes && cleanNotes(i.notes) && !i.notes.startsWith('Adición para:') ? ` (${cleanNotes(i.notes)})` : ''}</span>
        </div>
        ${i.additions && i.additions.map(a => `
          <div class="item" style="margin-left: 15px; font-size: 11px; color: #333;">
            <span class="item-qty">+ ${a.quantity}x</span>
            <span class="item-name">${a.menuItem.code ? `[${a.menuItem.code}] ` : ''}${a.menuItem.name} [Adición]</span>
          </div>
        `).join('') || ''}
      `).join('')}
    </div>
    ${(() => { const cn = (order.notes || '').replace(/^\[MOSTRADOR\]\s*/i, '').replace(/^\[PICKUP\]\s*/i, '').trim(); return cn ? `<div class="section"><div class="label">Notas</div><div class="value">${cn}</div></div>` : '' })()}
    <div class="section">
      <div class="item"><span>Subtotal</span><span>${formatCurrency(order.subtotal)}</span></div>
      <div class="item"><span>Domicilio</span><span>${formatCurrency(order.deliveryFee)}</span></div>
      ${order.tax > 0 ? `<div class="item"><span>Impoconsumo 8%</span><span>${formatCurrency(order.tax)}</span></div>` : ''}
      <div class="total">TOTAL: ${formatCurrency(order.total)}</div>
    </div>
    <div class="section">
      <div class="label">Atiende</div>
      <div class="value">${order.assignee?.name || order.waiter?.name || '—'}</div>
      ${(order.deliveryDriver?.name || order.deliveryDriverName) ? `<div class="value" style="margin-top:4px;"><b>Domiciliario:</b> ${order.deliveryDriver?.name || order.deliveryDriverName}</div>` : ''}
      <div class="value" style="font-size:10px;margin-top:4px;">${formatDate(order.createdAt)}</div>
    </div>
    <div class="footer">THE VILLA DOG · Comanda #${order.orderNumber}</div>
    <script>window.onload=function(){window.print();}</script>
    </body></html>
  `)
  win.document.close()
}
