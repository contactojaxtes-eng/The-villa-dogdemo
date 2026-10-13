import {
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';
import { PrismaService } from '../prisma/prisma.service';

export type WhatsAppWebhookSiteContext = {
  siteId: string;
  phoneNumberId: string;
  accountId: string | null;
  source: 'ACCOUNT_ROUTE' | 'PRINCIPAL_LEGACY';
};

export type WhatsAppSiteMetaConfig = WhatsAppWebhookSiteContext & {
  businessAccountId: string | null;
  displayPhoneNumber: string | null;
  accessToken: string | null;
  verifyToken: string | null;
};

/**
 * Resuelve a qué sede pertenece un número de Meta. El webhook entrante usa
 * este contexto para impedir que dos números creen o actualicen el mismo chat.
 *
 * Los secretos de sedes nuevas viven en variables de entorno. La base solo
 * guarda el nombre de esas variables. La lectura histórica de AppSetting está
 * permitida exclusivamente para la sede principal.
 */
@Injectable()
export class WhatsAppSiteResolverService {
  private readonly logger = new Logger(WhatsAppSiteResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private normalizePhoneNumberId(value: unknown): string | null {
    const normalized = String(value || '').replace(/\s+/g, '');
    return /^\d{5,32}$/.test(normalized) ? normalized : null;
  }

  private async getPrincipalLegacySetting(key: string): Promise<string | null> {
    const row = await this.prisma.appSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    const envKey = key.toUpperCase();
    const value = String(row?.value || this.config.get<string>(envKey) || '').trim();
    return value || null;
  }

  private readSecretFromEnv(envKey: string | null | undefined): string | null {
    const key = String(envKey || '').trim();
    if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(key)) return null;
    const value = String(this.config.get<string>(key) || '').trim();
    return value || null;
  }

  private secretsEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async buildAccountMetaConfig(account: any): Promise<WhatsAppSiteMetaConfig> {
    const siteId = String(account.siteId);
    const accessToken = this.readSecretFromEnv(account.accessTokenEnvKey);
    const verifyToken = this.readSecretFromEnv(account.verifyTokenEnvKey);
    return {
      siteId,
      phoneNumberId: account.phoneNumberId,
      accountId: account.id,
      source: 'ACCOUNT_ROUTE',
      businessAccountId: account.businessAccountId || null,
      displayPhoneNumber: account.displayPhoneNumber || null,
      accessToken:
        accessToken ||
        (siteId === DEFAULT_SITE_ID
          ? await this.getPrincipalLegacySetting('whatsapp_token')
          : null),
      verifyToken:
        verifyToken ||
        (siteId === DEFAULT_SITE_ID
          ? await this.getPrincipalLegacySetting('whatsapp_verify_token')
          : null),
    };
  }

  private async getPrincipalLegacyMetaConfig(): Promise<WhatsAppSiteMetaConfig | null> {
    const phoneNumberId = this.normalizePhoneNumberId(
      await this.getPrincipalLegacySetting('whatsapp_phone_id'),
    );
    if (!phoneNumberId) return null;
    return {
      siteId: DEFAULT_SITE_ID,
      phoneNumberId,
      accountId: null,
      source: 'PRINCIPAL_LEGACY',
      businessAccountId: await this.getPrincipalLegacySetting(
        'whatsapp_business_account_id',
      ),
      displayPhoneNumber: await this.getPrincipalLegacySetting(
        'whatsapp_business_phone',
      ),
      accessToken: await this.getPrincipalLegacySetting('whatsapp_token'),
      verifyToken: await this.getPrincipalLegacySetting(
        'whatsapp_verify_token',
      ),
    };
  }

  /**
   * Resuelve únicamente el contexto del change recibido. Meta puede agrupar
   * changes de números distintos en un mismo webhook, por lo que cada uno debe
   * validarse de forma independiente antes de tocar conversaciones o estados.
   */
  async resolveIncomingWebhookChangeContext(
    change: any,
  ): Promise<WhatsAppWebhookSiteContext | null> {
    if (change?.field !== 'messages') return null;
    const phoneNumberId = this.normalizePhoneNumberId(
      change?.value?.metadata?.phone_number_id,
    );
    if (!phoneNumberId) return null;
    return this.resolveIncomingPhoneNumberId(phoneNumberId);
  }

  private async resolveIncomingPhoneNumberId(
    phoneNumberId: string,
  ): Promise<WhatsAppWebhookSiteContext | null> {
    const accounts = await this.prisma.whatsAppAccount.findMany({
      where: {
        phoneNumberId,
        active: true,
        site: { active: true },
      },
      select: { id: true, siteId: true, phoneNumberId: true },
      take: 2,
    });

    // La restricción UNIQUE lo impide en producción; esta defensa evita
    // enrutar datos si una restauración o un mock deja el catálogo ambiguo.
    if (accounts.length > 1) {
      throw new ConflictException(
        'El número de WhatsApp está asociado a más de una sede',
      );
    }
    if (accounts.length === 1) {
      return {
        siteId: accounts[0].siteId,
        phoneNumberId: accounts[0].phoneNumberId,
        accountId: accounts[0].id,
        source: 'ACCOUNT_ROUTE',
      };
    }

    // Compatibilidad estrictamente limitada al número histórico de la sede
    // principal, para que desplegar la base no cambie su comportamiento.
    const legacyPhoneId = this.normalizePhoneNumberId(
      await this.getPrincipalLegacySetting('whatsapp_phone_id'),
    );
    if (legacyPhoneId === phoneNumberId) {
      const principal = await this.prisma.site.findFirst({
        where: { id: DEFAULT_SITE_ID, active: true },
        select: { id: true },
      });
      if (principal) {
        return {
          siteId: DEFAULT_SITE_ID,
          phoneNumberId,
          accountId: null,
          source: 'PRINCIPAL_LEGACY',
        };
      }
    }

    this.logger.warn(
      `Webhook ignorado: phone_number_id ${phoneNumberId} no tiene una sede activa`,
    );
    return null;
  }

  /**
   * Devuelve las credenciales internas de una sede. Nunca debe enviarse este
   * objeto al frontend. Para una sede nueva no existe respaldo global.
   */
  async getSiteMetaConfig(
    siteId: string,
  ): Promise<WhatsAppSiteMetaConfig | null> {
    const account = await this.prisma.whatsAppAccount.findUnique({
      where: { siteId },
      include: { site: { select: { active: true } } },
    });

    if (account?.active && account.site.active) {
      return this.buildAccountMetaConfig(account);
    }

    if (siteId !== DEFAULT_SITE_ID) return null;
    return this.getPrincipalLegacyMetaConfig();
  }

  /**
   * Credenciales exclusivas para una comprobación GET de solo lectura contra
   * Meta. Permite revisar una sede en preparación, pero no habilita envíos ni
   * el procesamiento de webhooks entrantes.
   */
  async getPreparedSiteMetaConfig(
    siteId: string,
  ): Promise<WhatsAppSiteMetaConfig | null> {
    const account = await this.prisma.whatsAppAccount.findUnique({
      where: { siteId },
      include: {
        site: {
          select: {
            organization: { select: { active: true } },
          },
        },
      },
    });

    if (account) {
      if (!account.site?.organization?.active) return null;
      const phoneNumberId = this.normalizePhoneNumberId(account.phoneNumberId);
      if (!phoneNumberId) return null;
      return this.buildAccountMetaConfig({ ...account, phoneNumberId });
    }

    if (siteId !== DEFAULT_SITE_ID) return null;
    return this.getPrincipalLegacyMetaConfig();
  }

  /** La verificación GET de Meta no incluye phone_number_id. */
  async acceptsVerificationToken(candidate: string): Promise<boolean> {
    const supplied = String(candidate || '').trim();
    if (!supplied) return false;

    const accounts = await this.prisma.whatsAppAccount.findMany({
      where: {
        verifyTokenEnvKey: { not: null },
        site: { organization: { active: true } },
      },
      select: { verifyTokenEnvKey: true },
    });
    for (const account of accounts) {
      const expected = this.readSecretFromEnv(account.verifyTokenEnvKey);
      if (expected && this.secretsEqual(supplied, expected)) return true;
    }

    const legacy = await this.getPrincipalLegacySetting(
      'whatsapp_verify_token',
    );
    return Boolean(legacy && this.secretsEqual(supplied, legacy));
  }
}
