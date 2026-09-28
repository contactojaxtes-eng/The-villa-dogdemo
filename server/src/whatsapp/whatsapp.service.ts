import { Injectable, Logger, BadRequestException, ConflictException, ForbiddenException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';
import { buildMessagingMenuText } from '../menu/menu-text';
import { receiptSummary } from '../tables/receipt';

type CachedMedia = {
  buffer: Buffer;
  contentType: string;
  bytes: number;
  lastUsed: number;
  expiresAt: number;
};

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly settingCache = new Map<string, { value: string | null; expiresAt: number }>();
  private readonly mediaCache = new Map<string, CachedMedia>();
  private readonly mediaRequests = new Map<string, Promise<{ buffer: Buffer; contentType: string } | null>>();
  private mediaCacheBytes = 0;
  private readonly maxMediaCacheBytes = 32 * 1024 * 1024;
  private readonly maxMediaCacheItems = 50;
  private readonly mediaCacheTtlMs = 6 * 60 * 60 * 1000;
  private readonly geminiKeyCursors = new Map<string, number>();
  private readonly geminiKeyCooldownUntil = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private socketGateway: SocketGateway,
  ) {}

  async onModuleInit() {
    try {
      await this.purgeLegacyMenuFile();
      await this.cleanupCrossedSessions();
    } catch (error) {
      this.logger.warn('No se pudo limpiar la carta estática anterior al iniciar', error);
    }
  }

  private async cleanupCrossedSessions() {
    try {
      const sessions = await this.prisma.whatsAppSession.findMany({
        where: { customerPhone: { not: null } },
        select: { id: true, phone: true, customerPhone: true, customerName: true },
      });

      for (const s of sessions) {
        const cleanP = (s.phone || '').replace(/\D/g, '');
        const p10 = cleanP.length === 12 && cleanP.startsWith('57') ? cleanP.slice(2) : cleanP;
        const cleanCP = (s.customerPhone || '').replace(/\D/g, '');
        const cp10 = cleanCP.length === 12 && cleanCP.startsWith('57') ? cleanCP.slice(2) : cleanCP;

        if (cp10.length === 10 && p10.length === 10 && cp10 !== p10) {
          this.logger.log(`🧹 Desvinculando sesión cruzada ${s.id} (${s.customerName}): phone=${s.phone}, customerPhone=${s.customerPhone}`);
          await this.prisma.whatsAppSession.update({
            where: { id: s.id },
            data: {
              customerPhone: p10.startsWith('3') ? p10 : s.phone,
            },
          });
        }
      }
    } catch (e) {
      this.logger.warn('Error en limpieza de sesiones cruzadas:', e);
    }
  }

  private normalizeSpanishLookup(value: unknown): string {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Los pedidos usan un entero de PostgreSQL. Una búsqueda por teléfono no
   * puede terminar en esa columna: además de no ser un pedido, números como
   * 3015932223 superan el rango INT4 y hacían fallar toda la búsqueda.
   *
   * Los números cortos siguen funcionando como búsqueda rápida de pedido.
   * Para un número largo se exige #, "pedido", "orden" o "factura".
   */
  private parseOrderNumberFromSearch(cleanSearch: string): number | null {
    if (!cleanSearch) return null;

    const isExplicitOrderSearch = cleanSearch.startsWith('#')
      || cleanSearch.includes('pedido')
      || cleanSearch.includes('orden')
      || cleanSearch.includes('factura');
    const isShortPlainNumber = /^\d{1,6}$/.test(cleanSearch);

    if (!isExplicitOrderSearch && !isShortPlainNumber) return null;

    const digits = cleanSearch.replace(/\D/g, '');
    if (!digits) return null;

    const orderNumber = Number(digits);
    return Number.isSafeInteger(orderNumber)
      && orderNumber > 0
      && orderNumber <= 2_147_483_647
      ? orderNumber
      : null;
  }

  private isBeverageMenuItem(item: { category?: { name?: string | null } | null }): boolean {
    return /bebida|gaseosa|jugo|agua/i.test(item.category?.name || '');
  }

  private beverageCore(name: string): string {
    return this.normalizeSpanishLookup(String(name || '')
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|mililitros?|l|litros?)\b/gi, ' ')
      .replace(/\b(?:vidrio|pet|pl[aá]stic[ao]|postob[oó]n)\b/gi, ' '));
  }

  private beverageSizeInMl(value: string): number | null {
    const str = String(value || '');
    if (/\b(?:1[.,]5\s*l(?:itros?)?|litro\s+y\s+medio)\b/i.test(str)) return 1500;
    if (/\b(?:2[.,]5\s*l(?:itros?)?|dos\s+litros\s+y\s+medio)\b/i.test(str)) return 2500;
    const match = str.match(/\b(\d+(?:[.,]\d+)?)\s*(ml|mililitros?|l|litros?)\b/i);
    if (match) {
      const amount = Number(match[1].replace(',', '.'));
      return Math.round(amount * (/^m/i.test(match[2]) ? 1 : 1000));
    }
    const literMatch = str.match(/\b(1[.,]5|2[.,]5)\b/);
    if (literMatch) {
      return Math.round(Number(literMatch[1].replace(',', '.')) * 1000);
    }
    // Los clientes también suelen decir solo “la 400” o “la 250”.
    const commonSize = str.match(/\b(250|300|350|400|500|600|750)\b/);
    return commonSize ? Number(commonSize[1]) : null;
  }

  private isBeverageSelectionUnambiguous(
    selected: { name: string; category?: { name?: string | null } | null },
    catalog: Array<{ name: string; category?: { name?: string | null } | null }>,
    conversation: string,
  ): boolean {
    if (!this.isBeverageMenuItem(selected)) return true;
    // REGLA CRÍTICA: Las únicas bebidas que la IA NUNCA debe halar son las de vidrio
    if (/\bvidrio\b/i.test(selected.name)) return false;

    const core = this.beverageCore(selected.name);
    if (!core) return false;
    const lines = String(conversation || '').split(/\r?\n/);
    const customerLines = lines.some(line => /^\s*cliente\s*:/i.test(line))
      ? lines.filter(line => /^\s*cliente\s*:/i.test(line))
      : lines;
    const latestMention = [...customerLines].reverse().find(line => this.normalizeSpanishLookup(line).includes(core));
    if (!latestMention) return false;

    // Un cambio posterior del cliente invalida la bebida anterior aunque el
    // modelo todavía la devuelva. Una lista de dos bebidas sin cambio conserva
    // ambas, porque son dos productos distintos del mismo pedido.
    const beverageCores = Array.from(new Set(catalog
      .filter(item => this.isBeverageMenuItem(item))
      .map(item => this.beverageCore(item.name))
      .filter(Boolean)))
      .sort((a, b) => b.length - a.length);
    const beveragePattern = new RegExp(`\\b(?:${beverageCores.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');
    const selectedLineIndex = customerLines.lastIndexOf(latestMention);
    const replacedByAnotherBeverage = customerLines.slice(selectedLineIndex).some(line => {
      const normalized = this.normalizeSpanishLookup(line);
      if (!/\b(?:cambi\w*|reemplaz\w*|sustitu\w*|prefier\w*|mejor|en vez de|quita\w*)\b/.test(normalized)) return false;
      const mentionedCores = Array.from(normalized.matchAll(beveragePattern), match => ({ core: match[0], position: match.index || 0 }));
      if (mentionedCores.length === 0) return false;
      const betterThan = normalized.indexOf(' mejor que ');
      const finalChoice = betterThan >= 0
        ? [...mentionedCores].reverse().find(mention => mention.position < betterThan)?.core
        : mentionedCores[mentionedCores.length - 1].core;
      return Boolean(finalChoice && finalChoice !== core);
    });
    if (replacedByAnotherBeverage) return false;

    const mention = latestMention
      .split(/\s+y\s+|[,;]/i)
      .reverse()
      .find(part => this.normalizeSpanishLookup(part).includes(core)) || latestMention;
    const normalizedMention = this.normalizeSpanishLookup(mention);
    const selectedIsZero = /\bzero\b/.test(this.normalizeSpanishLookup(selected.name));
    if (selectedIsZero !== /\b(?:zero|sin azucar)\b/.test(normalizedMention)) return false;

    // Si el cliente pide explícitamente vidrio, la IA NO debe jalar bebidas de vidrio
    const mentionsGlass = /\bvidrio\b/.test(normalizedMention);
    if (mentionsGlass) return false;

    // Solo se consideran presentaciones no-vidrio
    const nonGlassVariants = catalog.filter(item =>
      this.isBeverageMenuItem(item) &&
      this.beverageCore(item.name) === core &&
      !/\bvidrio\b/i.test(item.name),
    );
    if (nonGlassVariants.length === 0) return false;

    const mentionedSize = this.beverageSizeInMl(mention);
    const selectedSize = this.beverageSizeInMl(selected.name);

    // Si el cliente especificó tamaño explícito (1.5 L, 2.5 L, 400 ml, etc.)
    if (mentionedSize !== null) {
      return selectedSize === mentionedSize;
    }

    // Si no especificó tamaño (ej: "una coca cola", "dos manzanas", "una colombiana"),
    // la IA debe halar la presentación personal plástica por defecto (400 ml o <= 600 ml)
    const personalVariant = nonGlassVariants.find(item => {
      const size = this.beverageSizeInMl(item.name);
      return size !== null && size <= 600;
    }) || nonGlassVariants[0];

    return selected.name === personalVariant.name;
  }

  private extractExplicitNeighborhood(messages: string[]): string | null {
    for (const message of [...messages].reverse()) {
      const match = message.match(/\bbarrio\s*[:\-]?\s+([^,\n.;]+)/i);
      if (!match?.[1]) continue;
      const value = match[1]
        .split(/\b(?:direcci[oó]n|pago|efectivo|transferencia|nequi|daviplata|bancolombia)\b/i)[0]
        .replace(/\s+(?:y|con)\s*$/i, '')
        .trim();
      if (value.length >= 2) return value;
    }
    return null;
  }

  private isMeaningfulGeminiReply(value: string): boolean {
    const text = String(value || '').trim();
    return text.length >= 3 && /[a-záéíóúñ0-9]/i.test(text);
  }

  private parseColombianAmount(value: string): number | null {
    const normalized = String(value || '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async getSettings() {
    const keys = [
      'whatsapp_phone_id',
      'whatsapp_token',
      'whatsapp_verify_token',
      'whatsapp_business_phone',
      'chatbot_enabled',
      'order_reader_enabled',
      'chatbot_menu_share_message',
      'chatbot_menu_text',
      'chatbot_payment_qr_name',
      'chatbot_payment_qr_mimetype',
      'chatbot_payment_qr_caption',
      'chatbot_payment_qr_mode',
      'chatbot_payment_account_text',
      'gemini_api_key',
      'gemini_model',
      'chatbot_ai_instructions',
      'digital_menu_url',
      'business_hours_enabled',
      'out_of_service_enabled',
      'out_of_service_message',
      'restaurant_hours',
    ];
    const settings = await this.prisma.appSetting.findMany({ where: { key: { in: keys } } });
    const map: Record<string, string> = {};
    for (const s of settings) {
      if (s.key === 'gemini_api_key') {
        const realKeys = (s.value || '').split(',').map(k => k.trim()).filter(Boolean);
        map[s.key] = realKeys.map(k => {
          const last4 = k.length > 4 ? k.slice(-4) : '••••';
          return `••••••••••••••••••••••••••••••••••••••••${last4}`;
        }).join(', ');
      } else {
        map[s.key] = (s.key.includes('token') || s.key.includes('key')) ? '••••••••' : s.value;
      }
    }
    let menuText = map.chatbot_menu_text || '';
    if (!menuText) {
      try {
        menuText = await this.buildMessagingMenuText();
      } catch (error) {
        this.logger.warn('No se pudo generar la carta de WhatsApp al leer la configuración', error);
        menuText = '📋 *MENÚ Y PRECIOS VILLA DOG*';
      }
    }
    const [geminiRequestsToday, geminiUsageDaily] = await Promise.all([
      this.getGeminiUsageToday(),
      this.getGeminiUsageDaily(),
    ]);
    const geminiKeyCount = (settings.find(s => s.key === 'gemini_api_key')?.value || '')
      .split(',')
      .map(key => key.trim())
      .filter(Boolean)
      .length;
    return {
      phoneId: map.whatsapp_phone_id || '',
      businessPhone: map.whatsapp_business_phone || '',
      verifyTokenConfigured: !!settings.find(s => s.key === 'whatsapp_verify_token'),
      chatbotEnabled: map.chatbot_enabled === 'true', // Estricto: solo true si explícitamente se guardó como 'true'
      orderReaderEnabled: map.order_reader_enabled === 'true',
      configured: !!(map.whatsapp_phone_id && settings.find(s => s.key === 'whatsapp_token')),
      menuShareMessage: map.chatbot_menu_share_message || 'Mira nuestra carta actualizada y arma tu pedido aquí:',
      menuText,
      paymentQrName: map.chatbot_payment_qr_name || null,
      paymentQrMime: map.chatbot_payment_qr_mimetype || null,
      paymentQrCaption: map.chatbot_payment_qr_caption || '',
      paymentQrMode: map.chatbot_payment_qr_mode || (map.chatbot_payment_qr_name ? 'IMAGE' : 'ACCOUNT'),
      paymentAccountText: map.chatbot_payment_account_text || '',
      geminiApiKey: map.gemini_api_key || '',
      geminiKeyCount,
      geminiModel: map.gemini_model || 'gemini-3.5-flash-lite',
      aiInstructions: map.chatbot_ai_instructions || '',
      geminiRequestsToday,
      geminiUsageDaily,
      // Mientras no exista un dominio público explícito, no mostramos ni
      // compartimos la URL interna de Railway como parte de la carta.
      digitalMenuUrl: this.getShareableDigitalMenuUrl(map.digital_menu_url) || '',
      businessHoursEnabled: map.business_hours_enabled === 'true',
      outOfServiceEnabled: map.out_of_service_enabled === 'true',
      outOfServiceMessage: map.out_of_service_message || '',
      restaurantHours: map.restaurant_hours || '12:00 PM - 11:00 PM',
    };
  }

  /**
   * URL pública que se comparte con los clientes para consultar la carta.
   * PUBLIC_MENU_URL permite alojarla en un dominio/subdominio separado del
   * backend (por ejemplo https://menu.tudominio.com/menu). CLIENT_URL y
   * Railway son únicamente respaldos para instalaciones que aún no lo han
   * configurado.
   */
  private getConfiguredPublicMenuUrl(): string | null {
    const raw = String(this.config.get('PUBLIC_MENU_URL') || '').trim().replace(/\/+$/, '');
    if (!raw) return null;
    return /\/menu$/i.test(raw) ? raw : `${raw}/menu`;
  }

  private getMenuUrlFromBase(base: string | null | undefined): string | null {
    const normalized = String(base || '').trim().replace(/\/+$/, '');
    return normalized ? `${normalized}/menu` : null;
  }

  private getLegacyDigitalMenuUrls(): string[] {
    const urls = [
      this.getMenuUrlFromBase(this.config.get('CLIENT_URL')),
      this.getMenuUrlFromBase(this.config.get('RAILWAY_PUBLIC_DOMAIN') ? `https://${this.config.get('RAILWAY_PUBLIC_DOMAIN')}` : null),
      'http://localhost:5173/menu',
    ];
    return urls.filter((url): url is string => Boolean(url));
  }

  private resolveDigitalMenuUrl(configured?: string | null): string {
    const stored = String(configured || '').trim().replace(/\/+$/, '');
    const publicUrl = this.getConfiguredPublicMenuUrl();
    // Si antes se guardó automáticamente la URL de Railway/CLIENT_URL, la
    // migramos al nuevo dominio público sin pisar una URL personalizada.
    if (publicUrl && stored && this.getLegacyDigitalMenuUrls().includes(stored)) return publicUrl;
    return stored || this.getDefaultDigitalMenuUrl();
  }

  private getShareableDigitalMenuUrl(configured?: string | null): string | null {
    const stored = String(configured || '').trim().replace(/\/+$/, '');
    const publicUrl = this.getConfiguredPublicMenuUrl();
    if (publicUrl) return publicUrl;
    if (!stored || this.getLegacyDigitalMenuUrls().includes(stored) || /^https?:\/\/[^/]+\.up\.railway\.app\/menu$/i.test(stored)) return null;
    return stored;
  }

  private async getMessagingMenuCategories() {
    const categories = await this.prisma.menuCategory.findMany({
      where: { active: true },
      include: {
        items: {
          where: { active: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    // Las adiciones se eligen dentro del pedido; no forman parte de la carta
    // principal que se envía como lista por WhatsApp.
    return categories.filter(category => category.items.length > 0 && !/^adiciones?$/i.test(category.name.trim()));
  }

  private async buildMessagingMenuText(): Promise<string> {
    const categories = await this.getMessagingMenuCategories();
    return buildMessagingMenuText(categories);
  }

  private getDefaultDigitalMenuUrl() {
    return this.getConfiguredPublicMenuUrl()
      || this.getMenuUrlFromBase(this.config.get('CLIENT_URL'))
      || this.getMenuUrlFromBase(this.config.get('RAILWAY_PUBLIC_DOMAIN') ? `https://${this.config.get('RAILWAY_PUBLIC_DOMAIN')}` : null)
      || 'http://localhost:5173/menu';
  }

  private buildMetaRecipient(target: string): { to?: string; recipient?: string } {
    const trimmed = (target || '').trim();
    const cleanDigits = trimmed.replace(/\D/g, '');

    // 1. If it starts with CO. or is a long BSUID (>= 13 digits not starting with 573):
    if (trimmed.startsWith('CO.') || (cleanDigits.length >= 13 && !cleanDigits.startsWith('573'))) {
      const bsuid = trimmed.startsWith('CO.') ? trimmed : `CO.${cleanDigits}`;
      return { recipient: bsuid };
    }

    // 2. If it is a Colombian 10-digit phone (starts with 3):
    if (cleanDigits.length === 10 && cleanDigits.startsWith('3')) {
      return { to: '57' + cleanDigits };
    }

    // 3. If it is already 12 digits starting with 57:
    if (cleanDigits.length === 12 && cleanDigits.startsWith('57')) {
      return { to: cleanDigits };
    }

    // 4. Other standard phones (7 to 12 digits):
    if (cleanDigits.length >= 7 && cleanDigits.length <= 12) {
      return { to: cleanDigits };
    }

    // Default fallback
    if (cleanDigits.length >= 13) {
      return { recipient: `CO.${cleanDigits}` };
    }

    return { to: cleanDigits || trimmed };
  }

  formatRecipient(phone: string): string {
    if (!phone) return '';
    const trimmed = phone.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
    if (trimmed.startsWith('@')) {
      return trimmed.slice(1);
    }
    if (trimmed.startsWith('CO.')) {
      return trimmed;
    }
    if (trimmed.startsWith('wa_')) {
      return trimmed.slice(3);
    }
    const cleanDigits = trimmed.replace(/\D/g, '');
    if (cleanDigits.length === 10 && cleanDigits.startsWith('3')) {
      return '57' + cleanDigits;
    }
    if (cleanDigits.length === 12 && cleanDigits.startsWith('57')) {
      return cleanDigits;
    }
    if (cleanDigits.length >= 7 && /^\d+$/.test(trimmed)) {
      return cleanDigits;
    }
    return trimmed;
  }

  getBestRecipientPhone(session?: any, fallbackPhone?: string): string {
    if (session?.phone) return session.phone;
    return fallbackPhone || '';
  }

  async resolveActiveRecipient(session?: any, fallbackPhone?: string): Promise<{ recipientPhone: string; lastInWaId?: string; isId: boolean }> {
    let targetSession = session;
    if (!targetSession && fallbackPhone) {
      targetSession = await this.resolveSessionForDispatch(fallbackPhone);
    }

    let lastIn: any = null;
    if (targetSession?.id) {
      lastIn = await this.prisma.whatsAppMessage.findFirst({
        where: {
          sessionId: targetSession.id,
          direction: 'IN',
          waMessageId: { startsWith: 'wamid.' }
        },
        orderBy: { createdAt: 'desc' }
      });
    }

    if (lastIn?.waMessageId) {
      const waId = lastIn.waMessageId;
      // 1. Si el último mensaje entrante vino de un teléfono móvil MSISDN real (wamid.HBgM):
      // IMPORTANTE: session.phone es el número del usuario que está chateando en WhatsApp.
      // NUNCA debemos anteponer customerPhone porque customerPhone puede ser un teléfono de Nequi o alterno
      // que no tiene ventana de 24h abierta, provocando que los mensajes salientes fallen.
      if (waId.startsWith('wamid.HBgM')) {
        const bestPhone = (!this.isDummyPhoneNumber(targetSession?.phone) ? targetSession?.phone : null)
          || (!this.isDummyPhoneNumber(fallbackPhone) ? fallbackPhone : null)
          || targetSession?.customerPhone
          || '';
        return { recipientPhone: bestPhone, lastInWaId: waId, isId: false };
      }
      // 2. Si el último mensaje entrante vino de un ID/BSUID de anuncio (wamid.HBgTQ08u o contiene Q08u):
      if (waId.startsWith('wamid.HBgTQ08u') || waId.includes('Q08u')) {
        const bestId = targetSession?.phone || fallbackPhone || '';
        return { recipientPhone: bestId, lastInWaId: waId, isId: true };
      }
    }

    // 3. Fallback limpio
    const candidate = (!this.isDummyPhoneNumber(targetSession?.phone) ? targetSession?.phone : null)
      || (!this.isDummyPhoneNumber(fallbackPhone) ? fallbackPhone : null)
      || targetSession?.customerPhone
      || '';
    const clean = candidate.replace(/\D/g, '');
    const isId = candidate.startsWith('CO.') || (clean.length >= 13 && !clean.startsWith('573'));
    return { recipientPhone: candidate, lastInWaId: lastIn?.waMessageId, isId };
  }

  private isDummyPhoneNumber(phone?: string | null): boolean {
    if (!phone) return true;
    const trimmed = phone.trim();
    if (!trimmed) return true;
    if (trimmed.startsWith('@') || trimmed.startsWith('CO.')) return false;
    const clean = trimmed.replace(/\D/g, '');
    return clean === '3000000000' || clean === '0000000000' || /^0+$/.test(clean) || clean.length < 7;
  }

  /**
   * Variantes válidas del número remitente de WhatsApp. `phone` es la
   * identidad de la conversación; `customerPhone` es solo un dato de contacto
   * editable y nunca debe utilizarse para decidir a qué sesión pertenece un
   * pedido.
   */
  private senderPhoneVariants(phone?: string | null): string[] {
    const raw = (phone || '').trim();
    if (!raw || this.isDummyPhoneNumber(raw)) return [];

    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('3')) {
      return Array.from(new Set([raw, digits, `57${digits}`, `+57${digits}`]));
    }
    if (digits.length === 12 && digits.startsWith('57')) {
      const phone10 = digits.slice(2);
      return Array.from(new Set([raw, digits, `+${digits}`, phone10]));
    }
    return [raw];
  }

  extractCallablePhone(text?: string, contact?: any, rawPhone?: string): string | null {
    // 1. Direct standard Colombian phone (10 or 12 digits)
    const cleanDigits = (rawPhone || '').replace(/\D/g, '');
    if (cleanDigits.length === 10 && cleanDigits.startsWith('3')) {
      return cleanDigits;
    }
    if (cleanDigits.length === 12 && cleanDigits.startsWith('573')) {
      return cleanDigits.slice(2);
    }
    if (cleanDigits.length === 11 && cleanDigits.startsWith('1')) {
      return cleanDigits; // US / Canada standard number
    }

    // 2. Check contact object from Meta webhook
    if (contact) {
      const cWaId = (contact.wa_id || '').replace(/\D/g, '');
      if (cWaId.length === 10 && cWaId.startsWith('3')) return cWaId;
      if (cWaId.length === 12 && cWaId.startsWith('573')) return cWaId.slice(2);
      if (cWaId.length === 11 && cWaId.startsWith('1')) return cWaId;

      const cPhone = (contact.phones?.[0]?.phone || '').replace(/\D/g, '');
      if (cPhone.length === 10 && cPhone.startsWith('3')) return cPhone;
      if (cPhone.length === 12 && cPhone.startsWith('573')) return cPhone.slice(2);
    }

    // 3. Scan message text with regex for Colombian mobile phone numbers
    if (text) {
      // 3.1 Check explicit label (e.g. "Cel: 3108776660", "Teléfono: 3001234567", "numero de llamadas: 315...")
      const explicitMatch = text.match(/(?:tel[eé]fono|cel(?:ular)?|m[oó]vil|n[uú]mero|num|nro|wa|llamadas?)\s*[:=-]?\s*(?:57\s*)?(3\d{2}[\s.-]?\d{3}[\s.-]?\d{4})/i);
      if (explicitMatch) {
        const digits = explicitMatch[1].replace(/\D/g, '');
        if (digits.length === 10 && digits.startsWith('3')) return digits;
      }

      // 3.2 Check standalone lines with a 10 or 12 digit number
      const lines = text.split(/[\r\n]+/);
      for (const line of lines) {
        const trimmed = line.trim();
        const lineDigits = trimmed.replace(/\D/g, '');
        if (lineDigits.length === 10 && lineDigits.startsWith('3')) return lineDigits;
        if (lineDigits.length === 12 && lineDigits.startsWith('573')) return lineDigits.slice(2);
      }

      // 3.3 Generic 10 digit Colombian mobile pattern
      const genericMatch = text.match(/\b(?:57\s*)?(3[0-9]{2})[\s.-]?([0-9]{3})[\s.-]?([0-9]{4})\b/);
      if (genericMatch) {
        const digits = `${genericMatch[1]}${genericMatch[2]}${genericMatch[3]}`;
        if (digits.length === 10) return digits;
      }
    }

    return null;
  }

  async resolveSessionForDispatch(target: string): Promise<any> {
    if (!target || this.isDummyPhoneNumber(target)) return null;
    const raw = target.trim();
    const cleanDigits = raw.replace(/\D/g, '');
    const isStandardPhone = cleanDigits.length >= 7 && cleanDigits.length <= 13 && !this.isDummyPhoneNumber(cleanDigits);
    const phone10 = (cleanDigits.length === 12 && cleanDigits.startsWith('57')) ? cleanDigits.slice(2) : cleanDigits;
    const phone12 = (phone10.length === 10 && phone10.startsWith('3')) ? '57' + phone10 : cleanDigits;

    const orConditions: any[] = [{ id: raw }, { phone: raw }];
    if (isStandardPhone) {
      orConditions.push(
        { phone: cleanDigits },
        { phone: phone10 },
        { phone: phone12 }
      );
    } else if (cleanDigits.length > 0 && !this.isDummyPhoneNumber(cleanDigits)) {
      orConditions.push({ phone: cleanDigits });
    }

    return this.prisma.whatsAppSession.findFirst({
      where: { OR: orConditions },
      include: { assignedTo: { select: { id: true, name: true } } },
      orderBy: { lastMessageAt: 'desc' }
    });
  }

  async findOrCreateSession(rawPhone: string, defaultName?: string, callablePhone?: string) {
    const raw = (rawPhone || '').trim();
    const cleanDigits = raw.replace(/\D/g, '');
    const isStandardPhone = cleanDigits.length >= 7 && cleanDigits.length <= 13;
    const phone10 = cleanDigits.length === 12 && cleanDigits.startsWith('57') ? cleanDigits.slice(2) : cleanDigits;
    const phone12 = phone10.length === 10 && phone10.startsWith('3') ? '57' + phone10 : cleanDigits;
    const primaryKey = (isStandardPhone && (phone10.length === 10 || cleanDigits.length <= 12)) 
      ? (phone10.length === 10 ? phone10 : cleanDigits) 
      : raw;

    const orConditions: any[] = [{ id: raw }, { phone: raw }, { phone: primaryKey }];
    if (isStandardPhone) {
      orConditions.push({ phone: cleanDigits }, { phone: phone10 }, { phone: phone12 });
    }

    let session = await this.prisma.whatsAppSession.findFirst({
      where: { OR: orConditions },
      include: { assignedTo: { select: { id: true, name: true } } },
      orderBy: { lastMessageAt: 'desc' }
    });

    const resolvedCallable = callablePhone || (phone10.length === 10 && phone10.startsWith('3') ? phone10 : null);

    if (!session) {
      const fallbackName = defaultName || (isStandardPhone && phone10.length === 10 ? `+57 ${phone10.slice(0, 3)} ${phone10.slice(3, 6)} ${phone10.slice(6)}` : raw);
      session = await this.prisma.whatsAppSession.create({
        data: {
          phone: primaryKey,
          customerPhone: resolvedCallable || primaryKey,
          customerName: fallbackName
        },
        include: { assignedTo: { select: { id: true, name: true } } }
      });
    } else if (resolvedCallable && !session.customerPhone) {
      session = await this.prisma.whatsAppSession.update({
        where: { id: session.id },
        data: { customerPhone: resolvedCallable },
        include: { assignedTo: { select: { id: true, name: true } } }
      });
    }

    return session;
  }

  private async purgeLegacyMenuFile() {
    await this.prisma.appSetting.deleteMany({
      where: { key: { in: ['chatbot_menu_file_base64', 'chatbot_menu_file_name', 'chatbot_menu_file_mimetype', 'chatbot_menu_file_caption', 'chatbot_menu_meta_media_id'] } },
    });
  }

  async savePaymentQrFile(base64: string, fileName: string, mimeType: string) {
    await this.prisma.appSetting.upsert({
      where: { key: 'chatbot_payment_qr_base64' },
      create: { key: 'chatbot_payment_qr_base64', value: base64 },
      update: { value: base64 },
    });
    await this.prisma.appSetting.upsert({
      where: { key: 'chatbot_payment_qr_name' },
      create: { key: 'chatbot_payment_qr_name', value: fileName },
      update: { value: fileName },
    });
    await this.prisma.appSetting.upsert({
      where: { key: 'chatbot_payment_qr_mimetype' },
      create: { key: 'chatbot_payment_qr_mimetype', value: mimeType },
      update: { value: mimeType },
    });
    await this.prisma.appSetting.upsert({
      where: { key: 'chatbot_payment_qr_mode' },
      create: { key: 'chatbot_payment_qr_mode', value: 'IMAGE' },
      update: { value: 'IMAGE' },
    });
    // Un identificador de Meta pertenece a los bytes anteriores. Se elimina antes
    // de precargar la nueva imagen para impedir que se envíe un QR obsoleto.
    await this.prisma.appSetting.deleteMany({
      where: { key: 'chatbot_payment_qr_meta_media_id' },
    });
    this.settingCache.delete('chatbot_payment_qr_mode');
    this.socketGateway.emitWhatsApp('whatsappSettingsUpdated', await this.getSettings());

    // Pre-cachear QR en Meta Media API de inmediato
    (async () => {
      try {
        const phoneId = await this.getSetting('whatsapp_phone_id');
        const token = await this.getSetting('whatsapp_token');
        if (!phoneId || !token) return;

        const buffer = Buffer.from(base64, 'base64');
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
        formData.append('file', blob, fileName);
        formData.append('type', mimeType);
        formData.append('messaging_product', 'whatsapp');

        const uploadRes = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          if (uploadData.id) {
            await this.prisma.appSetting.upsert({
              where: { key: 'chatbot_payment_qr_meta_media_id' },
              create: { key: 'chatbot_payment_qr_meta_media_id', value: uploadData.id },
              update: { value: uploadData.id },
            });
            this.logger.log(`QR de pago pre-cacheado con éxito en Meta Media ID: ${uploadData.id}`);
          }
        }
      } catch (e) {
        this.logger.error('Error pre-cacheando QR en Meta:', e);
      }
    })();
  }

  async deletePaymentQrFile() {
    await this.prisma.appSetting.deleteMany({
      where: { key: { in: ['chatbot_payment_qr_base64', 'chatbot_payment_qr_name', 'chatbot_payment_qr_mimetype', 'chatbot_payment_qr_meta_media_id'] } },
    });
    await this.prisma.appSetting.upsert({
      where: { key: 'chatbot_payment_qr_mode' },
      create: { key: 'chatbot_payment_qr_mode', value: 'ACCOUNT' },
      update: { value: 'ACCOUNT' },
    });
    this.settingCache.delete('chatbot_payment_qr_mode');
    this.socketGateway.emitWhatsApp('whatsappSettingsUpdated', await this.getSettings());
  }

  async sendPaymentQr(phone: string) {
    const targetSession = await this.resolveSessionForDispatch(phone);
    const { recipientPhone, lastInWaId, isId } = await this.resolveActiveRecipient(targetSession, phone);
    const cleanPhone = this.formatRecipient(recipientPhone);
    const now = Date.now();
    const lastSent = this.paymentQrSendingLocks.get(cleanPhone) || 0;
    if (now - lastSent < 4000) {
      this.logger.warn(`Deduplicando envío de QR para ${cleanPhone} (llamada repetida en < 4s)`);
      return { sent: true, deduplicated: true };
    }
    this.paymentQrSendingLocks.set(cleanPhone, now);

    const qrRows = await this.prisma.appSetting.findMany({
      where: {
        key: {
          in: [
            'chatbot_payment_qr_mode',
            'chatbot_payment_account_text',
            'chatbot_payment_qr_base64',
            'chatbot_payment_qr_name',
            'chatbot_payment_qr_mimetype',
            'chatbot_payment_qr_meta_media_id',
            'chatbot_payment_qr_caption',
          ],
        },
      },
    });
    const qrSettings = Object.fromEntries(qrRows.map(row => [row.key, row.value])) as Record<string, string>;
    const mode = String(qrSettings.chatbot_payment_qr_mode || (qrSettings.chatbot_payment_qr_base64 ? 'IMAGE' : 'ACCOUNT')).toUpperCase();
    const accountText = String(qrSettings.chatbot_payment_account_text || '').trim();

    if (mode === 'ACCOUNT') {
      if (!accountText) {
        throw new BadRequestException('Configura primero los datos de la cuenta en Configuración > WhatsApp y envíos.');
      }
      return this.sendMessage(cleanPhone, accountText);
    }

    const fileValue = qrSettings.chatbot_payment_qr_base64;
    if (!fileValue) {
      if (accountText) return this.sendMessage(cleanPhone, accountText);
      throw new BadRequestException('Configura primero una imagen QR o los datos de la cuenta.');
    }

    const caption = String(qrSettings.chatbot_payment_qr_caption || '').trim();
    const fileName = qrSettings.chatbot_payment_qr_name || 'QR_Pago_THE_VILLA_DOG.png';
    const mimeType = qrSettings.chatbot_payment_qr_mimetype || 'image/png';
    const cachedMediaId = qrSettings.chatbot_payment_qr_meta_media_id;
    const phoneId = await this.getSetting('whatsapp_phone_id');
    const token = await this.getSetting('whatsapp_token');

    // 1. Envío instantáneo 0.05s usando ID cacheado
    if (cachedMediaId && phoneId && token) {
      const mediaId = cachedMediaId;
      const recipientObj = this.buildMetaRecipient(cleanPhone);
      const sendBody: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        ...recipientObj,
        type: 'image',
        image: { id: mediaId, ...(caption ? { caption } : {}) }
      };

      if (isId || recipientObj.recipient || cleanPhone.length >= 13 || cleanPhone.startsWith('CO.')) {
        if (lastInWaId) {
          sendBody.context = { message_id: lastInWaId };
        }
      }

      try {
        const sendRes = await fetch(`https://graph.facebook.com/v26.0/${phoneId}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(sendBody),
        });

        let ok = sendRes.ok;
        let sendData = await sendRes.json();

        if (!ok && (sendData?.error?.code === 131047 || sendData?.error?.code === 131026 || sendData?.error?.code === 470)) {
          this.logger.warn(`Ventana de 24h cerrada para ${cleanPhone} en QR. Enviando plantilla de reactivación...`);
          const tmplResult = await this.sendTemplate(cleanPhone, 'actualizacion_sistema_niche', 'es_CO', []);
          if (tmplResult.sent) return { sent: true, data: tmplResult.data };
        }

        if (ok) {
          const session = targetSession || await this.findOrCreateSession(cleanPhone);
          await this.prisma.whatsAppSession.update({ where: { id: session.id }, data: { lastMessageAt: new Date() } });

          const msgContent = caption ? `${mediaId}|${caption}` : mediaId;

          const newMsg = await this.prisma.whatsAppMessage.create({
            data: {
              waMessageId: sendData.messages?.[0]?.id || `out-${Date.now()}`,
              sessionId: session.id,
              direction: 'OUT',
              content: msgContent,
              messageType: 'image',
              status: 'sent',
            },
          });

          this.socketGateway.emitWhatsApp('whatsappMessage', {
            id: newMsg.id,
            waMessageId: newMsg.waMessageId,
            sessionId: session.id,
            phone: cleanPhone,
            customerName: session.customerName || cleanPhone,
            content: msgContent,
            messageType: 'image',
            direction: 'OUT',
            status: newMsg.status || 'sent',
            assignedTo: session.assignedToId,
            createdAt: newMsg.createdAt,
          });

          return { sent: true, data: sendData };
        }
      } catch (err) {
        this.logger.warn('Fallo con QR media_id cacheado, reintentando subida...', err);
      }
    }

    // 2. Si no estaba cacheado, subirlo y guardar ID
    const buffer = Buffer.from(fileValue, 'base64');
    return this.sendMediaMessage(cleanPhone, buffer, fileName, mimeType, 'image', caption);
  }

  private menuSendingLocks = new Map<string, number>();
  private paymentQrSendingLocks = new Map<string, number>();

  async sendMenuCarta(phone: string) {
    const targetSession = await this.resolveSessionForDispatch(phone);
    const { recipientPhone } = await this.resolveActiveRecipient(targetSession, phone);
    const cleanPhone = this.formatRecipient(recipientPhone);
    const now = Date.now();
    const lastSent = this.menuSendingLocks.get(cleanPhone) || 0;
    if (now - lastSent < 4000) {
      this.logger.warn(`Deduplicando envío de carta para ${cleanPhone} (llamada repetida en < 4s)`);
      return { sent: true, deduplicated: true };
    }
    this.menuSendingLocks.set(cleanPhone, now);

    const rows = await this.prisma.appSetting.findMany({
      where: { key: { in: ['digital_menu_url', 'chatbot_menu_share_message', 'chatbot_menu_text'] } },
    });
    const values = Object.fromEntries(rows.map(row => [row.key, row.value])) as Record<string, string>;
    const link = this.getShareableDigitalMenuUrl(values.digital_menu_url);
    const customMessage = String(values.chatbot_menu_share_message || '').trim();
    let menuText = String(values.chatbot_menu_text || '').trim();
    if (!menuText) {
      menuText = await this.buildMessagingMenuText();
    }
    const intro = customMessage || 'Aquí tienes nuestra carta actualizada:';
    const introWithoutPlaceholder = intro.replaceAll('{url}', '').replace(/\n{3,}/g, '\n\n').trim();
    const linkText = link
      ? `\n\nTambién puedes verla y armar tu pedido directamente aquí:\n👉 ${link}`
      : '';
    const message = `${introWithoutPlaceholder}\n\n${menuText}${linkText}`;

    // La carta es siempre el catálogo vivo. Los PDF e imágenes antiguos dejan de
    // tener prioridad, por lo que un cambio de producto o precio no queda obsoleto.
    return this.sendMessage(cleanPhone, message);
  }

  // Reenvío Directo en el Servidor (0.05s, sin descargar ni re-subir bytes)
  async forwardMessage(targetPhone: string, content: string, messageType?: string) {
    const cleanPhone = this.formatRecipient(targetPhone);

    if (['image', 'audio', 'document', 'video'].includes(messageType || '')) {
      const rawMediaId = content.split('|')[0];
      const cleanMediaId = rawMediaId.includes('/') ? rawMediaId.split('/').pop() : rawMediaId;
      const caption = content.includes('|') ? content.split('|').slice(1).join('|') : '';
      const phoneId = await this.getSetting('whatsapp_phone_id');
      const token = await this.getSetting('whatsapp_token');

      if (!phoneId || !token || !cleanMediaId) {
        return this.sendMessage(cleanPhone, content);
      }

      const recipientObj = this.buildMetaRecipient(cleanPhone);
      const sendBody: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        ...recipientObj,
        type: messageType,
      };

      if (cleanPhone.length >= 14 || /^\d{14,18}$/.test(cleanPhone)) {
        const lastIn = await this.prisma.whatsAppMessage.findFirst({
          where: {
            session: { phone: cleanPhone },
            direction: 'IN',
            waMessageId: { startsWith: 'wamid.' }
          },
          orderBy: { createdAt: 'desc' }
        });
        if (lastIn?.waMessageId) {
          sendBody.context = { message_id: lastIn.waMessageId };
        }
      }

      if (messageType === 'image') sendBody.image = { id: cleanMediaId, ...(caption ? { caption } : {}) };
      else if (messageType === 'audio') sendBody.audio = { id: cleanMediaId };
      else sendBody.document = { id: cleanMediaId, filename: 'archivo_reenviado', ...(caption ? { caption } : {}) };

      const sendRes = await fetch(`https://graph.facebook.com/v26.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sendBody),
      });

      const sendOk = sendRes.ok;
      const sendData = await sendRes.json();

      if (sendOk) {
        const session = await this.findOrCreateSession(cleanPhone);
        await this.prisma.whatsAppSession.update({ where: { id: session.id }, data: { lastMessageAt: new Date() } });

        const msgContent = caption ? `${cleanMediaId}|${caption}` : cleanMediaId;

        const newMsg = await this.prisma.whatsAppMessage.create({
          data: {
            waMessageId: sendData.messages?.[0]?.id || `out-${Date.now()}`,
            sessionId: session.id,
            direction: 'OUT',
            content: msgContent,
            messageType: messageType || 'text',
            status: 'sent',
          },
        });

        this.socketGateway.emitWhatsApp('whatsappMessage', {
          id: newMsg.id,
          waMessageId: newMsg.waMessageId,
          sessionId: session.id,
          phone: session.phone,
          customerName: session.customerName || session.phone,
          content: msgContent,
          messageType: messageType || 'text',
          direction: 'OUT',
          status: newMsg.status || 'sent',
          assignedTo: session.assignedToId,
          createdAt: newMsg.createdAt,
        });

        return { sent: true, data: sendData };
      }
      return { sent: false, data: sendData };
    } else {
      // Reenvío de texto o enlace en 0.05s
      return this.sendMessage(cleanPhone, content);
    }
  }

  async updateSettings(data: { 
    phoneId?: string; 
    token?: string; 
    verifyToken?: string; 
    businessPhone?: string; 
    chatbotEnabled?: boolean; 
    orderReaderEnabled?: boolean;
    geminiApiKey?: string; 
    geminiModel?: string;
    aiInstructions?: string;
    digital_menu_url?: string;
    menuShareMessage?: string;
    menuText?: string;
    paymentQrMode?: 'IMAGE' | 'ACCOUNT';
    paymentAccountText?: string;
    paymentQrCaption?: string;
    businessHoursEnabled?: boolean;
    outOfServiceEnabled?: boolean;
    outOfServiceMessage?: string;
    restaurantHours?: string;
  }) {
    const updates: { key: string; value: string }[] = [];
    if (data.phoneId !== undefined) updates.push({ key: 'whatsapp_phone_id', value: data.phoneId.trim() });
    if (data.token && !data.token.includes('••')) {
      const cleanToken = data.token.trim().replace(/^["']|["']$/g, '').split(/\s+/)[0];
      updates.push({ key: 'whatsapp_token', value: cleanToken });
    }
    if (data.verifyToken !== undefined && !data.verifyToken.includes('••')) {
      const cleanVerify = data.verifyToken.trim().replace(/^["']|["']$/g, '').split(/\s+/)[0];
      updates.push({ key: 'whatsapp_verify_token', value: cleanVerify });
    }
    if (data.businessPhone !== undefined) updates.push({ key: 'whatsapp_business_phone', value: data.businessPhone });
    if (data.chatbotEnabled !== undefined) updates.push({ key: 'chatbot_enabled', value: String(data.chatbotEnabled) });
    if (data.orderReaderEnabled !== undefined) updates.push({ key: 'order_reader_enabled', value: String(data.orderReaderEnabled) });
    
    if (data.geminiApiKey !== undefined) {
      const incomingRaw = data.geminiApiKey.trim();
      if (!incomingRaw) {
        updates.push({ key: 'gemini_api_key', value: '' });
      } else {
        const existingSetting = await this.prisma.appSetting.findUnique({ where: { key: 'gemini_api_key' } });
        const existingKeys = (existingSetting?.value || '').split(',').map(k => k.trim()).filter(Boolean);
        const incomingTokens = incomingRaw.split(',').map(k => k.trim()).filter(Boolean);
        
        const mergedKeys = this.resolveGeminiKeys(incomingTokens, existingKeys);
        if (mergedKeys.length === 0) {
          throw new BadRequestException('No se pudo reconocer ninguna llave válida de Gemini');
        }
        updates.push({ key: 'gemini_api_key', value: mergedKeys.join(', ') });
      }
    }

    if (data.geminiModel !== undefined) {
      const geminiModel = this.normalizeGeminiModel(data.geminiModel);
      if (!geminiModel) throw new BadRequestException('El modelo de Gemini es obligatorio');
      updates.push({ key: 'gemini_model', value: geminiModel });
    }
    if (data.aiInstructions !== undefined) {
      const aiInstructions = String(data.aiInstructions).trim();
      if (aiInstructions.length > 4000) {
        throw new BadRequestException('Las instrucciones de la IA no pueden superar 4.000 caracteres');
      }
      updates.push({ key: 'chatbot_ai_instructions', value: aiInstructions });
    }

    if (data.digital_menu_url !== undefined) {
      const menuUrl = String(data.digital_menu_url).trim();
      if (menuUrl.length > 500) throw new BadRequestException('El enlace de la carta es demasiado largo');
      if (menuUrl) {
        try {
          const parsed = new URL(menuUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
        } catch {
          throw new BadRequestException('El enlace de la carta debe ser una URL http o https válida');
        }
      }
      updates.push({ key: 'digital_menu_url', value: menuUrl });
    }
    if (data.menuShareMessage !== undefined) {
      const menuShareMessage = String(data.menuShareMessage).trim();
      if (menuShareMessage.length > 3500) throw new BadRequestException('El mensaje de la carta es demasiado largo');
      updates.push({ key: 'chatbot_menu_share_message', value: menuShareMessage });
    }
    if (data.menuText !== undefined) {
      const cleanMenuText = String(data.menuText).trim();
      updates.push({ key: 'chatbot_menu_text', value: cleanMenuText });
      updates.push({ key: 'chatbot_menu_text_custom', value: 'true' });
    }
    if (data.paymentQrMode !== undefined) {
      if (!['IMAGE', 'ACCOUNT'].includes(data.paymentQrMode)) throw new BadRequestException('Modo de cobro inválido');
      updates.push({ key: 'chatbot_payment_qr_mode', value: data.paymentQrMode });
    }
    if (data.paymentAccountText !== undefined) {
      const paymentAccountText = String(data.paymentAccountText).trim();
      if (paymentAccountText.length > 4096) throw new BadRequestException('Los datos de la cuenta son demasiado largos');
      updates.push({ key: 'chatbot_payment_account_text', value: paymentAccountText });
    }
    if (data.businessHoursEnabled !== undefined) updates.push({ key: 'business_hours_enabled', value: String(data.businessHoursEnabled) });
    if (data.outOfServiceEnabled !== undefined) updates.push({ key: 'out_of_service_enabled', value: String(data.outOfServiceEnabled) });
    if (data.outOfServiceMessage !== undefined) {
      const message = String(data.outOfServiceMessage).trim();
      if (message.length > 1200) throw new BadRequestException('El mensaje de cierre no puede superar 1.200 caracteres');
      updates.push({ key: 'out_of_service_message', value: message });
    }
    if (data.restaurantHours !== undefined) {
      const hours = String(data.restaurantHours).trim();
      const timePattern = /^(?:[01]?\d|2[0-3]):[0-5]\d\s*(?:am|pm)?$/i;
      const parts = hours.split('-').map(part => part.trim());
      if (parts.length !== 2 || !timePattern.test(parts[0]) || !timePattern.test(parts[1])) {
        throw new BadRequestException('El horario debe tener una hora de apertura y una de cierre válidas');
      }
      updates.push({ key: 'restaurant_hours', value: hours });
    }
    if (data.paymentQrCaption !== undefined) {
      const paymentQrCaption = String(data.paymentQrCaption).trim();
      if (paymentQrCaption.length > 1024) throw new BadRequestException('El texto del QR es demasiado largo');
      updates.push({ key: 'chatbot_payment_qr_caption', value: paymentQrCaption });
    }

    for (const u of updates) {
      await this.prisma.appSetting.upsert({
        where: { key: u.key },
        create: u,
        update: { value: u.value },
      });
      this.settingCache.delete(u.key);
    }
    if (data.digital_menu_url !== undefined || data.menuShareMessage !== undefined) {
      await this.purgeLegacyMenuFile();
    }
    const currentSettings = await this.getSettings();
    if (this.socketGateway) {
      this.socketGateway.emitWhatsApp('whatsappSettingsUpdated', currentSettings);
    }
    return currentSettings;
  }

  async regenerateMessagingMenuText(): Promise<string> {
    const menuText = await this.buildMessagingMenuText();
    await this.prisma.appSetting.upsert({
      where: { key: 'chatbot_menu_text' },
      create: { key: 'chatbot_menu_text', value: menuText },
      update: { value: menuText },
    });
    await this.prisma.appSetting.upsert({
      where: { key: 'chatbot_menu_text_custom' },
      create: { key: 'chatbot_menu_text_custom', value: 'false' },
      update: { value: 'false' },
    });
    this.settingCache.delete('chatbot_menu_text');
    this.settingCache.delete('chatbot_menu_text_custom');
    if (this.socketGateway) {
      this.socketGateway.emitWhatsApp('whatsappSettingsUpdated', { menuText });
    }
    return menuText;
  }

  async verifyWebhook(mode: string, token: string, challenge: string) {
    const dbToken = await this.getSetting('whatsapp_verify_token');
    const verifyToken = dbToken || this.config.get('WHATSAPP_VERIFY_TOKEN') || 'the_villa_dog_verify_token';
    if (mode === 'subscribe' && token === verifyToken) return challenge;
    return null;
  }

  async streamMedia(mediaId: string, res: any) {
    try {
      const media = await this.getMediaBuffer(mediaId);
      if (!media) return res.status(404).send('Archivo multimedia no disponible');

      res.setHeader('Content-Type', media.contentType);
      res.setHeader('Content-Length', String(media.buffer.length));
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      res.setHeader('ETag', `"wa-${mediaId}"`);
      return res.send(media.buffer);
    } catch (err: any) {
      this.logger.error(`Error obteniendo media de WhatsApp (${mediaId}):`, err?.message || err);
      return res.status(500).send('Error obteniendo archivo multimedia de Meta');
    }
  }

  handleWebhook(body: any) {
    // Fire and forget: procesamos en segundo plano para devolver 200 OK a Meta inmediatamente
    // Esto evita que Meta cancele el webhook por timeout durante ráfagas masivas
    this._processWebhookAsync(body).catch(err => {
      this.logger.error('Error procesando webhook asíncrono:', err?.message || err);
    });
    return { status: 'ok' };
  }

  private async _processWebhookAsync(body: any) {
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        const messages = value.messages || [];
        const statuses = value.statuses || [];
        const contactsList = value.contacts || [];

        // Procesar distintos clientes en paralelo, conservando el orden de los
        // mensajes de un mismo número para evitar carreras al crear la sesión.
        const messagesBySender = new Map<string, any[]>();
        for (const msg of messages) {
          const sender = msg.from || msg.from_user_id || msg.sender || msg.wa_id || msg.id || 'unknown';
          const group = messagesBySender.get(sender) || [];
          group.push(msg);
          messagesBySender.set(sender, group);
        }

        await Promise.all([...messagesBySender.values()].map(async group => {
          for (const msg of group) {
            const rawFrom = msg.from || msg.from_user_id || msg.sender || msg.wa_id || '';
            const cleanFrom = (rawFrom || '').replace(/\D/g, '');
            const matchedContact = contactsList.find((c: any) => {
              const cWaId = (c.wa_id || c.user_id || '').replace(/\D/g, '');
              return cWaId === cleanFrom || (cleanFrom.length === 12 && cWaId === cleanFrom.slice(2)) || (cWaId.length === 12 && cWaId.slice(2) === cleanFrom);
            }) || contactsList[0];
            await this.processIncomingMessage(msg, matchedContact);
          }
        }));

        await Promise.all(statuses.map((statusObj: any) => this.processMessageStatusUpdate(statusObj)));
      }
    }
  }

  private async processMessageStatusUpdate(statusObj: any) {
    const waMessageId = statusObj.id;
    const status = statusObj.status; // 'sent', 'delivered', 'read', 'failed'
    const errorsList = statusObj.errors || [];

    this.logger.log(`[Meta Status Webhook] wamid: ${waMessageId} | status: ${status} | errors: ${JSON.stringify(errorsList)}`);

    try {
      const msg = await this.prisma.whatsAppMessage.findFirst({
        where: { OR: [{ waMessageId }, { id: waMessageId }] },
        include: { session: true }
      });

      if (msg) {
        const statusPriority: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
        const currentPriority = statusPriority[msg.status] || 0;
        const newPriority = statusPriority[status] || 0;

        const isFailed = status === 'failed';
        if (isFailed || newPriority > currentPriority) {
          if (isFailed) {
            this.logger.error(`Mensaje saliente ${waMessageId} FALLÓ en Meta. Errores:`, JSON.stringify(errorsList));
          }
          await this.prisma.whatsAppMessage.update({
            where: { id: msg.id },
            data: { status },
          });

          // Ensure session is marked active on delivery/read
          if (status === 'delivered' || status === 'read') {
            await this.prisma.whatsAppSession.update({
              where: { id: msg.sessionId },
              data: { active: true }
            }).catch(() => {});
          }

          if (this.socketGateway) {
            this.socketGateway.emitWhatsApp('whatsappMessageStatus', {
              messageId: msg.id,
              waMessageId: msg.waMessageId || waMessageId,
              sessionId: msg.sessionId,
              status,
              errors: errorsList
            });
            this.socketGateway.emitWhatsApp('whatsappSessionUpdated', {
              sessionId: msg.sessionId,
            });
          }
        }
      }
    } catch (err) {
      this.logger.error(`Error actualizando estado de mensaje ${waMessageId}:`, err);
    }
  }

  private async processIncomingMessage(msg: any, contact?: any) {
    let rawPhone = msg.from || msg.from_user_id || msg.sender || msg.wa_id || contact?.wa_id || contact?.user_id || '';
    if (!rawPhone || rawPhone === 'cliente_wa') {
      const waId = msg.id || '';
      if (waId.startsWith('wamid.HBg')) {
        try {
          const rest = waId.slice(10);
          const b64Part = rest.split(/[^A-Za-z0-9+/=]/)[0];
          const decoded = Buffer.from(b64Part, 'base64').toString('utf8');
          const coMatch = decoded.match(/CO\.(\d+)/i);
          if (coMatch) {
            rawPhone = coMatch[1];
          } else {
            const digitsMatch = decoded.match(/^(\d{10,16})/);
            if (digitsMatch) {
              rawPhone = digitsMatch[1];
            } else {
              const anyDigits = decoded.replace(/\D/g, '');
              if (anyDigits.length >= 10) rawPhone = anyDigits.slice(0, 16);
            }
          }
        } catch (e) {}
      }
    }
    const cleanDigits = (rawPhone || '').replace(/\D/g, '');
    const phone10 = (cleanDigits.length === 12 && cleanDigits.startsWith('57')) ? cleanDigits.slice(2) : cleanDigits;
    const formattedPhone = (phone10.length === 10) ? `+57 ${phone10.slice(0, 3)} ${phone10.slice(3, 6)} ${phone10.slice(6)}` : (cleanDigits ? `+${cleanDigits}` : 'Cliente');
    
    // Extraer nombre real de Meta sin arrobas ni IDs técnicos
    let rawContactName = (contact?.profile?.name || contact?.profile?.username || '').trim();
    if (rawContactName.startsWith('@')) {
      rawContactName = rawContactName.replace(/^@+/, '').trim();
    }
    const isNameOnlyDigits = /^\d+$/.test(rawContactName.replace(/[\s+()-]/g, ''));
    const isTechnicalId = /^(wa_lead_|user_|id_|c_|wamid\.)/i.test(rawContactName) || isNameOnlyDigits;

    const customerName = (rawContactName && !isTechnicalId) ? rawContactName : formattedPhone;
    const phone = (phone10.length === 10) ? phone10 : (cleanDigits || rawPhone);
    const messageType = msg.type || 'text';
    
    try {

    // Manejo de Reacciones de WhatsApp (emojis ❤️, 👍, 😂, 🔥, 😮, 🙏)
    if (messageType === 'reaction') {
      const targetWaMessageId = msg.reaction?.message_id;
      const emoji = msg.reaction?.emoji || '';

      if (targetWaMessageId) {
        try {
          const targetMsg = await this.prisma.whatsAppMessage.findFirst({
            where: { OR: [{ waMessageId: targetWaMessageId }, { id: targetWaMessageId }] }
          });
          if (targetMsg) {
            await this.prisma.whatsAppMessage.update({
              where: { id: targetMsg.id },
              data: { reaction: emoji || null }
            });
            if (this.socketGateway) {
              this.socketGateway.emitWhatsApp('whatsappMessageReaction', {
                messageId: targetMsg.id,
                waMessageId: targetWaMessageId,
                sessionId: targetMsg.sessionId,
                reaction: emoji || null
              });
            }
          }
        } catch (e) {
          this.logger.error('Error procesando reacción de WhatsApp:', e);
        }
      }
      return;
    }

    let content = '';
    let dbMessageType = messageType;

    if (messageType === 'text') {
      content = msg.text?.body || '';
    } else if (messageType === 'image') {
      const mediaId = msg.image?.id || '';
      const caption = msg.image?.caption || '';
      const url = mediaId ? `/api/whatsapp/media/${mediaId}` : '[Imagen de WhatsApp]';
      content = caption ? `${url}|${caption}` : url;
    } else if (messageType === 'audio' || messageType === 'voice') {
      const mediaId = msg.audio?.id || msg.voice?.id || '';
      const caption = msg.audio?.caption || msg.voice?.caption || '';
      const url = mediaId ? `/api/whatsapp/media/${mediaId}` : '[Nota de Voz de WhatsApp]';
      content = caption ? `${url}|${caption}` : url;
      dbMessageType = 'audio';
    } else if (messageType === 'video') {
      const mediaId = msg.video?.id || '';
      const caption = msg.video?.caption || '';
      const url = mediaId ? `/api/whatsapp/media/${mediaId}` : '[Video de WhatsApp]';
      content = caption ? `${url}|${caption}` : url;
      dbMessageType = 'video';
    } else if (messageType === 'document') {
      const mediaId = msg.document?.id || '';
      const caption = msg.document?.caption || '';
      const url = mediaId ? `/api/whatsapp/media/${mediaId}` : '[Documento de WhatsApp]';
      content = caption ? `${url}|${caption}` : url;
    } else if (messageType === 'location') {
      const loc = msg.location || {};
      const lat = loc.latitude;
      const lng = loc.longitude;
      const locName = loc.name || loc.address || '';
      content = `📍 Ubicación compartida: https://maps.google.com/?q=${lat},${lng}${locName ? ` - ${locName}` : ''}`;
      dbMessageType = 'location';
    } else if (messageType === 'call_log' || messageType === 'call' || messageType === 'system') {
      content = '📞 Llamada perdida de WhatsApp';
      dbMessageType = 'text';
    } else if (messageType === 'button') {
      content = msg.button?.text || msg.button?.payload || '[Botón de WhatsApp]';
      dbMessageType = 'text';
    } else if (messageType === 'interactive') {
      const interType = msg.interactive?.type;
      if (interType === 'button_reply') {
        content = msg.interactive?.button_reply?.title || '[Respuesta interactiva]';
      } else if (interType === 'list_reply') {
        content = msg.interactive?.list_reply?.title || '[Selección de lista]';
      } else {
        content = msg.interactive?.body?.text || `[Interactivo: ${interType}]`;
      }
      dbMessageType = 'text';
    } else if (messageType === 'sticker') {
      const mediaId = msg.sticker?.id || '';
      content = mediaId ? `/api/whatsapp/media/${mediaId}` : '🎭 Sticker';
      dbMessageType = 'image';
    } else if (messageType === 'contacts') {
      const firstContact = msg.contacts?.[0];
      const contactName = firstContact?.name?.formatted_name || 'Contacto';
      const contactPhone = firstContact?.phones?.[0]?.phone || '';
      content = `👤 Contacto compartido: ${contactName}${contactPhone ? ` (${contactPhone})` : ''}`;
      dbMessageType = 'text';
    } else if (messageType === 'order') {
      const orderItems = msg.order?.product_items || [];
      const orderText = orderItems.map((item: any) => `${item.quantity || 1}x ${item.product_retailer_id || 'Producto'}`).join(', ');
      content = `🛒 Pedido de Catálogo: ${orderText || msg.order?.text || '[Pedido de Catálogo]'}`;
      dbMessageType = 'text';
    } else {
      content = msg[messageType]?.caption || msg[messageType]?.text || msg.text?.body || `[Mensaje recibido: ${messageType}]`;
    }

    if (!content || !content.trim()) {
      content = `[Mensaje recibido de WhatsApp]`;
    }

    // Guard: skip if this waMessageId was already processed (Meta webhook retries)
    if (msg.id) {
      const existing = await this.prisma.whatsAppMessage.findFirst({
        where: { waMessageId: msg.id },
      });
      if (existing) {
        this.logger.log(`Webhook retry detectado: mensaje ${msg.id} ya existe, omitiendo.`);
        return;
      }
    }

    // Intentar extraer el nombre del cliente si viene explícito en el texto del mensaje (ej: Nombre: Juan Martinez)
    let finalCustomerName = customerName;
    if (content) {
      const nameMatch = content.match(/Nombre:\s*([^\n\r*]+)/i);
      if (nameMatch && nameMatch[1].trim()) {
        const foundName = nameMatch[1].trim().replace(/^@+/, '');
        if (foundName && !/^\d+$/.test(foundName.replace(/[\s+()-]/g, ''))) {
          finalCustomerName = foundName;
        }
      }
    }

    // Extraer número de teléfono llamable (10 dígitos colombianos o estándar internacional)
    const detectedCallablePhone = this.extractCallablePhone(content, contact, rawPhone);

    // Normalizar formato de teléfono (10 o 12 dígitos)
    const isStandardPhone = cleanDigits.length >= 7 && cleanDigits.length <= 13;
    const phone12 = cleanDigits.length === 10 ? '57' + cleanDigits : cleanDigits;
    const primaryPhoneKey = (isStandardPhone && (phone10.length === 10 || cleanDigits.length <= 12))
      ? (phone10.length === 10 ? phone10 : cleanDigits) 
      : (cleanDigits || phone || `wa_lead_${msg.id || Date.now()}`);

    const orConditions: any[] = [];
    if (primaryPhoneKey && primaryPhoneKey !== 'cliente_wa') orConditions.push({ phone: primaryPhoneKey });
    if (phone && phone !== 'cliente_wa' && phone !== primaryPhoneKey) orConditions.push({ phone: phone });
    if (isStandardPhone) {
      orConditions.push({ phone: cleanDigits }, { phone: phone10 }, { phone: phone12 });
    }
    if (rawPhone && rawPhone !== 'cliente_wa' && rawPhone !== primaryPhoneKey && rawPhone !== phone) {
      orConditions.push({ phone: rawPhone });
    }
    if (orConditions.length === 0) {
      orConditions.push({ phone: primaryPhoneKey });
    }

    let session: any = await this.prisma.whatsAppSession.findFirst({
      where: { OR: orConditions },
      include: { assignedTo: { select: { id: true, name: true } } },
      orderBy: { lastMessageAt: 'desc' }
    });

    if (!finalCustomerName || finalCustomerName === phone || finalCustomerName === 'Cliente') {
      finalCustomerName = formattedPhone;
    }

    const previousLastMessageAt = session?.lastMessageAt || null;
    const callablePhone = (phone10.length === 10 && phone10.startsWith('3')) ? phone10 : (cleanDigits || null);

    if (!session) {
      session = await this.prisma.whatsAppSession.create({
        data: { 
          phone: primaryPhoneKey, 
          customerPhone: callablePhone,
          customerName: finalCustomerName, 
          active: true, 
          lastMessageAt: new Date() 
        },
        include: { assignedTo: { select: { id: true, name: true } } },
      });
    } else {
      const isExistingFormattedPhone = session.customerName && /^\+57\s\d{3}\s\d{3}\s\d{4}$/.test(session.customerName);
      const isExistingId = session.customerName && (session.customerName.startsWith('@') || session.customerName.startsWith('wa_lead_') || session.customerName === session.phone);
      
      let nameToSave = session.customerName;
      if (!session.customerName || isExistingId || (isExistingFormattedPhone && finalCustomerName && !finalCustomerName.startsWith('+57'))) {
        nameToSave = finalCustomerName;
      }
      
      const updateData: any = {
        lastMessageAt: new Date(),
        customerName: nameToSave,
        active: true,
      };

      // Una conversación atendida ayer vuelve disponible cuando el cliente
      // escribe en un día nuevo. Así "Míos" protege la atención del turno
      // actual, pero no deja chats antiguos amarrados a una asesora.
      if (session.assignedToId && previousLastMessageAt && previousLastMessageAt < this.getBogotaDayStart()) {
        updateData.assignedToId = null;
        updateData.waitingForAdvisor = false;
      }

      if (!session.customerPhone && callablePhone) {
        updateData.customerPhone = callablePhone;
      }
      const cleanSessionPhone = (session.phone || '').replace(/\D/g, '');
      if ((cleanSessionPhone.length >= 13 && !cleanSessionPhone.startsWith('573')) && callablePhone) {
        updateData.phone = primaryPhoneKey;
        updateData.customerPhone = callablePhone;
      }

      session = await this.prisma.whatsAppSession.update({
        where: { id: session.id },
        data: updateData,
        include: { assignedTo: { select: { id: true, name: true } } },
      });
    }

    let replyToContent: string | null = null;
    let replyToDirection: string | null = null;

    if (msg.context?.id) {
      const quotedWaId = msg.context.id;
      try {
        const quotedMsg = await this.prisma.whatsAppMessage.findFirst({
          where: {
            OR: [
              { waMessageId: quotedWaId },
              { id: quotedWaId },
            ]
          },
          select: { content: true, direction: true, messageType: true }
        });

        if (quotedMsg) {
          if (quotedMsg.messageType === 'image') {
            replyToContent = '📷 Imagen';
          } else if (quotedMsg.messageType === 'audio') {
            replyToContent = '🎤 Nota de voz';
          } else if (quotedMsg.messageType === 'document') {
            replyToContent = '📄 Documento';
          } else if (quotedMsg.messageType === 'video') {
            replyToContent = '🎥 Video';
          } else {
            replyToContent = quotedMsg.content.includes('|') 
              ? quotedMsg.content.split('|').slice(1).join('|') || quotedMsg.content 
              : quotedMsg.content;
          }
          replyToDirection = quotedMsg.direction;
        }
      } catch (err) {
        this.logger.warn('Error resolviendo mensaje citado en context:', err);
      }
    }

    const newMsg = await this.prisma.whatsAppMessage.create({
      data: {
        waMessageId: msg.id,
        sessionId: session.id,
        direction: 'IN',
        content,
        messageType: dbMessageType,
        replyToContent,
        replyToDirection,
      },
    });

    this.socketGateway.emitWhatsApp('whatsappMessage', {
      id: newMsg.id,
      waMessageId: newMsg.waMessageId,
      sessionId: session.id,
      phone,
      customerPhone: session.customerPhone,
      customerName,
      content,
      messageType: dbMessageType,
      direction: 'IN',
      status: 'received',
      assignedToId: session.assignedToId,
      assignedTo: session.assignedTo,
      createdAt: newMsg.createdAt,
      replyToContent,
      replyToDirection,
    });

    this.socketGateway.emitWhatsApp('whatsappSessionUpdated', {
      sessionId: session.id,
      customerName: session.customerName,
      customerPhone: session.customerPhone,
      lastMessageAt: session.lastMessageAt,
      assignedToId: session.assignedToId,
      assignedTo: session.assignedTo,
    });

    // La entrada se muestra primero y la IA corre fuera de la ruta del webhook.
    // La lectura de pedidos puede transcribir una nota de voz aunque el bot esté
    // pausado; esta operación nunca envía una respuesta al cliente.
    if (dbMessageType === 'text') {
      this.handleChatbot(session, content, previousLastMessageAt).catch(err => {
        this.logger.error(`Error en chatbot de texto para ${session.phone}:`, err);
      });
    } else if (dbMessageType === 'audio') {
      const mediaId = this.getMediaIdFromContent(content);
      if (mediaId) {
        this.transcribeIncomingAudio({
          session,
          messageId: newMsg.id,
          mediaId,
          content,
        }).catch(err => {
          this.logger.error(`Error transcribiendo nota de voz para ${session.phone}:`, err);
        });
      }
      this.handleMultimediaChatbot(session, dbMessageType, mediaId || content).catch(err => {
        this.logger.error(`Error en chatbot multimedia para ${session.phone}:`, err);
      });
    } else {
      this.handleMultimediaChatbot(session, dbMessageType, content).catch(err => {
        this.logger.error(`Error en chatbot multimedia para ${session.phone}:`, err);
      });
    }

    } catch (err) {
      this.logger.error(`❌ Error CRÍTICO procesando mensaje entrante de ${phone} (type: ${messageType}):`, err);
    }
  }

  private getBogotaDayStart() {
    const bogotaDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    return new Date(`${bogotaDateStr}T00:00:00.000-05:00`);
  }

  private async releasePreviousDayAssignments() {
    // Algunos entornos de prueba solo exponen las consultas de lectura.
    // Prisma real siempre implementa updateMany.
    if (typeof this.prisma.whatsAppSession.updateMany !== 'function') return;
    const result = await this.prisma.whatsAppSession.updateMany({
      where: {
        active: true,
        assignedToId: { not: null },
        lastMessageAt: { lt: this.getBogotaDayStart() },
      },
      data: { assignedToId: null, waitingForAdvisor: false },
    });

    if (result.count > 0) {
      this.socketGateway.emitWhatsApp('whatsappSessionUpdated', { previousDayAssignmentsReleased: result.count });
    }
  }

  async getSessionsStats(userId?: string) {
    await this.releasePreviousDayAssignments();
    const todayStart = this.getBogotaDayStart();
    const recentLimit = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [total, today, unreadSessions, waiting, unassigned, mine, recentIncoming, recentOutgoing] = await Promise.all([
      this.prisma.whatsAppSession.count({ where: { active: true } }),
      this.prisma.whatsAppSession.count({
        where: { active: true, lastMessageAt: { gte: todayStart } }
      }),
      this.prisma.whatsAppMessage.groupBy({
        by: ['sessionId'],
        where: { createdAt: { gte: recentLimit }, direction: 'IN', status: { not: 'read' } },
        _count: { id: true }
      }),
      this.prisma.whatsAppSession.count({
        where: { active: true, waitingForAdvisor: true }
      }),
      this.prisma.whatsAppSession.count({
        where: { active: true, assignedToId: null }
      }),
      userId ? this.prisma.whatsAppSession.count({
        where: { active: true, assignedToId: userId }
      }) : 0,
      this.prisma.whatsAppMessage.findMany({
        where: {
          direction: 'IN',
          createdAt: { gte: recentLimit }
        },
        orderBy: { createdAt: 'desc' },
        distinct: ['sessionId'],
        select: { sessionId: true, createdAt: true }
      }),
      this.prisma.whatsAppMessage.findMany({
        where: {
          direction: 'OUT',
          createdAt: { gte: recentLimit }
        },
        orderBy: { createdAt: 'desc' },
        distinct: ['sessionId'],
        select: { sessionId: true, createdAt: true }
      })
    ]);

    const outgoingMap = new Map(recentOutgoing.map(o => [o.sessionId, o.createdAt.getTime()]));
    const unansweredIds = new Set(
      recentIncoming
        .filter(inc => {
          const outTime = outgoingMap.get(inc.sessionId);
          return !outTime || inc.createdAt.getTime() > outTime;
        })
        .map(inc => inc.sessionId)
    );

    if (waiting > 0) {
      const waitingSessions = await this.prisma.whatsAppSession.findMany({
        where: { active: true, waitingForAdvisor: true },
        select: { id: true }
      });
      for (const w of waitingSessions) {
        unansweredIds.add(w.id);
      }
    }

    return {
      total,
      today,
      unread: unreadSessions.length,
      unanswered: unansweredIds.size,
      waiting,
      unassigned,
      mine
    };
  }

  async getSessions(
    search?: string, 
    fetchAll?: boolean, 
    limit?: number, 
    page?: number,
    filter?: string,
    userId?: string,
    cursor?: string,
    cursorMode?: boolean,
  ) {
    await this.releasePreviousDayAssignments();
    const cleanSearch = search?.trim() ? search.trim().toLowerCase() : '';
    const safePage = Math.max(1, page || 1);
    const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit as number) : (cleanSearch ? 100 : 60);
    const takeAmount = fetchAll ? undefined : Math.min(100, Math.max(1, requestedLimit));
    const skipAmount = (!fetchAll && !cursorMode && takeAmount && safePage > 1) ? (safePage - 1) * takeAmount : undefined;

    const andClauses: any[] = [{ active: true }];
    let matchingOrders: any[] = [];
    // When a global search finds a historical message, keep the matching
    // message so the WhatsApp-style result can show the exact context.
    const messageMatchesBySession = new Map<string, Array<{
      id: string;
      content: string;
      direction: string;
      messageType: string;
      createdAt: Date;
    }>>();

    if (cleanSearch) {
      const searchDigits = cleanSearch.replace(/\D/g, '');
      let orderPhones: string[] = [];
      let orderNames: string[] = [];

      // 1. Check if search is an order number (e.g. "23", "#23", "pedido 23", "orden 23")
      const isExplicitOrderSearch = cleanSearch.startsWith('#') || cleanSearch.includes('pedido') || cleanSearch.includes('orden') || cleanSearch.includes('factura');
      const orderSearchNum = this.parseOrderNumberFromSearch(cleanSearch);

      if (orderSearchNum !== null) {
        const bogotaDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
        const startOfToday = new Date(`${bogotaDateStr}T00:00:00.000-05:00`);
        const openShift = await this.prisma.cashClosing.findFirst({
          where: { isOpen: true },
          orderBy: { shiftStart: 'desc' },
        });
        const searchSince = (openShift?.shiftStart && (Date.now() - openShift.shiftStart.getTime()) < 24 * 60 * 60 * 1000 && openShift.shiftStart < startOfToday)
          ? openShift.shiftStart
          : startOfToday;

        // Primero buscar en los pedidos del turno/día actual
        matchingOrders = await this.prisma.order.findMany({
          where: {
            orderNumber: orderSearchNum,
            orderType: { in: ['DELIVERY', 'PICKUP'] },
            createdAt: { gte: searchSince },
          },
          select: { id: true, orderNumber: true, customerName: true, customerPhone: true, chatSessionId: true, status: true, total: true, createdAt: true },
          take: 5,
          orderBy: { createdAt: 'desc' }
        });

        // Si no hay pedidos de hoy con ese número, buscar el más reciente de los últimos 2 días
        if (matchingOrders.length === 0) {
          const recentDays = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
          matchingOrders = await this.prisma.order.findMany({
            where: {
              orderNumber: orderSearchNum,
              orderType: { in: ['DELIVERY', 'PICKUP'] },
              createdAt: { gte: recentDays },
            },
            select: { id: true, orderNumber: true, customerName: true, customerPhone: true, chatSessionId: true, status: true, total: true, createdAt: true },
            take: 1,
            orderBy: { createdAt: 'desc' }
          });
        }

        orderPhones = matchingOrders
          .map(o => o.customerPhone)
          .filter(p => !this.isDummyPhoneNumber(p));
        orderNames = matchingOrders
          .map(o => o.customerName)
          .filter(n => n && n !== 'Cliente Mostrador' && n !== 'Cliente Recoger' && n.trim().length >= 3);
      }

      // 2. Search message history for words or phrases (e.g. "pizza", "salchipapa", "nequi", "domicilio")
      let messageSessionIds: string[] = [];
      if (cleanSearch.length >= 2 && !isExplicitOrderSearch) {
        const msgMatches = await this.prisma.whatsAppMessage.findMany({
          where: { content: { contains: cleanSearch, mode: 'insensitive' } },
          select: { id: true, sessionId: true, content: true, direction: true, messageType: true, createdAt: true },
          take: 100,
          distinct: ['sessionId'],
          orderBy: { createdAt: 'desc' }
        });
        messageSessionIds = msgMatches.map(m => m.sessionId).filter(Boolean);
        for (const match of msgMatches) {
          const matches = messageMatchesBySession.get(match.sessionId) || [];
          matches.push({
            id: match.id,
            content: match.content,
            direction: match.direction,
            messageType: match.messageType,
            createdAt: match.createdAt,
          });
          messageMatchesBySession.set(match.sessionId, matches);
        }
      }

      const orSearchList: any[] = [
        { customerName: { contains: cleanSearch, mode: 'insensitive' } },
        { id: { contains: cleanSearch, mode: 'insensitive' } },
      ];
      const matchedOrderSessionIds = matchingOrders
        .map(order => order.chatSessionId)
        .filter((id): id is string => Boolean(id));
      if (matchedOrderSessionIds.length > 0) {
        orSearchList.push({ id: { in: Array.from(new Set(matchedOrderSessionIds)) } });
      }

      // Soporte para búsqueda insensible a tildes (ej. "fabian" encuentra "Fabián", "jose" encuentra "José")
      const normSearch = cleanSearch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (normSearch !== cleanSearch) {
        orSearchList.push({ customerName: { contains: normSearch, mode: 'insensitive' } });
      }
      const accentedTerm = normSearch
        .replace(/a/g, 'á')
        .replace(/e/g, 'é')
        .replace(/i/g, 'í')
        .replace(/o/g, 'ó')
        .replace(/u/g, 'ú');
      if (accentedTerm !== normSearch && accentedTerm !== cleanSearch) {
        orSearchList.push({ customerName: { contains: accentedTerm, mode: 'insensitive' } });
      }

      // Si tiene tildes en vocales individuales (ej. a->á)
      const commonAccents = [
        normSearch.replace(/a/g, 'á'),
        normSearch.replace(/e/g, 'é'),
        normSearch.replace(/i/g, 'í'),
        normSearch.replace(/o/g, 'ó'),
        normSearch.replace(/u/g, 'ú'),
      ];
      for (const ca of commonAccents) {
        if (ca !== normSearch && ca !== cleanSearch) {
          orSearchList.push({ customerName: { contains: ca, mode: 'insensitive' } });
        }
      }

      // Búsqueda profunda de teléfono por fragmentos, prefijos y formatos con espacios/guiones
      if (searchDigits.length >= 2 && !this.isDummyPhoneNumber(searchDigits)) {
        const s10 = (searchDigits.length === 12 && searchDigits.startsWith('57')) ? searchDigits.slice(2) : searchDigits;

        orSearchList.push({ phone: { contains: searchDigits } });
        orSearchList.push({ customerPhone: { contains: searchDigits } });
        orSearchList.push({ phone: { contains: '57' + s10 } });
        orSearchList.push({ customerPhone: { contains: '57' + s10 } });
        orSearchList.push({ phone: { contains: '+57' + s10 } });
        orSearchList.push({ customerPhone: { contains: '+57' + s10 } });
        orSearchList.push({ phone: { contains: '+57 ' + s10 } });
        orSearchList.push({ customerPhone: { contains: '+57 ' + s10 } });

        if (s10 !== searchDigits) {
          orSearchList.push({ phone: { contains: s10 } });
          orSearchList.push({ customerPhone: { contains: s10 } });
        }

        // Variantes con espacios y guiones (ej. "317 404", "317 404 7876", "317-404", "+57 317 404")
        if (s10.length >= 3) {
          const d3 = s10.slice(0, 3);
          const rest = s10.slice(3);
          if (rest.length > 0) {
            const spaced = `${d3} ${rest}`;
            const dashed = `${d3}-${rest}`;
            orSearchList.push({ customerName: { contains: spaced, mode: 'insensitive' } });
            orSearchList.push({ phone: { contains: spaced } });
            orSearchList.push({ customerPhone: { contains: spaced } });
            orSearchList.push({ phone: { contains: `+57 ${spaced}` } });
            orSearchList.push({ customerPhone: { contains: `+57 ${spaced}` } });
            orSearchList.push({ phone: { contains: dashed } });
            orSearchList.push({ customerPhone: { contains: dashed } });
          }

          if (s10.length >= 6) {
            const d6 = s10.slice(3, 6);
            const dEnd = s10.slice(6);
            const fullSpaced = dEnd ? `${d3} ${d6} ${dEnd}` : `${d3} ${d6}`;
            orSearchList.push({ customerName: { contains: fullSpaced, mode: 'insensitive' } });
            orSearchList.push({ phone: { contains: fullSpaced } });
            orSearchList.push({ customerPhone: { contains: fullSpaced } });
            orSearchList.push({ phone: { contains: `+57 ${fullSpaced}` } });
            orSearchList.push({ customerPhone: { contains: `+57 ${fullSpaced}` } });
          }
        }

        // Búsqueda en la tabla Customer y Order para relacionar clientes por fragmentos de teléfono
        try {
          const [matchingCustomers, matchingOrders] = await Promise.all([
            this.prisma.customer.findMany({
              where: {
                OR: [
                  { phone: { contains: s10 } },
                  { phone: { contains: searchDigits } },
                  { name: { contains: cleanSearch, mode: 'insensitive' } }
                ]
              },
              select: { phone: true, name: true },
              take: 50
            }),
            this.prisma.order.findMany({
              where: {
                OR: [
                  { customerPhone: { contains: s10 } },
                  { customerPhone: { contains: searchDigits } },
                  { customerName: { contains: cleanSearch, mode: 'insensitive' } }
                ]
              },
              select: { customerPhone: true, customerName: true },
              take: 50,
              orderBy: { createdAt: 'desc' }
            })
          ]);

          for (const mc of matchingCustomers) {
            if (mc.phone && !this.isDummyPhoneNumber(mc.phone)) {
              const cleanMc = mc.phone.replace(/\D/g, '');
              const p10 = cleanMc.length === 12 && cleanMc.startsWith('57') ? cleanMc.slice(2) : cleanMc;
              orSearchList.push({ phone: { contains: cleanMc } });
              orSearchList.push({ customerPhone: { contains: cleanMc } });
              if (p10) {
                orSearchList.push({ phone: { contains: p10 } });
                orSearchList.push({ customerPhone: { contains: p10 } });
              }
            }
            if (mc.name && mc.name.length >= 3 && mc.name !== 'Cliente Mostrador' && mc.name !== 'Cliente Recoger') {
              orSearchList.push({ customerName: { contains: mc.name, mode: 'insensitive' } });
            }
          }

          for (const mo of matchingOrders) {
            if (mo.customerPhone && !this.isDummyPhoneNumber(mo.customerPhone)) {
              const cleanMo = mo.customerPhone.replace(/\D/g, '');
              const p10 = cleanMo.length === 12 && cleanMo.startsWith('57') ? cleanMo.slice(2) : cleanMo;
              orSearchList.push({ phone: { contains: cleanMo } });
              orSearchList.push({ customerPhone: { contains: cleanMo } });
              if (p10) {
                orSearchList.push({ phone: { contains: p10 } });
                orSearchList.push({ customerPhone: { contains: p10 } });
              }
            }
            if (mo.customerName && mo.customerName.length >= 3 && mo.customerName !== 'Cliente Mostrador' && mo.customerName !== 'Cliente Recoger') {
              orSearchList.push({ customerName: { contains: mo.customerName, mode: 'insensitive' } });
            }
          }
        } catch {}
      }

      if (cleanSearch.startsWith('@')) {
        orSearchList.push({ customerName: { contains: cleanSearch, mode: 'insensitive' } });
        orSearchList.push({ phone: { contains: cleanSearch.replace(/^@/, '') } });
      }

      // Multi-word and prefix search for accent tolerance (e.g. "fabian" matches "Fabián", "maria" matches "María")
      const words = cleanSearch.split(/\s+/).filter(w => w.length >= 2 && !w.startsWith('#'));
      for (const w of words) {
        orSearchList.push({ customerName: { contains: w, mode: 'insensitive' } });
        const normW = w.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (normW !== w) {
          orSearchList.push({ customerName: { contains: normW, mode: 'insensitive' } });
        }
        if (normW.length >= 3) {
          orSearchList.push({ customerName: { contains: normW.slice(0, 3), mode: 'insensitive' } });
        }
      }

      // Add order phone matches (strictly valid phones only)
      for (const op of orderPhones) {
        if (this.isDummyPhoneNumber(op)) continue;
        const cleanOp = op.replace(/\D/g, '');
        const p10 = cleanOp.length === 12 && cleanOp.startsWith('57') ? cleanOp.slice(2) : cleanOp;
        if (p10 && !this.isDummyPhoneNumber(p10)) {
          orSearchList.push({ phone: { contains: p10 } });
          orSearchList.push({ customerPhone: { contains: p10 } });
        }
        orSearchList.push({ phone: { contains: op } });
      }

      // Add order customer names
      for (const on of orderNames) {
        if (on && on.length >= 3 && on !== 'Cliente Mostrador' && on !== 'Cliente Recoger') {
          orSearchList.push({ customerName: { contains: on, mode: 'insensitive' } });
        }
      }

      // Add message session IDs
      if (messageSessionIds.length > 0) {
        orSearchList.push({ id: { in: messageSessionIds } });
      }

      andClauses.push({ OR: orSearchList });
    }

    // Si hay búsqueda activa por texto/número, NO restringir por NINGÚN filtro de pestaña para buscar globalmente en toda la BD
    if (!cleanSearch) {
      if (filter === 'TODAY') {
        const bogotaDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
        const todayStart = new Date(`${bogotaDateStr}T00:00:00.000-05:00`);
        andClauses.push({ lastMessageAt: { gte: todayStart } });
      } else if (filter === 'MINE') {
        if (userId) {
          andClauses.push({ assignedToId: userId });
        }
      } else if (filter === 'UNASSIGNED') {
        andClauses.push({ assignedToId: null });
      } else if (filter === 'WAITING') {
        andClauses.push({ waitingForAdvisor: true });
      } else if (filter === 'UNREAD') {
        const recentLimit = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const unreadSessions = await this.prisma.whatsAppMessage.groupBy({
          by: ['sessionId'],
          where: {
            createdAt: { gte: recentLimit },
            direction: 'IN',
            status: { not: 'read' },
          },
          _count: { id: true },
        });
        const unreadIds = unreadSessions.map(u => u.sessionId);
        if (unreadIds.length > 0) {
          andClauses.push({ id: { in: unreadIds } });
        } else {
          return cursorMode ? { items: [], nextCursor: null } : [];
        }
      } else if (filter === 'UNANSWERED') {
        const recentLimit = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const [recentIncoming, recentOutgoing] = await Promise.all([
          this.prisma.whatsAppMessage.findMany({
            where: { direction: 'IN', createdAt: { gte: recentLimit } },
            orderBy: { createdAt: 'desc' },
            distinct: ['sessionId'],
            select: { sessionId: true, createdAt: true }
          }),
          this.prisma.whatsAppMessage.findMany({
            where: { direction: 'OUT', createdAt: { gte: recentLimit } },
            orderBy: { createdAt: 'desc' },
            distinct: ['sessionId'],
            select: { sessionId: true, createdAt: true }
          })
        ]);

        const outgoingMap = new Map(recentOutgoing.map(o => [o.sessionId, o.createdAt.getTime()]));
        const unansweredIds = recentIncoming
          .filter(inc => {
            const outTime = outgoingMap.get(inc.sessionId);
            return !outTime || inc.createdAt.getTime() > outTime;
          })
          .map(inc => inc.sessionId);

        andClauses.push({
          OR: [
            ...(unansweredIds.length > 0 ? [{ id: { in: unansweredIds } }] : []),
            { waitingForAdvisor: true }
          ]
        });
      }
    }

    if (cursorMode && cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        const beforeDate = new Date(decoded?.lastMessageAt);
        if (typeof decoded?.id !== 'string' || !decoded.id || decoded.id.length > 128 || Number.isNaN(beforeDate.getTime())) {
          throw new Error('invalid cursor');
        }
        andClauses.push({
          OR: [
            { lastMessageAt: { lt: beforeDate } },
            { lastMessageAt: beforeDate, id: { lt: decoded.id } },
          ],
        });
      } catch {
        throw new BadRequestException('Cursor de conversaciones inválido');
      }
    }

    const where: any = andClauses.length === 1 ? andClauses[0] : { AND: andClauses };

    const queriedSessions = await this.prisma.whatsAppSession.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      ...(takeAmount ? { take: cursorMode ? takeAmount + 1 : takeAmount } : {}),
      ...(skipAmount ? { skip: skipAmount } : {}),
    });

    const hasNextPage = Boolean(cursorMode && takeAmount && queriedSessions.length > takeAmount);
    const sessions = hasNextPage ? queriedSessions.slice(0, takeAmount) : queriedSessions;
    const cursorAnchor = sessions[sessions.length - 1];
    const nextCursor = hasNextPage && cursorAnchor
      ? Buffer.from(JSON.stringify({
          lastMessageAt: cursorAnchor.lastMessageAt.toISOString(),
          id: cursorAnchor.id,
        })).toString('base64url')
      : null;

    const sessionIds = sessions.map(s => s.id);
    const unreadCounts = sessionIds.length > 0 ? await this.prisma.whatsAppMessage.groupBy({
      by: ['sessionId'],
      where: {
        sessionId: { in: sessionIds },
        direction: 'IN',
        status: { not: 'read' },
      },
      _count: { id: true },
    }) : [];
    const unreadMap = new Map(unreadCounts.map(u => [u.sessionId, u._count.id]));

    const seen = new Set<string>();
    const deduplicatedSessions: any[] = [];

    for (const s of sessions) {
      const raw = (s.phone || '').trim();
      const cleanDigits = raw.replace(/\D/g, '');
      const isStd = (cleanDigits.length === 10 || (cleanDigits.length === 12 && cleanDigits.startsWith('57'))) && !this.isDummyPhoneNumber(cleanDigits);
      const phone10 = isStd ? (cleanDigits.length === 12 ? cleanDigits.slice(2) : cleanDigits) : null;

      const dedupKey = phone10 || s.id;
      if (!seen.has(dedupKey)) {
        seen.add(dedupKey);
        const realLastMessageAt = (s.messages && s.messages.length > 0 && s.messages[0].createdAt)
          ? s.messages[0].createdAt
          : s.lastMessageAt;
        deduplicatedSessions.push({
          ...s,
          lastMessageAt: realLastMessageAt,
          unreadCount: unreadMap.get(s.id) || 0,
          ...(cleanSearch ? { searchMatches: messageMatchesBySession.get(s.id) || [] } : {}),
        });
      }
    }

    // Attach active shift orders to sessions (reset on cash register close)
    const openCashShift = await this.prisma.cashClosing.findFirst({
      where: { isOpen: true },
      orderBy: { shiftStart: 'desc' },
    });

    let activeShiftOrders: any[] = [];
    if (openCashShift && sessionIds.length > 0) {
      const shiftStartTime = openCashShift.shiftStart || openCashShift.createdAt;
      const senderPhones = Array.from(new Set(
        deduplicatedSessions.flatMap(session => this.senderPhoneVariants(session.phone)),
      ));

      activeShiftOrders = await this.prisma.order.findMany({
        where: {
          OR: [
            { chatSessionId: { in: sessionIds } },
            ...(senderPhones.length > 0 ? [{ chatSessionId: null, customerPhone: { in: senderPhones } }] : []),
          ],
          orderType: { in: ['DELIVERY', 'PICKUP'] },
          createdAt: { gte: shiftStartTime },
          status: { notIn: ['CANCELLED', 'DELIVERED'] },
        },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          total: true,
          customerPhone: true,
          chatSessionId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    for (const session of deduplicatedSessions) {
      let match = activeShiftOrders.find(order => order.chatSessionId === session.id);

      // Compatibilidad únicamente para pedidos antiguos sin chatSessionId. La
      // identidad se compara contra el número remitente `phone`, nunca contra
      // customerPhone ni contra el nombre editable del cliente.
      if (!match) {
        const senderVariants = new Set(this.senderPhoneVariants(session.phone));
        const legacyMatches = activeShiftOrders.filter(order =>
          !order.chatSessionId && senderVariants.has(order.customerPhone),
        );
        if (legacyMatches.length === 1) match = legacyMatches[0];
      }

      session.activeOrder = match ? {
        id: match.id,
        orderNumber: match.orderNumber,
        status: match.status,
        total: match.total,
        chatSessionId: match.chatSessionId || session.id,
      } : null;

      if (!session.activeOrder && matchingOrders.length > 0) {
        const exactSearchMatch = matchingOrders.find(order => order.chatSessionId === session.id);
        if (exactSearchMatch) {
          session.activeOrder = {
            id: exactSearchMatch.id,
            orderNumber: exactSearchMatch.orderNumber,
            status: exactSearchMatch.status,
            total: exactSearchMatch.total,
            chatSessionId: session.id,
          };
        }
      }
    }

    // Ordenamiento inteligente por relevancia cuando hay búsqueda activa
    if (cleanSearch) {
      const searchDigits = cleanSearch.replace(/\D/g, '');
      const orderSearchNum = this.parseOrderNumberFromSearch(cleanSearch);

      deduplicatedSessions.sort((a, b) => {
        // Prioridad 1: Coincidencia exacta de número de pedido (ej. #23)
        const aOrderNum = a.activeOrder?.orderNumber;
        const bOrderNum = b.activeOrder?.orderNumber;
        const aExactOrder = orderSearchNum !== null && aOrderNum === orderSearchNum;
        const bExactOrder = orderSearchNum !== null && bOrderNum === orderSearchNum;
        if (aExactOrder && !bExactOrder) return -1;
        if (!aExactOrder && bExactOrder) return 1;

        // Prioridad 2: El nombre empieza por la búsqueda
        const aName = (a.customerName || '').toLowerCase();
        const bName = (b.customerName || '').toLowerCase();
        const aNameStarts = aName.startsWith(cleanSearch);
        const bNameStarts = bName.startsWith(cleanSearch);
        if (aNameStarts && !bNameStarts) return -1;
        if (!aNameStarts && bNameStarts) return 1;

        // Prioridad 3: El nombre contiene la búsqueda
        const aNameHas = aName.includes(cleanSearch);
        const bNameHas = bName.includes(cleanSearch);
        if (aNameHas && !bNameHas) return -1;
        if (!aNameHas && bNameHas) return 1;

        // Prioridad 4: El teléfono empieza por los dígitos buscados
        if (searchDigits && searchDigits.length >= 3) {
          const aPhone = (a.customerPhone || a.phone || '').replace(/\D/g, '');
          const bPhone = (b.customerPhone || b.phone || '').replace(/\D/g, '');
          const aPhoneStarts = aPhone.startsWith(searchDigits) || aPhone.startsWith('57' + searchDigits);
          const bPhoneStarts = bPhone.startsWith(searchDigits) || bPhone.startsWith('57' + searchDigits);
          if (aPhoneStarts && !bPhoneStarts) return -1;
          if (!aPhoneStarts && bPhoneStarts) return 1;
        }

        return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
      });
    }

    return cursorMode ? { items: deduplicatedSessions, nextCursor } : deduplicatedSessions;
  }

  async getSession(id: string) {
    return this.prisma.whatsAppSession.findUnique({
      where: { id },
      include: { assignedTo: { select: { id: true, name: true } } }
    });
  }

  async updateSession(id: string, data: { customerName?: string; customerPhone?: string }) {
    const session = await this.prisma.whatsAppSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Sesión no encontrada');

    let cleanPhone = data.customerPhone?.trim() || null;
    if (cleanPhone) {
      if (this.isDummyPhoneNumber(cleanPhone)) {
        cleanPhone = null;
      } else {
        const digits = cleanPhone.replace(/\D/g, '');
        cleanPhone = (digits.length === 12 && digits.startsWith('57')) ? digits.slice(2) : digits;
      }
    }

    const updated = await this.prisma.whatsAppSession.update({
      where: { id },
      data: {
        ...(data.customerName !== undefined ? { customerName: data.customerName.trim() || null } : {}),
        ...(data.customerPhone !== undefined ? { customerPhone: cleanPhone } : {}),
      },
      include: { assignedTo: { select: { id: true, name: true } } }
    });

    if (this.socketGateway) {
      this.socketGateway.emitWhatsApp('whatsappSessionUpdated', {
        sessionId: updated.id,
        customerName: updated.customerName,
        customerPhone: updated.customerPhone,
        lastMessageAt: updated.lastMessageAt,
        assignedToId: updated.assignedToId,
        assignedTo: updated.assignedTo,
      });
    }

    return updated;
  }

  async getSessionMessages(sessionId: string, before?: string, requestedLimit?: number, beforeId?: string) {
    const session = await this.prisma.whatsAppSession.findUnique({ where: { id: sessionId } });
    if (!session) return [];

    const limit = Number.isFinite(requestedLimit)
      ? Math.min(200, Math.max(20, Math.trunc(requestedLimit!)))
      : 120;
    let beforeDate: Date | undefined;
    if (before) {
      const parsed = new Date(before);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Cursor de mensajes inválido');
      if (beforeId && beforeId.length > 128) throw new BadRequestException('Cursor de mensajes inválido');
      beforeDate = parsed;
    }

    const messageCursor = beforeDate
      ? beforeId
        ? {
            OR: [
              { createdAt: { lt: beforeDate } },
              { createdAt: beforeDate, id: { lt: beforeId } },
            ],
          }
        : { createdAt: { lt: beforeDate } }
      : {};

    const messages = await this.prisma.whatsAppMessage.findMany({
      where: {
        // Una conversación se identifica por su ID. No mezclar mensajes de
        // sesiones que compartan teléfono o una variante antigua del número.
        sessionId,
        ...messageCursor,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return messages.reverse();
  }

  async deleteSession(id: string) {
    const session = await this.prisma.whatsAppSession.findUnique({ where: { id } });
    if (session) {
      await this.prisma.whatsAppMessage.deleteMany({ where: { sessionId: id } });
      try {
        await this.prisma.whatsAppSession.delete({ where: { id } });
      } catch (err) {
        await this.prisma.whatsAppSession.update({
          where: { id },
          data: {
            customerName: null,
            waitingForAdvisor: false,
            active: false,
            lastMessageAt: new Date(0),
          }
        });
      }
      if (this.socketGateway) {
        this.socketGateway.emitWhatsApp('chatSessionDeleted', { sessionId: id });
      }
    }
    return { ok: true, message: 'Chat e historial eliminados completamente' };
  }

  async deleteMessage(id: string, mode: string = 'for_me') {
    const msg = await this.prisma.whatsAppMessage.findUnique({
      where: { id },
      include: { session: true },
    });
    if (!msg) return { ok: true };

    if (mode === 'for_everyone') {
      if (msg.waMessageId && !msg.waMessageId.startsWith('out-')) {
        try {
          const token = await this.getSetting('whatsapp_token');
          const phoneId = await this.getSetting('whatsapp_phone_id');
          if (token && phoneId) {
            const metaRes = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                status: 'deleted',
                message_id: msg.waMessageId,
              }),
            });
            const metaData = await metaRes.json();
            this.logger.log(`Meta delete response for ${msg.waMessageId}: ${JSON.stringify(metaData)}`);
          }
        } catch (err) {
          this.logger.error(`Error revocando mensaje ${msg.waMessageId} en Meta:`, err);
        }
      }

      const updated = await this.prisma.whatsAppMessage.update({
        where: { id },
        data: {
          content: '🚫 Este mensaje fue eliminado',
          status: 'deleted',
        },
      });

      if (this.socketGateway) {
        this.socketGateway.emitWhatsApp('chatMessageEdited', {
          messageId: id,
          sessionId: msg.sessionId,
          content: '🚫 Este mensaje fue eliminado',
          status: 'deleted',
          isDeletedForEveryone: true,
        });
      }
      return { ok: true, mode: 'for_everyone', message: updated };
    } else {
      await this.prisma.whatsAppMessage.delete({ where: { id } });
      if (this.socketGateway) {
        this.socketGateway.emitWhatsApp('chatMessageDeleted', {
          messageId: id,
          sessionId: msg.sessionId,
          mode: 'for_me',
        });
      }
      return { ok: true, mode: 'for_me' };
    }
  }

  async editMessage(id: string, content: string) {
    const msg = await this.prisma.whatsAppMessage.findUnique({
      where: { id },
      include: { session: true },
    });
    if (!msg) throw new NotFoundException('Mensaje no encontrado');

    if (msg.waMessageId && !msg.waMessageId.startsWith('out-') && msg.session?.phone) {
      try {
        const token = await this.getSetting('whatsapp_token');
        const phoneId = await this.getSetting('whatsapp_phone_id');
        if (token && phoneId) {
          const rawPhone = (msg.session?.phone || '').replace(/\D/g, '');
          const formattedPhone = rawPhone.length === 10 ? `57${rawPhone}` : rawPhone;
          const metaRes = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: formattedPhone,
              type: 'text',
              text: { body: content },
              message_id: msg.waMessageId,
            }),
          });
          const metaData = await metaRes.json();
          this.logger.log(`Meta edit response for ${msg.waMessageId}: ${JSON.stringify(metaData)}`);
        }
      } catch (err) {
        this.logger.error(`Error editando mensaje ${msg.waMessageId} en Meta:`, err);
      }
    }

    const updated = await this.prisma.whatsAppMessage.update({
      where: { id },
      data: {
        content,
        isEdited: true,
      },
    });

    if (this.socketGateway) {
      this.socketGateway.emitWhatsApp('chatMessageEdited', {
        messageId: id,
        sessionId: msg.sessionId,
        content,
        isEdited: true,
      });
    }
    return updated;
  }

  async markSessionMessagesAsRead(sessionId: string, force = false) {
    const session = await this.prisma.whatsAppSession.findUnique({ where: { id: sessionId } });
    if (!session) return;

    // REGLA SOLICITADA POR EL USUARIO:
    // Un chat no se puede marcar como leído hasta que la última respuesta sea de un asesor o administrador.
    // Si el último mensaje fue enviado por el cliente ('IN'), debe continuar apareciendo como NO LEÍDO
    // aunque un asesor abra el chat para leerlo, evitando que se olvide responderlo.
    if (!force) {
      const lastMessage = await this.prisma.whatsAppMessage.findFirst({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
      });
      if (!lastMessage || lastMessage.direction === 'IN') {
        return;
      }
    }

    // Capturar únicamente los mensajes que realmente están pendientes antes de
    // actualizar la BD. Así no reenviamos a Meta todo el historial cada vez que
    // una asesora abre la conversación.
    const unreadMessages = await this.prisma.whatsAppMessage.findMany({
      where: {
        sessionId,
        direction: 'IN',
        status: { not: 'read' },
        waMessageId: { not: null },
      },
      select: { id: true, waMessageId: true },
    });

    // 1. Marcar todos los mensajes entrantes pendientes como leídos en la BD
    await this.prisma.whatsAppMessage.updateMany({
      where: {
        sessionId,
        direction: 'IN',
        status: { not: 'read' },
      },
      data: { status: 'read' },
    });

    // El contador de la bandeja representa conversaciones con mensajes sin leer.
    // Calcularlo aquí permite que todas las asesoras actualicen la misma cifra por
    // WebSocket sin tener que recargar las 400+ conversaciones de la bandeja.
    const recentLimit = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const unreadSessions = await this.prisma.whatsAppMessage.groupBy({
      by: ['sessionId'],
      where: {
        createdAt: { gte: recentLimit },
        direction: 'IN',
        status: { not: 'read' },
      },
      _count: { id: true },
    });

    // 2. Emitir actualización a los clientes por WebSockets
    this.socketGateway.emitWhatsApp('whatsappSessionUpdated', {
      id: sessionId,
      sessionId,
      unreadCount: 0,
      totalUnread: unreadSessions.length,
    });

    // 3. Notificar a Meta WhatsApp Graph API en segundo plano (Fire-and-forget asíncrono sin bloquear la interfaz)
    (async () => {
      try {
        const phoneId = await this.getSetting('whatsapp_phone_id');
        const token = await this.getSetting('whatsapp_token');
        if (!phoneId || !token) return;

        for (const msg of unreadMessages) {
          try {
            await fetch(`https://graph.facebook.com/v26.0/${phoneId}/messages`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: msg.waMessageId,
              }),
            });
          } catch (err) {
            this.logger.error(`Error al marcar mensaje ${msg.id} como leído en Meta API`, err);
          }
        }
      } catch (err) {
        this.logger.error(`Error en marcado asíncrono en Meta`, err);
      }
    })();
  }

  async getMediaUrl(mediaId: string): Promise<string | null> {
    const token = await this.getSetting('whatsapp_token');
    if (!token) return null;
    try {
      const res = await fetch(`https://graph.facebook.com/v26.0/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.url || null;
    } catch (err) {
      this.logger.error('Error obteniendo URL de media', err);
      return null;
    }
  }

  async getMediaBuffer(mediaId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const now = Date.now();
    const cached = this.mediaCache.get(mediaId);
    if (cached && cached.expiresAt > now) {
      cached.lastUsed = now;
      return { buffer: cached.buffer, contentType: cached.contentType };
    }
    if (cached) {
      this.mediaCache.delete(mediaId);
      this.mediaCacheBytes -= cached.bytes;
    }

    const pending = this.mediaRequests.get(mediaId);
    if (pending) return pending;

    const request = (async () => {
      const token = await this.getSetting('whatsapp_token');
      if (!token) return null;
      const url = await this.getMediaUrl(mediaId);
      if (!url) return null;

      try {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) {
          this.logger.error(`Error descargando media de Meta. HTTP Status: ${response.status}`);
          return null;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
        const entry: CachedMedia = {
          buffer,
          contentType,
          bytes: buffer.length,
          lastUsed: Date.now(),
          expiresAt: Date.now() + this.mediaCacheTtlMs,
        };
        this.mediaCache.set(mediaId, entry);
        this.mediaCacheBytes += entry.bytes;
        this.pruneMediaCache();
        return { buffer, contentType };
      } catch (err) {
        this.logger.error('Error descargando buffer de media', err);
        return null;
      }
    })().finally(() => this.mediaRequests.delete(mediaId));

    this.mediaRequests.set(mediaId, request);
    return request;
  }

  private pruneMediaCache() {
    const now = Date.now();
    for (const [key, entry] of this.mediaCache.entries()) {
      if (entry.expiresAt <= now) {
        this.mediaCache.delete(key);
        this.mediaCacheBytes -= entry.bytes;
      }
    }

    if (this.mediaCache.size <= this.maxMediaCacheItems && this.mediaCacheBytes <= this.maxMediaCacheBytes) return;
    const oldest = [...this.mediaCache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key, entry] of oldest) {
      if (this.mediaCache.size <= this.maxMediaCacheItems && this.mediaCacheBytes <= this.maxMediaCacheBytes) break;
      this.mediaCache.delete(key);
      this.mediaCacheBytes -= entry.bytes;
    }
  }

  async assignSession(
    sessionId: string,
    userId: string | null,
    actor?: { id: string; name?: string; role: string },
  ) {
    if (!sessionId || sessionId === 'undefined' || sessionId === 'null') {
      throw new BadRequestException('ID de sesión inválido');
    }
    let session = await this.prisma.whatsAppSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      const raw = sessionId.trim();
      const cleanDigits = raw.replace(/\D/g, '');
      const phone10 = cleanDigits.length === 12 && cleanDigits.startsWith('57') ? cleanDigits.slice(2) : cleanDigits;
      session = await this.prisma.whatsAppSession.findFirst({
        where: {
          OR: [
            { phone: raw },
            ...(cleanDigits ? [{ phone: cleanDigits }] : []),
            ...(phone10 ? [{ phone: phone10 }] : []),
          ]
        },
        orderBy: { lastMessageAt: 'desc' },
      });
      if (session) {
        sessionId = session.id;
      }
    }
    if (!session) throw new NotFoundException('Conversación no encontrada');

    const isSupervisor = !actor || ['ADMIN', 'SUPERADMIN'].includes(actor.role);
    if (actor && userId && userId !== actor.id && !isSupervisor) {
      throw new ForbiddenException('No puedes asignar esta conversación a otra persona');
    }

    if (userId) {
      const target = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, active: true },
      });
      if (!target?.active) throw new BadRequestException('La asesora seleccionada no está activa');

      // Las asesoras y el personal de domicilios solo pueden tomar un chat
      // libre o uno que ya les pertenece. Solo ADMIN/SUPERADMIN puede reasignar
      // una conversación atendida por otra persona.
      const canTakeOver = isSupervisor;
      if (canTakeOver) {
        await this.prisma.whatsAppSession.update({
          where: { id: sessionId },
          data: { assignedToId: userId, waitingForAdvisor: false },
        });
      } else {
        const claimed = await this.prisma.whatsAppSession.updateMany({
          where: {
            id: sessionId,
            OR: [{ assignedToId: null }, { assignedToId: userId }],
          },
          data: { assignedToId: userId, waitingForAdvisor: false },
        });
        if (claimed.count === 0) {
          const owner = await this.prisma.whatsAppSession.findUnique({
            where: { id: sessionId },
            include: { assignedTo: { select: { id: true, name: true } } },
          });
          throw new ConflictException(
            owner?.assignedTo?.name
              ? `Esta conversación ya fue tomada por ${owner.assignedTo.name}`
              : 'Esta conversación ya fue tomada por otra asesora',
          );
        }
      }
    } else if (actor && !isSupervisor && actor.role !== 'DELIVERY_MANAGER') {
      const released = await this.prisma.whatsAppSession.updateMany({
        where: {
          id: sessionId,
          OR: [{ assignedToId: actor.id }, { assignedToId: null }],
        },
        data: { assignedToId: null },
      });
      if (released.count === 0) {
        throw new ConflictException('No puedes liberar una conversación atendida por otra asesora');
      }
    } else {
      await this.prisma.whatsAppSession.update({
        where: { id: sessionId },
        data: { assignedToId: null },
      });
    }

    const updated = await this.prisma.whatsAppSession.update({
      where: { id: sessionId },
      data: { waitingForAdvisor: false },
      include: { assignedTo: { select: { id: true, name: true } } },
    });

    this.socketGateway.emitWhatsApp('chatSessionAssigned', {
      id: sessionId,
      sessionId,
      phone: updated.phone,
      assignedToId: userId,
      assignedTo: updated.assignedTo,
      waitingForAdvisor: false,
    });

    this.socketGateway.emitWhatsApp('whatsappSessionUpdated', {
      id: sessionId,
      sessionId,
      phone: updated.phone,
      assignedToId: userId,
      assignedTo: updated.assignedTo,
      waitingForAdvisor: false,
    });

    return updated;
  }

  async unassignAllSessions(userId?: string) {
    const where: any = { active: true, assignedToId: { not: null } };
    if (userId) {
      where.assignedToId = userId;
    }
    const result = await this.prisma.whatsAppSession.updateMany({
      where,
      data: { assignedToId: null }
    });

    this.socketGateway.emitWhatsApp('whatsappSessionUpdated', { unassignedAll: true });
    return { count: result.count };
  }

  async unassignSessionByPhone(phone: string) {
    if (!phone) return;
    try {
      const cleanDigits = phone.replace(/\D/g, '');
      const phone10 = cleanDigits.length === 12 && cleanDigits.startsWith('57') ? cleanDigits.slice(2) : cleanDigits;
      
      const orList: any[] = [{ id: phone }, { phone: phone }];
      if (cleanDigits) {
        orList.push({ phone: cleanDigits }, { customerPhone: cleanDigits });
      }
      if (phone10) {
        orList.push({ phone: phone10 }, { phone: `57${phone10}` }, { phone: `+57${phone10}` });
        orList.push({ customerPhone: phone10 }, { customerPhone: `57${phone10}` }, { customerPhone: `+57${phone10}` });
      }

      const sessions = await this.prisma.whatsAppSession.findMany({
        where: {
          OR: orList,
          assignedToId: { not: null },
        },
        include: { assignedTo: { select: { id: true, name: true } } },
      });

      for (const session of sessions) {
        await this.assignSession(session.id, null);
        this.logger.log(`[unassignSessionByPhone] Chat ${session.id} (${session.phone}) liberado automáticamente tras despacho`);
      }
    } catch (err) {
      this.logger.error(`[unassignSessionByPhone] Error liberando sesión para teléfono ${phone}:`, err);
    }
  }

  async sendDirectToSession(sessionId: string, text: string) {
    if (!sessionId || !text) return { sent: false };
    const session = await this.prisma.whatsAppSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return { sent: false };

    const phoneId = await this.getSetting('whatsapp_phone_id');
    const token = await this.getSetting('whatsapp_token');
    if (!phoneId || !token) {
      this.logger.warn('WhatsApp API no configurada');
      return { sent: false, reason: 'not_configured' };
    }

    const { recipientPhone, lastInWaId, isId } = await this.resolveActiveRecipient(session, session.phone);
    const formattedPhone = this.formatRecipient(recipientPhone);
    const recipientObj = this.buildMetaRecipient(formattedPhone);
    const metaPayload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...recipientObj,
      type: 'text',
      text: { body: text },
    };

    if (isId || recipientObj.recipient || formattedPhone.length >= 13 || formattedPhone.startsWith('CO.')) {
      if (lastInWaId) {
        metaPayload.context = { message_id: lastInWaId };
      }
    }

    try {
      let res = await fetch(`https://graph.facebook.com/v26.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metaPayload),
      });
      let ok = res.ok;
      let data = await res.json();

      if (!ok && (data?.error?.code === 131047 || data?.error?.code === 131026 || data?.error?.code === 470)) {
        this.logger.warn(`Ventana de 24h cerrada para ${formattedPhone}. Enviando plantilla de reactivación automática...`);
        const tmplResult = await this.sendTemplate(formattedPhone, 'actualizacion_sistema_niche', 'es_CO', []);
        if (tmplResult.sent) {
          return { sent: true, data: tmplResult.data };
        }
      }

      if (ok) {
        await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: { lastMessageAt: new Date(), active: true },
        });

        const newMsg = await this.prisma.whatsAppMessage.create({
          data: {
            waMessageId: data.messages?.[0]?.id || `out-${Date.now()}`,
            sessionId: session.id,
            direction: 'OUT',
            content: text,
            messageType: 'text',
            status: 'sent',
          },
        });

        this.socketGateway.emitWhatsApp('whatsappMessage', {
          id: newMsg.id,
          waMessageId: newMsg.waMessageId,
          sessionId: session.id,
          phone: session.phone,
          customerPhone: session.customerPhone,
          customerName: session.customerName || session.phone,
          content: text,
          messageType: 'text',
          direction: 'OUT',
          status: 'sent',
          assignedTo: session.assignedToId,
          createdAt: newMsg.createdAt,
        });

        await this.markSessionMessagesAsRead(session.id, true);
        return { sent: true, messageId: newMsg.id };
      }
      return { sent: false, error: data?.error };
    } catch (err) {
      this.logger.error('Error enviando mensaje directo a sesion WhatsApp', err);
      return { sent: false, reason: 'api_error' };
    }
  }

  async sendMessage(phone: string, text: string, replyToWaMessageId?: string, replyToContent?: string, sessionId?: string) {
    const phoneId = await this.getSetting('whatsapp_phone_id');
    const token = await this.getSetting('whatsapp_token');
    if (!phoneId || !token) {
      this.logger.warn('WhatsApp API no configurada');
      return { sent: false, reason: 'not_configured' };
    }

    const cleanInput = (phone || '').replace(/\D/g, '');
    if (cleanInput === '3000000000' || cleanInput === '0000000000' || /^0+$/.test(cleanInput) || (!phone.startsWith('@') && !phone.startsWith('CO.') && cleanInput.length < 7)) {
      return { sent: false, reason: 'dummy_phone' };
    }

    const targetSession = sessionId
      ? await this.prisma.whatsAppSession.findUnique({ where: { id: sessionId }, include: { assignedTo: { select: { id: true, name: true } } } })
      : await this.resolveSessionForDispatch(phone);

    const { recipientPhone, lastInWaId, isId } = await this.resolveActiveRecipient(targetSession, phone);
    const formattedPhone = this.formatRecipient(recipientPhone);

    // Build Meta API payload with optional reply context
    const recipientObj = this.buildMetaRecipient(formattedPhone);
    const metaPayload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...recipientObj,
      type: 'text',
      text: { body: text },
    };
    if (replyToWaMessageId) {
      metaPayload.context = { message_id: replyToWaMessageId };
    } else if (isId || recipientObj.recipient || formattedPhone.length >= 13 || formattedPhone.startsWith('CO.')) {
      if (lastInWaId) {
        metaPayload.context = { message_id: lastInWaId };
      }
    }

    let persistedMessage: any = null;
    try {
      let res = await fetch(`https://graph.facebook.com/v26.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metaPayload),
      });
      let ok = res.ok;
      let data = await res.json();

      // Fallback Inteligente: Si el mensaje falla por ventana de 24h cerrada (código #131047, #131026 o #470)
      if (!ok && (data?.error?.code === 131047 || data?.error?.code === 131026 || data?.error?.code === 470)) {
        this.logger.warn(`Ventana de 24h cerrada para ${formattedPhone}. Enviando plantilla de reactivación automática...`);
        const tmplResult = await this.sendTemplate(formattedPhone, 'actualizacion_sistema_niche', 'es_CO', []);
        if (tmplResult.sent) {
          return { sent: true, data: tmplResult.data };
        }
      }

      if (ok) {
        const session = targetSession || await this.findOrCreateSession(formattedPhone);
        await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: { lastMessageAt: new Date(), active: true },
        });

        // Determine replyToDirection from DB if we have a replyToWaMessageId
        let replyToDirection: string | null = null;
        if (replyToWaMessageId) {
          const repliedMsg = await this.prisma.whatsAppMessage.findFirst({
            where: { waMessageId: replyToWaMessageId },
            select: { direction: true },
          });
          replyToDirection = repliedMsg?.direction || null;
        }

        const newMsg = await this.prisma.whatsAppMessage.create({
          data: {
            waMessageId: data.messages?.[0]?.id || `out-${Date.now()}`,
            sessionId: session.id,
            direction: 'OUT',
            content: text,
            messageType: 'text',
            status: 'sent',
            ...(replyToContent ? { replyToContent } : {}),
            ...(replyToDirection ? { replyToDirection } : {}),
          },
        });

        persistedMessage = {
          id: newMsg.id,
          waMessageId: newMsg.waMessageId,
          sessionId: session.id,
          phone: session.phone,
          customerPhone: session.customerPhone,
          customerName: session.customerName || session.phone,
          content: text,
          messageType: 'text',
          direction: 'OUT',
          status: newMsg.status || 'sent',
          assignedTo: session.assignedToId,
          createdAt: newMsg.createdAt,
          replyToContent: replyToContent || null,
          replyToDirection: replyToDirection || null,
        };
        this.socketGateway.emitWhatsApp('whatsappMessage', persistedMessage);
        await this.markSessionMessagesAsRead(session.id, true);
      }

      return { sent: ok, data, message: persistedMessage };
    } catch (err) {
      this.logger.error('Error enviando WhatsApp', err);
      return { sent: false, reason: 'api_error' };
    }
  }

  async sendLocation(phone: string, latitude: number, longitude: number, name?: string, address?: string) {
    const phoneId = await this.getSetting('whatsapp_phone_id');
    const token = await this.getSetting('whatsapp_token');
    if (!phoneId || !token) {
      this.logger.warn('WhatsApp API no configurada');
      return { sent: false, reason: 'not_configured' };
    }

    const targetSession = await this.resolveSessionForDispatch(phone);
    const resolvedRecipient = this.getBestRecipientPhone(targetSession, phone);
    const formattedPhone = this.formatRecipient(resolvedRecipient);

    try {
      const recipientObj = this.buildMetaRecipient(formattedPhone);
      const res = await fetch(`https://graph.facebook.com/v26.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          ...recipientObj,
          type: 'location',
          location: {
            latitude,
            longitude,
            name: name || '',
            address: address || '',
          },
        }),
      });

      const ok = res.ok;
      const data = await res.json();

      if (ok) {
        const session = targetSession || await this.findOrCreateSession(formattedPhone);
        await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: { lastMessageAt: new Date(), active: true },
        });

        const locationText = `📍 Ubicación compartida: https://maps.google.com/?q=${latitude},${longitude}${name ? ` - ${name}` : ''}`;

        const newMsg = await this.prisma.whatsAppMessage.create({
          data: {
            waMessageId: data.messages?.[0]?.id || `out-loc-${Date.now()}`,
            sessionId: session.id,
            direction: 'OUT',
            content: locationText,
            messageType: 'location',
            status: 'sent',
          },
        });

        this.socketGateway.emitWhatsApp('whatsappMessage', {
          id: newMsg.id,
          waMessageId: newMsg.waMessageId,
          sessionId: session.id,
          phone: session.phone,
          customerPhone: session.customerPhone,
          customerName: session.customerName || session.phone,
          content: locationText,
          messageType: 'location',
          direction: 'OUT',
          status: 'sent',
          assignedTo: session.assignedToId,
          createdAt: newMsg.createdAt,
        });
        await this.markSessionMessagesAsRead(session.id, true);
      }

      return { sent: ok, data };
    } catch (err) {
      this.logger.error('Error enviando ubicación WhatsApp', err);
      return { sent: false, reason: 'api_error' };
    }
  }

  async sendTemplate(
    phone: string,
    templateName: string,
    languageCode: string = 'es_CO',
    params: string[] = [],
  ) {
    const phoneId = await this.getSetting('whatsapp_phone_id');
    const token = await this.getSetting('whatsapp_token');
    if (!phoneId || !token) {
      this.logger.warn('WhatsApp API no configurada');
      return { sent: false, reason: 'not_configured' };
    }

    const targetSession = await this.resolveSessionForDispatch(phone);
    const resolvedRecipient = this.getBestRecipientPhone(targetSession, phone);
    const formattedPhone = this.formatRecipient(resolvedRecipient);

    const executeSend = async (currentParams: string[], currentLang: string) => {
      const components: any[] = [];
      if (currentParams && currentParams.length > 0) {
        components.push({
          type: 'body',
          parameters: currentParams.map((val) => ({ type: 'text', text: val })),
        });
      }

      const recipientObj = this.buildMetaRecipient(formattedPhone);
      const res = await fetch(`https://graph.facebook.com/v26.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          ...recipientObj,
          type: 'template',
          template: {
            name: templateName,
            language: { code: currentLang },
            ...(components.length > 0 ? { components } : {}),
          },
        }),
      });
      const ok = res.ok;
      const data = await res.json();
      return { ok, data };
    };

    try {
      let { ok, data } = await executeSend(params, languageCode);

      // Smart Fallback 1: Error #132001 (Language code mismatch: e.g. es_CO vs es vs es_LA vs es_EC)
      if (!ok && data?.error?.code === 132001) {
        const langCandidates = ['es_CO', 'es', 'es_LA', 'es_EC', 'es_ES'].filter(l => l !== languageCode);
        for (const candidateLang of langCandidates) {
          this.logger.warn(`Retrying template ${templateName} with candidate lang: ${candidateLang}`);
          const retry = await executeSend(params, candidateLang);
          if (retry.ok) {
            ok = true;
            data = retry.data;
            break;
          }
          if (retry.data?.error?.code !== 132001) {
            data = retry.data;
            break;
          }
        }
      }

      // Smart Fallback 2: Error #132000 (Parameter mismatch)
      if (!ok && data?.error?.code === 132000) {
        const fallbackParams = params.length > 0 ? [] : ['Cliente'];
        this.logger.warn(`Retrying template ${templateName} with fallback params: ${JSON.stringify(fallbackParams)}`);
        
        // Try fallback params across language codes if needed
        const langCandidatesToTry = [languageCode, 'es_CO', 'es', 'es_LA', 'es_EC'].filter((item, index, self) => self.indexOf(item) === index);
        for (const langCandidate of langCandidatesToTry) {
          const fallbackResult = await executeSend(fallbackParams, langCandidate);
          if (fallbackResult.ok) {
            ok = true;
            data = fallbackResult.data;
            break;
          }
        }
      }

      if (ok) {
        const session = targetSession || await this.findOrCreateSession(formattedPhone);
        await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: { lastMessageAt: new Date(), active: true },
        });

        const fullTemplateText = `¡Actualización de Pedidos The Villa Dog!

¡Hola, The Villa Dog manía!

Hemos actualizado nuestro sistema de pedidos por WhatsApp. 📲

Si tienes alguna dificultad para realizar tu pedido, elimina nuestro número de WhatsApp y agrégalo nuevamente a tus contactos.

¡Y listo! Podrás pedir tu domicilio con normalidad.

Gracias por elegirnos y seguir siendo parte de nuestra The Villa Dog manía.

The Villa Dog • Montería`;

        const knownTemplatesText: Record<string, string> = {
          'niche_aviso_servicio': fullTemplateText,
          'actualizacion_sistema_niche': fullTemplateText,
          'notificacion_atencion_niche': `📢 ¡Hola! Queremos confirmar la recepción de tu mensaje. En un momento un asesor de The Villa Dog te atenderá.`,
          'niche_prueba': fullTemplateText,
        };

        const templateSummary = knownTemplatesText[templateName] || `📢 Plantilla Meta: ${templateName}`;
        const newMsg = await this.prisma.whatsAppMessage.create({
          data: {
            waMessageId: data.messages?.[0]?.id || `out-${Date.now()}`,
            sessionId: session.id,
            direction: 'OUT',
            content: templateSummary,
            messageType: 'template',
            status: 'sent',
          },
        });

        this.socketGateway.emitWhatsApp('whatsappMessage', {
          id: newMsg.id,
          waMessageId: newMsg.waMessageId,
          sessionId: session.id,
          phone: session.phone,
          customerName: session.customerName || session.phone,
          content: templateSummary,
          messageType: 'template',
          direction: 'OUT',
          status: 'sent',
          assignedTo: session.assignedToId,
          createdAt: newMsg.createdAt,
        });

        this.socketGateway.emitWhatsApp('whatsappSessionUpdated', {
          id: session.id,
          sessionId: session.id,
          phone: session.phone,
          lastMessageAt: session.lastMessageAt,
          lastMessageText: templateSummary,
        });
        await this.markSessionMessagesAsRead(session.id, true);
      }

      return { sent: ok, data };
    } catch (err) {
      this.logger.error('Error enviando plantilla WhatsApp', err);
      return { sent: false, reason: 'api_error' };
    }
  }

  async sendMediaMessage(
    phone: string,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    type: 'image' | 'audio' | 'document' | 'video',
    caption?: string,
  ) {
    const phoneId = await this.getSetting('whatsapp_phone_id');
    const token = await this.getSetting('whatsapp_token');
    if (!phoneId || !token) {
      this.logger.warn('WhatsApp API no configurada');
      return { sent: false, reason: 'not_configured' };
    }

    const targetSession = await this.resolveSessionForDispatch(phone);
    const { recipientPhone, lastInWaId, isId } = await this.resolveActiveRecipient(targetSession, phone);
    const formattedPhone = this.formatRecipient(recipientPhone);

    let persistedMessage: any = null;
    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
      formData.append('file', blob, fileName);
      formData.append('type', mimeType);
      formData.append('messaging_product', 'whatsapp');

      const uploadRes = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/media`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!uploadRes.ok) {
        const errData = await uploadRes.json();
        this.logger.error('Error subiendo archivo a Meta', errData);
        return { sent: false, reason: errData?.error?.message || 'meta_upload_error' };
      }

      const uploadData = await uploadRes.json();
      const mediaId = uploadData.id;
      if (!mediaId) {
        return { sent: false, reason: 'no_media_id_returned' };
      }

      const recipientObj = this.buildMetaRecipient(formattedPhone);
      const sendBody: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        ...recipientObj,
        type: type,
      };

      if (isId || recipientObj.recipient || formattedPhone.length >= 13 || formattedPhone.startsWith('CO.')) {
        if (lastInWaId) {
          sendBody.context = { message_id: lastInWaId };
        }
      }

      if (type === 'image') {
        sendBody.image = { id: mediaId, ...(caption ? { caption } : {}) };
      } else if (type === 'audio') {
        sendBody.audio = { id: mediaId };
      } else {
        sendBody.document = { id: mediaId, filename: fileName, ...(caption ? { caption } : {}) };
      }

      const sendRes = await fetch(`https://graph.facebook.com/v26.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sendBody),
      });

      const sendOk = sendRes.ok;
      const sendData = await sendRes.json();

      if (sendOk) {
        const session = targetSession || await this.findOrCreateSession(formattedPhone);
        await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: { lastMessageAt: new Date(), active: true },
        });

        const msgContent = caption ? `${mediaId}|${caption}` : mediaId;

        const newMsg = await this.prisma.whatsAppMessage.create({
          data: {
            waMessageId: sendData.messages?.[0]?.id || `out-${Date.now()}`,
            sessionId: session.id,
            direction: 'OUT',
            content: msgContent,
            messageType: type,
            status: 'sent',
          },
        });

        persistedMessage = {
          id: newMsg.id,
          waMessageId: newMsg.waMessageId,
          sessionId: session.id,
          phone: session.phone,
          customerPhone: session.customerPhone,
          customerName: session.customerName || session.phone,
          content: msgContent,
          messageType: type,
          direction: 'OUT',
          status: newMsg.status || 'sent',
          assignedTo: session.assignedToId,
          createdAt: newMsg.createdAt,
        };
        this.socketGateway.emitWhatsApp('whatsappMessage', persistedMessage);
        await this.markSessionMessagesAsRead(session.id, true);
      }

      return { sent: sendOk, data: sendData, message: persistedMessage };
    } catch (err) {
      this.logger.error('Error enviando WhatsApp multimedia', err);
      return { sent: false, reason: 'api_error' };
    }
  }

  private formatClosedBusinessMessage(message: string, hours: string): string {
    const [opening = '', closing = ''] = String(hours || '').split('-').map(part => part.trim());
    const fallback = `¡Hola! En este momento estamos cerrados. Volvemos a atender desde las ${opening || 'hora habitual'}.`;
    return (String(message || '').trim() || fallback)
      .replace(/\{\{?\s*(?:abre|apertura)\s*\}?\}/gi, opening || 'hora habitual')
      .replace(/\{\{?\s*(?:cierra|cierre)\s*\}?\}/gi, closing || '')
      .replace(/\{\{?\s*horario\s*\}?\}/gi, hours || 'horario habitual')
      .trim();
  }

  private async getClosedBusinessReply(): Promise<string | null> {
    const [outOfServiceEnabled, businessHoursEnabled, outOfServiceMessage, restaurantHours] = await Promise.all([
      this.getSetting('out_of_service_enabled'),
      this.getSetting('business_hours_enabled'),
      this.getSetting('out_of_service_message'),
      this.getSetting('restaurant_hours'),
    ]);
    const hours = restaurantHours || '12:00 - 23:00';
    if (outOfServiceEnabled === 'true') return this.formatClosedBusinessMessage(outOfServiceMessage || '', hours);
    if (businessHoursEnabled === 'true' && !this.checkIfWithinBusinessHours(hours)) {
      return this.formatClosedBusinessMessage(outOfServiceMessage || '', hours);
    }
    return null;
  }

  private async handleChatbot(session: any, userText: string, previousLastMessageAt?: Date | null) {
    try {
      // El cierre programado es una respuesta operativa, independiente de la
      // IA. Por eso sigue funcionando aunque el bot conversacional esté pausado.
      const closedReply = await this.getClosedBusinessReply();
      if (closedReply) {
        await this.sendMessage(session.phone, closedReply);
        return;
      }

      // Verificar si el chatbot está habilitado en los ajustes
      const chatbotEnabled = await this.getSetting('chatbot_enabled');
      if (chatbotEnabled !== 'true') {
        this.logger.log(`Chatbot desactivado/pausado (${chatbotEnabled}), ignorando mensaje de ${session.phone}`);
        return;
      }

      // Si la sesión ya está asignada a un usuario humano, no hacemos auto-respuesta ni la desasignamos
      if (session.assignedToId) {
        this.logger.log(`Sesión ${session.phone} asignada a ${session.assignedToId}, chatbot no responde`);
        return;
      }

      // Si la sesión estuvo inactiva por más de 15 minutos en estado de espera del chatbot (sin asesor), reiniciamos
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const lastActivity = previousLastMessageAt ? new Date(previousLastMessageAt) : new Date(0);
      if (session.waitingForAdvisor && (!previousLastMessageAt || lastActivity < fifteenMinutesAgo)) {
        this.logger.log(`Sesión ${session.phone} inactiva por más de 15 minutos. Reiniciando estado de espera.`);
        session = await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: {
            waitingForAdvisor: false,
          },
          include: { assignedTo: { select: { id: true, name: true } } },
        });
        
        // Notificar al frontend vía socket
        this.socketGateway.emitWhatsApp('chatSessionAssigned', {
          sessionId: session.id,
          assignedToId: session.assignedToId,
          assignedTo: session.assignedTo,
          waitingForAdvisor: false,
        });
      }

      const normalized = userText.trim().toLowerCase();

      // Si el usuario escribe explícitamente "bot", "salir" o "reiniciar" para reactivar el chatbot
      if (session.waitingForAdvisor && (normalized === 'bot' || normalized === 'salir' || normalized === 'reiniciar' || normalized === 'menu' || normalized === 'menú')) {
        this.logger.log(`Usuario solicitó reactivar el chatbot. Liberando estado de espera.`);
        session = await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: { waitingForAdvisor: false },
        });

        // Notificar al frontend vía socket
        this.socketGateway.emitWhatsApp('chatSessionAssigned', {
          sessionId: session.id,
          assignedToId: session.assignedToId,
          waitingForAdvisor: false,
        });
      } else if (session.waitingForAdvisor) {
        this.logger.log(`Sesión ${session.phone} está en espera de un asesor. Chatbot permanece en silencio.`);
        return;
      }

      const rawApiKeys = await this.getSetting('gemini_api_key');
      if (!rawApiKeys) {
        this.logger.log(`API Key de Gemini no configurada. Usando chatbot de contingencia basado en reglas.`);
        return this.handleRuleBasedChatbot(session, userText, previousLastMessageAt);
      }
      
      const apiKeys = rawApiKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);

      await this.handleGeminiChatbot(session, userText, apiKeys);

    } catch (error) {
      this.logger.error(`Error en ruteador de chatbot para ${session.phone}:`, error);
      // Fallback en caso de cualquier error en el ruteo o Gemini
      try {
        await this.handleRuleBasedChatbot(session, userText, previousLastMessageAt);
      } catch (fbErr) {
        this.logger.error(`Error en chatbot de contingencia para ${session.phone}:`, fbErr);
      }
    }
  }

  private buildGeminiAssistantPrompt(context: {
    customInstructionsBlock: string;
    recentOrdersSummary: string;
    menuSummary: string;
    restaurantHours: string | null;
    zonesSummary: string;
    menuGeneralRule: string;
    dynamicCategoriesString: string;
    menuCategoryRule: string;
    menuFollowupRule: string;
    session: { customerName?: string | null };
    paymentInstruction: string;
    conversationPrompt: string;
  }): string {
    const {
      customInstructionsBlock, recentOrdersSummary, menuSummary, restaurantHours,
      zonesSummary, menuGeneralRule, dynamicCategoriesString, menuCategoryRule,
      menuFollowupRule, session, paymentInstruction, conversationPrompt,
    } = context;
    return `
Eres la persona encargada de atender de forma directa el WhatsApp del restaurante "The Villa Dog" en Montería, Colombia. Habla con un tono humano, cercano, natural y muy sencillo. Evita a toda costa sonar como un robot, una máquina de soporte técnico o un asistente de inteligencia artificial genérico. Habla como un asesor amable del restaurante.
${customInstructionsBlock}

PAUTAS DE ESTILO OBLIGATORIAS:
- TEXTO CORTO Y DIRECTO: Mantén tus respuestas en un máximo de 1 o 2 párrafos muy breves. Al cliente no le gusta leer bloques de texto largos. (EXCEPCIÓN: Cuando el cliente pida los precios de una categoría de comida, SÍ puedes y DEBES enviar la lista completa de todos los productos y precios de esa categoría en el chat).
- CERO EMOJIS: NUNCA USES EMOJIS. Responde únicamente con texto plano y puntuación estándar. Absolutamente PROHIBIDO enviar emojis. No uses caritas ni símbolos, solo texto normal.
- NATURALIDAD: Responde con frases frescas y sencillas (ej: "Hola, ¿cómo estás?", "¡Hola! Claro que sí, con gusto", "¡Excelente elección!").
- ATENCIÓN A PEDIDOS PREVIOS O CANCELADOS: Si el cliente pregunta qué tenía su pedido anterior o pide repetir un pedido cancelado o anterior, REVISA el Historial de Pedidos Recientes de este cliente detallado abajo y respóndele exactamente con la lista de productos y cantidades de ese pedido.

Historial de Pedidos Recientes de este Cliente:
${recentOrdersSummary}

Menú del restaurante:
${menuSummary}

Horario configurado por el restaurante:
${restaurantHours || 'Horario por confirmar con un asesor.'}

Cobertura y tarifas de domicilios según el barrio en Montería:
${zonesSummary}

    Reglas críticas de interacción:
    1. SI EL CLIENTE PIDE "EL MENÚ" O "LA CARTA" EN GENERAL:
       ${menuGeneralRule}
       Responde con un formato claro y organizado, usando líneas separadas por categoría.

${dynamicCategoriesString}

¿Te gustaría que te detalle los precios de alguna categoría en específico o ya sabes qué quieres pedir? ¡Dime y lo armamos de una!

    2. SI EL CLIENTE PIDE VER UNA CATEGORÍA COMPLETA (Pizzas, Perros, Hamburguesas, Salchipapas, Suizos, Asados, Patacones, Bebidas):
       ${menuCategoryRule}

    3. SI EL CLIENTE PREGUNTA QUÉ LE RECOMIENDAS O PIDE SUGERENCIA DEL MENÚ:
       ¡ABSOLUTAMENTE PROHIBIDO ENVIAR TEXTO DE CORRIDO NI LA LISTA COMPLETA DE CATEGORÍAS! DEBES presentar 2 o 3 opciones estrellas organizadas OBLIGATORIAMENTE EN PUNTOS DESGLOSADOS (BULLET POINTS) CON LÍNEAS SEPARADAS.
       Formato obligatorio:
       "¡Hola! Claro que sí, con mucho gusto te sugiero nuestras especialidades más recomendadas:

- Salchipapa Especial: Porción súper generosa con carnes seleccionadas y abundante queso fundido.
- Pizza de la Casa: Masa artesanal horneada con el toque crujiente perfecto e ingredientes frescos.
- Suizo Gratinado: ¡El preferido de la casa que nunca falla!

¿Cuál de estos se te antoja probar hoy?"

    4. REGLA FUNDAMENTAL DE CERO REPETICIÓN DEL MENÚ DIGITAL:
       ${menuFollowupRule} (ej: "¿Qué ingredientes trae el suizo?", "Y con papas a la francesa?", "¿Cuántos gramos trae?", "¿Tienen Coca Cola?")
       - En todas las preguntas de aclaración, ingredientes, gramos o seguimiento, RESPONDE ÚNICAMENTE LA RESPUESTA DIRECTA A LA INQUIETUD DEL CLIENTE DE FORMA CORDIAL Y CORTA. NO agregues el enlace del menú digital al final de cada mensaje.

    5. TIEMPO DE ESPERA, TARIFAS Y TOTALES:
       - NUNCA inventes ni calcules por tu cuenta un tiempo, una tarifa de domicilio o el total final del pedido.
       - No tienes una estimación validada de cocina ni transporte. Si el cliente pregunta por demora, indica que un asesor la confirmará.
       - Los precios solo pueden salir del menú vigente incluido arriba.
       - La tarifa solo puede mencionarse cuando el barrio coincide claramente con una zona oficial. El total definitivo lo confirma el sistema o un asesor.

    5A. BEBIDAS Y PRESENTACIONES:
       - Usa únicamente el nombre exacto de las bebidas del menú vigente. No cambies una marca, sabor, tamaño o empaque por otro parecido.
       - Si el cliente dice solo “gaseosa”, “jugo”, “agua”, “manzana” o una marca con varias presentaciones, pregunta cuál presentación quiere antes de resumirla como producto confirmado.
       - Las bebidas cuyo nombre incluya “vidrio” NO se ofrecen ni se confirman para domicilio. Si el cliente quiere domicilio y pide una de vidrio, indícale brevemente que debe elegir otra presentación. Solo se permiten para recoger o consumir en el restaurante.
       - Si cambia una bebida, confirma la última elección y no mantengas en el resumen la bebida anterior.

    5B. RESUMEN DEL PEDIDO:
       - Agrupa cantidades iguales como “Perro Sencillo x2”; no enumeres el mismo producto dos veces si tienen la misma preparación.
       - Conserva las notas de preparación por producto, como “sin salsa”, “sin cebolla” o “con más queso”. No confundas estas notas con otro producto.
       - Si dos unidades llevan preparaciones distintas, distingue claramente cuál nota corresponde a cada una.

    6. MANEJO DE DATOS Y TOMAR PEDIDOS (REGLAS DE ORO):
       - NOMBRE DEL CLIENTE: El nombre registrado de la persona es "${session.customerName || 'No especificado aún'}". Si ya conoces su nombre (por ejemplo, "${session.customerName || ''}" o si viene en el texto como "Nombre: Juan Martinez"), ESTÁ ABSOLUTAMENTE PROHIBIDO VOLVER A PREGUNTAR SU NOMBRE. Llámalo por su nombre directamente (ej: "¡Hola Juan!").
       - CUENTAS DE TRANSFERENCIA: ${paymentInstruction}
       - PREGUNTA ÚNICA: No pidas los datos uno por uno. Después de conocer productos y tipo de entrega, solicita EN UN SOLO MENSAJE todos los datos que falten.
       - PEDIDO PARA PASAR A RECOGER (PICKUP): Nunca preguntes barrio ni dirección. Pide únicamente el método de pago si todavía falta.
       - PEDIDO A DOMICILIO: La dirección exacta y el método de pago son necesarios. El barrio es opcional: úsalo si el cliente lo informa, pero NUNCA bloquees ni retrases el pedido por no tenerlo. Ejemplo: "Listo. Envíame en un solo mensaje tu dirección exacta y si pagas en efectivo o transferencia; si conoces el barrio también puedes indicarlo."
       - Si el cliente ya entregó uno o dos datos, pregunta solamente por todos los que falten, juntos y en una respuesta corta.
       - TARIFA DE DOMICILIO - REGLA CRÍTICA ABSOLUTA: La lista de barrios y tarifas que tienes disponible arriba es la lista OFICIAL. Si el barrio del cliente NO APARECE en esa lista oficial, o si no tiene precio asignado, ESTÁ ABSOLUTAMENTE PROHIBIDO DECIR QUE EL DOMICILIO ES "GRATIS", "$0" O INVENTAR UN VALOR. Jamás digas que un domicilio es gratis. En esos casos, DEBES responder exactamente: "Perfecto. El valor del domicilio a tu barrio será verificado y confirmado directamente por nuestro asesor al procesar tu pedido." e incluir [TRANSFERIR_ASESOR].

    7. FINALIZACIÓN Y TRANSFERENCIA:
       Si el cliente ya entregó los productos y todos los datos necesarios (o si recoge y ya dio el método de pago), responde que un asesor revisará y confirmará el resumen e incluye [TRANSFERIR_ASESOR]. Nunca afirmes que el pedido ya fue creado porque se crea desde el panel.

Historial de la conversación reciente:
${conversationPrompt}

Restaurante (Tú):
`;
  }

  private async handleGeminiChatbot(session: any, userText: string, apiKeys: string[]) {
    try {
      const cleanPhone = (session.phone.startsWith('57') && session.phone.length === 12)
        ? session.phone.substring(2)
        : session.phone;
      const [
        history,
        dbItems,
        dbZones,
        recentCustomerOrders,
        configuredMenuUrl,
        restaurantHours,
        aiInstructions,
        paymentQrMode,
        paymentAccountText,
      ] = await Promise.all([
        this.prisma.whatsAppMessage.findMany({
          where: { sessionId: session.id },
          orderBy: { createdAt: 'desc' },
          take: 16,
        }),
        this.prisma.menuItem.findMany({
          where: { active: true },
          include: { category: { select: { name: true } } },
          orderBy: [{ category: { name: 'asc' } }, { price: 'asc' }],
        }),
        this.prisma.deliveryZone.findMany({
          where: { active: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.order.findMany({
          where: { customerPhone: { contains: cleanPhone } },
          include: { items: { include: { menuItem: true } } },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        this.getSetting('digital_menu_url'),
        this.getSetting('restaurant_hours'),
        this.getSetting('chatbot_ai_instructions'),
        this.getSetting('chatbot_payment_qr_mode'),
        this.getSetting('chatbot_payment_account_text'),
      ]);
      const messagesChronological = history.reverse();
      
      const itemsByCategory: Record<string, string[]> = {};
      dbItems.forEach(i => {
        const catName = i.category?.name || 'General';
        if (!itemsByCategory[catName]) itemsByCategory[catName] = [];
        const desc = i.description ? ` (${i.description})` : '';
        itemsByCategory[catName].push(`- ${i.name}: $${i.price.toLocaleString('de-DE')}${desc}`);
      });

      const menuSummary = Object.entries(itemsByCategory)
        .map(([cat, items]) => `*${cat.toUpperCase()}*\n${items.join('\n')}`)
        .join('\n\n');

      // Consolidar categorías limpias dinámicamente desde la BD (evitando sub-variaciones como c/ papas, gratinadas, etc.)
      const cleanCatSet = new Set<string>();
      Object.keys(itemsByCategory).forEach(rawCat => {
        let cleaned = rawCat
          .replace(/\s+c\/.*/i, '')           // Remueve "c/ Papas al Vapor", "c/ Papas Francesas"
          .replace(/\s+(Familiar|Junior|Personal|Especialidades|Clásicas|Gratinadas|Gratinados|Rellenos)$/i, '')
          .replace(/\s+para\s+Pizza.*/i, '')
          .trim();
        if (cleaned) cleanCatSet.add(cleaned);
      });

      const dynamicCategoriesString = Array.from(cleanCatSet)
        .sort((a, b) => a.localeCompare(b, 'es'))
        .map(c => `- *${c}*`)
        .join('\n');

      const zonesSummary = dbZones.map(z => `- ${z.name}: $${z.rate.toLocaleString('de-DE')}`).join('\n');

      let recentOrdersSummary = 'No hay pedidos previos registrados para este cliente.';
      if (recentCustomerOrders.length > 0) {
        recentOrdersSummary = recentCustomerOrders.map(o => {
          const itemsList = ((o as any).items || []).map((i: any) => `${i.quantity}x ${i.menuItem?.name || 'Producto'}${i.notes ? ` (${i.notes})` : ''}`).join(', ');
          const statusText = o.status === 'CANCELLED' ? 'CANCELADO' : o.status === 'DELIVERED' ? 'ENTREGADO' : o.status;
          return `- Pedido #${o.orderNumber} (${statusText}) - Total: $${o.total.toLocaleString('de-DE')}: ${itemsList || 'Sin detalles'}`;
        }).join('\n');
      }

        const displayMenuUrl = this.getShareableDigitalMenuUrl(configuredMenuUrl);
        const menuGeneralRule = displayMenuUrl
          ? `Muestra la lista limpia de categorías principales y al final incluye el enlace digital: ${displayMenuUrl}.`
          : 'Muestra la lista limpia de categorías principales en el chat. Todavía no hay un enlace público configurado; no inventes ni incluyas ninguna URL.';
        const menuCategoryRule = displayMenuUrl
          ? `Muestra la lista de platos con sus precios correspondientes a esa categoría. Al final puedes incluir la carta digital: ${displayMenuUrl}.`
          : 'Muestra la lista de platos con sus precios correspondientes a esa categoría. No incluyas enlaces hasta que administración configure el dominio público.';
        const menuFollowupRule = displayMenuUrl
          ? `- PROHIBIDO REPETIR EL ENLACE AL MENÚ DIGITAL ("${displayMenuUrl}") en preguntas de seguimiento o dudas específicas.`
          : '- No inventes enlaces ni menciones una carta digital que todavía no tiene dominio configurado.';
        const paymentInstruction = paymentQrMode === 'IMAGE'
          ? 'El cobro por transferencia se comparte mediante el QR oficial. No inventes números de cuenta; indica que el asesor enviará el QR cuando corresponda.'
          : paymentAccountText
            ? `Los únicos datos oficiales para transferencias son:\n${paymentAccountText}`
            : 'No hay datos de transferencia configurados. No inventes cuentas ni teléfonos; transfiere la conversación a un asesor para confirmar el pago.';
        const customInstructionsBlock = aiInstructions?.trim()
          ? `\nINSTRUCCIONES ADICIONALES CONFIGURADAS POR ADMINISTRACIÓN:\n${aiInstructions.trim()}\n`
          : '';

        const conversationPrompt = messagesChronological.map(m => {
          const rawContent = String(m.content || '').trim();
          const content = rawContent.length > 1200
            ? `${rawContent.slice(0, 500)}\n[Mensaje extenso ya enviado]`
            : rawContent;
          return `${m.direction === 'IN' ? 'Cliente' : 'Restaurante (Tú)'}: ${content}`;
        }).join('\n');

        const systemPrompt = this.buildGeminiAssistantPrompt({
          customInstructionsBlock, recentOrdersSummary, menuSummary, restaurantHours,
          zonesSummary, menuGeneralRule, dynamicCategoriesString, menuCategoryRule,
          menuFollowupRule, session, paymentInstruction, conversationPrompt,
        });

      let lastError: any = null;
      let data: any = null;
      const modelsToTry = await this.getGeminiModels();

      for (const key of this.getGeminiKeyCandidates(apiKeys)) {
        if (this.isGeminiKeyOnCooldown(key)) continue;
        for (const model of modelsToTry) {
          if (this.isGeminiKeyOnCooldown(key)) break;
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
          const payload = {
            contents: [{
              parts: [{ text: systemPrompt }]
            }],
            // Gemini 3.8 no longer accepts temperature. Low thinking keeps
            // the live chat fast while preserving the model's validation.
            generationConfig: this.buildGeminiGenerationConfig(model, {
              temperature: 0.3,
              maxOutputTokens: 600,
            }),
          };
          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(7000)
            });

            if (!response.ok) {
              if (response.status === 429 || response.status === 403) {
                await this.putGeminiKeyOnCooldown(key, response);
                lastError = new Error(`Gemini no puede usar temporalmente la llave ...${key.slice(-4)}`);
                break;
              }
              throw new Error(`Gemini API returned status ${response.status}`);
            }
            const candidateData: any = await response.json();
            const candidateReply = String(candidateData?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
            if (!this.isMeaningfulGeminiReply(candidateReply)) {
              lastError = new Error('Gemini no devolvió texto para este mensaje');
              continue;
            }
            data = candidateData;
            await this.incrementGeminiUsage();
            break;
          } catch (e: any) {
            const safeError = this.sanitizeGeminiError(e, apiKeys);
            this.logger.warn(`Error con modelo ${model} y API key (...${key.slice(-4)}): ${safeError}. Probando siguiente opción...`);
            lastError = e;
          }
        }
        if (data) break;
      }

      if (!data) {
        throw lastError || new Error('Todas las API keys de Gemini fallaron (429 u otro error)');
      }

      let replyText = (data as any).candidates?.[0]?.content?.parts?.[0]?.text;
      if (!replyText) {
        throw new Error('Empty response from Gemini');
      }

      replyText = replyText.trim();

      let shouldTransfer = replyText.includes('[TRANSFERIR_ASESOR]');
      let cleanReply = replyText.replace('[TRANSFERIR_ASESOR]', '').trim();

      const explicitNeighborhood = this.extractExplicitNeighborhood([userText]);
      if (explicitNeighborhood) {
        const normalizedNeighborhood = this.normalizeSpanishLookup(explicitNeighborhood);
        const configuredZone = dbZones.find(zone => this.normalizeSpanishLookup(zone.name) === normalizedNeighborhood);
        if (!configuredZone) {
          cleanReply = 'Perfecto. El valor del domicilio a tu barrio será verificado y confirmado directamente por nuestro asesor al procesar tu pedido.';
          shouldTransfer = true;
        }
      }

      const normalizedIncoming = this.normalizeSpanishLookup(
        messagesChronological
          .filter(message => message.direction === 'IN')
          .map(message => message.content)
          .join(' '),
      );
      const mentionedZone = [...dbZones]
        .sort((left, right) => right.name.length - left.name.length)
        .find(zone => {
          const normalizedZone = this.normalizeSpanishLookup(zone.name);
          return normalizedZone.length >= 3 && ` ${normalizedIncoming} `.includes(` ${normalizedZone} `);
        });
      const tariffClaim = cleanReply.match(
        /(?:\b(?:valor|tarifa|costo)\s+(?:del\s+)?domicilio\b|\bdomicilio\s+(?:cuesta|vale|tiene un valor de)\b)[^0-9$]{0,80}\$?\s*([\d][\d.,]*)/i,
      );
      const claimedTariff = tariffClaim?.[1] ? this.parseColombianAmount(tariffClaim[1]) : null;
      const invalidTariff = Boolean(tariffClaim) && (
        !mentionedZone || claimedTariff === null || claimedTariff !== Number(mentionedZone.rate)
      );
      const claimsUnverifiedTotal = /\btotal(?:\s+(?:final|a pagar|del pedido))?\b[^0-9$]{0,50}\$?\s*[\d]/i.test(cleanReply);
      const claimsUnverifiedTime = /\b(?:tarda|demora|tiempo estimado|llega(?:r[ií]a)?)\b[^0-9]{0,40}\d+\s*(?:minutos?|mins?|horas?)/i.test(cleanReply);
      const claimsFreeDelivery = /\bdomicilio\b[^.!?\n]{0,50}\bgratis\b|\bgratis\b[^.!?\n]{0,50}\bdomicilio\b/i.test(cleanReply);

      if (invalidTariff || claimsUnverifiedTotal || claimsUnverifiedTime || claimsFreeDelivery) {
        cleanReply = 'Gracias. Un asesor verificará la tarifa, el tiempo y el total antes de confirmar tu pedido.';
        shouldTransfer = true;
      }

      if (!this.isMeaningfulGeminiReply(cleanReply)) {
        cleanReply = 'Gracias. Un asesor revisará los datos de tu pedido y te confirmará el resumen.';
        shouldTransfer = true;
      }

      if (cleanReply) {
        await this.sendMessage(session.phone, cleanReply);
      }

      if (shouldTransfer) {
        this.logger.log(`Gemini solicitó transferir cliente ${session.phone} a un asesor.`);
        await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: { waitingForAdvisor: true },
        });

        this.socketGateway.emitWhatsApp('whatsappAgentRequest', {
          sessionId: session.id,
          phone: session.phone,
          customerName: session.customerName,
          waitingForAdvisor: true,
        });
      }

    } catch (err) {
      this.logger.error(`Error en handleGeminiChatbot para ${session.phone}, reintentando contingencia:`, err);
      throw err; // Propagar para que handleChatbot ejecute la contingencia tradicional
    }
  }

  private async handleRuleBasedChatbot(session: any, userText: string, previousLastMessageAt?: Date | null) {
    try {
      // Verificar si el chatbot está habilitado en los ajustes
      const chatbotEnabled = await this.getSetting('chatbot_enabled');
      if (chatbotEnabled !== 'true') {
        this.logger.log(`Chatbot desactivado o sin configurar, ignorando mensaje de ${session.phone}`);
        return;
      }

      // Si la sesión ya está asignada a un usuario humano, no hacemos auto-respuesta ni la desasignamos
      if (session.assignedToId) {
        this.logger.log(`Sesión ${session.phone} asignada a ${session.assignedToId}, chatbot no responde`);
        return;
      }

      // Si la sesión estuvo inactiva por más de 15 minutos en estado de espera del chatbot (sin asesor), reiniciamos
      const inactivityThreshold = new Date(Date.now() - 15 * 60 * 1000);
      const lastActivity = previousLastMessageAt ? new Date(previousLastMessageAt) : new Date(0);
      if (session.waitingForAdvisor && (!previousLastMessageAt || lastActivity < inactivityThreshold)) {
        this.logger.log(`Sesión ${session.phone} inactiva por más de 15 minutos. Reiniciando estado de espera.`);
        session = await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: {
            waitingForAdvisor: false,
          },
          include: { assignedTo: { select: { id: true, name: true } } },
        });
        
        // Notificar al frontend vía socket
        this.socketGateway.emitWhatsApp('chatSessionAssigned', {
          sessionId: session.id,
          assignedToId: session.assignedToId,
          assignedTo: session.assignedTo,
          waitingForAdvisor: false,
        });
      }

      const normalized = userText.trim().toLowerCase();

      // Si el usuario escribe explícitamente "bot", "salir" o "reiniciar" para reactivar el chatbot
      if (session.waitingForAdvisor && (normalized === 'bot' || normalized === 'salir' || normalized === 'reiniciar' || normalized === 'menu' || normalized === 'menú')) {
        this.logger.log(`Usuario solicitó reactivar el chatbot. Liberando estado de espera.`);
        session = await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: { waitingForAdvisor: false },
        });

        // Notificar al frontend vía socket
        this.socketGateway.emitWhatsApp('chatSessionAssigned', {
          sessionId: session.id,
          assignedToId: session.assignedToId,
          waitingForAdvisor: false,
        });
      } else if (session.waitingForAdvisor) {
        this.logger.log(`Sesión ${session.phone} está en espera de un asesor. Chatbot permanece en silencio.`);
        return;
      }

      this.logger.log(`Chatbot procesando mensaje de ${session.phone}: "${normalized}"`);

      // 1. Verificar si el cliente tiene un pedido activo/en curso
      const cleanPhone = (session.phone || '').replace(/\D/g, '').slice(-10);
      const activeOrder = await this.prisma.order.findFirst({
        where: {
          customerPhone: { contains: cleanPhone },
          status: { in: ['PENDING', 'READY', 'IN_ROUTE'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (activeOrder) {
        const orderStatusMap: Record<string, string> = {
          PENDING: 'En espera / Preparando ',
          READY: 'Listo en cocina ',
          IN_ROUTE: 'En camino con el domiciliario ',
        };
        const statusText = orderStatusMap[activeOrder.status] || activeOrder.status;

        if (normalized === '5') {
          const modifyText = 
            `Entendido. Por favor escribe a continuación detalladamente los cambios que deseas realizar en tu pedido *#${activeOrder.orderNumber}* (por ejemplo: "quiero agregar una porción de papas" o "cambiar gaseosa por jugo").\n\n` +
            `Uno de nuestros asesores tomará tu solicitud de inmediato y actualizará tu pedido. ¡Gracias! �`;
          await this.sendMessage(session.phone, modifyText);

          await this.prisma.whatsAppSession.update({
            where: { id: session.id },
            data: { waitingForAdvisor: true },
          });

          this.socketGateway.emitWhatsApp('whatsappAgentRequest', {
            sessionId: session.id,
            phone: session.phone,
            customerName: session.customerName,
            waitingForAdvisor: true,
          });
          return;
        }

        if (normalized === '6') {
          const advisorText = 
            `De acuerdo. En un momento uno de nuestros asesores tomará tu chat personalmente para ayudarte con tu pedido *#${activeOrder.orderNumber}*. ¡Gracias por tu paciencia! �`;
          await this.sendMessage(session.phone, advisorText);

          await this.prisma.whatsAppSession.update({
            where: { id: session.id },
            data: { waitingForAdvisor: true },
          });

          this.socketGateway.emitWhatsApp('whatsappAgentRequest', {
            sessionId: session.id,
            phone: session.phone,
            customerName: session.customerName,
            waitingForAdvisor: true,
          });
          return;
        }

        if (normalized === '7') {
          const cancelRequestText = 
            `Entendido. Para solicitar la cancelación de tu pedido *#${activeOrder.orderNumber}*, por favor indícanos brevemente el motivo de la cancelación.\n\n` +
            `Un asesor revisará tu solicitud de inmediato y te confirmará la cancelación. ⚠`;
          await this.sendMessage(session.phone, cancelRequestText);

          await this.prisma.whatsAppSession.update({
            where: { id: session.id },
            data: { waitingForAdvisor: true },
          });

          this.socketGateway.emitWhatsApp('whatsappAgentRequest', {
            sessionId: session.id,
            phone: session.phone,
            customerName: session.customerName,
            waitingForAdvisor: true,
          });
          return;
        }

        // Si es un saludo normal o cualquier otro texto, le mostramos el menú de pedido en curso
        const greetingsList = ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'buen', 'hello', 'hi', 'menu', 'menú', 'carta', 'pedido'];
        const wordsList = normalized.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?¿¡]/g, "").split(/\s+/);
        const isGreetingText = greetingsList.some(g => {
          if (g.includes(' ')) {
            const escaped = g.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(`\\b${escaped}\\b`, 'i');
            return regex.test(normalized);
          }
          return wordsList.includes(g);
        });

        if (isGreetingText || normalized === 'inicio' || normalized === 'volver' || normalized === '0') {
          const orderMenuText = 
            `¡Hola! Vemos que actualmente tienes un pedido activo en curso:\n` +
            `• *Pedido:* #${activeOrder.orderNumber}\n` +
            `• *Estado:* ${statusText}\n\n` +
            `En un momento uno de nuestros asesores tomará tu chat personalmente. Si deseas consultar o cambiar algo de tu pedido, déjanos tu mensaje aquí y lo atenderemos de inmediato. ¡Muchas gracias! 😊`;
          await this.sendMessage(session.phone, orderMenuText);
          await this.prisma.whatsAppSession.update({
            where: { id: session.id },
            data: { waitingForAdvisor: true },
          });
          this.socketGateway.emitWhatsApp('whatsappAgentRequest', {
            sessionId: session.id,
            phone: session.phone,
            customerName: session.customerName,
            waitingForAdvisor: true,
          });
          return;
        }
        
        // Si escribe algo directamente, notificamos al asesor y le respondemos confirmación neutral
        const directChangesText = 
          `He recibido tu mensaje respecto a tu pedido *#${activeOrder.orderNumber}*:\n\n` +
          `_"${userText}"_\n\n` +
          `He notificado a los asesores de inmediato para ayudarte personalmente. ¡Muchas gracias! �`;
        await this.sendMessage(session.phone, directChangesText);

        await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: { waitingForAdvisor: true },
        });

        this.socketGateway.emitWhatsApp('whatsappAgentRequest', {
          sessionId: session.id,
          phone: session.phone,
          customerName: session.customerName,
          waitingForAdvisor: true,
        });
        return;
      }
      
      // Detectar si el cliente está pidiendo la carta o menú
      const menuKeywords = ['carta', 'menu', 'menú', 'catalogo', 'catálogo', 'opciones', 'precios', 'variedad', 'sabores'];
      const isAskingForMenu = menuKeywords.some(kw => normalized.includes(kw));

      // Detectar si el mensaje del cliente parece un pedido de comida
      const foodKeywords = [
        'hamburguesa', 'perro', 'salchipapa', 'patacon', 'patacón',
        'arepa', 'combo', 'porcion', 'porción', 'papas', 'gaseosa', 'jugo',
        'pollo', 'carne', 'queso', 'jamon', 'jamón', 'tocineta', 'chorizo',
        'super', 'súper', 'niche', 'personal', 'familiar', 'mediana',
        'semifamiliar', 'mixto', 'mixta', 'especial', 'sencilla', 'sencillo',
        'quiero', 'dame', 'pido', 'pideme', 'manda', 'envía', 'envia',
        'nombre:', 'dirección:', 'direccion:', 'barrio:', 'pedido:',
        'bebida', 'malteada', 'limonada', 'agua'
      ];
      const looksLikeOrder = (foodKeywords.some(kw => normalized.includes(kw)) || normalized.includes('pizza')) && !isAskingForMenu;

      // Detectar si el mensaje es una pregunta sobre la ubicación/dirección física del restaurante
      const locationKeywords = [
        'ubicacion', 'ubicación', 'ubicados', 'dónde están', 'donde estan', 'dónde queda', 'donde queda', 
        'donde se ubican', 'dónde se ubican', 'dirección del local', 'direccion del local'
      ];
      
      // Si el cliente escribe su propia dirección en una plantilla, no es una pregunta de ubicación
      const hasAddressPattern = /nombre:/i.test(normalized) || /direcci[oó]n:\s*\S+/i.test(normalized) || /\b(calle|carrera|clle|cra|cl|cr|diag|diagonal|trans|transversal|ave|avenida|barrio|mza|mz)\b/i.test(normalized);
      const isLocationQuery = locationKeywords.some(kw => normalized.includes(kw)) && !hasAddressPattern && !looksLikeOrder;

      // Si es un saludo o la primera interacción
      const greetings = ['hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'buen', 'hello', 'hi', 'oe', 'quiubo', 'menu', 'menú', 'carta', 'pedir', 'comprar', 'ordenar', 'pedido'];
      const words = normalized.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?¿¡]/g, "").split(/\s+/);
      const isGreeting = greetings.some(g => {
        if (g.includes(' ')) {
          const escaped = g.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`\\b${escaped}\\b`, 'i');
          return regex.test(normalized);
        }
        return words.includes(g);
      });

      if (isLocationQuery) {
        const locationText = 
          `📍 *Ubicación y Domicilios - The Villa Dog:*\n\n` +
          `Despachamos pedidos directamente a tu dirección en toda la ciudad. 🛵🔥\n\n` +
          `Compártenos tu barrio y dirección para cotizar tu envío y tomar tu pedido. Con gusto te atendemos.`;
        await this.sendMessage(session.phone, locationText);
        return;
      }

      // Verificar si la sesión expiró (30 min sin mensajes entrantes)
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const lastInbound = previousLastMessageAt || new Date(0);
      const isSessionExpired = lastInbound < thirtyMinutesAgo;

      // Menú principal: saludos simples, sesión expirada, o comandos de navegación
      const isSimpleGreeting = isGreeting && normalized.length < 20 && !looksLikeOrder && !isLocationQuery && !isAskingForMenu;

      if (isSimpleGreeting || isSessionExpired || normalized === 'inicio' || normalized === 'volver' || normalized === '0') {
        this.logger.log(`Enviando bienvenida a ${session.phone} (greeting=${isGreeting}, expired=${isSessionExpired})`);
        const configuredMenuUrl = await this.getSetting('digital_menu_url');
        const digitalMenuUrl = this.getShareableDigitalMenuUrl(configuredMenuUrl);
        let menuLinkText = '';
        if (digitalMenuUrl) {
          const cleanedPhone = (session.phone.startsWith('57') && session.phone.length === 12) ? session.phone.substring(2) : session.phone;
          const hasPhoneAsName = session.customerName && /^\d+$/.test(session.customerName.replace(/\D/g, ''));
          const nameParam = (session.customerName && !hasPhoneAsName) ? `&name=${encodeURIComponent(session.customerName)}` : '';
          const separator = digitalMenuUrl.includes('?') ? '&' : '?';
          const fullMenuUrl = `${digitalMenuUrl}${separator}phone=${cleanedPhone}${nameParam}`;
          const displayUrl = fullMenuUrl.replace(/^https?:\/\//i, '');
          menuLinkText = `\n\nPuedes ver nuestra carta digital interactiva aquí:\n👉 ${displayUrl}`;
        }
        const welcomeText = 
          `¡Hola! Te damos la bienvenida a *The Villa Dog* 🌭🔥\n\n` +
          `Con gusto te atendemos. Cuéntanos qué te gustaría pedir o en qué podemos ayudarte.${menuLinkText}`;
        await this.sendMessage(session.phone, welcomeText);
        return;
      }

      if (normalized === '1' || isAskingForMenu) {
        // Generar lista de categorías activas
        const activeCategories = await this.getMessagingMenuCategories();
        
        const configuredMenuUrl = await this.getSetting('digital_menu_url');
        const digitalMenuUrl = this.getShareableDigitalMenuUrl(configuredMenuUrl);
        let fullMenuUrl = digitalMenuUrl;
        if (digitalMenuUrl) {
          const cleanedPhone = (session.phone.startsWith('57') && session.phone.length === 12) ? session.phone.substring(2) : session.phone;
          const hasPhoneAsName = session.customerName && /^\d+$/.test(session.customerName.replace(/\D/g, ''));
          const nameParam = (session.customerName && !hasPhoneAsName) ? `&name=${encodeURIComponent(session.customerName)}` : '';
          const separator = digitalMenuUrl.includes('?') ? '&' : '?';
          fullMenuUrl = `${digitalMenuUrl}${separator}phone=${cleanedPhone}${nameParam}`;
        }
        const displayUrl = fullMenuUrl ? fullMenuUrl.replace(/^https?:\/\//i, '') : '';
        const digitalMenuLine = displayUrl 
          ? `\n\nTambién puedes ver nuestra carta digital interactiva con fotos y armar tu pedido directamente aquí:\n👉 ${displayUrl}` 
          : '';

        // Buscar si el cliente preguntó por una categoría específica (ej: pizzas, hamburguesas, etc)
        const matchedCategory = activeCategories.find(cat => {
          const catNorm = cat.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          return normalized.includes(catNorm) || (catNorm.includes('pizza') && normalized.includes('pizza')) || (catNorm.includes('hamburguesa') && normalized.includes('hamburguesa'));
        });

        let menuText = '';
        if (matchedCategory && matchedCategory.items.length > 0) {
          const itemList = matchedCategory.items.slice(0, 15).map(i => `• *${i.name}*: $${i.price.toLocaleString('de-DE')}`).join('\n');
          menuText = 
            `*¡Claro que sí! 🌭 Aquí tienes nuestras opciones:*\n\n` +
            `${itemList}\n\n` +
            `¿Deseas pedir alguna de estas opciones? Escríbenos directamente lo que deseas ordenar.${digitalMenuLine}\n\n` +
            `Escríbenos lo que deseas pedir y con gusto tomamos tu pedido. 😊`;
        } else {
          const liveMenuText = await this.buildMessagingMenuText();
          menuText = 
            `${liveMenuText}${digitalMenuLine}\n\n` +
            `Escríbenos lo que deseas pedir y con gusto tomamos tu pedido. 😊`;
        }
          
        await this.sendMessage(session.phone, menuText);
        return;
      }

      if (normalized === '2') {
        const orderTemplateText = 
          `¡Excelente elección! 🌭🔥\n\n` +
          `Para tomar tu pedido, por favor cuéntanos:\n` +
          `• *Productos y adiciones* que deseas\n` +
          `• *¿Para domicilio o para recoger?*\n` +
          `• *Dirección exacta* de entrega (el barrio es opcional)\n` +
          `• *Método de pago* (Efectivo / Transferencia)\n\n` +
          `Uno de nuestros asesores tomará tu pedido de inmediato. ¡Muchas gracias! 😊`;
        await this.sendMessage(session.phone, orderTemplateText);
        await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: { waitingForAdvisor: true },
        });
        this.socketGateway.emitWhatsApp('whatsappAgentRequest', {
          sessionId: session.id,
          phone: session.phone,
          customerName: session.customerName,
          waitingForAdvisor: true,
        });
        return;
      }

      if (normalized === '3') {
        const scheduleText = 
          `� *Nuestros Horarios de Atención:*\n\n` +
          `• Martes a Domingo: 5:30 PM - 11:30 PM\n` +
          `• Lunes: Cerrado por descanso de nuestro equipo.\n\n` +
          `Escríbenos lo que deseas pedir y con gusto tomamos tu pedido. 😊`;
        await this.sendMessage(session.phone, scheduleText);
        return;
      }

      if (normalized === '4') {
        const dbZones = await this.prisma.deliveryZone.findMany({
          where: { active: true },
          orderBy: { name: 'asc' }
        });
        const zonesList = dbZones.map(z => `- ${z.name}: $${z.rate.toLocaleString('de-DE')}`).join('\n');

        const coverageText = 
          `� *Cobertura y Domicilios en Montería:*\n\n` +
          `${zonesList}\n\n` +
          `*Nota:* Si tu barrio es nuevo o no aparece en la lista, no te preocupes, un asesor definirá el costo al momento de procesar tu pedido. \n\n` +
          `Escríbenos lo que deseas pedir y con gusto tomamos tu pedido. 😊`;
        await this.sendMessage(session.phone, coverageText);
        return;
      }

      if (normalized === '5') {
        const agentText = 
          `Entendido. En un momento uno de nuestros asesores tomará tu chat y te atenderá personalmente. ¡Gracias por escribirnos! �`;
        await this.sendMessage(session.phone, agentText);
        
        await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: { waitingForAdvisor: true },
        });

        // Notificar a todos los asesores conectados
        this.socketGateway.emitWhatsApp('whatsappAgentRequest', {
          sessionId: session.id,
          phone: session.phone,
          customerName: session.customerName,
          waitingForAdvisor: true,
        });
        return;
      }

// FALLBACK: Verificar si el mensaje parece un pedido de comida
      const lastMessages = await this.prisma.whatsAppMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      const lastOutMessage = lastMessages.find(m => m.direction === 'OUT');
      
      // Definir ventana de tiempo para el contexto (ej. 15 minutos)
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const isRecentContext = lastOutMessage && lastOutMessage.createdAt >= fifteenMinutesAgo;

      // Contextos en los que el usuario está intentando hacer un pedido:
      // 1. Estaba viendo el menú (opción 1)
      // 2. Estaba en la plantilla de pedido (opción 2)
      // 3. Escribió algo que parece comida directamente
      const wasViewingMenu = isRecentContext && (
        lastOutMessage.messageType === 'document' || 
        lastOutMessage.content?.includes('menú en PDF') ||
        lastOutMessage.content?.includes('¡Aquí tienes nuestro menú!') ||
        lastOutMessage.content?.includes('nuestro menú físico') ||
        lastOutMessage.content?.includes('carta digital')
      );
      
      const wasWaitingForOrder = isRecentContext && (
        lastOutMessage.content?.includes('Para registrar tu pedido, por favor') ||
        lastOutMessage.content?.includes('¡Escribe tu pedido y un asesor') ||
        lastOutMessage.content?.includes('registrar tu pedido y dirección') ||
        (lastOutMessage.content?.includes('Pedido:*') && !lastOutMessage.content?.includes('Hacer un Pedido'))
      );

      if (wasViewingMenu || wasWaitingForOrder || looksLikeOrder) {
        // Detectar si ya trae los campos de la plantilla (Nombre:, Dirección:, Barrio:, Pedido:)
        const hasTemplateFields = /nombre:/i.test(userText) && (/direcci[oó]n:/i.test(userText) || /barrio:/i.test(userText));
        
        if (hasTemplateFields) {
          // El cliente ya llenó la plantilla completa, enviar directo al asesor
          const confirmText = 
            `¡Perfecto!  Hemos recibido tu pedido:\n\n` +
            `${userText}\n\n` +
            `Uno de nuestros asesores tomará tu chat de inmediato para confirmar el valor total y enviártelo. ¡Gracias! `;
          await this.sendMessage(session.phone, confirmText);
        } else {
          // El cliente escribió lo que quiere pero sin plantilla, enviarle la plantilla pre-llenada
          const hasPhoneAsName = session.customerName && /^\d+$/.test(session.customerName.replace(/\D/g, ''));
          const hasValidName = session.customerName && !hasPhoneAsName;
          const nameLine = hasValidName ? '' : `*Nombre:* \n`;
          const templateText = 
            `¡Excelente elección! \n\n` +
            `Para registrar tu pedido y dirección de envío, por favor copia, pega y completa la siguiente plantilla con tus datos:\n\n` +
            nameLine +
            `*Dirección:* (Escribir "Recoger" si pasas por él)\n` +
            `*Barrio:* \n` +
            `*¿Es para Domicilio o Recoger?:* \n` +
            `*Método de Pago:* (Efectivo / Nequi / Tarjeta)\n` +
            `*Pedido:* ${userText}\n\n` +
            `¡Uno de nuestros asesores tomará tu chat de inmediato para confirmar el valor total y enviártelo! `;
          await this.sendMessage(session.phone, templateText);
        }
        
        await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: { waitingForAdvisor: true },
        });

        this.socketGateway.emitWhatsApp('whatsappAgentRequest', {
          sessionId: session.id,
          phone: session.phone,
          customerName: session.customerName,
          waitingForAdvisor: true,
        });
        return;
      }

      this.logger.log(`Mensaje recibido de ${session.phone}: "${normalized}", derivando a atención personalizada`);
      const fallbackText = 
        `¡Hola! 👋 Recibimos tu mensaje en *The Villa Dog* 🌭🔥\n\n` +
        `En un momento uno de nuestros asesores te responderá personalmente para tomar tu pedido o resolver tus dudas. ¡Muchas gracias por escribirnos! 😊`;
      await this.sendMessage(session.phone, fallbackText);
      await this.prisma.whatsAppSession.update({
        where: { id: session.id },
        data: { waitingForAdvisor: true },
      });
      this.socketGateway.emitWhatsApp('whatsappAgentRequest', {
        sessionId: session.id,
        phone: session.phone,
        customerName: session.customerName,
        waitingForAdvisor: true,
      });
      return;
    } catch (error) {
      this.logger.error(`Error en chatbot para ${session.phone}:`, error);
    }
  }

  private async sendImageByUrl(phone: string, imageUrl: string, caption?: string) {
    const phoneId = await this.getSetting('whatsapp_phone_id');
    const token = await this.getSetting('whatsapp_token');
    if (!phoneId || !token) return;

    const targetSession = await this.resolveSessionForDispatch(phone);
    const resolvedRecipient = this.getBestRecipientPhone(targetSession, phone);
    const formattedPhone = this.formatRecipient(resolvedRecipient);

    try {
      const recipientObj = this.buildMetaRecipient(formattedPhone);
      const body: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        ...recipientObj,
        type: 'image',
        image: { link: imageUrl },
      };
      if (caption) body.image.caption = caption;

      const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      
      if (!res.ok) {
        const err = await res.json();
        this.logger.error('Error enviando imagen por URL:', err);
      }
    } catch (err) {
      this.logger.error('Error en sendImageByUrl:', err);
    }
  }

  private resolveGeminiKeys(incomingTokens: string[], existingKeys: string[]): string[] {
    const resolved: string[] = [];
    const usedExisting = new Set<number>();

    incomingTokens.forEach((rawToken, index) => {
      const token = String(rawToken || '').trim();
      if (!token) return;

      if (token.includes('•')) {
        const suffix = token.replace(/•/g, '').trim().slice(-4);
        let existingIndex = suffix
          ? existingKeys.findIndex((existing, candidateIndex) => !usedExisting.has(candidateIndex) && existing.endsWith(suffix))
          : -1;
        if (existingIndex < 0 && existingKeys[index] && !usedExisting.has(index)) {
          existingIndex = index;
        }
        if (existingIndex >= 0) {
          resolved.push(existingKeys[existingIndex]);
          usedExisting.add(existingIndex);
        }
        return;
      }

      if (token.length >= 10) resolved.push(token);
    });

    return Array.from(new Set(resolved));
  }

  /**
   * Returns the keys in the order a single Gemini operation must try them.
   * The first key advances on every operation, so configured projects share
   * traffic evenly instead of exhausting the first key before using the next.
   */
  private getGeminiKeyCandidates(rawKeys: string[], now = Date.now()): string[] {
    const keys = Array.from(new Set(rawKeys.map(key => String(key || '').trim()).filter(Boolean)));
    if (keys.length === 0) return [];

    for (const [key, cooldownUntil] of this.geminiKeyCooldownUntil.entries()) {
      if (cooldownUntil <= now) this.geminiKeyCooldownUntil.delete(key);
    }

    const poolId = keys.join('\u001f');
    const cursor = this.geminiKeyCursors.get(poolId) || 0;
    const startIndex = ((cursor % keys.length) + keys.length) % keys.length;
    const candidates: string[] = [];
    for (let offset = 0; offset < keys.length; offset += 1) {
      const keyIndex = (startIndex + offset) % keys.length;
      const key = keys[keyIndex];
      if ((this.geminiKeyCooldownUntil.get(key) || 0) > now) continue;
      candidates.push(key);
    }

    if (candidates.length > 0) {
      this.advanceGeminiKeyCursor(keys, candidates[0]);
    }

    return candidates;
  }

  private advanceGeminiKeyCursor(rawKeys: string[], apiKey: string): void {
    const keys = Array.from(new Set(rawKeys.map(key => String(key || '').trim()).filter(Boolean)));
    const usedIndex = keys.indexOf(apiKey);
    if (usedIndex < 0) return;
    this.geminiKeyCursors.set(keys.join('\u001f'), (usedIndex + 1) % keys.length);
  }

  private isGeminiKeyOnCooldown(apiKey: string, now = Date.now()): boolean {
    const cooldownUntil = this.geminiKeyCooldownUntil.get(apiKey) || 0;
    if (cooldownUntil > now) return true;
    if (cooldownUntil) this.geminiKeyCooldownUntil.delete(apiKey);
    return false;
  }

  private geminiRetryDelayMs(status: number, response?: any, errorBody?: unknown): number {
    const defaultDelay = status === 403 ? 5 * 60_000 : 60_000;
    const retryAfter = response?.headers?.get?.('retry-after');
    let requestedDelay = 0;

    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) {
        requestedDelay = seconds * 1000;
      } else {
        const retryAt = Date.parse(retryAfter);
        if (Number.isFinite(retryAt)) requestedDelay = Math.max(0, retryAt - Date.now());
      }
    }

    let serializedBody = '';
    try {
      serializedBody = typeof errorBody === 'string' ? errorBody : JSON.stringify(errorBody || '');
    } catch {
      serializedBody = '';
    }
    const retryDelayMatch = serializedBody.match(/retryDelay["']?\s*:\s*["']?([\d.]+)s/i)
      || serializedBody.match(/retry(?:\s+in|\s+after)?\s+([\d.]+)\s*(?:s|sec|second)/i);
    if (retryDelayMatch) {
      requestedDelay = Math.max(requestedDelay, Number(retryDelayMatch[1]) * 1000);
    }

    const effectiveDelay = requestedDelay > 0 ? requestedDelay : defaultDelay;
    return Math.min(24 * 60 * 60_000, Math.max(5_000, effectiveDelay));
  }

  private async putGeminiKeyOnCooldown(apiKey: string, response: any): Promise<unknown> {
    const status = Number(response?.status || 429);
    const receivedAt = Date.now();
    const initialDelayMs = this.geminiRetryDelayMs(status, response);
    this.geminiKeyCooldownUntil.set(
      apiKey,
      Math.max(this.geminiKeyCooldownUntil.get(apiKey) || 0, receivedAt + initialDelayMs),
    );

    let errorBody: unknown = null;
    try {
      if (typeof response?.text === 'function') {
        const errorText = await response.text();
        try {
          errorBody = JSON.parse(errorText);
        } catch {
          errorBody = errorText;
        }
      } else if (typeof response?.json === 'function') {
        errorBody = await response.json();
      }
    } catch {
      errorBody = null;
    }

    const delayMs = this.geminiRetryDelayMs(status, response, errorBody);
    this.geminiKeyCooldownUntil.set(
      apiKey,
      Math.max(this.geminiKeyCooldownUntil.get(apiKey) || 0, receivedAt + delayMs),
    );
    this.logger.warn(
      `Gemini key (...${apiKey.slice(-4)}) quedó en pausa ${Math.ceil(delayMs / 1000)} s tras HTTP ${status}; se usará la siguiente llave.`,
    );
    return errorBody;
  }

  private isValidGeminiModel(model: string): boolean {
    return /^[a-zA-Z0-9._-]{3,100}$/.test(model);
  }

  private normalizeGeminiModel(value: string): string {
    const model = String(value || '').trim().replace(/^models\//i, '');
    if (model && !this.isValidGeminiModel(model)) {
      throw new BadRequestException('El nombre del modelo de Gemini no es válido');
    }
    return model;
  }

  private async getGeminiModels(override?: string): Promise<string[]> {
    const requested = override === undefined ? '' : this.normalizeGeminiModel(override);
    const configured = String(await this.getSetting('gemini_model') || '').trim().replace(/^models\//i, '');
    return Array.from(new Set([
      requested,
      this.isValidGeminiModel(configured) ? configured : '',
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-2.5-flash-lite',
    ].filter(Boolean)));
  }

  private buildGeminiGenerationConfig(
    model: string,
    options: { temperature?: number; maxOutputTokens?: number } = {},
  ): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    if (Number.isFinite(options.maxOutputTokens)) config.maxOutputTokens = options.maxOutputTokens;
    if (/^gemini-3\./i.test(model)) {
      config.thinkingConfig = { thinkingLevel: 'low' };
    } else if (/^gemini-2\.5-flash-lite(?:$|-)/i.test(model)) {
      // Flash-Lite está orientado a extracción de alto volumen. Desactivar
      // cualquier presupuesto de razonamiento evita que una lectura de chat
      // espere tokens que no necesita.
      config.thinkingConfig = { thinkingBudget: 0 };
    } else if (/thinking/i.test(model)) {
      // Modelos de razonamiento (thinking) no admiten el parámetro temperature en la API de Google
    } else if (options.temperature !== undefined) {
      config.temperature = options.temperature;
    }
    return config;
  }

  private sanitizeGeminiError(error: unknown, keys: string[]): string {
    let message = error instanceof Error ? error.message : String(error || 'Error desconocido del proveedor');
    for (const key of keys) {
      if (key) message = message.split(key).join('[llave oculta]');
    }
    return message.replace(/https?:\/\/\S+/gi, '[URL del proveedor]').slice(0, 240);
  }

  /**
   * Reads the models visible to the configured Gemini key. Google exposes the
   * model context/output token limits here, but it does not expose the
   * remaining requests for an AI Studio/Cloud project through this endpoint.
   */
  async getGeminiModelInfo(key?: string, model?: string) {
    const existingSetting = await this.prisma.appSetting.findUnique({ where: { key: 'gemini_api_key' } });
    const existingKeys = (existingSetting?.value || '').split(',').map(k => k.trim()).filter(Boolean);
    const providedTokens = key ? key.split(',').map(k => k.trim()).filter(Boolean) : [];
    const keys = providedTokens.length > 0
      ? this.resolveGeminiKeys(providedTokens, existingKeys)
      : existingKeys;

    if (keys.length === 0) {
      throw new BadRequestException('Agrega al menos una llave de Gemini para consultar sus modelos.');
    }

    let payload: any = null;
    let lastError: unknown = null;
    let workingKey = '';
    for (const apiKey of keys.slice(0, 10)) {
      try {
        const models: any[] = [];
        let pageToken = '';
        let page = 0;
        let pageFailed = false;
        do {
          const params = new URLSearchParams({ key: apiKey, pageSize: '1000' });
          if (pageToken) params.set('pageToken', pageToken);
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?${params.toString()}`, {
            signal: AbortSignal.timeout(8000),
          });
          if (!response.ok) {
            const errorBody: any = await response.json().catch(() => null);
            lastError = this.sanitizeGeminiError(errorBody?.error?.message || `Gemini respondió HTTP ${response.status}`, keys);
            pageFailed = true;
            break;
          }
          const pagePayload: any = await response.json();
          if (Array.isArray(pagePayload?.models)) models.push(...pagePayload.models);
          pageToken = String(pagePayload?.nextPageToken || '');
          page += 1;
        } while (pageToken && page < 20);

        if (pageFailed) continue;
        payload = { models };
        workingKey = apiKey;
        break;
      } catch (error) {
        lastError = this.sanitizeGeminiError(error, keys);
      }
    }

    if (!payload) {
      throw new BadRequestException(String(lastError || 'No se pudieron consultar los modelos de Gemini.'));
    }

    const availableModels = (Array.isArray(payload.models) ? payload.models : [])
      .filter((entry: any) => Array.isArray(entry?.supportedGenerationMethods) && entry.supportedGenerationMethods.includes('generateContent'))
      .map((entry: any) => ({
        name: String(entry.name || '').replace(/^models\//i, ''),
        displayName: String(entry.displayName || entry.name || '').trim(),
        description: String(entry.description || '').trim().slice(0, 240),
        inputTokenLimit: Number.isFinite(entry.inputTokenLimit) ? entry.inputTokenLimit : null,
        outputTokenLimit: Number.isFinite(entry.outputTokenLimit) ? entry.outputTokenLimit : null,
        supportedGenerationMethods: entry.supportedGenerationMethods,
      }))
      .filter((entry: any) => entry.name)
      .reduce((unique: any[], entry: any) => unique.some(item => item.name === entry.name) ? unique : [...unique, entry], [])
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    const configuredModel = this.normalizeGeminiModel(model || String(await this.getSetting('gemini_model') || ''));
    const productionCandidates = availableModels.filter((entry: any) => {
      const name = String(entry.name || '').toLowerCase();
      return !/(embedding|image|imagen|tts|audio|live|robotics|computer|deep-research|veo|lyria)/i.test(name)
        && !/(preview|experimental|exp|latest)/i.test(name);
    });
    const preferredNames = [
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-2.5-flash-lite',
    ];
    const recommended = preferredNames.map(name => productionCandidates.find((entry: any) => entry.name === name)).find(Boolean)
      || productionCandidates.find((entry: any) => /flash/i.test(entry.name))
      || availableModels[0]
      || null;
    // "Seleccionado" significa exactamente el modelo que el administrador
    // guardó. La consulta nunca cambia esa elección silenciosamente.
    const selected = availableModels.find((entry: any) => entry.name === configuredModel) || null;
    const requestsToday = await this.getGeminiUsageToday();

    return {
      provider: 'Google Gemini',
      keySuffix: workingKey ? `••••${workingKey.slice(-4)}` : null,
      configuredModel: configuredModel || null,
      selectedModel: selected,
      availableModels,
      usage: {
        requestsToday,
        quotaRemaining: null,
        quotaSource: 'Google AI Studio / Google Cloud Console',
        note: 'Google no publica la cuota restante de la llave en esta API. El límite depende del proyecto y del plan del proveedor.',
      },
      checkedAt: new Date().toISOString(),
    };
  }

  async testMetaConnection(tokenOverride?: string, phoneIdOverride?: string) {
    const rawToken = tokenOverride?.trim() || await this.getSetting('whatsapp_token');
    const rawPhoneId = phoneIdOverride?.trim() || await this.getSetting('whatsapp_phone_id');

    const phoneId = rawPhoneId ? String(rawPhoneId).replace(/\s+/g, '') : '';
    const token = rawToken ? String(rawToken).replace(/^["']|["']$/g, '').split(/\s+/)[0] : '';

    if (!phoneId || !token) {
      return {
        success: false,
        message: 'Falta configurar el Phone Number ID o el Token de acceso de Meta.',
      };
    }

    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();

      if (!res.ok) {
        const error = data?.error;
        let hint = '';
        if (error?.code === 190) {
          hint = 'El Token de Meta ha caducado o es un token temporal de 24h. Genera un token permanente de Usuario del Sistema en Meta Business Manager.';
        } else if (error?.code === 100 || error?.code === 200) {
          hint = 'El Token no tiene permisos sobre este Phone Number ID o pertenece a otra cuenta comercial de Meta.';
        }
        return {
          success: false,
          code: error?.code,
          message: error?.message || 'Error al validar con Meta',
          hint,
        };
      }

      return {
        success: true,
        displayPhoneNumber: data.display_phone_number,
        verifiedName: data.verified_name,
        qualityRating: data.quality_rating,
        status: data.code_verification_status,
        message: `Conexión exitosa con Meta Cloud API. Número verificado: ${data.display_phone_number || phoneId} (${data.verified_name || 'Sin nombre verificado'}).`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'No se pudo contactar con los servidores de Meta.',
      };
    }
  }

  async testGeminiConnection(key?: string, prompt?: string, model?: string) {
    const existingSetting = await this.prisma.appSetting.findUnique({ where: { key: 'gemini_api_key' } });
    const existingKeys = (existingSetting?.value || '').split(',').map(k => k.trim()).filter(Boolean);

    let keysToTest: string[] = [];
    if (key && key.trim()) {
      const tokens = key.split(',').map(k => k.trim()).filter(Boolean);
      keysToTest = this.resolveGeminiKeys(tokens, existingKeys);
    }

    if (keysToTest.length === 0) {
      keysToTest = existingKeys;
    }

    if (keysToTest.length === 0) {
      return {
        success: false,
        message: 'No hay ninguna llave API configurada para probar.',
        testedKeys: 0,
        validKeys: 0,
        results: [],
      };
    }

    if (keysToTest.length > 10) {
      throw new BadRequestException('Puedes probar máximo 10 llaves a la vez');
    }

    const testPrompt = String(prompt || 'Responde únicamente: Conexión correcta').trim();
    if (!testPrompt) throw new BadRequestException('Escribe un mensaje de prueba');
    if (testPrompt.length > 500) throw new BadRequestException('El mensaje de prueba no puede superar 500 caracteres');

    const modelsToTry = await this.getGeminiModels(model);
    const results: Array<{
      key: string;
      ok: boolean;
      model?: string;
      latencyMs: number;
      reply?: string;
      error?: string;
    }> = [];

    for (const apiKey of keysToTest) {
      const startedAt = Date.now();
      let result: (typeof results)[number] | null = null;
      let lastError = 'El proveedor no devolvió una respuesta válida';

      for (const candidateModel of modelsToTry) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:generateContent?key=${apiKey}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: testPrompt }] }],
              generationConfig: this.buildGeminiGenerationConfig(candidateModel, {
                temperature: 0,
                maxOutputTokens: 100,
              }),
            }),
            signal: AbortSignal.timeout(6000)
          });
          if (res.ok) {
            const data: any = await res.json();
            const reply = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
            if (!this.isMeaningfulGeminiReply(reply)) {
              lastError = 'Gemini no devolvió texto para esta prueba';
              continue;
            }
            await this.incrementGeminiUsage();
            result = {
              key: `••••${apiKey.slice(-4)}`,
              ok: true,
              model: candidateModel,
              latencyMs: Date.now() - startedAt,
              reply: reply.slice(0, 500),
            };
            break;
          }

          const errJson: any = res.status === 403 || res.status === 429
            ? await this.putGeminiKeyOnCooldown(apiKey, res)
            : await res.json().catch(() => null);
          lastError = this.sanitizeGeminiError(
            errJson?.error?.message || `Gemini respondió HTTP ${res.status}`,
            keysToTest,
          );
          if (res.status === 403 || res.status === 429) break;
        } catch (error) {
          lastError = this.sanitizeGeminiError(error, keysToTest);
        }
      }

      results.push(result || {
        key: `••••${apiKey.slice(-4)}`,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: lastError,
      });
    }

    const successful = results.filter(result => result.ok);
    const firstSuccessful = successful[0];
    const requestsToday = await this.getGeminiUsageToday();

    return {
      success: successful.length > 0,
      message: successful.length > 0
        ? `${successful.length} de ${keysToTest.length} llave(s) respondieron correctamente.`
        : 'Ninguna llave respondió correctamente. Revisa el detalle de la prueba.',
      testedKeys: keysToTest.length,
      validKeys: successful.length,
      model: firstSuccessful?.model || modelsToTry[0],
      latencyMs: firstSuccessful?.latencyMs,
      reply: firstSuccessful?.reply || '',
      requestsToday,
      results,
    };
  }

  async unassignSessionById(sessionId: string) {
    if (!sessionId) return;
    try {
      const session = await this.prisma.whatsAppSession.findUnique({
        where: { id: sessionId },
        include: { assignedTo: { select: { id: true, name: true } } },
      });
      if (!session?.assignedToId) return;
      await this.assignSession(session.id, null);
      this.logger.log(`[unassignSessionById] Chat ${session.id} (${session.phone}) liberado automáticamente tras despacho`);
    } catch (err) {
      this.logger.error(`[unassignSessionById] Error liberando sesión ${sessionId}:`, err);
    }
  }

  /**
   * Runs a conversation against Gemini without touching WhatsApp, sessions,
   * orders or messages. The superadmin uses this endpoint as a training
   * sandbox before enabling the production chatbot.
   */
  async testGeminiChat(
    rawMessages?: unknown,
    key?: string,
    model?: string,
    instructionsOverride?: string,
  ) {
    if (!Array.isArray(rawMessages)) {
      throw new BadRequestException('Envía al menos un mensaje para la prueba');
    }
    if (rawMessages.length > 20) {
      throw new BadRequestException('La prueba admite hasta 20 mensajes por conversación');
    }
    if (rawMessages.some((entry: any) => entry?.role !== 'user' && entry?.role !== 'model')) {
      throw new BadRequestException('Los mensajes de prueba deben ser del cliente o del modelo');
    }

    const messages = rawMessages
      .map((entry: any) => ({
        role: entry?.role === 'model' ? 'model' : 'user',
        text: String(entry?.text || '').trim(),
      }))
      .filter((entry: { text: string }) => Boolean(entry.text));

    if (messages.length === 0) {
      throw new BadRequestException('Escribe un mensaje para iniciar la prueba');
    }
    if (messages[0].role !== 'user' || messages[messages.length - 1].role !== 'user') {
      throw new BadRequestException('La conversación debe comenzar y terminar con un mensaje del cliente');
    }
    if (messages.some((entry: { role: string }, index: number) => entry.role !== (index % 2 === 0 ? 'user' : 'model'))) {
      throw new BadRequestException('Los turnos del cliente y del modelo deben alternarse');
    }
    if (messages.some((entry: { text: string }) => entry.text.length > 2000)) {
      throw new BadRequestException('Cada mensaje de prueba puede tener máximo 2.000 caracteres');
    }
    const totalCharacters = messages.reduce((total: number, entry: { text: string }) => total + entry.text.length, 0);
    if (totalCharacters > 12000) {
      throw new BadRequestException('La conversación de prueba es demasiado larga');
    }

    const existingSetting = await this.prisma.appSetting.findUnique({ where: { key: 'gemini_api_key' } });
    const existingKeys = (existingSetting?.value || '').split(',').map(k => k.trim()).filter(Boolean);
    const suppliedKeys = typeof key === 'string' ? key.split(',').map(k => k.trim()).filter(Boolean) : [];
    const apiKeys = suppliedKeys.length > 0
      ? this.resolveGeminiKeys(suppliedKeys, existingKeys)
      : existingKeys;

    if (apiKeys.length === 0) {
      return {
        success: false,
        message: 'No hay ninguna llave API de Gemini disponible para la prueba.',
      };
    }
    if (apiKeys.length > 10) {
      throw new BadRequestException('Puedes usar máximo 10 llaves en la prueba');
    }

    const [dbItems, dbZones, configuredMenuUrl, restaurantHours, configuredInstructions, paymentQrMode, paymentAccountText] = await Promise.all([
      this.prisma.menuItem.findMany({
        where: { active: true },
        include: { category: { select: { name: true } } },
        orderBy: [{ category: { name: 'asc' } }, { price: 'asc' }],
      }),
      this.prisma.deliveryZone.findMany({
        where: { active: true },
        orderBy: { name: 'asc' },
      }),
      this.getSetting('digital_menu_url'),
      this.getSetting('restaurant_hours'),
      this.getSetting('chatbot_ai_instructions'),
      this.getSetting('chatbot_payment_qr_mode'),
      this.getSetting('chatbot_payment_account_text'),
    ]);

    const itemsByCategory: Record<string, string[]> = {};
    for (const item of dbItems) {
      const category = item.category?.name || 'General';
      if (!itemsByCategory[category]) itemsByCategory[category] = [];
      const description = item.description ? ` (${item.description})` : '';
      itemsByCategory[category].push(`- ${item.name}: $${Number(item.price).toLocaleString('de-DE')}${description}`);
    }
    const menuSummary = Object.entries(itemsByCategory)
      .map(([category, items]) => `*${category.toUpperCase()}*\n${items.join('\n')}`)
      .join('\n\n') || 'No hay productos activos cargados todavía.';
    const zonesSummary = dbZones.map(zone => `- ${zone.name}: $${Number(zone.rate).toLocaleString('de-DE')}`).join('\n');
    const instructions = String(instructionsOverride ?? configuredInstructions ?? '').trim().slice(0, 4000);
    const customInstructionsBlock = instructions
      ? `\nINSTRUCCIONES ADICIONALES CONFIGURADAS POR ADMINISTRACIÓN:\n${instructions}\n`
      : '';
    const paymentInstruction = paymentQrMode === 'IMAGE'
      ? 'El cobro por transferencia se comparte mediante el QR oficial. No inventes números de cuenta; indica que el asesor enviará el QR cuando corresponda.'
      : paymentAccountText
        ? `Los únicos datos oficiales para transferencias son:\n${paymentAccountText}`
        : 'No hay datos de transferencia configurados. No inventes cuentas ni teléfonos; transfiere la conversación a un asesor para confirmar el pago.';
    const displayMenuUrl = this.getShareableDigitalMenuUrl(configuredMenuUrl);
    const menuGeneralRule = displayMenuUrl
      ? `Muestra la lista limpia de categorías principales y al final incluye el enlace digital: ${displayMenuUrl}.`
      : 'Muestra la lista limpia de categorías principales en el chat. Todavía no hay un enlace público configurado; no inventes ni incluyas ninguna URL.';
    const menuCategoryRule = displayMenuUrl
      ? `Muestra la lista de platos con sus precios correspondientes a esa categoría. Al final puedes incluir la carta digital: ${displayMenuUrl}.`
      : 'Muestra la lista de platos con sus precios correspondientes a esa categoría. No incluyas enlaces hasta que administración configure el dominio público.';
    const menuFollowupRule = displayMenuUrl
      ? `- PROHIBIDO REPETIR EL ENLACE AL MENÚ DIGITAL ("${displayMenuUrl}") en preguntas de seguimiento o dudas específicas.`
      : '- No inventes enlaces ni menciones una carta digital que todavía no tiene dominio configurado.';
    const cleanCategories = new Set<string>();
    Object.keys(itemsByCategory).forEach(category => {
      const cleaned = category
        .replace(/\s+c\/.*/i, '')
        .replace(/\s+(Familiar|Junior|Personal|Especialidades|Clásicas|Gratinadas|Gratinados|Rellenos)$/i, '')
        .replace(/\s+para\s+Pizza.*/i, '')
        .trim();
      if (cleaned) cleanCategories.add(cleaned);
    });
    const dynamicCategoriesString = Array.from(cleanCategories)
      .sort((left, right) => left.localeCompare(right, 'es'))
      .map(category => `- *${category}*`)
      .join('\n');
    const conversationPrompt = messages.map((entry: { role: 'user' | 'model'; text: string }) =>
      `${entry.role === 'user' ? 'Cliente' : 'Restaurante (Tú)'}: ${entry.text.length > 1200 ? `${entry.text.slice(0, 500)}\n[Mensaje extenso ya enviado]` : entry.text}`,
    ).join('\n');
    const sandboxPrompt = this.buildGeminiAssistantPrompt({
      customInstructionsBlock,
      recentOrdersSummary: 'No hay pedidos previos registrados para este cliente.',
      menuSummary, restaurantHours, zonesSummary, menuGeneralRule,
      dynamicCategoriesString, menuCategoryRule, menuFollowupRule,
      session: { customerName: '' }, paymentInstruction, conversationPrompt,
    });
    const modelsToTry = await this.getGeminiModels(model);
    let lastError = 'El proveedor no devolvió una respuesta válida';
    const keyCandidates = this.getGeminiKeyCandidates(apiKeys);
    if (keyCandidates.length === 0) {
      lastError = 'Todas las llaves están temporalmente en pausa por cuota';
    }

    for (const apiKey of keyCandidates) {
      if (this.isGeminiKeyOnCooldown(apiKey)) continue;
      for (const candidateModel of modelsToTry) {
        if (this.isGeminiKeyOnCooldown(apiKey)) break;
        const startedAt = Date.now();
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:generateContent?key=${apiKey}`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: sandboxPrompt }] }],
              generationConfig: this.buildGeminiGenerationConfig(candidateModel, {
                temperature: 0.3,
                maxOutputTokens: 600,
              }),
            }),
            signal: AbortSignal.timeout(15000),
          });

          if (!response.ok) {
            const errorBody: any = response.status === 403 || response.status === 429
              ? await this.putGeminiKeyOnCooldown(apiKey, response)
              : await response.json().catch(() => null);
            lastError = this.sanitizeGeminiError(
              errorBody?.error?.message || `Gemini respondió HTTP ${response.status}`,
              apiKeys,
            );
            // 403/429 significa que esta llave no puede atender ahora; pasa a
            // la siguiente llave para conservar la continuidad del servicio.
            if (response.status === 403 || response.status === 429) break;
            continue;
          }

          const data: any = await response.json();
          const reply = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
          if (!this.isMeaningfulGeminiReply(reply)) {
            lastError = 'Gemini no devolvió texto para este mensaje';
            continue;
          }

          await this.incrementGeminiUsage();
          return {
            success: true,
            message: 'Respuesta generada en el entorno de prueba. No se envió nada por WhatsApp.',
            reply: reply.slice(0, 3000),
            model: candidateModel,
            key: `••••${apiKey.slice(-4)}`,
            latencyMs: Date.now() - startedAt,
            requestsToday: await this.getGeminiUsageToday(),
          };
        } catch (error) {
          lastError = this.sanitizeGeminiError(error, apiKeys);
        }
      }
    }

    return {
      success: false,
      message: `No se pudo generar la respuesta en el entorno de prueba: ${lastError}`,
    };
  }

  private buildGeminiOrderResponseSchema() {
    return {
      type: 'OBJECT',
      properties: {
        items: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              menuItemId: { type: 'STRING' },
              quantity: { type: 'INTEGER' },
              preference: { type: 'STRING' },
              notes: { type: 'STRING' },
              additions: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['menuItemId', 'quantity', 'preference', 'notes', 'additions'],
          },
        },
        // Gemini rechaza los valores vacíos dentro de enum. Los campos aún no
        // confirmados se representan como null y el parser los normaliza a null.
        detectedOrderType: { type: 'STRING', enum: ['delivery', 'pickup'], nullable: true },
        paymentMethod: { type: 'STRING', enum: ['CASH', 'TRANSFER'], nullable: true },
        independentNotes: { type: 'ARRAY', items: { type: 'STRING' } },
        unresolvedBeverages: { type: 'ARRAY', items: { type: 'STRING' } },
        customerName: { type: 'STRING' },
        customerPhone: { type: 'STRING' },
        customerAddress: { type: 'STRING' },
        customerAddressReference: { type: 'STRING' },
        customerNeighborhood: { type: 'STRING' },
        zoneId: { type: 'STRING' },
      },
      required: [
        'items', 'detectedOrderType', 'paymentMethod', 'independentNotes', 'unresolvedBeverages',
        'customerName', 'customerPhone', 'customerAddress',
        'customerAddressReference', 'customerNeighborhood', 'zoneId',
      ],
    };
  }

  async getOrderReaderStatus() {
    return {
      enabled: (await this.getSetting('order_reader_enabled')) === 'true',
    };
  }

  async parseOrderWithGemini(text: string) {
    const readerEnabled = await this.getSetting('order_reader_enabled');
    if (readerEnabled !== 'true') {
      throw new BadRequestException('La lectura automática de pedidos está pausada. Toma el pedido manualmente o actívala en Configuración técnica.');
    }
    const rawApiKey = await this.getSetting('gemini_api_key');
    if (!rawApiKey) {
      throw new BadRequestException('La clave API de Gemini no está configurada.');
    }
    const apiKeys = rawApiKey.split(',').map(k => k.trim()).filter(k => k.length > 0);

    try {
      const [dbItems, dbZones] = await Promise.all([
        this.prisma.menuItem.findMany({
          where: { active: true },
          include: {
            category: {
              select: { name: true }
            }
          }
        }),
        this.prisma.deliveryZone.findMany({
          where: { active: true },
          select: { id: true, name: true, rate: true }
        })
      ]);

      // Identificar adiciones a partir del catálogo
      const dbAdditions = dbItems.filter(i => {
        const cat = (i.category?.name || '').toLowerCase();
        const name = i.name.toLowerCase();
        return cat.includes('adicion') || cat.includes('adicional') || cat.includes('borde') || name.startsWith('adición') || name.startsWith('adicion');
      });

      // Deduplicar items (mismo nombre+categoría = mismo plato, usar primer ID)
      const uniqueMap = new Map<string, typeof dbItems[0]>();
      for (const item of dbItems) {
        const key = `${item.name}|${item.category?.name || ''}`;
        if (!uniqueMap.has(key)) uniqueMap.set(key, item);
      }
      const uniqueItems = Array.from(uniqueMap.values());

      // Agrupar por categoría para formato compacto y claro
      const byCategory = new Map<string, typeof uniqueItems>();
      for (const item of uniqueItems) {
        const cat = item.category?.name || 'General';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(item);
      }

      let menuSummary = '';
      for (const [cat, items] of byCategory) {
        menuSummary += `\n## ${cat}\n`;
        for (const i of items) {
          const desc = i.description ? ` (${i.description})` : '';
          menuSummary += `${i.id} | ${i.name}${desc} | $${i.price}\n`;
        }
      }

      const additionSummary = dbAdditions.length > 0
        ? dbAdditions.map(a => `${a.id} | ${a.name} | $${a.price}`).join('\n')
        : 'No hay adiciones registradas.';

      const zoneSummary = dbZones.map(z => `${z.id} | ${z.name} | $${z.rate}`).join('\n');

      const prompt = `Eres el asistente inteligente oficial de The Villa Dog especializado en extraer pedidos de clientes con máxima precisión.
Lee la conversación y devuelve únicamente el pedido FINAL que el cliente solicitó o confirmó. No inventes platos ni datos.

CATÁLOGO VIGENTE DE PRODUCTOS (ID | Nombre del producto | Precio):
${menuSummary}

ADICIONES VIGENTES (ID | Nombre de adición | Precio):
${additionSummary}

ZONAS DE DOMICILIO VIGENTES (ID | Barrio | Tarifa):
${zoneSummary || 'No hay zonas configuradas.'}

REGLAS DE RECONOCIMIENTO Y RELACIÓN DE PRODUCTOS (THE VILLA DOG):
- PERROS CALIENTES:
  * "un perro", "un perro sencillo", "perro" -> "Perro Sencillo"
  * "un perro especial" -> "Perro Especial The Villa Dog"
  * "perro super", "super villa dog" -> "Perro Super The Villa Dog"
  * "perro suizo" -> "Perro Suizo" (¡IMPORTANTE! Si dice "perro suizo" es un perro caliente, no el plato suizo).
  * "perro americano", "perro ranchero", "perro con pollo", "perro con tocineta", "chori perro", "perro gemelo", "perro escocés", "perro italo suizo", "perro italo ranchero", "perro suizito", "perro combo" -> Asigna exactamente su ID.
- HAMBURGUESAS:
  * "una hamburguesa", "una burger", "hamburguesa sencilla" -> "Hamburguesa Sencilla"
  * "hamburguesa especial" -> "Hamburguesa Especial The Villa Dog"
  * "hamburguesa super", "hamburguesa super especial" -> "Hamburguesa Super Especial The Villa Dog"
  * "hamburguesa mixta", "hamburguesa doble carne", "hamburguesa con pollo", "hamburguesa ranchera especial", "hamburguesa combo" -> Asigna exactamente su ID.
- SALVAJADAS:
  * Platos para compartir: "Salvajada Chica", "Salvajada Matrimonio", "Salvajada Trío", "Salvajada Super", "Salvajada The Villa Dog", "Salvajada Extralargue", "Salvajada Salvajadita". Si pide "salvajada chica" o "salvajada pequeña", asigna "Salvajada Chica". Asigna la variante sencilla o gratinada según lo que pida.
- PATACONES RELLENOS:
  * "patacon mixto", "patacon con todo", "patacon trifasico", "señor patacon", etc.
- SUIZOS Y PLATOS:
  * Si el cliente dice "un suizo", "suizo al plato", "suizo con papas", "suizo gratinado", "mini suizo", asigna al plato correspondiente de la categoría Suizos (con papas a la francesa por defecto salvo que diga al vapor).
- BEBIDAS:
  * "coca cola", "postobon manzana", "kola roman", "quatro", "jugo hit", "agua", "hatsu", "bretaña".
  * ¡IMPORTANTE! LA IA SÍ DEBE HALAR / AGREGAR LAS BEBIDAS AL CARRITO ("items"):
    - Las ÚNICAS bebidas que la IA NUNCA debe agregar a "items" son las BEBIDAS DE VIDRIO (las que incluyan "vidrio" en el nombre, como "Coca Cola Vidrio 250 ml", "Manzana Vidrio 250 ml", etc.). NUNCA selecciones ni agregues bebidas de vidrio a "items". Si el cliente pide bebida en vidrio, no la agregues a "items" y déjala en "unresolvedBeverages".
    - Para todas las demás bebidas (plásticas, personales, 1.5 L, 2.5 L, jugos, agua):
      * Si el cliente NO especifica el tamaño (ej: "una coca cola", "dos manzanas", "una colombiana", "un jugo hit mora", "un agua"), asigna por defecto la presentación personal plástica correspondiente (400 ml o 300 ml para agua). NUNCA asignes vidrio.
      * Si el cliente especifica tamaño (ej: "1.5 L", "2.5 L", "400 ml"), asigna esa presentación exacta.
  * Si el cliente cambió de bebida, conserva solo su última elección confirmada.
- ADICIONES:
  * Si el cliente pide queso extra, tocineta extra, salchicha extra, piña extra, etc., busca y asigna el ID exacto en "additions".
- INSTRUCCIONES DE PREPARACIÓN Y NOTAS ("notes"):
  * "notes" es EXCLUSIVAMENTE para modificaciones de preparación culinaria en cocina (ejemplos válidos: "Sin cebolla", "Sin salsas", "Sin piña", "Con tártara aparte", "Sin ripio", "Bien asada", "Papas al vapor", "Tártara y piña aparte").
  * PROHIBIDO PREGUNTAS DE PRECIOS O DUDAS: JAMÁS pongas en "notes" preguntas, consultas de precios o dudas del cliente (ej: NUNCA "qué precio tiene", "cuánto vale", "qué cuesta", "qué precio tiene gratinada", "precio del perro", "cuánto es", etc.). Si el cliente preguntó un precio o una duda en el chat, IGNÓRALO por completo para las notas.
  * PROHIBIDO REPETIR PRODUCTOS O CANTIDADES: JAMÁS pongas en "notes" el nombre del producto ni su cantidad o variante (ej: NUNCA "3 sencillo", "1 perro", "hamburguesa sencilla", "gratinado", "sencillo", "combo"). La cantidad va en "quantity" y el producto en "menuItemId".
  * PROHIBIDO CHARLA, SALUDOS O AFECTO: JAMÁS incluyas saludos ("hola", "buenas"), expresiones de cortesía ("por favor", "me regala", "me da"), ni frases afectivas ("te amo", "bebé", "mi amor", "linda", etc.) en las notas.
  * REGLA DEFAULT: Si el cliente NO dio una instrucción explícita de modificación/cocina para ese producto, el campo "notes" DEBE SER EXACTAMENTE UNA CADENA VACÍA ("").
  * SEPARACIÓN DE PRODUCTOS CON DIFERENTE PREPARACIÓN (MUY IMPORTANTE): Si el cliente pide por ejemplo "2 perros sencillos 1 sin cebolla", NO los agrupes en un solo ítem de 2. Debes separarlos en dos ítems independientes en el array "items":
    - Ítem 1: menuItemId del Perro Sencillo, quantity: 1, notes: "Sin cebolla"
    - Ítem 2: menuItemId del Perro Sencillo, quantity: 1, notes: ""
    Si pide "5 perros sencillos 2 sin cebolla", crea un ítem con quantity: 2 y notes: "Sin cebolla", y otro ítem con quantity: 3 y notes: "".
- CANTIDADES:
  * Detecta cantidades explícitas al inicio o al final (ej: "2 perros sencillos", "perro sencillo x2", "tres hamburguesas"). quantity debe ser entero entre 1 y 99.
- TIPO DE ENTREGA Y PAGO:
  * detectedOrderType: "delivery" si es a domicilio; "pickup" si pasa a recoger o come en mesa; null si no lo especifica.
  * paymentMethod: "CASH" para efectivo; "TRANSFER" para Nequi, Daviplata, Bancolombia; null si no se confirma.
- DATOS DEL CLIENTE:
  * Extrae nombre, teléfono, dirección, barrio y referencia si el cliente los escribió.
  * zoneId: solo el ID de una zona vigente si coincide claramente con el barrio escrito; de lo contrario null.

Devuelve exactamente este JSON:
{
  "items": [{
    "menuItemId": "UUID-EXACTO",
    "quantity": 1,
    "preference": "",
    "notes": "",
    "additions": []
  }],
  "detectedOrderType": "delivery"|"pickup"|null,
  "paymentMethod": "CASH"|"TRANSFER"|null,
  "independentNotes": [],
  "unresolvedBeverages": [],
  "customerName": "",
  "customerPhone": "",
  "customerAddress": "",
  "customerAddressReference": "",
  "customerNeighborhood": "",
  "zoneId": ""
}

CONVERSACIÓN:
"""
${text}
"""
Responde solo con JSON válido.`;

      let data: any = null;
      let modelUsed = '';
      let lastError: any = null;
      // El modelo principal es el que el administrador guardó en Configuración
      // técnica. El navegador mantiene su reconocimiento local inmediato y los
      // otros modelos se usan únicamente como contingencia si el elegido falla.
      const modelsToTry = await this.getGeminiModels();

      for (const key of this.getGeminiKeyCandidates(apiKeys)) {
        if (this.isGeminiKeyOnCooldown(key)) continue;
        for (const model of modelsToTry) {
          if (this.isGeminiKeyOnCooldown(key)) break;
          try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
            const payload = {
              contents: [{
                parts: [{ text: prompt }]
              }],
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: this.buildGeminiOrderResponseSchema(),
                ...this.buildGeminiGenerationConfig(model, {
                  temperature: 0.0,
                  maxOutputTokens: 4096,
                }),
              }
            };

            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(7000)
            });

            if (!response.ok) {
              if (response.status === 429 || response.status === 403) {
                await this.putGeminiKeyOnCooldown(key, response);
                lastError = new Error(`Gemini no puede usar temporalmente la llave ...${key.slice(-4)}`);
                break;
              }
              const errText = await response.text();
              throw new Error(`Gemini API (${model}) error: ${response.status} - ${errText}`);
            }

            const candidateData: any = await response.json();
            if (candidateData?.candidates?.[0]?.content?.parts?.[0]?.text) {
              data = candidateData;
              modelUsed = model;
              await this.incrementGeminiUsage();
              break;
            }
            lastError = new Error('Gemini no devolvió contenido para interpretar el pedido');
          } catch (e: any) {
            const safeError = this.sanitizeGeminiError(e, apiKeys);
            this.logger.warn(`Error con modelo ${model} y Gemini key (...${key.slice(-4)}): ${safeError}. Probando siguiente opción...`);
            lastError = e;
          }
        }
        if (data?.candidates?.[0]?.content?.parts?.[0]?.text) break;
      }

      if (!data) {
        throw lastError || new Error('Todas las API keys y modelos fallaron en parseOrder');
      }

      let resultText = (data as any).candidates?.[0]?.content?.parts?.[0]?.text;
      if (!resultText) {
        throw new Error('No se recibió contenido de Gemini');
      }

      // Limpiar markdown si el modelo no respetó la regla
      resultText = resultText.trim();
      if (resultText.startsWith('```json')) {
        resultText = resultText.substring(7, resultText.length - 3).trim();
      } else if (resultText.startsWith('```')) {
        resultText = resultText.substring(3, resultText.length - 3).trim();
      }

      const parsedResponse = JSON.parse(resultText);
      const rawJson = parsedResponse && typeof parsedResponse === 'object' && !Array.isArray(parsedResponse)
        ? parsedResponse
        : {};
      const rawItems = Array.isArray(rawJson?.items) ? rawJson.items : [];
      const detectedOrderType = rawJson.detectedOrderType === 'delivery' || rawJson.detectedOrderType === 'pickup'
        ? rawJson.detectedOrderType
        : null;
      const isDeliveryOrder = detectedOrderType === 'delivery';
      this.logger.log(`[parseOrder] Gemini devolvió JSON con ${rawItems.length} items`);
      const parsedCartItems: any[] = [];
      const unresolvedBeverages: string[] = [];

      for (const rawItem of rawItems) {
        if (!rawItem || typeof rawItem !== 'object') continue;
        let rawId = rawItem.menuItemId || '';
        this.logger.log(`[parseOrder] Procesando item menuItemId="${rawId}"`);
        if (rawId.startsWith('[ID:')) {
          rawId = rawId.replace('[ID:', '').replace(']', '').trim();
          this.logger.log(`[parseOrder] Limpiado a rawId="${rawId}"`);
        }
        
        let menuItem = dbItems.find(i => i.id === rawId);
        if (!menuItem) {
          this.logger.warn(`[parseOrder] ⚠ NO se encontró menuItem con id="${rawId}" en dbItems (${dbItems.length} items en DB)`);
          // Aceptar el nombre únicamente cuando coincide por completo. Una
          // coincidencia parcial puede convertir un producto en otro distinto.
          const normalizedRawId = this.normalizeSpanishLookup(rawId);
          const nameMatch = normalizedRawId
            ? dbItems.find(i => this.normalizeSpanishLookup(i.name) === normalizedRawId)
            : undefined;
          if (nameMatch) {
            this.logger.log(`[parseOrder] Encontrado por nombre: ${nameMatch.name} (id=${nameMatch.id})`);
            menuItem = nameMatch;
          } else {
            // Si rawId corresponde a una bebida (ej: Gemini envió "Coca Cola" o "Manzana"),
            // buscar entre las variantes no-vidrio
            const beverageMatch = dbItems.find(i => {
              if (!this.isBeverageMenuItem(i)) return false;
              if (/\bvidrio\b/i.test(i.name)) return false;
              const core = this.beverageCore(i.name);
              return core && (core === normalizedRawId || normalizedRawId.includes(core) || core.includes(normalizedRawId));
            });
            if (beverageMatch) {
              const core = this.beverageCore(beverageMatch.name);
              const nonGlassVariants = dbItems.filter(i =>
                this.isBeverageMenuItem(i) &&
                this.beverageCore(i.name) === core &&
                !/\bvidrio\b/i.test(i.name),
              );
              const sizeInText = this.beverageSizeInMl(text);
              const matchedBySize = sizeInText ? nonGlassVariants.find(i => this.beverageSizeInMl(i.name) === sizeInText) : null;
              const defaultPersonal = nonGlassVariants.find(i => {
                const s = this.beverageSizeInMl(i.name);
                return s !== null && s <= 600;
              }) || nonGlassVariants[0];
              menuItem = matchedBySize || defaultPersonal || beverageMatch;
              this.logger.log(`[parseOrder] Bebida encontrada por búsqueda inteligente: ${menuItem.name} (id=${menuItem.id})`);
            } else {
              const fuzzyMatch = normalizedRawId
                ? dbItems.find(i => {
                    const normItem = this.normalizeSpanishLookup(i.name);
                    return normItem.includes(normalizedRawId) || normalizedRawId.includes(normItem);
                  })
                : undefined;
              if (fuzzyMatch && !this.isBeverageMenuItem(fuzzyMatch)) {
                this.logger.log(`[parseOrder] Encontrado por coincidencia aproximada: ${fuzzyMatch.name} (id=${fuzzyMatch.id})`);
                menuItem = fuzzyMatch;
              } else {
                continue;
              }
            }
          }
        }
        // REGLA CRÍTICA: Las únicas bebidas que la IA NUNCA debe halar son las de vidrio.
        // Si el modelo devolvió una bebida de vidrio por error, verificar si el cliente pidió vidrio:
        if (menuItem && /\bvidrio\b/i.test(menuItem.name)) {
          const core = this.beverageCore(menuItem.name);
          const mentionsGlass = /\bvidrio\b/i.test(this.normalizeSpanishLookup(text));
          if (!mentionsGlass) {
            // El cliente no pidió vidrio, auto-corregir a la variante personal plástica
            const nonGlassEquivalent = dbItems.find(i =>
              this.isBeverageMenuItem(i) &&
              this.beverageCore(i.name) === core &&
              !/\bvidrio\b/i.test(i.name) &&
              (this.beverageSizeInMl(i.name) || 0) <= 600,
            );
            if (nonGlassEquivalent) {
              this.logger.log(`[parseOrder] Corrigiendo bebida de vidrio a presentación plástica personal: ${menuItem.name} -> ${nonGlassEquivalent.name}`);
              menuItem = nonGlassEquivalent;
            } else {
              this.logger.warn(`[parseOrder] Bebida en vidrio no admitida por IA: ${menuItem.name}`);
              unresolvedBeverages.push(`${menuItem.name} (no disponible en vidrio)`);
              continue;
            }
          } else {
            this.logger.warn(`[parseOrder] Bebida en vidrio solicitada no admitida por IA: ${menuItem.name}`);
            unresolvedBeverages.push(`${menuItem.name} (no disponible en vidrio)`);
            continue;
          }
        }
        if (!this.isBeverageSelectionUnambiguous(menuItem, dbItems, text)) {
          this.logger.warn(`[parseOrder] Bebida sin presentación inequívoca: ${menuItem.name}`);
          unresolvedBeverages.push(menuItem.name);
          continue;
        }
        // CORRECCIÓN DETERMINÍSTICA DE TAMAÑO DE PIZZAS:
        // Si el producto seleccionado es una pizza no-personal (Familiar, Mediana, Extra Grande)
        // pero el cliente NO mencionó explícitamente "familiar", "mediana", "extragrande" ni "grande",
        // forzar inmediatamente a la variante Personal correspondiente.
        if (menuItem) {
          const itemNameLower = menuItem.name.toLowerCase();
          const isPizza = itemNameLower.includes('pizza') || (menuItem.category?.name || '').toLowerCase().includes('pizza');
          
          if (isPizza) {
            const textLower = text.toLowerCase();
            const hasFamiliar = /\bfamiliar\b/i.test(textLower);
            const hasMediana = /\bmediana\b/i.test(textLower);
            const hasExtraGrande = /\b(extra\s*grande|extragrande|grande)\b/i.test(textLower);
            const isMitad = /\bmitad\b/i.test(textLower);

            // Si es mitad pero el cliente no dijo mitad, buscar variante entera
            if (itemNameLower.includes('mitad') && !isMitad) {
              const cleanedFlavor = itemNameLower.replace(/pizza\s+mitad/gi, '').replace(/\(.*\)/g, '').split('-')[0].trim();
              const wholeMatch = dbItems.find(i => 
                !i.name.toLowerCase().includes('mitad') && 
                i.name.toLowerCase().includes(cleanedFlavor) && 
                i.name.toLowerCase().includes('personal')
              );
              if (wholeMatch) {
                this.logger.log(`[parseOrder] Corrigiendo pizza mitad a entera: ${menuItem.name} -> ${wholeMatch.name}`);
                menuItem = wholeMatch;
              }
            }

            const currentIsFamiliar = itemNameLower.includes('familiar') || (menuItem.category?.name || '').toLowerCase().includes('familiar');
            const currentIsMediana = itemNameLower.includes('mediana') || (menuItem.category?.name || '').toLowerCase().includes('mediana');
            const currentIsExtra = itemNameLower.includes('extra') || (menuItem.category?.name || '').toLowerCase().includes('extragrande');

            // Si la IA asignó Familiar/Mediana/Extra pero el cliente no lo pidió, forzar a Personal
            if ((currentIsFamiliar && !hasFamiliar) || (currentIsMediana && !hasMediana) || (currentIsExtra && !hasExtraGrande)) {
              const baseFlavor = menuItem.name
                .replace(/\b(Personal|Mediana|Familiar|Extra Grande|Extragrande)\b/gi, '')
                .replace(/\(.*?\)/g, '')
                .trim()
                .toLowerCase();

              const personalMatch = dbItems.find(i => {
                const iNameLower = i.name.toLowerCase();
                const iCatLower = (i.category?.name || '').toLowerCase();
                const isPersonal = iNameLower.includes('personal') || iCatLower.includes('personal');
                if (!isPersonal) return false;
                const iBaseFlavor = i.name
                  .replace(/\b(Personal|Mediana|Familiar|Extra Grande|Extragrande)\b/gi, '')
                  .replace(/\(.*?\)/g, '')
                  .trim()
                  .toLowerCase();
                return iBaseFlavor === baseFlavor || iBaseFlavor.includes(baseFlavor) || baseFlavor.includes(iBaseFlavor);
              });

              if (personalMatch) {
                this.logger.log(`[parseOrder] Corrigiendo tamaño de pizza a Personal por defecto: ${menuItem.name} -> ${personalMatch.name}`);
                menuItem = personalMatch;
              }
            }
          }

          // CORRECCIÓN DETERMINÍSTICA DE PAPAS (FRANCESA POR DEFECTO VS VAPOR):
          // En Suizos, Salchipapas, Desgranados y platos con variantes de papas:
          // Si el producto seleccionado es una variante "al Vapor" pero el cliente NO escribió explícitamente "vapor" ni "cocida",
          // forzar de inmediato a la variante correspondiente con "Papas Francesa".
          const isVaporVariant = itemNameLower.includes('vapor') || itemNameLower.includes('cocida');
          if (isVaporVariant) {
            const textLower = text.toLowerCase();
            const hasVapor = /\b(al\s*vapor|vapor|cocida|cocidas)\b/i.test(textLower);
            if (!hasVapor) {
              const cleanBaseName = menuItem.name
                .replace(/\(.*?\)/g, '')
                .replace(/\b(al\s*vapor|vapor|cocida|cocidas|papas\s*al\s*vapor)\b/gi, '')
                .trim()
                .toLowerCase();

              const francesaMatch = dbItems.find(i => {
                const iLower = i.name.toLowerCase();
                const hasFrancesa = iLower.includes('francesa') || !iLower.includes('vapor');
                return hasFrancesa && (iLower.includes(cleanBaseName) || cleanBaseName.includes(iLower.replace(/\(.*?\)/g, '').trim()));
              });

              if (francesaMatch) {
                this.logger.log(`[parseOrder] Corrigiendo variante Vapor a Francesa por defecto: ${menuItem.name} -> ${francesaMatch.name}`);
                menuItem = francesaMatch;
              }
            }
          }
        }

        this.logger.log(`[parseOrder]  Encontrado: ${menuItem.name}`);

        const additions: any[] = [];
        const rawAdditions = Array.isArray(rawItem.additions) ? rawItem.additions : [];
        for (const addId of rawAdditions) {
          let cleanAddId = addId || '';
          if (cleanAddId.startsWith('[ID:')) {
            cleanAddId = cleanAddId.replace('[ID:', '').replace(']', '').trim();
          }
          let add = dbItems.find(i => i.id === cleanAddId);
          if (!add && cleanAddId) {
            const normAdd = this.normalizeSpanishLookup(cleanAddId);
            add = dbItems.find(i => this.normalizeSpanishLookup(i.name) === normAdd)
              || dbItems.find(i => this.normalizeSpanishLookup(i.name).includes(normAdd) || normAdd.includes(this.normalizeSpanishLookup(i.name)));
          }
          if (add) additions.push(add);
        }

        let cleanItemNotes = typeof rawItem.notes === 'string' ? rawItem.notes.trim() : '';
        const parsedItemQty = Math.min(99, Math.max(1, Math.trunc(Number(rawItem.quantity) || 1)));

        if (cleanItemNotes) {
          // Quitar consultas directas de precios
          cleanItemNotes = cleanItemNotes.replace(/\b(?:que\s+precio\s+tiene|cuanto\s+cuesta|cuanto\s+vale|que\s+cuesta|a\s+como|a\s+cómo|que\s+vale|que\s+precio)\b/gi, ' ');
          cleanItemNotes = cleanItemNotes.replace(/[?¿]/g, ' ');

          // Quitar repeticiones de cantidades y nombres de producto/variantes dentro de la nota
          cleanItemNotes = cleanItemNotes.replace(/\b\d+\s*(?:x\s*)?(?:perros?|hamburguesas?|pizzas?|salchipapas?|desgranados?|suizos?|patacones?)?\s*(?:sencill[oa]s?|especial(?:es)?|gratina[do]s?|mixt[oa]s?|personal(?:es)?|familiar(?:es)?|chica|combo|tradicional|clasic[oa]s?|grande|pequeñ[oa]s?)\b/gi, ' ');
          cleanItemNotes = cleanItemNotes.replace(/\b\d+\s+(sin|con)\b/gi, '$1');

          cleanItemNotes = cleanItemNotes
            .replace(/\(\s*\$\s*[\d.,]+\s*\)/gi, '')
            .replace(/\[\s*\$\s*[\d.,]+\s*\]/gi, '')
            .replace(/\$\s*[\d.,]+/g, '')
            .replace(/\b\d{1,3}(?:\.\d{3})+(?:\s*(?:pesos|cop|mil|k))?\b/gi, '')
            .replace(/\b\d{4,}(?:\s*(?:pesos|cop|mil|k))?\b/gi, '');

          if (menuItem) {
            const parenMatches = menuItem.name.match(/\(([^)]+)\)/g) || [];
            for (const p of parenMatches) {
              const inside = p.replace(/[()]/g, '').trim();
              if (inside.length > 2) {
                cleanItemNotes = cleanItemNotes.replace(new RegExp(`\\b${inside.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi'), '');
              }
            }
            const cleanProdName = menuItem.name.replace(/\([^)]+\)/g, '').trim();
            if (cleanProdName.length > 2) {
              cleanItemNotes = cleanItemNotes.replace(new RegExp(`\\b${cleanProdName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi'), '');
            }
          }

          cleanItemNotes = cleanItemNotes.replace(/\s+/g, ' ').trim();

          // Si después de limpiar solo quedó una repetición de cantidad/variante/producto (ej: "3 sencillo", "sencillo", "gratinada", "gra")
          const isPureProductOrQty = /^(?:\d+\s*(?:x\s*)?)?(?:perros?|hamburguesas?|pizzas?|salchipapas?|desgranados?|suizos?|patacones?)?\s*(?:sencill[oa]s?|especial(?:es)?|gratina[do]s?|mixt[oa]s?|personal(?:es)?|familiar(?:es)?|chica|combo|tradicional|clasic[oa]s?|grande|pequeñ[oa]s?|super|gra\b)?\s*$/i.test(cleanItemNotes);
          if (isPureProductOrQty) {
            cleanItemNotes = '';
          }

          // Limpiar delimitadores iniciales y finales respetando la nota completa del cliente
          if (cleanItemNotes) {
            cleanItemNotes = cleanItemNotes.replace(/^[—–\-|,.\s]+|[—–\-|,.\s]+$/g, '').trim();
          }
        }

        // Si la nota original especificaba una cantidad parcial (ej: "1 sin cebolla" cuando quantity es 2)
        const rawNoteStr = String(rawItem.notes || '');
        const wordToNum: Record<string, number> = { 'un': 1, 'una': 1, 'uno': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5 };
        const partialMatch = rawNoteStr.match(/(?:^|\s)(\d+|un|una|uno|dos|tres|cuatro|cinco)\s+(?:sin|con|solo\s+con)\s+([a-záéíóúüñA-ZÁÉÍÓÚÜÑ\s,/.\-–—]+)/i);
        let partialQty = 0;
        if (partialMatch) {
          const rawPart = partialMatch[1].toLowerCase();
          partialQty = parseInt(rawPart, 10) || wordToNum[rawPart] || 0;
        }

        if (cleanItemNotes && partialQty > 0 && partialQty < parsedItemQty) {
          parsedCartItems.push({
            menuItem,
            quantity: partialQty,
            preference: typeof rawItem.preference === 'string' ? rawItem.preference.trim().slice(0, 300) : '',
            notes: cleanItemNotes,
            additions
          });
          parsedCartItems.push({
            menuItem,
            quantity: parsedItemQty - partialQty,
            preference: typeof rawItem.preference === 'string' ? rawItem.preference.trim().slice(0, 300) : '',
            notes: '',
            additions: []
          });
        } else {
          parsedCartItems.push({
            menuItem,
            quantity: parsedItemQty,
            preference: typeof rawItem.preference === 'string' ? rawItem.preference.trim().slice(0, 300) : '',
            notes: cleanItemNotes,
            additions
          });
        }
      }

      const paymentMethod = rawJson.paymentMethod === 'CASH' || rawJson.paymentMethod === 'TRANSFER'
        ? rawJson.paymentMethod
        : null;

      // Validar y resolver zoneId en base a las zonas de la base de datos
      let resolvedZoneId = rawJson.zoneId || null;
      let resolvedNeighborhood = rawJson.customerNeighborhood || null;

      if (resolvedZoneId) {
        const foundZone = dbZones.find(z => z.id === resolvedZoneId);
        if (foundZone) {
          resolvedNeighborhood = foundZone.name;
        } else {
          resolvedZoneId = null;
        }
      }

      if (!resolvedZoneId && resolvedNeighborhood) {
        const normSearch = this.normalizeSpanishLookup(resolvedNeighborhood);
        const matchedZone = dbZones.find(z => this.normalizeSpanishLookup(z.name) === normSearch);
        if (matchedZone) {
          resolvedZoneId = matchedZone.id;
          resolvedNeighborhood = matchedZone.name;
        }
      }

      const addedBeverageCores = new Set(
        parsedCartItems
          .filter(item => this.isBeverageMenuItem(item.menuItem))
          .map(item => this.beverageCore(item.menuItem.name))
          .filter(Boolean),
      );

      const cleanedUnresolvedBeverages = Array.from(new Set([
        ...unresolvedBeverages,
        ...(Array.isArray(rawJson.unresolvedBeverages)
          ? rawJson.unresolvedBeverages.filter((value: unknown) => typeof value === 'string').map((value: string) => value.trim().slice(0, 120)).filter(Boolean)
          : []),
      ])).filter(entry => {
        const normEntry = this.normalizeSpanishLookup(entry);
        if (!/\bvidrio\b/i.test(normEntry)) {
          for (const core of addedBeverageCores) {
            if (normEntry.includes(core) || core.includes(normEntry)) return false;
          }
        }
        return true;
      });

      return {
        parsedCartItems,
        unresolvedBeverages: cleanedUnresolvedBeverages,
        detectedOrderType,
        independentNotes: Array.isArray(rawJson.independentNotes)
          ? rawJson.independentNotes.filter((note: unknown) => typeof note === 'string').map((note: string) => note.trim().slice(0, 300)).filter(Boolean)
          : [],
        customerName: typeof rawJson.customerName === 'string' ? rawJson.customerName.trim().slice(0, 100) || null : null,
        customerPhone: typeof rawJson.customerPhone === 'string' ? rawJson.customerPhone.trim().slice(0, 35) || null : null,
        customerAddress: typeof rawJson.customerAddress === 'string' ? rawJson.customerAddress.trim().slice(0, 250) || null : null,
        customerAddressReference: typeof rawJson.customerAddressReference === 'string' ? rawJson.customerAddressReference.trim().slice(0, 250) || null : null,
        customerNeighborhood: typeof resolvedNeighborhood === 'string' ? resolvedNeighborhood.trim().slice(0, 120) || null : null,
        zoneId: resolvedZoneId,
        paymentMethod,
        modelUsed,
      };

    } catch (err) {
      this.logger.error('Error al parsear pedido con Gemini:', err);
      throw new Error(`Error al procesar el pedido con Inteligencia Artificial: ${err.message}`);
    }
  }

  private getMediaIdFromContent(content: string): string {
    const rawMediaId = String(content || '').split('|')[0].trim();
    if (!rawMediaId) return '';
    return rawMediaId.includes('/') ? (rawMediaId.split('/').pop() || '') : rawMediaId;
  }

  private async transcribeIncomingAudio(params: {
    session: any;
    messageId: string;
    mediaId: string;
    content: string;
  }): Promise<void> {
    const readerEnabled = await this.getSetting('order_reader_enabled');
    if (readerEnabled !== 'true') return;

    const rawApiKeys = await this.getSetting('gemini_api_key');
    const apiKeys = String(rawApiKeys || '').split(',').map(key => key.trim()).filter(Boolean);
    if (apiKeys.length === 0) return;

    const media = await this.getMediaBuffer(params.mediaId);
    if (!media?.buffer?.length) {
      this.logger.warn(`No fue posible descargar la nota de voz ${params.mediaId} para transcribirla.`);
      return;
    }

    // WhatsApp limita las notas de voz entrantes; este tope evita saturar la
    // memoria si un proveedor entrega un archivo anormalmente grande.
    if (media.buffer.length > 20 * 1024 * 1024) {
      this.logger.warn(`La nota de voz ${params.mediaId} excede 20 MB y no se transcribirá automáticamente.`);
      return;
    }

    const audioData = media.buffer.toString('base64');
    const mimeType = String(media.contentType || 'audio/ogg').split(';')[0].trim() || 'audio/ogg';
    const prompt = `Transcribe esta nota de voz de WhatsApp en español colombiano.

Devuelve únicamente la transcripción, sin saludo, sin resumen, sin markdown y sin inventar datos. Conserva cantidades, productos, direcciones, barrios, forma de pago y notas de cocina como “sin cebolla”, “sin salsa” o “con más queso”.`;
    let transcript = '';
    let modelUsed = '';
    const modelsToTry = await this.getGeminiModels();

    for (const key of this.getGeminiKeyCandidates(apiKeys)) {
      if (this.isGeminiKeyOnCooldown(key)) continue;
      for (const model of modelsToTry) {
        if (this.isGeminiKeyOnCooldown(key)) break;
        try {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    { inlineData: { mimeType, data: audioData } },
                    { text: prompt },
                  ],
                }],
                generationConfig: this.buildGeminiGenerationConfig(model, { maxOutputTokens: 1000 }),
              }),
              signal: AbortSignal.timeout(12_000),
            },
          );

          if (!response.ok) {
            if (response.status === 429 || response.status === 403) {
              await this.putGeminiKeyOnCooldown(key, response);
              break;
            }
            this.logger.warn(`Modelo ${model} no pudo transcribir audio: HTTP ${response.status}.`);
            continue;
          }

          const data: any = await response.json();
          transcript = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 3_000);
          if (transcript) {
            modelUsed = model;
            await this.incrementGeminiUsage();
            break;
          }
        } catch (error: any) {
          const safeError = this.sanitizeGeminiError(error, apiKeys);
          this.logger.warn(`Error transcribiendo audio con ${model} y la llave (...${key.slice(-4)}): ${safeError}`);
        }
      }
      if (transcript) break;
    }

    if (!transcript) return;

    const transcriptLabel = `📝 Transcripción: ${transcript}`;
    const contentWithTranscript = params.content.includes('|')
      ? `${params.content}

${transcriptLabel}`
      : `${params.content}|${transcriptLabel}`;
    const updated = await this.prisma.whatsAppMessage.update({
      where: { id: params.messageId },
      data: { content: contentWithTranscript },
    });

    this.socketGateway.emitWhatsApp('whatsappAudioTranscribed', {
      messageId: updated.id,
      waMessageId: updated.waMessageId,
      sessionId: params.session.id,
      phone: params.session.phone,
      customerName: params.session.customerName || params.session.phone,
      content: contentWithTranscript,
      transcript,
      modelUsed,
      createdAt: updated.createdAt,
    });
  }

  private async handleAudioWithGemini(session: any, mediaId: string): Promise<boolean> {
    try {
      const rawApiKeys = await this.getSetting('gemini_api_key');
      if (!rawApiKeys) return false;
      const apiKeys = rawApiKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);
      if (apiKeys.length === 0) return false;

      const media = await this.getMediaBuffer(mediaId);
      if (!media || !media.buffer) return false;

      const base64Audio = media.buffer.toString('base64');
      const mimeType = media.contentType.split(';')[0].trim() || 'audio/ogg';

      const [configuredMenuUrl, restaurantHours, aiInstructions, paymentQrMode, paymentAccountText] = await Promise.all([
        this.getSetting('digital_menu_url'),
        this.getSetting('restaurant_hours'),
        this.getSetting('chatbot_ai_instructions'),
        this.getSetting('chatbot_payment_qr_mode'),
        this.getSetting('chatbot_payment_account_text'),
      ]);
      const digitalMenuUrl = this.getShareableDigitalMenuUrl(configuredMenuUrl);
      const audioMenuLinkRule = digitalMenuUrl
        ? `Si pide el menú o una categoría, muestra los productos y precios y puedes añadir este enlace al final: ${digitalMenuUrl}.`
        : 'Si pide el menú o una categoría, muestra los productos y precios directamente en el chat. No incluyas enlaces porque todavía no hay un dominio público configurado.';
      const paymentInstruction = paymentQrMode === 'IMAGE'
        ? 'Para transferencias se utiliza el QR oficial. No inventes números de cuenta; indica que un asesor enviará el QR.'
        : paymentAccountText
          ? `Datos oficiales para transferencias:\n${paymentAccountText}`
          : 'No hay datos de transferencia configurados. No inventes cuentas y pide apoyo a un asesor.';
      const customInstructionsBlock = aiInstructions?.trim()
        ? `\nINSTRUCCIONES ADICIONALES CONFIGURADAS POR ADMINISTRACIÓN:\n${aiInstructions.trim()}\n`
        : '';

      const dbItems = await this.prisma.menuItem.findMany({
        where: { active: true },
        include: { category: { select: { name: true } } },
        orderBy: [{ category: { name: 'asc' } }, { price: 'asc' }]
      });

      const itemsByCategory: Record<string, string[]> = {};
      dbItems.forEach(i => {
        const catName = i.category?.name || 'General';
        if (!itemsByCategory[catName]) itemsByCategory[catName] = [];
        itemsByCategory[catName].push(`- ${i.name}: $${i.price.toLocaleString('de-DE')}`);
      });
      const menuSummary = Object.entries(itemsByCategory)
        .map(([cat, items]) => `*${cat.toUpperCase()}*\n${items.join('\n')}`)
        .join('\n\n');

      const systemPrompt = `
Eres la persona encargada de atender de forma directa el WhatsApp del restaurante "The Villa Dog" en Montería, Colombia.
Estás escuchando una NOTA DE VOZ que envió un cliente por WhatsApp.
${customInstructionsBlock}

INSTRUCCIONES CRÍTICAS:
1. Escucha atentamente la nota de voz adjunta.
2. Responde a la inquietud o pedido del cliente de forma muy amable, humana y clara.
3. PAUTAS DE ESTILO Y MENÚ DUAL:
- ABSOLUTAMENTE PROHIBIDO USAR EMOJIS. No uses caritas ni símbolos. Solo texto normal con puntuación estándar.
- ${audioMenuLinkRule}
- SI EL CLIENTE PREGUNTA QUÉ LE RECOMIENDAS O PIDE SUGERENCIA EN EL AUDIO: No mandes la lista de categorías. Recomienda con entusiasmo 2 o 3 platos estrellas usando únicamente el menú oficial.
- SI EL CLIENTE MENCIONA UNA CATEGORÍA ESPECÍFICA (ej: "pizzas", "perros", "hamburguesas", "salchipapas"): Muestra los platos y precios de esa categoría en el chat.

HORARIO CONFIGURADO:
${restaurantHours || 'Horario por confirmar con un asesor.'}

PAGOS:
${paymentInstruction}

Menú del restaurante:
${menuSummary}
`;

      let replyText: string | null = null;
      const modelsToTry = await this.getGeminiModels();

      for (const key of this.getGeminiKeyCandidates(apiKeys)) {
        if (this.isGeminiKeyOnCooldown(key)) continue;
        for (const model of modelsToTry) {
          if (this.isGeminiKeyOnCooldown(key)) break;
          try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
            const payload = {
              contents: [{
                parts: [
                  {
                    inlineData: {
                    mimeType: mimeType,
                    data: base64Audio
                  }
                },
                {
                  text: systemPrompt
                }
              ]
            }],
            generationConfig: this.buildGeminiGenerationConfig(model, {
              temperature: 0.3,
              maxOutputTokens: 500,
            })
          };

          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(12000)
          });

          if (res.ok) {
            const data = await res.json();
            const candidateReply = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
            if (this.isMeaningfulGeminiReply(candidateReply)) {
              replyText = candidateReply;
              await this.incrementGeminiUsage();
              break;
            }
          } else {
            if (res.status === 429 || res.status === 403) {
              await this.putGeminiKeyOnCooldown(key, res);
              break;
            }
            const errBody = await res.text();
            const safeError = this.sanitizeGeminiError(errBody, apiKeys);
            this.logger.warn(`Modelo ${model} devolvió HTTP ${res.status}: ${safeError}`);
          }
        } catch (e: any) {
          const safeError = this.sanitizeGeminiError(e, apiKeys);
          this.logger.warn(`Error procesando audio con modelo ${model} y Gemini key (...${key.slice(-4)}): ${safeError}`);
        }
      }
      if (replyText) break;
    }

      if (replyText) {
        replyText = replyText.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
        
        if (digitalMenuUrl && !replyText.includes(digitalMenuUrl)) {
          const lowerText = replyText.toLowerCase();
          if (lowerText.includes('menú') || lowerText.includes('menu') || lowerText.includes('carta') || lowerText.includes('opciones')) {
            replyText += `\n\nPuedes ver nuestra carta digital interactiva con fotos aquí: ${digitalMenuUrl}`;
          }
        }

        await this.sendMessage(session.phone, replyText);
        return true;
      }
      return false;
    } catch (err) {
      this.logger.error('Error procesando nota de voz con Gemini:', err);
      return false;
    }
  }

  private async handleMultimediaChatbot(session: any, type: string, mediaId: string) {
    try {
      const closedReply = await this.getClosedBusinessReply();
      if (closedReply) {
        await this.sendMessage(session.phone, closedReply);
        return;
      }

      if (session.assignedToId || session.waitingForAdvisor) {
        return;
      }

      const chatbotEnabled = await this.getSetting('chatbot_enabled');
      if (chatbotEnabled !== 'true') return;

      if (type === 'audio') {
        const handledByAi = await this.handleAudioWithGemini(session, mediaId);
        if (handledByAi) {
          return;
        }

        const text = `He recibido tu mensaje de voz. En un momento uno de nuestros asesores lo escuchara y te respondera personalmente. Gracias por tu paciencia.`;
        await this.sendMessage(session.phone, text);
      } else if (type === 'image') {
        const text = `He recibido tu imagen. La he compartido con nuestros asesores para que la revisen de inmediato. Gracias.`;
        await this.sendMessage(session.phone, text);
      } else if (type === 'document') {
        const text = `He recibido tu documento. Lo he compartido con nuestros asesores para que lo revisen. Gracias.`;
        await this.sendMessage(session.phone, text);
      } else {
        return;
      }

      await this.prisma.whatsAppSession.update({
        where: { id: session.id },
        data: { waitingForAdvisor: true },
      });

      this.socketGateway.emitWhatsApp('whatsappAgentRequest', {
        sessionId: session.id,
        phone: session.phone,
        customerName: session.customerName,
        waitingForAdvisor: true,
      });
    } catch (err) {
      this.logger.error('Error en chatbot multimedia:', err);
    }
  }

  async incrementGeminiUsage() {
    const today = new Date().toISOString().split('T')[0];
    const key = `gemini_usage_${today}`;
    try {
      // Un único UPSERT evita perder incrementos cuando varias respuestas llegan a la vez.
      // La clave de cada día permanece en la tabla para consultar el historial.
      await this.prisma.$executeRaw`
        INSERT INTO "app_settings" ("id", "key", "value", "updatedAt")
        VALUES (${randomUUID()}, ${key}, '1', NOW())
        ON CONFLICT ("key") DO UPDATE SET
          "value" = ("app_settings"."value"::bigint + 1)::text,
          "updatedAt" = NOW()
      `;
    } catch (err) {
      this.logger.error('Error incrementando uso de Gemini:', err);
    }
  }

  async getGeminiUsageDaily(days = 30): Promise<Array<{ date: string; success: number }>> {
    const today = new Date();
    const todayDate = today.toISOString().slice(0, 10);
    const firstDay = new Date(Date.UTC(
      today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - days + 1,
    )).toISOString().slice(0, 10);
    try {
      const settings = await this.prisma.appSetting.findMany({
        where: {
          key: {
            gte: `gemini_usage_${firstDay}`,
            lte: `gemini_usage_${todayDate}`,
          },
        },
        select: { key: true, value: true },
        orderBy: { key: 'desc' },
      });
      const daily = settings.flatMap(({ key, value }) => {
        if (!/^gemini_usage_\d{4}-\d{2}-\d{2}$/.test(key)) return [];
        const success = Number(value);
        if (!Number.isSafeInteger(success) || success < 0) return [];
        return [{ date: key.slice('gemini_usage_'.length), success }];
      });
      if (daily[0]?.date !== todayDate) daily.unshift({ date: todayDate, success: 0 });
      return daily;
    } catch (err) {
      this.logger.error('Error consultando historial de uso de Gemini:', err);
      return [{ date: todayDate, success: 0 }];
    }
  }

  async getGeminiUsageToday(): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const key = `gemini_usage_${today}`;
    try {
      const setting = await this.prisma.appSetting.findUnique({ where: { key } });
      return setting ? Number(setting.value) : 0;
    } catch {
      return 0;
    }
  }

  private async getSetting(key: string): Promise<string | null> {
    const cached = this.settingCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const s = await this.prisma.appSetting.findUnique({ where: { key } });
    const rawValue = s?.value || this.config.get(key.toUpperCase()) || null;
    const value = key === 'digital_menu_url' ? this.resolveDigitalMenuUrl(rawValue) : rawValue;
    this.settingCache.set(key, { value, expiresAt: Date.now() + 60_000 });
    return value;
  }

  private checkIfWithinBusinessHours(hoursStr: string): boolean {
    if (!hoursStr) return true;
    try {
      const parts = hoursStr.split('-').map(p => p.trim());
      if (parts.length !== 2) return true;

      const parseTime = (str: string) => {
        const isPM = /pm/i.test(str);
        const isAM = /am/i.test(str);
        const clean = str.replace(/am|pm/gi, '').trim();
        let [h, m] = clean.split(':').map(Number);
        if (isNaN(h)) h = 0;
        if (isNaN(m)) m = 0;
        if (isPM && h < 12) h += 12;
        if (isAM && h === 12) h = 0;
        return h * 60 + m;
      };

      const startMin = parseTime(parts[0]);
      const endMin = parseTime(parts[1]);

      const now = new Date();
      // Zona horaria de Colombia GMT-5
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      const colombiaTime = new Date(utc + (3600000 * -5));
      const nowMin = colombiaTime.getHours() * 60 + colombiaTime.getMinutes();

      if (startMin <= endMin) {
        return nowMin >= startMin && nowMin <= endMin;
      } else {
        return nowMin >= startMin || nowMin <= endMin;
      }
    } catch (err) {
      return true;
    }
  }

  async getOrderChat(orderId: string, before?: string, requestedLimit?: number, beforeId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        customerPhone: true,
        customerAddress: true,
        total: true,
        status: true,
        orderType: true,
        paymentMethod: true,
        paymentStatus: true,
        cashAmount: true,
        transferAmount: true,
        chatSessionId: true,
        transferProofs: {
          orderBy: { createdAt: 'desc' },
          select: receiptSummary,
        },
      },
    });

    if (!order) {
      throw new BadRequestException('Pedido no encontrado');
    }

    let session: any = null;

    if (order.chatSessionId) {
      session = await this.prisma.whatsAppSession.findUnique({
        where: { id: order.chatSessionId },
      });
    }

    if (!session && order.customerPhone) {
      const senderPhones = this.senderPhoneVariants(order.customerPhone);
      if (senderPhones.length > 0) {
        const candidates = await this.prisma.whatsAppSession.findMany({
          where: { phone: { in: senderPhones } },
          orderBy: { lastMessageAt: 'desc' },
          take: 2,
        });
        // Solo enlazamos pedidos antiguos cuando existe una única sesión
        // inequívoca. Si hay dos conversaciones con el mismo número, elegir la
        // más reciente podría abrir o editar el pedido de otro chat.
        session = candidates.length === 1 ? candidates[0] : null;

        if (session && !order.chatSessionId) {
          const linked = await this.prisma.order.updateMany({
            where: { id: order.id, chatSessionId: null },
            data: { chatSessionId: session.id },
          }).catch(() => ({ count: 0 }));
          if (linked.count === 0) {
            // Otra operación enlazó el pedido primero. Volvemos a leer el
            // vínculo real y no usamos el candidato calculado con datos viejos.
            const current = await this.prisma.order.findUnique({
              where: { id: order.id },
              select: { chatSessionId: true },
            });
            session = current?.chatSessionId
              ? await this.prisma.whatsAppSession.findUnique({ where: { id: current.chatSessionId } })
              : null;
          }
        }
      }
    }

    const pageSize = Number.isFinite(requestedLimit)
      ? Math.min(80, Math.max(20, Math.trunc(requestedLimit!)))
      : 40;
    let messages: any[] = [];
    let hasPreviousMessages = false;
    if (session) {
      // Pedimos una fila adicional para saber si hay historial anterior, sin
      // cargar las 100 burbujas y archivos asociados al abrir el modal.
      const messagePage = await this.getSessionMessages(session.id, before, pageSize + 1, beforeId);
      hasPreviousMessages = messagePage.length > pageSize;
      messages = hasPreviousMessages ? messagePage.slice(1) : messagePage;
    }

    // La respuesta conserva los campos que usa el modal, pero los bytes del
    // comprobante solo se sirven al pulsar "Ver comprobante".
    const transferProofs = (order.transferProofs || []).map((proof: any) => ({
      id: proof.id,
      status: proof.status,
      method: proof.method,
      amount: proof.amount,
      originalName: proof.originalName,
      mimeType: proof.mimeType,
      fileSize: proof.fileSize,
      rejectionReason: proof.rejectionReason,
      purgedAt: proof.purgedAt,
      reviewedAt: proof.reviewedAt,
      createdAt: proof.createdAt,
      paymentId: proof.paymentId,
      orderId: proof.orderId,
      tableId: proof.tableId,
      cashClosingId: proof.cashClosingId,
      submittedById: proof.submittedById,
      reviewedById: proof.reviewedById,
    }));
    const { transferProofs: _ignoredTransferProofs, ...orderSummary } = order;
    const oldestMessage = messages[0];

    return {
      order: orderSummary,
      session,
      messages,
      transferProofs,
      messagePage: {
        hasPrevious: hasPreviousMessages,
        before: hasPreviousMessages && oldestMessage?.createdAt
          ? new Date(oldestMessage.createdAt).toISOString()
          : null,
        beforeId: hasPreviousMessages ? oldestMessage?.id || null : null,
        limit: pageSize,
      },
    };
  }

  async getOrderChatProof(orderId: string, proofId: string) {
    const proof = await this.prisma.transferProof.findFirst({
      where: { id: proofId, orderId },
      select: {
        id: true,
        method: true,
        mimeType: true,
        fileBase64: true,
        filePath: true,
      },
    });
    if (!proof) {
      throw new NotFoundException('Comprobante no encontrado en este pedido');
    }
    return proof;
  }

  async sendOrderChatMessage(orderId: string, text: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new BadRequestException('Pedido no encontrado');
    }

    let sessionId = order.chatSessionId;
    if (!sessionId && order.customerPhone) {
      const chatInfo = await this.getOrderChat(orderId);
      sessionId = chatInfo.session?.id || null;
    }

    if (sessionId) {
      return this.sendDirectToSession(sessionId, text);
    }

    throw new BadRequestException('El pedido no tiene una conversación de WhatsApp única asociada. Ábrelo desde el chat correcto antes de enviar el mensaje.');
  }
}
