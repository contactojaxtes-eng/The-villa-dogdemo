import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import * as net from 'net';
import { PrismaService } from '../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class PrintService {
  private readonly logger = new Logger(PrintService.name);

  constructor(
    private prisma: PrismaService,
    private socketGateway: SocketGateway,
    @Inject(forwardRef(() => OrdersService))
    private ordersService: OrdersService,
  ) {}

  private isIpv4(value: string) {
    const parts = value.split('.');
    return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  }

  private isLocalPrinterAddress(value: string) {
    if (value.toUpperCase().startsWith('USB:')) {
      const shareName = value.slice(4).trim();
      return /^[\p{L}\p{N} ._()-]{1,80}$/u.test(shareName);
    }
    const [host, rawPort, ...extra] = value.split(':');
    const validPort = rawPort === undefined || (/^\d+$/.test(rawPort) && Number(rawPort) >= 1 && Number(rawPort) <= 65535);
    return (this.isIpv4(host) || host === 'localhost') && extra.length === 0 && validPort;
  }

  async getPrinterSettings() {
    const keys = [
      'caja_printer_mode', 'caja_printer_ip', 'caja_printer_port', 'caja_printer_paper', 'caja_printer_name',
      'cocina_printer_mode', 'cocina_printer_ip', 'cocina_printer_port', 'cocina_printer_paper', 'cocina_printer_name', 'cocina_printer_categories',
      'bar_printer_mode', 'bar_printer_ip', 'bar_printer_port', 'bar_printer_paper', 'bar_printer_name', 'bar_printer_categories',
      'printer_auto_print', 'custom_prep_printers',
      'restaurant_name', 'restaurant_nit', 'restaurant_address', 'restaurant_phone', 'restaurant_hours'
    ];
    const rows = await this.prisma.appSetting.findMany({ where: { key: { in: keys } } });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;

    const parseCats = (raw?: string): string[] => {
      if (!raw) return [];
      try { return JSON.parse(raw); } catch { return []; }
    };

    let printers: any[] = [];
    if (map.custom_prep_printers) {
      try {
        printers = JSON.parse(map.custom_prep_printers);
      } catch {
        printers = [];
      }
    } else {
      // Migrate legacy settings
      printers = [
        {
          id: 'cocina',
          name: map.cocina_printer_name || 'Cocina',
          mode: map.cocina_printer_mode || 'network',
          ip: map.cocina_printer_ip || '',
          port: parseInt(map.cocina_printer_port || '9100'),
          paper: map.cocina_printer_paper || '80',
          categories: parseCats(map.cocina_printer_categories),
        },
        {
          id: 'bar',
          name: map.bar_printer_name || 'Bar / Bebidas',
          mode: map.bar_printer_mode || 'network',
          ip: map.bar_printer_ip || '',
          port: parseInt(map.bar_printer_port || '9100'),
          paper: map.bar_printer_paper || '80',
          categories: parseCats(map.bar_printer_categories),
        }
      ];
    }

    const legacyCocina = printers.find(p => p.id === 'cocina') || printers[0] || { mode: 'network', ip: '', port: 9100, paper: '80', name: 'Cocina', categories: [] };
    const legacyBar = printers.find(p => p.id === 'bar') || printers[1] || { mode: 'network', ip: '', port: 9100, paper: '80', name: 'Bar / Bebidas', categories: [] };

    return {
      restaurant: {
        name: map.restaurant_name || 'THE VILLA DOG',
        nit: map.restaurant_nit || '',
        address: map.restaurant_address || 'Monteria, Cordoba',
        phone: map.restaurant_phone || '310 000 0000',
        hours: map.restaurant_hours || '12:00 PM - 11:00 PM',
      },
      caja: {
        mode: map.caja_printer_mode || 'browser',
        ip: map.caja_printer_ip || '',
        port: parseInt(map.caja_printer_port || '9100'),
        paper: map.caja_printer_paper || '80',
        name: map.caja_printer_name || 'Caja',
      },
      cocina: legacyCocina,
      bar: legacyBar,
      printers,
      autoPrint: map.printer_auto_print === 'true',
      // Fallback values for backward compatibility
      mode: legacyCocina.mode || 'network',
      ip: legacyCocina.ip || '',
      port: legacyCocina.port || 9100,
      paper: legacyCocina.paper || '80',
      name: legacyCocina.name || 'Cocina',
    };
  }

  async savePrinterSettings(data: any) {
    const updates: { key: string; value: string }[] = [];
    if (data.restaurant) {
      if (data.restaurant.name) updates.push({ key: 'restaurant_name', value: data.restaurant.name });
      if (data.restaurant.nit) updates.push({ key: 'restaurant_nit', value: data.restaurant.nit });
      if (data.restaurant.address) updates.push({ key: 'restaurant_address', value: data.restaurant.address });
      if (data.restaurant.phone) updates.push({ key: 'restaurant_phone', value: data.restaurant.phone });
      if (data.restaurant.hours) updates.push({ key: 'restaurant_hours', value: data.restaurant.hours });
    }
    if (data.caja) {
      if (data.caja.mode) updates.push({ key: 'caja_printer_mode', value: data.caja.mode });
      if (data.caja.ip !== undefined) updates.push({ key: 'caja_printer_ip', value: data.caja.ip });
      if (data.caja.port) updates.push({ key: 'caja_printer_port', value: String(data.caja.port) });
      if (data.caja.paper) updates.push({ key: 'caja_printer_paper', value: data.caja.paper });
      if (data.caja.name) updates.push({ key: 'caja_printer_name', value: data.caja.name });
    }
    if (data.printers && Array.isArray(data.printers)) {
      updates.push({ key: 'custom_prep_printers', value: JSON.stringify(data.printers) });
      
      const cocina = data.printers.find((p: any) => p.id === 'cocina') ||
        data.printers.find((p: any) => p.channel === 'DELIVERY' || p.channel === 'BOTH') ||
        data.printers.find((p: any) => (p.name || '').toLowerCase().includes('cocina') || (p.name || '').toLowerCase().includes('domicilio')) ||
        data.printers.find((p: any) => p.type !== 'caja') ||
        data.printers[0];

      if (cocina) {
        if (cocina.mode) updates.push({ key: 'cocina_printer_mode', value: cocina.mode });
        if (cocina.ip !== undefined) updates.push({ key: 'cocina_printer_ip', value: cocina.ip });
        if (cocina.port) updates.push({ key: 'cocina_printer_port', value: String(cocina.port) });
        if (cocina.paper) updates.push({ key: 'cocina_printer_paper', value: cocina.paper });
        if (cocina.name) updates.push({ key: 'cocina_printer_name', value: cocina.name });
        if (cocina.categories !== undefined) updates.push({ key: 'cocina_printer_categories', value: JSON.stringify(cocina.categories) });
      }
      const bar = data.printers.find((p: any) => p.id === 'bar') ||
        data.printers.find((p: any) => (p.name || '').toLowerCase().includes('bar') || (p.name || '').toLowerCase().includes('bebida'));
      if (bar) {
        if (bar.mode) updates.push({ key: 'bar_printer_mode', value: bar.mode });
        if (bar.ip !== undefined) updates.push({ key: 'bar_printer_ip', value: bar.ip });
        if (bar.port) updates.push({ key: 'bar_printer_port', value: String(bar.port) });
        if (bar.paper) updates.push({ key: 'bar_printer_paper', value: bar.paper });
        if (bar.name) updates.push({ key: 'bar_printer_name', value: bar.name });
        if (bar.categories !== undefined) updates.push({ key: 'bar_printer_categories', value: JSON.stringify(bar.categories) });
      }
    }
    if (data.autoPrint !== undefined) {
      updates.push({ key: 'printer_auto_print', value: data.autoPrint ? 'true' : 'false' });
    }
    for (const u of updates) {
      await this.prisma.appSetting.upsert({
        where: { key: u.key },
        create: u,
        update: { value: u.value },
      });
    }
    const updated = await this.getPrinterSettings();
    this.socketGateway.server?.emit('printerSettingsUpdated', updated);
    this.socketGateway.server?.emit('settingsUpdated', updated);
    return updated;
  }

  buildEscPos(text: string, paper: string): Buffer {
    const width = paper === '58' ? 32 : 48;
    const ESC = '\x1B';
    const GS = '\x1D';
    
    // Sanitizar tildes y caracteres diacríticos para evitar símbolos extraños en impresoras térmicas
    const sanitizedText = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ñ/g, 'n')
      .replace(/Ñ/g, 'N')
      .replace(/¿/g, '?')
      .replace(/¡/g, '!');

    // Inicializar impresora
    let out = ESC + '@';
    
    // Seleccionar tabla de caracteres WPC1252 (Latin-1)
    out += ESC + 't' + String.fromCharCode(16);
    
    const lines = sanitizedText.split('\n');
    for (const line of lines) {
      let cleanLine = line;
      let isBig = false;
      let isHeight = false;
      let isBold = false;
      let isCenter = false;

      if (cleanLine.includes('[BIG]')) {
        isBig = true;
        cleanLine = cleanLine.replace(/\[\/?BIG\]/g, '');
      }
      if (cleanLine.includes('[HEIGHT]')) {
        isHeight = true;
        cleanLine = cleanLine.replace(/\[\/?HEIGHT\]/g, '');
      }
      if (cleanLine.includes('[BOLD]')) {
        isBold = true;
        cleanLine = cleanLine.replace(/\[\/?BOLD\]/g, '');
      }
      if (cleanLine.includes('[CENTER]')) {
        isCenter = true;
        cleanLine = cleanLine.replace(/\[\/?CENTER\]/g, '');
      }

      // Alinear texto
      if (isCenter) {
        out += ESC + 'a' + String.fromCharCode(1); // Centrado
      } else {
        out += ESC + 'a' + String.fromCharCode(0); // Izquierda
      }

      // Configurar modo de fuente
      let modeByte = 0;
      if (isBold) modeByte |= 0x08;
      if (isBig) modeByte |= 0x30; // Double-height + Double-width
      else if (isHeight) modeByte |= 0x10; // Double-height solamente (ancho normal)
      out += ESC + '!' + String.fromCharCode(modeByte);
      
      // Ajustar el ancho máximo de la línea según el modo
      const lineMaxLen = isBig ? Math.floor(width / 2) : width;

      // Envolver líneas largas respetando palabras completas
      const chunks = this.wrapLine(cleanLine, lineMaxLen);
      for (const chunk of chunks) {
        out += chunk + '\n';
      }
    }

    // Restaurar modo normal
    out += ESC + '!' + String.fromCharCode(0);
    out += ESC + 'a' + String.fromCharCode(0);

    // 7 líneas en blanco al final
    out += '\n\n\n\n\n\n\n';
    
    // Corte de papel
    out += GS + 'V' + String.fromCharCode(0);
    
    // 3 pititos a la impresora cuando sale un pedido (ESC B 3 2 + BEL BEL BEL)
    out += ESC + 'B' + String.fromCharCode(3) + String.fromCharCode(2);
    out += '\x07\x07\x07';

    return Buffer.from(out, 'latin1');
  }

  private wrapLine(line: string, width: number): string[] {
    if (line.length <= width) return [line];
    const words = line.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if ((currentLine ? currentLine + ' ' + word : word).length <= width) {
        currentLine = currentLine ? currentLine + ' ' + word : word;
      } else {
        if (currentLine) lines.push(currentLine);
        if (word.length > width) {
          let rest = word;
          while (rest.length > width) {
            lines.push(rest.slice(0, width));
            rest = rest.slice(width);
          }
          currentLine = rest;
        } else {
          currentLine = word;
        }
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  async sendBufferToNetwork(buffer: Buffer, ip: string, port: number): Promise<{ ok: boolean; error?: string }> {
    if (!ip) return { ok: false, error: 'IP de impresora no configurada' };
    return new Promise(resolve => {
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve({ ok: false, error: 'Timeout conectando a la impresora' });
      }, 5000);
      socket.connect(port, ip, () => {
        socket.write(buffer, () => {
          clearTimeout(timeout);
          socket.end();
          resolve({ ok: true });
        });
      });
      socket.on('error', err => {
        clearTimeout(timeout);
        this.logger.error(`Print error ${ip}:${port}`, err.message);
        resolve({ ok: false, error: err.message });
      });
    });
  }

  async printToNetwork(content: string, ip: string, port: number, paper: string): Promise<{ ok: boolean; error?: string }> {
    const buffer = this.buildEscPos(content, paper);
    return this.sendBufferToNetwork(buffer, ip, port);
  }

  private cleanNotes(notes?: string | null): string {
    if (!notes) return '';
    return notes.replace(/\s*\(#[\w-]+\)/g, '').trim();
  }

  private cleanNotesForPrint(notes?: string | null, productName?: string): string {
    if (!notes) return '';
    let cleaned = notes.replace(/\s*\(#[\w-]+\)/g, '').trim();
    if (!cleaned) return '';
    if (cleaned.startsWith('Adición para:')) return '';

    // 0. Eliminar frases afectivas, saludos, despedidas o palabras de chat que nada tienen que ver con la cocina
    const chatFluff = /\b(te\s+amo|te\s+quiero|te\s+adoro|bebe|bebecito|bebesito|bebesita|mi\s+amor|mi\s+vida|mi\s+cielo|mi\s+rey|mi\s+reina|amor|reina|rey|princesa|cariño|linda|lindo|hermoso|hermosa|corazon|vida|parce|parcero|hermano|amigo|amiga|vecino|vecina|por\s*fa(?:vor)?|porfa|por\s+fa|muchas\s+gracias|gracias|buen\s+dia|buenas\s+tardes|buenas\s+noches|buenas|hola|saludos|atentamente|chao|adios)\b/gi;
    cleaned = cleaned.replace(chatFluff, ' ');

    // Eliminar verbos y peticiones conversacionales ("me regala", "me da", "deme", "regalame", etc.)
    const orderVerbs = /\b(me\s+regala[sn]?|me\s+da[sn]?|regalame|deme|mande(?:me)?|envie(?:me)?|traiga(?:me)?|quiero|quisiera|haga(?:me)?\s+el\s+favor|favor)\b/gi;
    cleaned = cleaned.replace(orderVerbs, ' ');

    // Quitar repeticiones de cantidades y nombres de producto dentro de la nota (ej: "2 perro sencillos 1 sin cebolla" -> "sin cebolla")
    cleaned = cleaned.replace(/\b\d+\s+(?:perro|hamburguesa|pizza|salchipapa|desgranado|suizo)s?\s*(?:sencill[oa]s?|especial(?:es)?|gratina[do]s?|mixt[oa]s?|personal(?:es)?|familiar(?:es)?)?/gi, ' ');
    cleaned = cleaned.replace(/\b\d+\s+(sin|con)\b/gi, '$1');

    // 1. Quitar precios, signos de pesos y valores monetarios (ej: "$ 17.300", "($ 17.300)", "$34.600", "$ 4.000")
    cleaned = cleaned
      .replace(/\(\s*\$\s*[\d.,]+\s*\)/gi, '')
      .replace(/\[\s*\$\s*[\d.,]+\s*\]/gi, '')
      .replace(/\$\s*[\d.,]+/g, '')
      .replace(/\b\d{1,3}(?:\.\d{3})+(?:\s*(?:pesos|cop|mil|k))?\b/gi, '')
      .replace(/\b\d{4,}(?:\s*(?:pesos|cop|mil|k))?\b/gi, '');

    // 2. Si se proporciona el nombre del producto, remover repeticiones del nombre o variantes del plato
    if (productName) {
      const parenMatches = productName.match(/\(([^)]+)\)/g) || [];
      for (const p of parenMatches) {
        const inside = p.replace(/[()]/g, '').trim();
        if (inside.length > 2) {
          cleaned = cleaned.replace(new RegExp(`\\b${inside.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi'), '');
        }
      }
      const cleanProdName = productName.replace(/\([^)]+\)/g, '').trim();
      if (cleanProdName.length > 2) {
        cleaned = cleaned.replace(new RegExp(`\\b${cleanProdName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi'), '');
      }
    }

    // 3. Limpiar delimitadores y frases conversacionales de asesores/bot
    cleaned = cleaned
      .split(/\s*[—–\-|,]\s*/)
      .map(chunk => chunk.trim())
      .filter(chunk => {
        if (!chunk || chunk.length < 2) return false;
        if (/^[\d\s.,$()\-—]+$/.test(chunk)) return false;

        const normChunk = chunk.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

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
          return false;
        }

        if (/^(valor|total|precio|domicilio|subtotal|papas francesa|papas francesas|papas vapor|papas al vapor)$/i.test(chunk)) return false;
        return true;
      })
      .join(' — ')
      .trim();

    if (!cleaned) return '';

    const normCleaned = cleaned.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normProduct = (productName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // 4. Ignorar si la nota es idéntica o sólo repite el nombre del producto
    if (normProduct && (normCleaned === normProduct || normCleaned === `1 x ${normProduct}` || normCleaned === `nota: ${normProduct}`)) {
      return '';
    }

    // 5. Descartar frases descriptivas de chat, promociones o descripciones de porciones
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
      const match = cleaned.match(/\b(sin\s+[\w\s]+|con\s+papas\s+[\w\s]+|salsa\s+[\w\s]+|bien\s+asada|termino\s+medio|jugo\s+en\s+[\w]+)\b/i);
      if (match) return match[0].trim();
      return '';
    }

    // 6. Si contiene una instrucción explícita de cocina (sin cebolla, sin salsa, con tártara, etc.), extraerla directamente
    const specificInstruction = cleaned.match(/\b(sin\s+[\w\s]+|con\s+[\w\s]+|aparte|bien\s+asada|bien\s+cocid[oa]|termino\s+medio|papas?\s+[\w\s]+|salsa\s+[\w\s]+)\b/i);
    if (specificInstruction) {
      return specificInstruction[0].trim();
    }

    return cleaned;
  }

  private groupOrderItems(items: any[]): any[] {
    const baseItems: any[] = [];
    const additions: any[] = [];

    for (const item of items) {
      const notesStr = item.notes || '';
      if (notesStr.startsWith('Adición para:')) {
        additions.push(item);
      } else {
        baseItems.push({ ...item, additions: [] });
      }
    }

    for (const add of additions) {
      const notesStr = add.notes || '';
      const tagMatch = notesStr.match(/\(#[\w-]+\)/);
      let parent: any = null;

      if (tagMatch) {
        const tag = tagMatch[0];
        parent = baseItems.find(bi => (bi.notes || '').includes(tag));
      }

      if (!parent) {
        const parentName = notesStr.replace('Adición para:', '').replace(/\s*\(#[\w-]+\)/g, '').trim().toLowerCase();
        parent = baseItems.find(bi => {
          const name = bi.menuItem?.name || bi.name || '';
          return name.toLowerCase().trim() === parentName;
        });
      }

      if (parent) {
        parent.additions.push(add);
      } else {
        baseItems.push({ ...add, additions: [] });
      }
    }

    return baseItems;
  }

  formatDisplayPhone(rawPhone?: string, orderType?: string, altPhone?: string): string {
    const candidate = altPhone || rawPhone;
    if (!candidate) return orderType === 'LOCAL' ? 'Consumo en restaurante / Mostrador' : 'N/A';
    const clean = candidate.trim();
    const digits = clean.replace(/\D/g, '');
    if (digits === '3000000000' || clean.toLowerCase().includes('mostrador') || orderType === 'LOCAL') {
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

  formatPaymentMethodLabel(order: any): string {
    const raw = String(order?.paymentMethod || 'EFECTIVO').trim().toUpperCase();
    if (raw === 'MIXED') {
      const cash = order?.cashAmount ? `$${Math.round(order.cashAmount).toLocaleString('es-CO')}` : '$0';
      const transfer = order?.transferAmount ? `$${Math.round(order.transferAmount).toLocaleString('es-CO')}` : '$0';
      return `MIXTO (EFECTIVO: ${cash} / TRANSF: ${transfer})`;
    }
    const map: Record<string, string> = {
      CASH: 'EFECTIVO',
      EFECTIVO: 'EFECTIVO',
      TRANSFER: 'TRANSFERENCIA',
      TRANSFERENCIA: 'TRANSFERENCIA',
      NEQUI: 'NEQUI',
      BANCOLOMBIA: 'BANCOLOMBIA',
      DAVIPLATA: 'DAVIPLATA',
      CARD: 'TARJETA / DATÁFONO',
      CREDIT_CARD: 'TARJETA DE CRÉDITO',
      DEBIT_CARD: 'TARJETA DE DÉBITO',
      DATAFONO: 'DATÁFONO',
      TARJETA: 'TARJETA',
    };
    return map[raw] || raw;
  }

  formatCajaInvoiceText(order: any, settings?: any): string {
    const fullAddress = [order.customerAddress, order.addressReference].filter(Boolean).join(' — ');
    const grouped = this.groupOrderItems(order.items || []);

    const restInfo = settings?.restaurant || {
      name: 'THE VILLA DOG',
      nit: '901928696',
      address: 'Monteria, Cordoba',
      phone: '310 000 0000',
    };

    const paper = settings?.caja?.paper || '80';
    const is80 = paper === '80';
    const width = is80 ? 48 : 32;

    const pad = (text: string, length: number, align: 'left' | 'right' = 'left'): string => {
      const cleanText = text.slice(0, length);
      if (align === 'left') {
        return cleanText.padEnd(length, ' ');
      } else {
        return cleanText.padStart(length, ' ');
      }
    };

    const padLine = (left: string, right: string) => {
      const space = width - left.length - right.length;
      if (space <= 0) return `${left} ${right}`;
      return left + ' '.repeat(space) + right;
    };

    const formatCurrency = (val: number) => `$${Math.round(val || 0).toLocaleString('de-DE')}`;

    const divider = '='.repeat(width);
    const lineDivider = '-'.repeat(width);

    const isTableOrder = Boolean(order.diningTable || order.tableId || order.orderType === 'LOCAL');
    const tableLabel = order.diningTable?.label || order.tableName || order.table?.label || (order.tableId ? 'Mesa' : 'Salón');
    const barrio = order.zone?.name || order.zoneName || order.barrio;
    const driverName = order.deliveryDriver?.name || order.deliveryDriverName || order.driverName || order.driver?.name;

    const lines: string[] = [
      `[CENTER][BIG][BOLD]${restInfo.name.toUpperCase()}[/BOLD][/BIG][/CENTER]`,
      `[CENTER]NIT: ${restInfo.nit}[/CENTER]`,
      `[CENTER]Dir: ${restInfo.address.toUpperCase()}[/CENTER]`,
      `[CENTER]Tel: ${restInfo.phone}[/CENTER]`,
      divider,
      `[CENTER][BIG][BOLD]PEDIDO #${order.orderNumber}[/BOLD][/BIG][/CENTER]`,
      `Factura: No. ${order.invoiceNumber || order.orderNumber}`,
      `Fecha: ${new Date(order.createdAt).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true })}`,
      divider,
      isTableOrder
        ? `MESA: ${tableLabel.toUpperCase()}`
        : `TIPO: ${order.orderType === 'DELIVERY' ? 'DOMICILIO 🛵' : 'PASAR A RECOGER 🏠'}`,
      `Cliente: ${order.customerName.toUpperCase()}`,
      `Teléfono: ${this.formatDisplayPhone(order.customerPhone, order.orderType, order.customer?.phone)}`,
      ...(!isTableOrder ? [
        `Dirección: ${fullAddress ? fullAddress.toUpperCase() : 'N/A'}`,
        ...(barrio ? [`Barrio: ${barrio.toUpperCase()}`] : []),
        ...(order.orderType === 'DELIVERY' ? [`Repartidor: ${(driverName || 'SIN ASIGNAR').toUpperCase()}`] : []),
      ] : []),
      `Medio de pago: ${this.formatPaymentMethodLabel(order)}`,
      `Estado: ${order.paymentStatus === 'CONFIRMED' ? 'PAGADO' : 'PENDIENTE DE PAGO'}`,
      `Atendido Por: ${(order.assignee?.name || order.waiter?.name || 'CAJERO').toUpperCase()}`,
      lineDivider,
      '[BOLD]DETALLE DE PRODUCTOS:[/BOLD]',
      lineDivider,
    ];

    const qtyWidth = is80 ? 4 : 3;
    const priceWidth = is80 ? 10 : 7;
    const totalWidth = is80 ? 10 : 7;
    const prodWidth = width - qtyWidth - priceWidth - totalWidth - 3;

    // Cabeceras de la tabla
    lines.push(
      pad('Cant', qtyWidth) + ' ' + pad('Producto', prodWidth) + ' ' + pad('Precio', priceWidth, 'right') + ' ' + pad('Total', totalWidth, 'right')
    );
    lines.push(lineDivider);

    const formatProductRow = (qty: number, name: string, price: number, total: number): string[] => {
      const qtyStr = String(qty);
      const priceStr = formatCurrency(price);
      const totalStr = formatCurrency(total);

      const words = name.trim().split(/\s+/);
      const nameLines: string[] = [];
      let currentLine = '';

      for (const word of words) {
        if (!currentLine) {
          currentLine = word;
        } else if ((currentLine + ' ' + word).length <= prodWidth) {
          currentLine += ' ' + word;
        } else {
          nameLines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) nameLines.push(currentLine);
      if (nameLines.length === 0) nameLines.push('');

      const result: string[] = [];
      for (let i = 0; i < nameLines.length; i++) {
        const q = i === 0 ? qtyStr.padEnd(qtyWidth, ' ') : ''.padEnd(qtyWidth, ' ');
        const p = i === 0 ? priceStr.padStart(priceWidth, ' ') : ''.padStart(priceWidth, ' ');
        const t = i === 0 ? totalStr.padStart(totalWidth, ' ') : ''.padStart(totalWidth, ' ');
        const prod = nameLines[i].padEnd(prodWidth, ' ');

        result.push(`${q} ${prod} ${p} ${t}`);
      }
      return result;
    };

    for (const item of grouped) {
      const price = item.unitPrice || 0;
      const totalBasePrice = price * item.quantity;
      const nameStr = item.menuItem?.name || 'Item';

      lines.push(...formatProductRow(item.quantity, nameStr, price, totalBasePrice));

      // Notas del item
      const cleaned = this.cleanNotesForPrint(item.notes, item.menuItem?.name);
      if (item.notes && cleaned && !item.notes.startsWith('Adición para:')) {
        lines.push(`   ↳ NOTA: ${cleaned.toUpperCase()}`);
      }

      // Adiciones
      if (item.additions && item.additions.length > 0) {
        for (const a of item.additions) {
          const aPrice = a.unitPrice || 0;
          const totalAddPrice = aPrice * a.quantity;
          const aName = `+ ${a.menuItem?.name || 'Item'}`;
          lines.push(...formatProductRow(a.quantity, aName, aPrice, totalAddPrice));
        }
      }
    }

    // Sección de Impuestos (INC 8%)
    const base = Math.round(order.subtotal / 1.08);
    const taxValue = Math.round(order.subtotal - base);

    lines.push(divider);
    lines.push('[CENTER][BOLD]Impuestos[/BOLD][/CENTER]');
    if (is80) {
      lines.push(pad('Nombre', 8) + pad('%', 5) + pad('Base', 17, 'right') + pad('Impuesto', 17, 'right'));
      lines.push(`INC       8%    ${pad(formatCurrency(base), 14, 'right')}    ${pad(formatCurrency(taxValue), 13, 'right')}`);
    } else {
      lines.push(pad('Nombre', 6) + pad('%', 4) + pad('Base', 11, 'right') + pad('Impuesto', 10, 'right'));
      lines.push(`INC    8% ${pad(formatCurrency(base), 9, 'right')}  ${pad(formatCurrency(taxValue), 8, 'right')}`);
    }

    lines.push(divider);
    lines.push(padLine('Subtotal:', formatCurrency(order.subtotal)));
    if (order.deliveryFee > 0) {
      lines.push(padLine('Domicilio:', formatCurrency(order.deliveryFee)));
    }
    lines.push(divider);
    lines.push('[CENTER][BIG][BOLD]VALOR A PAGAR:[/BOLD][/BIG][/CENTER]');
    lines.push(`[CENTER][BIG][BOLD]${formatCurrency(order.total)}[/BOLD][/BIG][/CENTER]`);
    lines.push(divider);

    const obsParts = [order.notes, order.addressReference].filter(Boolean).map(s => String(s).trim()).filter(Boolean);
    const realObs = obsParts.join(' — ');
    lines.push(
      `Observaciones: ${realObs ? realObs.toUpperCase() : ''}`,
      lineDivider,
      `[CENTER][BIG][BOLD]Turno: ${order.orderNumber}[/BOLD][/BIG][/CENTER]`,
      divider,
      '   ¡Muchas gracias por su compra!',
      divider
    );

    return lines.join('\n');
  }

  formatCocinaTicketText(order: any, stationName: string = 'COCINA', allowedCategoryIds?: string[], allPrepPrinters?: any[], paper: string = '80'): string | null {
    const fullAddress = [order.customerAddress, order.addressReference].filter(Boolean).join(' — ');
    let grouped = this.groupOrderItems(order.items || []);

    const targetPrinter = (allPrepPrinters || []).find(p => p.name === stationName || p.id === stationName);
    if (targetPrinter && targetPrinter.enabled === false) {
      return null; // Si la impresora está desactivada, no genera comanda para esta estación
    }

    if (allowedCategoryIds && allowedCategoryIds.length > 0) {
      const normAllowed = allowedCategoryIds.map(c => String(c).trim().toLowerCase());
      grouped = grouped.filter(item => {
        const catId = item.menuItem?.categoryId ? String(item.menuItem.categoryId).trim().toLowerCase() : '';
        const catName = item.menuItem?.category?.name ? String(item.menuItem.category.name).trim().toLowerCase() : '';
        const itemName = item.menuItem?.name ? String(item.menuItem.name).trim().toLowerCase() : '';
        
        const matchesId = Boolean(catId && normAllowed.includes(catId));
        const matchesName = Boolean(catName && normAllowed.some(a => a === catName || catName.includes(a) || a.includes(catName)));
        const matchesStationFallback = Boolean(normAllowed.some(a => a.includes('pizza')) && (catName.includes('pizza') || itemName.includes('pizza')));
        
        return matchesId || matchesName || matchesStationFallback;
      });
    } else if (allPrepPrinters && allPrepPrinters.length > 0) {
      // Catch-all: Imprime todo EXCEPTO las categorías reclamadas por otras estaciones ACTIVAS
      const claimedCategories = new Set<string>();
      for (const p of allPrepPrinters) {
        if (p.name === stationName || p.id === stationName) continue;
        if (p.type === 'caja') continue;
        if (p.enabled === false) continue; // Las estaciones desactivadas NO reclaman categorías
        if (p.categories && p.categories.length > 0) {
          for (const catId of p.categories) {
            claimedCategories.add(String(catId).trim().toLowerCase());
          }
        }
      }
      grouped = grouped.filter(item => {
        const catId = item.menuItem?.categoryId ? String(item.menuItem.categoryId).trim().toLowerCase() : '';
        const catName = item.menuItem?.category?.name ? String(item.menuItem.category.name).trim().toLowerCase() : '';
        const itemName = item.menuItem?.name ? String(item.menuItem.name).trim().toLowerCase() : '';

        const isClaimedById = Boolean(catId && claimedCategories.has(catId));
        const isClaimedByName = Boolean(catName && Array.from(claimedCategories).some(c => c === catName || catName.includes(c) || c.includes(catName)));
        const isPizzaClaimed = Boolean(Array.from(claimedCategories).some(c => c.includes('pizza')) && (catName.includes('pizza') || itemName.includes('pizza')));

        return !isClaimedById && !isClaimedByName && !isPizzaClaimed;
      });
    }

    if (order.status === 'CANCELLED') {
      return this.formatCancellationTicketText(order, stationName, allowedCategoryIds, allPrepPrinters, paper);
    }

    if (grouped.length === 0) return null;

    const is80 = paper === '80';
    const width = is80 ? 48 : 32;
    const divider = '='.repeat(width);
    const lineDivider = '-'.repeat(width);

    const isEdited = Boolean(order.isEdited);
    const waiterName = (order.assignee?.name || order.waiter?.name || '—').toUpperCase();
    const barrio = order.zone?.name || order.zoneName || order.barrio;
    const lines: string[] = [
      ...(isEdited ? [
        '[CENTER][BIG][BOLD]⚠️ PEDIDO EDITADO ⚠️[/BOLD][/BIG][/CENTER]',
        divider,
        `[CENTER][BIG][BOLD]PEDIDO EDITADO #${order.orderNumber}[/BOLD][/BIG][/CENTER]`,
      ] : [
        `[CENTER][BIG][BOLD]PEDIDO #${order.orderNumber}[/BOLD][/BIG][/CENTER]`,
      ]),
      `Fecha: ${new Date(order.createdAt).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true })}`,
      ...(isEdited ? [`Fecha Editado: ${new Date(order.updatedAt).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true })}`] : []),
      ...(order.diningTable?.label || order.tableId || order.orderType === 'LOCAL'
        ? [`[CENTER][BIG][BOLD]MESA: ${(order.diningTable?.label || order.tableName || (order.tableId ? 'MESA' : 'SALÓN')).toUpperCase()}[/BOLD][/BIG][/CENTER]`]
        : [`[CENTER][BOLD]TIPO: ${order.orderType === 'DELIVERY' ? 'DOMICILIO' : 'RECOGER EN LOCAL'}[/BOLD][/CENTER]`]),
      ...(order.customerName ? [`Cliente: ${order.customerName.toUpperCase()}`] : []),
      ...(order.customerPhone ? [`Teléfono: ${this.formatDisplayPhone(order.customerPhone, order.orderType, order.customer?.phone)}`] : []),
      ...(order.orderType === 'DELIVERY' && fullAddress ? [`Dirección: ${fullAddress.toUpperCase()}`] : []),
      ...(order.orderType === 'DELIVERY' && barrio ? [`Barrio: ${barrio.toUpperCase()}`] : []),
      `Atiende: ${waiterName}`,
      divider,
      isEdited ? '[BIG][BOLD]⚠️ PRODUCTOS EDITADOS (REVISAR):[/BOLD][/BIG]' : '[BIG][BOLD]PRODUCTOS A PREPARAR:[/BOLD][/BIG]',
      ''
    ];
    
    for (const item of grouped) {
      const uPrice = Number(item.unitPrice || item.price || item.menuItem?.price || 0);
      const cleaned = this.cleanNotesForPrint(item.notes, item.menuItem?.name);

      // Si el item viene con cantidad > 1 pero la nota original pedía una porción parcial (ej: "1 sin cebolla" en 2 perros)
      const rawNotesStr = String(item.notes || '');
      const wordToNum: Record<string, number> = { 'un': 1, 'una': 1, 'uno': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5 };
      const partialMatch = rawNotesStr.match(/(?:^|\s)(\d+|un|una|uno|dos|tres|cuatro|cinco)\s+(?:sin|con|solo\s+con)\s+([a-záéíóúñ\s]+)/i);
      let partialQty = 0;
      if (partialMatch) {
        const rawPart = partialMatch[1].toLowerCase();
        partialQty = parseInt(rawPart, 10) || wordToNum[rawPart] || 0;
      }

      if (cleaned && partialQty > 0 && partialQty < item.quantity) {
        const pSub = uPrice * partialQty;
        const pTag = uPrice > 0 ? ` ($ ${Math.round(uPrice).toLocaleString('es-CO')} c/u = $ ${Math.round(pSub).toLocaleString('es-CO')})` : '';
        lines.push(`[BOLD][HEIGHT]${partialQty} x ${item.menuItem?.name || 'Item'}${pTag}[/HEIGHT][/BOLD]`);
        lines.push(`[BOLD][HEIGHT]  ↳ NOTA: ${cleaned.toUpperCase()}[/HEIGHT][/BOLD]`);

        const remQty = item.quantity - partialQty;
        const remSub = uPrice * remQty;
        const remTag = uPrice > 0 ? ` ($ ${Math.round(uPrice).toLocaleString('es-CO')} c/u = $ ${Math.round(remSub).toLocaleString('es-CO')})` : '';
        lines.push(`[BOLD][HEIGHT]${remQty} x ${item.menuItem?.name || 'Item'}${remTag}[/HEIGHT][/BOLD]`);
      } else {
        const sub = uPrice * Number(item.quantity || 1);
        const priceTag = uPrice > 0 ? ` ($ ${Math.round(uPrice).toLocaleString('es-CO')} c/u = $ ${Math.round(sub).toLocaleString('es-CO')})` : '';
        lines.push(`[BOLD][HEIGHT]${item.quantity} x ${item.menuItem?.name || 'Item'}${priceTag}[/HEIGHT][/BOLD]`);
        if (item.notes && cleaned && !item.notes.startsWith('Adición para:')) {
          lines.push(`[BOLD][HEIGHT]  ↳ NOTA: ${cleaned.toUpperCase()}[/HEIGHT][/BOLD]`);
        }
      }
      if (item.additions && item.additions.length > 0) {
        for (const a of item.additions) {
          const aPrice = Number(a.unitPrice || a.price || a.menuItem?.price || 0);
          const aSub = aPrice * Number(a.quantity || 1);
          const aPriceTag = aPrice > 0 ? ` ($ ${Math.round(aPrice).toLocaleString('es-CO')} c/u = $ ${Math.round(aSub).toLocaleString('es-CO')})` : '';
          lines.push(`[BOLD][HEIGHT]  + ${a.quantity} x ${a.menuItem?.name || 'Item'}${aPriceTag}[/HEIGHT][/BOLD]`);
        }
      }
      lines.push(''); // Línea en blanco para separar productos
    }
    
    lines.push(divider);
    lines.push(`SUBTOTAL: $ ${Math.round(Number(order.subtotal || 0)).toLocaleString('es-CO')}`);
    if (Number(order.deliveryFee || 0) > 0) {
      lines.push(`DOMICILIO: $ ${Math.round(Number(order.deliveryFee)).toLocaleString('es-CO')}`);
    }
    if (Number(order.discount || 0) > 0) {
      lines.push(`DESCUENTO: -$ ${Math.round(Number(order.discount)).toLocaleString('es-CO')}`);
    }
    lines.push(`[BIG][BOLD]TOTAL A PAGAR: $ ${Math.round(Number(order.total || 0)).toLocaleString('es-CO')}[/BOLD][/BIG]`);
    lines.push(`FORMA DE PAGO: ${this.formatPaymentMethodLabel(order)}`);

    const cleanNoteText = (order.notes || '').replace(/\[\/?(PICKUP|BIG|BOLD|CENTER)\]/gi, '').trim();
    if (cleanNoteText) {
      lines.push(divider, `[BIG][BOLD]NOTA GENERAL:[/BOLD]\n${cleanNoteText.toUpperCase()}[/BIG]`);
    }
    if (isEdited) {
      lines.push(divider, `[CENTER][BIG][BOLD]*** REVISAR CAMBIOS - EDITADO #${order.orderNumber} ***[/BOLD][/BIG][/CENTER]`);
    }
    lines.push(divider, `[CENTER]** ${stationName.toUpperCase()} TICKET ${isEdited ? '(EDITADO)' : ''} **[/CENTER]`, divider);
    return lines.join('\n');
  }

  formatComandaText(order: any, settings?: any): string {
    return this.formatCajaInvoiceText(order, settings);
  }

  async printCancellation(order: any) {
    const settings = await this.getPrinterSettings();
    const results: any[] = [];
    const processedPrinters = new Set<string>();

    const isDeliveryOrder = !order.tableId && ['DELIVERY', 'PICKUP'].includes(order.orderType);
    const orderChannel = isDeliveryOrder ? 'DELIVERY' : 'DINING';

    for (const printer of settings.printers) {
      if (printer.enabled === false) continue;
      if (printer.type === 'caja') continue; // Only prep stations need cancellation notice

      const printerChannel = String(printer.channel || 'DINING').toUpperCase();
      if (printerChannel !== 'BOTH' && printerChannel !== orderChannel) {
        continue;
      }

      const printerKey = `${printer.mode}_${printer.ip || ''}_${printer.port || 9100}`;
      if (processedPrinters.has(printerKey) && (!printer.categories || printer.categories.length === 0)) {
        continue;
      }
      processedPrinters.add(printerKey);

      const text = this.formatCancellationTicketText(order, printer.name, printer.categories, settings.printers, printer.paper);
      if (!text) continue; // No items for this station

      const res = await this.dispatchPrintJob(printer.id || printer.name, text, printer, false);
      results.push(res);
    }
    return results;
  }

  formatCancellationTicketText(order: any, stationName: string, allowedCategoryIds?: string[], allPrepPrinters?: any[], paper: string = '80'): string | null {
    let grouped = this.groupOrderItems(order.items || []);

    if (allowedCategoryIds && allowedCategoryIds.length > 0) {
      const normAllowed = allowedCategoryIds.map(c => String(c).trim().toLowerCase());
      grouped = grouped.filter(item => {
        const catId = item.menuItem?.categoryId ? String(item.menuItem.categoryId).trim().toLowerCase() : '';
        const catName = item.menuItem?.category?.name ? String(item.menuItem.category.name).trim().toLowerCase() : '';
        const itemName = item.menuItem?.name ? String(item.menuItem.name).trim().toLowerCase() : '';
        
        const matchesId = Boolean(catId && normAllowed.includes(catId));
        const matchesName = Boolean(catName && normAllowed.some(a => a === catName || catName.includes(a) || a.includes(catName)));
        const matchesStationFallback = Boolean(normAllowed.some(a => a.includes('pizza')) && (catName.includes('pizza') || itemName.includes('pizza')));
        
        return matchesId || matchesName || matchesStationFallback;
      });
    } else if (allPrepPrinters && allPrepPrinters.length > 0) {
      const claimedCategories = new Set<string>();
      for (const p of allPrepPrinters) {
        if (p.name === stationName || p.id === stationName) continue;
        if (p.type === 'caja') continue;
        if (p.enabled === false) continue;
        if (p.categories && p.categories.length > 0) {
          for (const catId of p.categories) {
            claimedCategories.add(String(catId).trim().toLowerCase());
          }
        }
      }
      grouped = grouped.filter(item => {
        const catId = item.menuItem?.categoryId ? String(item.menuItem.categoryId).trim().toLowerCase() : '';
        const catName = item.menuItem?.category?.name ? String(item.menuItem.category.name).trim().toLowerCase() : '';
        const itemName = item.menuItem?.name ? String(item.menuItem.name).trim().toLowerCase() : '';

        const isClaimedById = Boolean(catId && claimedCategories.has(catId));
        const isClaimedByName = Boolean(catName && Array.from(claimedCategories).some(c => c === catName || catName.includes(c) || c.includes(catName)));
        const isPizzaClaimed = Boolean(Array.from(claimedCategories).some(c => c.includes('pizza')) && (catName.includes('pizza') || itemName.includes('pizza')));

        return !isClaimedById && !isClaimedByName && !isPizzaClaimed;
      });
    }

    if (grouped.length === 0) return null;

    const is80 = paper === '80';
    const width = is80 ? 48 : 32;
    const divider = '='.repeat(width);

    const lines: string[] = [
      divider,
      `[CENTER][BIG][BOLD]⛔ CANCELADO - NO PREPARAR ⛔[/BOLD][/BIG][/CENTER]`,
      divider,
      `[CENTER][BIG][BOLD]PEDIDO CANCELADO #${order.orderNumber}[/BOLD][/BIG][/CENTER]`,
      ...(order.diningTable?.label || order.tableId || order.orderType === 'LOCAL'
        ? [`[CENTER][BIG][BOLD]MESA: ${(order.diningTable?.label || order.tableName || (order.tableId ? 'MESA' : 'SALÓN')).toUpperCase()}[/BOLD][/BIG][/CENTER]`]
        : [`[CENTER][BOLD]TIPO: ${order.orderType === 'DELIVERY' ? 'DOMICILIO' : 'RECOGER EN LOCAL'}[/BOLD][/CENTER]`]),
      `Motivo: ${(order.cancellationReason || 'No especificado').toUpperCase()}`,
      `Fecha Canc: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: true })}`,
      divider,
      '[BIG][BOLD]❌ NO PREPARAR (PEDIDO CANCELADO):[/BOLD][/BIG]',
      ''
    ];

    for (const item of grouped) {
      lines.push(`[HEIGHT]${item.quantity} x ${item.menuItem?.name || 'Item'}[/HEIGHT]`);
      const cleaned = this.cleanNotesForPrint(item.notes, item.menuItem?.name);
      if (item.notes && cleaned && !item.notes.startsWith('Adición para:')) {
        lines.push(`[HEIGHT]  ↳ NOTA: ${cleaned.toUpperCase()}[/HEIGHT]`);
      }
      if (item.additions && item.additions.length > 0) {
        for (const a of item.additions) {
          lines.push(`[HEIGHT]  + ${a.quantity} x ${a.menuItem?.name || 'Item'}[/HEIGHT]`);
        }
      }
      lines.push('');
    }

    lines.push(divider);
    lines.push(`[CENTER][BIG][BOLD]*** CANCELADO #${order.orderNumber} ***[/BOLD][/BIG][/CENTER]`);
    lines.push(`[CENTER]** TICKET DE CANCELACION (${stationName.toUpperCase()}) **[/CENTER]`, divider);
    return lines.join('\n');
  }

  private async dispatchPrintJob(target: string, text: string, printerConfig: any, kickDrawer = false) {
    if (!text || !text.trim()) return { ok: false, error: 'Texto de impresión vacío' };

    const targetIp = (printerConfig?.ip || '').trim();
    if (['local_bridge', 'network'].includes(printerConfig?.mode) && !this.isLocalPrinterAddress(targetIp)) {
      return { ok: false, error: `Configura una IP o un nombre USB compartido válido para la impresora ${printerConfig?.name || target}` };
    }

    if (this.socketGateway) {
      this.socketGateway.server.emit('printJob', {
        target,
        text,
        mode: printerConfig.mode,
        ip: targetIp || printerConfig.ip,
        port: printerConfig.port || 9100,
        paper: printerConfig.paper,
      });
    }

    if (printerConfig.mode === 'local_bridge' || printerConfig.mode === 'network') {
      let buffer = this.buildEscPos(text, printerConfig.paper);
      if (target === 'caja' && kickDrawer) {
        const kick = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]);
        buffer = Buffer.concat([kick, buffer]);
      }
      const payload = buffer.toString('base64');
      await this.prisma.printJob.create({
        data: {
          impresoraIp: printerConfig?.id || target,
          payload,
          tipo: target,
        },
      });
      return { ok: true, mode: 'local_bridge', message: `Pedido encolado para impresión local (${target}).` };
    }

    return { ok: true, mode: printerConfig.mode, message: `Impresora de ${target} configurada en modo ${printerConfig.mode}. Transmitido por WebSocket.` };
  }

  // Printing does NOT change order status. Status transitions are manual.

  async printOrder(orderId: string, target?: string, kickDrawer = false) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { menuItem: { include: { category: true } } } },
        zone: true,
        assignee: { select: { name: true } },
        waiter: { select: { name: true } },
        customer: { select: { id: true, name: true, phone: true } },
        deliveryDriver: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!order) return { ok: false, error: 'Pedido no encontrado' };
    const settings = await this.getPrinterSettings();

    if (target) {
      if (target === 'caja') {
        const text = this.formatCajaInvoiceText(order, settings);
        const shouldKick = kickDrawer || order.paymentMethod === 'CASH';
        const res = await this.dispatchPrintJob('caja', text, settings.caja, shouldKick);
        return {
          ...res,
          text,
          paper: settings.caja?.paper || '80',
          orderId: order.id,
          orderNumber: order.orderNumber,
        };
      }
      
      let printer = settings.printers.find(p => p.id === target || p.name.toLowerCase() === target.toLowerCase());
      if (!printer && target === 'cocina') {
        const isDelivery = !order.tableId && ['DELIVERY', 'PICKUP'].includes(order.orderType);
        const orderChannel = isDelivery ? 'DELIVERY' : 'DINING';
        printer = settings.printers.find(p => {
          if (p.type === 'caja' || p.enabled === false) return false;
          const ch = String(p.channel || (isDelivery ? 'DELIVERY' : 'DINING')).toUpperCase();
          return ch === 'BOTH' || ch === orderChannel;
        }) || settings.cocina || settings.printers.find(p => p.type !== 'caja');
      }
      if (!printer && target === 'bar') {
        printer = settings.bar;
      }
      if (!printer && settings.printers.length > 0) {
        printer = settings.printers[0];
      }

      if (printer) {
        if (printer.type === 'caja') {
          // Impresoras dinámicas tipo Caja: factura completa
          const text = this.formatCajaInvoiceText(order, settings);
          const shouldKick = kickDrawer || order.paymentMethod === 'CASH';
          const res = await this.dispatchPrintJob(printer.id || target, text, printer, shouldKick);
          return {
            ...res,
            text,
            paper: printer.paper || '80',
            orderId: order.id,
            orderNumber: order.orderNumber,
          };
        }
        // Estaciones de preparación: comanda filtrada por categorías
        const text = this.formatCocinaTicketText(order, printer.name, printer.categories, settings.printers, printer.paper);
        if (!text) return { ok: true, message: `No hay productos para la estación ${printer.name}` };
        const res = await this.dispatchPrintJob(printer.id || target, text, printer, false);
        return {
          ...res,
          text,
          paper: printer.paper || '80',
          orderId: order.id,
          orderNumber: order.orderNumber,
        };
      }
      return { ok: false, error: `Impresora "${target}" no encontrada` };
    }

    // Default: Impresión completa (Factura Caja + todas las comandas correspondientes)
    const results: any[] = [];
    const cajaText = this.formatCajaInvoiceText(order, settings);
    const shouldKick = kickDrawer || order.paymentMethod === 'CASH';
    const resCaja = await this.dispatchPrintJob('caja', cajaText, settings.caja, shouldKick);
    results.push(resCaja);

    const isDeliveryOrder = !order.tableId && ['DELIVERY', 'PICKUP'].includes(order.orderType);
    const orderChannel = isDeliveryOrder ? 'DELIVERY' : 'DINING';

    for (const printer of settings.printers) {
      if (printer.enabled === false) continue; // Si la estación está desactivada, no imprime nada directamente en ella

      const printerChannel = String(printer.channel || (isDeliveryOrder ? 'DELIVERY' : 'DINING')).toUpperCase();
      if (printer.channel && printerChannel !== 'BOTH' && printerChannel !== orderChannel) {
        continue;
      }

      if (printer.type === 'caja') {
        // Impresoras adicionales tipo Caja: imprimen factura completa
        const text = this.formatCajaInvoiceText(order, settings);
        const res = await this.dispatchPrintJob(printer.id || printer.name.toLowerCase(), text, printer, kickDrawer);
        results.push(res);
      } else {
        // Estaciones de preparación: imprimen comanda filtrada por categorías
        const text = this.formatCocinaTicketText(order, printer.name, printer.categories, settings.printers, printer.paper);
        if (text) {
          const res = await this.dispatchPrintJob(printer.id || printer.name.toLowerCase(), text, printer, false);
          results.push(res);
        }
      }
    }

    return {
      ok: true,
      message: 'Comandas transmitidas a las estaciones configuradas',
      text: cajaText,
      paper: settings.caja?.paper || '80',
      orderId: order.id,
      orderNumber: order.orderNumber,
      results,
    };
  }

  formatCashClosingText(closing: any, paper: string = '80', detail?: any): string {
    const formatCOP = (val: number) => `$${Math.round(val || 0).toLocaleString('de-DE')}`;
    const width = paper === '58' ? 32 : 48;
    const d = detail || closing._detail;

    const padLine = (left: string, right: string) => {
      const space = width - left.length - right.length;
      if (space <= 0) return `${left} ${right}`;
      return left + ' '.repeat(space) + right;
    };

    const centerLine = (text: string) => {
      const space = Math.floor((width - text.length) / 2);
      if (space <= 0) return text;
      return ' '.repeat(space) + text;
    };

    const divider = '='.repeat(width);
    const lineDivider = '-'.repeat(width);

    // Calcular duración del turno
    let durationText = '';
    if (closing.shiftStart && closing.shiftEnd) {
      const diffMs = new Date(closing.shiftEnd).getTime() - new Date(closing.shiftStart).getTime();
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      durationText = `${hours}h ${mins}m`;
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
    ];

    if (durationText) {
      lines.push(padLine('Duracion Turno:', durationText));
    }

    lines.push(
      divider,
      padLine('BASE INICIAL EN CAJA:', formatCOP(closing.initialCash)),
      divider,
      centerLine('VENTAS POR METODO DE PAGO'),
      lineDivider
    );

    // Ventas por método
    if (d && d.ventasPorMetodo && d.ventasPorMetodo.length > 0) {
      for (const m of d.ventasPorMetodo) {
        if (m.sales > 0 || m.count > 0) {
          lines.push(padLine(`  ${m.label} (${m.count} trans.):`, formatCOP(m.sales)));
        }
      }
    } else {
      lines.push(padLine('  Efectivo:', formatCOP(closing.totalCash)));
      lines.push(padLine('  Transferencias:', formatCOP(closing.totalTransfers)));
      if (closing.totalNequi) lines.push(padLine('    · Nequi:', formatCOP(closing.totalNequi)));
      if (closing.totalBancolombia) lines.push(padLine('    · Bancolombia:', formatCOP(closing.totalBancolombia)));
      if (closing.totalDaviplata) lines.push(padLine('    · Daviplata:', formatCOP(closing.totalDaviplata)));
      if (closing.totalCredit) lines.push(padLine('  Credito (Fiados):', formatCOP(closing.totalCredit)));
    }

    lines.push(
      lineDivider,
      padLine('SUBTOTAL VENTAS:', formatCOP(closing.totalSales))
    );

    if (d && d.domicilios > 0) {
      lines.push(padLine('Recargo Domicilios:', formatCOP(d.domicilios)));
    }
    if (closing.totalTips > 0) {
      lines.push(padLine('Total Propinas:', formatCOP(closing.totalTips)));
    }

    const totalFacturado = (closing.totalSales || 0) + (closing.totalTips || 0);
    lines.push(
      lineDivider,
      padLine('TOTAL FACTURADO:', formatCOP(totalFacturado))
    );

    if (d && d.transacciones) {
      lines.push(padLine('Total Pedidos Entregados:', String(d.transacciones)));
    }

    // Gastos del turno
    lines.push(
      divider,
      centerLine('GASTOS Y EGRESOS DEL TURNO'),
      lineDivider
    );

    if (d && d.gastos && d.gastos.items && d.gastos.items.length > 0) {
      for (const g of d.gastos.items) {
        lines.push(padLine(`  ${g.tipo}:`, `-${formatCOP(g.total)}`));
      }
    } else if (closing.totalExpenses > 0) {
      lines.push(padLine('  Gastos registrados:', `-${formatCOP(closing.totalExpenses)}`));
    } else {
      lines.push(padLine('  Sin gastos registrados:', '$0'));
    }

    lines.push(
      lineDivider,
      padLine('TOTAL GASTOS / EGRESOS:', `-${formatCOP(closing.totalExpenses || 0)}`)
    );

    // Arqueo y Cuadre de Efectivo
    const cashSales = closing.totalCash || 0;
    const tipsCash = (closing.totalTips || 0);
    const expensesVal = (closing.totalExpenses || 0);
    const expectedCash = (closing.initialCash || 0) + cashSales + tipsCash - expensesVal;

    lines.push(
      divider,
      centerLine('ARQUEO Y CUADRE DE EFECTIVO'),
      lineDivider,
      padLine('  (+) Base Inicial:', formatCOP(closing.initialCash)),
      padLine('  (+) Ventas en Efectivo:', formatCOP(cashSales)),
      padLine('  (+) Propinas Efectivo:', formatCOP(tipsCash)),
      padLine('  (-) Gastos Efectivo:', `-${formatCOP(expensesVal)}`),
      lineDivider,
      padLine('  (=) EFECTIVO ESPERADO:', formatCOP(expectedCash)),
      padLine('  DIFERENCIA / DESCUADRE:', formatCOP(closing.discrepancy || 0)),
      divider
    );

    if (closing.notes) {
      lines.push('Notas del Cierre:', closing.notes, divider);
    }

    lines.push(
      '',
      padLine('Firma Cajero:', '_________________'),
      '',
      padLine('Firma Supervisor:', '_________________'),
      divider,
      centerLine('** REPORTE DE CIERRE AUDITADO **'),
      centerLine('Software The Villa Dog v1.0')
    );

    return lines.join('\n');
  }

  formatCashOpeningText(opening: any, paper: string = '80'): string {
    const formatCOP = (val: number) => `$${Math.round(val || 0).toLocaleString('de-DE')}`;
    const width = paper === '58' ? 32 : 48;

    const padLine = (left: string, right: string) => {
      const space = width - left.length - right.length;
      if (space <= 0) return `${left} ${right}`;
      return left + ' '.repeat(space) + right;
    };

    const centerLine = (text: string) => {
      const space = Math.floor((width - text.length) / 2);
      if (space <= 0) return text;
      return ' '.repeat(space) + text;
    };

    const divider = '='.repeat(width);
    const lineDivider = '-'.repeat(width);

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
      padLine('BASE INICIAL EN EFECTIVO:', formatCOP(opening.initialCash || 0)),
      divider,
    ];

    if (opening.notes) {
      lines.push('Notas de Apertura:', opening.notes, divider);
    }

    lines.push(
      '',
      padLine('Firma Cajero:', '_________________'),
      '',
      padLine('Firma Supervisor:', '_________________'),
      divider,
      centerLine('** TURNO INICIADO CON EXITO **'),
      centerLine('Software The Villa Dog v1.0')
    );

    return lines.join('\n');
  }

  async printOpening(openingId: string) {
    const opening = await this.prisma.cashClosing.findUnique({
      where: { id: openingId },
      include: { 
        user: { select: { name: true } },
        cashRegister: { select: { name: true } }
      },
    });
    if (!opening) return { ok: false, error: 'Apertura de caja no encontrada' };
    const settings = await this.getPrinterSettings();
    const printerConfig = settings.caja;

    const text = this.formatCashOpeningText(opening, printerConfig.paper);

    // Emitir por WebSocket para el puente de impresión local
    if (this.socketGateway) {
      this.socketGateway.server.emit('printJob', {
        target: 'caja',
        text,
        mode: printerConfig.mode,
        ip: printerConfig.ip,
        port: printerConfig.port,
        paper: printerConfig.paper,
      });
    }

    if (printerConfig.mode === 'local_bridge' || printerConfig.mode === 'network') {
      const buffer = this.buildEscPos(text, printerConfig.paper);
      const payload = buffer.toString('base64');
      await this.prisma.printJob.create({
        data: {
          impresoraIp: printerConfig.ip || 'caja',
          payload,
          tipo: 'caja',
        },
      });
      return { ok: true, mode: 'local_bridge', message: `Apertura de caja encolada para impresión local.` };
    }

    return { ok: true, mode: printerConfig.mode };
  }

  async printClosing(closingId: string) {
    const closing = await this.prisma.cashClosing.findUnique({
      where: { id: closingId },
      include: { 
        user: { select: { name: true } },
        cashRegister: { select: { name: true } }
      },
    });
    if (!closing) return { ok: false, error: 'Cierre de caja no encontrado' };
    const settings = await this.getPrinterSettings();
    const printerConfig = settings.caja;

    const text = this.formatCashClosingText(closing, printerConfig.paper);

    // Emitir por WebSocket para el puente de impresión local
    if (this.socketGateway) {
      this.socketGateway.server.emit('printJob', {
        target: 'caja',
        text,
        mode: printerConfig.mode,
        ip: printerConfig.ip,
        port: printerConfig.port,
        paper: printerConfig.paper,
      });
    }

    if (printerConfig.mode === 'local_bridge') {
      const buffer = this.buildEscPos(text, printerConfig.paper);
      const payload = buffer.toString('base64');
      await this.prisma.printJob.create({
        data: {
          impresoraIp: printerConfig.ip || 'caja',
          payload,
          tipo: 'caja',
        },
      });
      return { ok: true, mode: 'local_bridge', message: `Cierre de caja encolado para impresión local.` };
    }

    if (printerConfig.mode !== 'network') {
      return { ok: true, mode: printerConfig.mode, message: `Impresora de caja configurada en modo ${printerConfig.mode}. Transmitido por WebSocket.` };
    }

    try {
      return await this.printToNetwork(text, printerConfig.ip, printerConfig.port, printerConfig.paper);
    } catch (err: any) {
      return { ok: false, error: err.message, message: 'Fallo impresión local, transmitido por WebSocket.' };
    }
  }

  async testPrint(target: string = 'cocina') {
    const settings = await this.getPrinterSettings();
    let printerConfig: any = settings.caja;
    if (target !== 'caja') {
      const printer = settings.printers.find(p => p.id === target || (p.name && p.name.toLowerCase() === target.toLowerCase()));
      if (printer) {
        printerConfig = printer;
      } else if (target.toLowerCase().includes('pizza')) {
        printerConfig = settings.printers.find(p => p.name?.toLowerCase().includes('pizza'));
      } else {
        printerConfig = settings.printers.find(p => p.name?.toLowerCase().includes('cocina')) || settings.cocina;
      }
    }

    if (!printerConfig) return { ok: false, error: `Impresora "${target}" no encontrada` };
    const targetIp = (printerConfig.ip || '').trim();
    if (!this.isLocalPrinterAddress(targetIp)) return { ok: false, error: `Configura primero una IP o un nombre USB compartido válido para ${printerConfig.name || target}` };

    const text = `THE VILLA DOG - Prueba de impresion (${(printerConfig.name || target).toUpperCase()})\nMonteria, Cordoba\n========================\nSi ves esto, la impresora funciona.\n`;

    if (this.socketGateway) {
      this.socketGateway.server.emit('printJob', {
        target,
        text,
        mode: printerConfig.mode,
        ip: targetIp || printerConfig.ip,
        port: printerConfig.port || 9100,
        paper: printerConfig.paper,
      });
    }

    const buffer = this.buildEscPos(text, printerConfig.paper);
    const payload = buffer.toString('base64');
    await this.prisma.printJob.create({
      data: {
        impresoraIp: printerConfig.id || target,
        payload,
        tipo: target,
      },
    });
    return { ok: true, mode: 'local_bridge', message: `Prueba de impresion (${printerConfig.name || target}) enviada al puente local.` };
  }

  async clearPrintQueue(target?: string) {
    if (target) {
      const result = await this.prisma.printJob.deleteMany({
        where: { tipo: target },
      });
      return { ok: true, deleted: result.count, message: `Cola de impresión para "${target}" limpiada (${result.count} trabajos eliminados).` };
    }
    const result = await this.prisma.printJob.deleteMany({});
    return { ok: true, deleted: result.count, message: `Cola de impresión completa limpiada (${result.count} trabajos eliminados).` };
  }

  async openDrawer() {
    const settings = await this.getPrinterSettings();
    const printerConfig = settings.caja;

    // Pulso electrónico RJ11 para cajón monedero
    const kick = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]);

    if (printerConfig.mode === 'local_bridge') {
      const payload = kick.toString('base64');
      await this.prisma.printJob.create({
        data: {
          impresoraIp: printerConfig.ip || 'caja',
          payload,
          tipo: 'caja',
        },
      });
      return { ok: true, mode: 'local_bridge', message: 'Comando de apertura de monedero encolado para el puente local.' };
    }

    if (printerConfig.mode === 'network') {
      try {
        await this.sendBufferToNetwork(kick, printerConfig.ip, printerConfig.port);
        return { ok: true, mode: 'network', message: 'Monedero abierto por red.' };
      } catch (err: any) {
        return { ok: false, error: err.message, message: 'Fallo al abrir monedero por IP.' };
      }
    }

    // Para WebUSB o Browser, el cliente gestiona la apertura directamente.
    return { ok: true, mode: printerConfig.mode, message: 'Señal de apertura enviada.' };
  }
}
