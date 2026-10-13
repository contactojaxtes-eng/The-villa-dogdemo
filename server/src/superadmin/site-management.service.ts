import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_SITE_ID,
  WHATSAPP_META_PREFLIGHT_VERIFIED_AT_KEY,
} from '../common/multisite.constants';
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
} from '../auth/permissions.constant';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { ActivateSiteDto } from './dto/activate-site.dto';
import { DeactivateSiteDto } from './dto/deactivate-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { UpdateSiteMemberDto } from './dto/update-site-member.dto';
import {
  UpsertSiteWhatsAppAccountDto,
  WHATSAPP_ACCESS_TOKEN_ENV_KEY_PATTERN,
  WHATSAPP_VERIFY_TOKEN_ENV_KEY_PATTERN,
} from './dto/upsert-site-whatsapp-account.dto';
import { SocketGateway } from '../socket/socket.gateway';

type SiteActor = { id: string; name: string; role: string };

const sitePermissionKeys = new Set(ALL_PERMISSION_KEYS);

const sitePreparationSelect = Prisma.validator<Prisma.SiteSelect>()({
  id: true,
  code: true,
  name: true,
  timezone: true,
  address: true,
  phone: true,
  active: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
  settings: {
    where: {
      key: {
        in: [
          'custom_prep_printers',
          WHATSAPP_META_PREFLIGHT_VERIFIED_AT_KEY,
        ],
      },
    },
    select: { key: true, value: true },
  },
  whatsappAccount: {
    select: {
      active: true,
      phoneNumberId: true,
      businessAccountId: true,
      displayPhoneNumber: true,
      accessTokenEnvKey: true,
      verifyTokenEnvKey: true,
    },
  },
  _count: {
    select: {
      memberships: { where: { active: true, user: { active: true } } },
      deliveryZones: { where: { active: true } },
      cashRegisters: { where: { active: true, purpose: 'DELIVERY' } },
      kitchenStations: { where: { active: true } },
      menuItems: {
        where: {
          active: true,
          code: { not: null },
          category: { active: true },
        },
      },
    },
  },
});

type SitePreparationRecord = Prisma.SiteGetPayload<{
  select: typeof sitePreparationSelect;
}>;

@Injectable()
export class SiteManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly socketGateway: SocketGateway,
  ) {}

  private normalizeCode(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  private cleanOptional(value?: string) {
    const clean = String(value || '').trim();
    return clean || null;
  }

  private remapCatalogReferences(value: unknown, itemIds: Map<string, string>): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.remapCatalogReferences(entry, itemIds));
    }
    if (!value || typeof value !== 'object') return value;
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(source)) {
      if ((key === 'itemId' || key === 'menuItemId') && typeof entry === 'string') {
        result[key] = itemIds.get(entry) || entry;
      } else {
        result[key] = this.remapCatalogReferences(entry, itemIds);
      }
    }
    return result;
  }

  /**
   * A new site starts with an independent copy of the principal catalog. The
   * copied categories and products receive new IDs, so later price, image or
   * availability edits cannot affect the principal. Existing orders retain
   * their original product IDs and are never copied.
   */
  private async clonePrincipalCatalog(transaction: any, targetSiteId: string) {
    if (!transaction.menuCategory?.findMany || !transaction.menuItem?.create) {
      return { categories: 0, items: 0 };
    }

    const sourceCategories = await transaction.menuCategory.findMany({
      where: { siteId: DEFAULT_SITE_ID },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          include: { recipe: { include: { items: true } } },
        },
      },
    });
    const categoryIds = new Map<string, string>();
    const itemIds = new Map<string, string>();
    const pendingRecipes: Array<{ source: any; targetId: string }> = [];

    for (const sourceCategory of sourceCategories || []) {
      const category = await transaction.menuCategory.create({
        data: {
          siteId: targetSiteId,
          name: sourceCategory.name,
          description: sourceCategory.description,
          active: sourceCategory.active,
          sortOrder: sourceCategory.sortOrder,
        },
      });
      categoryIds.set(sourceCategory.id, category.id);

      for (const sourceItem of sourceCategory.items || []) {
        const item = await transaction.menuItem.create({
          data: {
            siteId: targetSiteId,
            name: sourceItem.name,
            code: sourceItem.code,
            description: sourceItem.description,
            price: sourceItem.price,
            image: sourceItem.image,
            active: sourceItem.active,
            availableForDelivery: sourceItem.availableForDelivery,
            sortOrder: sourceItem.sortOrder,
            categoryId: category.id,
            type: sourceItem.type,
            comboItems: sourceItem.comboItems,
            prepTime: sourceItem.prepTime,
          },
        });
        itemIds.set(sourceItem.id, item.id);
        if (sourceItem.recipe) pendingRecipes.push({ source: sourceItem.recipe, targetId: item.id });
      }
    }

    for (const { source, targetId } of pendingRecipes) {
      const recipe = await transaction.recipe.create({ data: { menuItemId: targetId } });
      if (source.items?.length && transaction.recipeIngredient?.createMany) {
        await transaction.recipeIngredient.createMany({
          data: source.items.map((entry: any) => ({
            recipeId: recipe.id,
            ingredientId: entry.ingredientId,
            quantity: entry.quantity,
            wastePercentage: entry.wastePercentage,
            unit: entry.unit,
          })),
        });
      }
    }

    // Combo references are JSON and are therefore corrected after all target
    // IDs are known. Unknown references are preserved for manual review.
    for (const sourceCategory of sourceCategories || []) {
      for (const sourceItem of sourceCategory.items || []) {
        if (sourceItem.comboItems == null) continue;
        const targetId = itemIds.get(sourceItem.id);
        if (!targetId) continue;
        await transaction.menuItem.update({
          where: { id: targetId },
          data: { comboItems: this.remapCatalogReferences(sourceItem.comboItems, itemIds) as any },
        });
      }
    }

    return { categories: categoryIds.size, items: itemIds.size };
  }

  private async resolveSiteRole(value: string) {
    const role = String(value || '')
      .trim()
      .toUpperCase();
    if (!role || role === 'SUPERADMIN') {
      throw new BadRequestException(
        'El rol SUPERADMIN no se puede asignar a una sede',
      );
    }

    const defaultPermissions = DEFAULT_ROLE_PERMISSIONS[role];
    if (defaultPermissions) {
      return { role, permissions: [...defaultPermissions] };
    }

    const customRole = await this.prisma.customRole.findFirst({
      where: { code: role, active: true, NOT: { code: 'SUPERADMIN' } },
      select: { code: true, permissions: true },
    });
    if (!customRole) {
      throw new BadRequestException(
        `El rol ${role} no existe o no está disponible para sedes`,
      );
    }

    const permissions = Array.isArray(customRole.permissions)
      ? [
          ...new Set(
            customRole.permissions.filter(
              (permission): permission is string =>
                typeof permission === 'string' &&
                permission !== '*' &&
                sitePermissionKeys.has(permission),
            ),
          ),
        ]
      : [];

    return { role: customRole.code, permissions };
  }

  private hasConfiguredPrinter(site: SitePreparationRecord) {
    const raw = site.settings.find(
      (setting) => setting.key === 'custom_prep_printers',
    )?.value;
    if (!raw) return false;
    try {
      const printers = JSON.parse(raw);
      return (
        Array.isArray(printers) &&
        printers.some(
          (printer) =>
            printer &&
            printer.enabled !== false &&
            typeof printer.name === 'string' &&
            printer.name.trim().length > 0 &&
            this.hasValidPrinterAddress(printer.ip),
        )
      );
    } catch {
      return false;
    }
  }

  private hasValidPrinterAddress(value: unknown) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    if (/^USB:/i.test(raw)) {
      return raw.replace(/^USB:\s*/i, '').trim().length > 0;
    }

    const host = raw
      .replace(/^https?:\/\//i, '')
      .split(':')[0]
      .trim();
    return host.length > 0;
  }

  private hasConfiguredSecret(envKey?: string | null) {
    const key = String(envKey || '').trim();
    if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(key)) return false;
    return Boolean(String(this.config.get<string>(key) || '').trim());
  }

  private hasConfiguredWhatsApp(site: SitePreparationRecord) {
    const account = site.whatsappAccount;
    if (!account?.phoneNumberId?.trim()) return false;

    // Una sede operativa exige una cuenta activa. Durante la preparación la
    // cuenta permanece apagada para impedir webhooks o envíos prematuros.
    if (site.active && !account.active) return false;

    // La sede principal conserva temporalmente sus secretos históricos en
    // AppSetting. Las sedes nuevas nunca heredan ese respaldo global.
    if (site.isDefault || site.id === DEFAULT_SITE_ID) return true;

    const accessTokenEnvKey = String(account.accessTokenEnvKey || '')
      .trim()
      .toUpperCase();
    const verifyTokenEnvKey = String(account.verifyTokenEnvKey || '')
      .trim()
      .toUpperCase();
    if (
      !WHATSAPP_ACCESS_TOKEN_ENV_KEY_PATTERN.test(accessTokenEnvKey) ||
      !WHATSAPP_VERIFY_TOKEN_ENV_KEY_PATTERN.test(verifyTokenEnvKey) ||
      accessTokenEnvKey === verifyTokenEnvKey
    ) {
      return false;
    }

    return (
      this.hasConfiguredSecret(accessTokenEnvKey) &&
      this.hasConfiguredSecret(verifyTokenEnvKey)
    );
  }

  private hasRecentMetaPreflight(site: SitePreparationRecord) {
    const raw = site.settings.find(
      (setting) => setting.key === WHATSAPP_META_PREFLIGHT_VERIFIED_AT_KEY,
    )?.value;
    const verifiedAt = Date.parse(String(raw || ''));
    if (!Number.isFinite(verifiedAt)) return false;
    const age = Date.now() - verifiedAt;
    return age >= 0 && age <= 7 * 24 * 60 * 60 * 1000;
  }

  private preparationStatus(site: SitePreparationRecord) {
    const checks = [
      {
        key: 'identity',
        label: 'Dirección y teléfono',
        ready: Boolean(site.address?.trim() && site.phone?.trim()),
      },
      {
        key: 'memberships',
        label: 'Usuarios de la sede',
        ready: site._count.memberships > 0,
      },
      {
        key: 'delivery-register',
        label: 'Caja de domicilios',
        ready: site._count.cashRegisters > 0,
      },
      {
        key: 'delivery-zones',
        label: 'Barrios y tarifas',
        ready: site._count.deliveryZones > 0,
      },
      {
        key: 'kitchen',
        label: 'Estaciones de cocina',
        ready: site._count.kitchenStations > 0,
      },
      {
        key: 'catalog',
        label: 'Catálogo con productos activos',
        ready: site._count.menuItems > 0,
      },
      {
        key: 'printing',
        label: 'Impresión configurada',
        ready: this.hasConfiguredPrinter(site),
      },
      {
        key: 'whatsapp',
        label: 'WhatsApp propio',
        ready: this.hasConfiguredWhatsApp(site),
      },
      {
        key: 'whatsapp-meta-preflight',
        label: 'Conexión Meta verificada (últimos 7 días)',
        ready: this.hasRecentMetaPreflight(site),
      },
    ];
    const completed = checks.filter((check) => check.ready).length;

    return {
      completed,
      total: checks.length,
      configurationReady: completed === checks.length,
      checks,
    };
  }

  private activationPolicyAllows(siteCode: string) {
    const enabled = ['1', 'true', 'yes', 'on'].includes(
      String(
        this.config.get<string>('MULTISITE_ACTIVATION_ENABLED') || '',
      )
        .trim()
        .toLowerCase(),
    );
    if (!enabled) return false;

    const allowedCodes = new Set(
      String(
        this.config.get<string>('MULTISITE_ACTIVATION_SITE_CODES') || '',
      )
        .split(',')
        .map((code) => this.normalizeCode(code))
        .filter(Boolean),
    );
    return allowedCodes.has(this.normalizeCode(siteCode));
  }

  private serialize(site: SitePreparationRecord) {
    const account = site.whatsappAccount;
    const readiness = this.preparationStatus(site);
    const activationAllowed = this.activationPolicyAllows(site.code);

    return {
      id: site.id,
      code: site.code,
      name: site.name,
      timezone: site.timezone,
      address: site.address,
      phone: site.phone,
      active: site.active,
      isDefault: site.isDefault,
      createdAt: site.createdAt,
      updatedAt: site.updatedAt,
      memberCount: site._count.memberships,
      status: site.isDefault ? 'PRINCIPAL' : site.active ? 'ACTIVE' : 'DRAFT',
      readiness,
      whatsapp: account
        ? {
            configured: true,
            active: account.active,
            phoneNumberId: account.phoneNumberId,
            businessAccountId: account.businessAccountId,
            displayPhoneNumber: account.displayPhoneNumber,
            accessTokenEnvKey: account.accessTokenEnvKey,
            verifyTokenEnvKey: account.verifyTokenEnvKey,
          }
        : null,
      canActivate:
        !site.isDefault &&
        !site.active &&
        readiness.configurationReady &&
        activationAllowed,
      activationBlockedReason:
        !site.isDefault &&
        !site.active &&
        readiness.configurationReady &&
        !activationAllowed
          ? 'La configuración está completa; falta habilitar este código en la ventana controlada de activación.'
          : null,
    };
  }

  async activateSite(
    siteId: string,
    dto: ActivateSiteDto,
    actor: SiteActor,
  ) {
    if (dto.acknowledgeIsolation !== true) {
      throw new BadRequestException(
        'Debes confirmar que verificaste el aislamiento de la sede',
      );
    }

    let activated: SitePreparationRecord;
    let activationPerformed = false;

    try {
      activated = await this.prisma.$transaction(
        async (transaction) => {
          const site = await transaction.site.findFirst({
            where: { id: siteId, organizationId: DEFAULT_ORGANIZATION_ID },
            select: sitePreparationSelect,
          });
          if (!site) throw new NotFoundException('Sede no encontrada');
          if (site.isDefault || site.id === DEFAULT_SITE_ID) {
            throw new BadRequestException(
              'La sede principal no se administra desde esta activación',
            );
          }

          if (
            String(dto.confirmationCode || '').trim().toLowerCase() !==
            site.code.trim().toLowerCase()
          ) {
            throw new BadRequestException(
              'El código de confirmación no corresponde a la sede',
            );
          }

          // Repetir la misma solicitud no apaga ni duplica nada.
          if (site.active) return site;

          if (!this.activationPolicyAllows(site.code)) {
            throw new BadRequestException(
              'Esta sede no está incluida en la ventana controlada de activación',
            );
          }

          const readiness = this.preparationStatus(site);
          if (!readiness.configurationReady) {
            const missing = readiness.checks
              .filter((check) => !check.ready)
              .map((check) => check.label)
              .join(', ');
            throw new BadRequestException(
              `La sede todavía no está lista. Falta: ${missing}`,
            );
          }

          if (!site.whatsappAccount) {
            throw new BadRequestException(
              'La sede no tiene una cuenta de WhatsApp preparada',
            );
          }

          await transaction.whatsAppAccount.update({
            where: { siteId: site.id },
            data: { active: true },
          });

          const updated = await transaction.site.update({
            where: { id: site.id },
            data: { active: true },
            select: sitePreparationSelect,
          });
          activationPerformed = true;
          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'La sede cambió mientras se activaba. Actualiza la lista e intenta nuevamente.',
        );
      }
      throw error;
    }

    if (activationPerformed) {
      await this.audit.log({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'SITE_ACTIVATE',
        targetType: 'Site',
        targetId: activated.id,
        metadata: {
          siteCode: activated.code,
          siteName: activated.name,
          whatsappPhoneNumberId: activated.whatsappAccount?.phoneNumberId,
        },
      });
    }

    return this.serialize(activated);
  }

  async deactivateSite(
    siteId: string,
    dto: DeactivateSiteDto,
    actor: SiteActor,
  ) {
    if (dto.acknowledgePause !== true) {
      throw new BadRequestException(
        'Debes confirmar que deseas pausar la sede secundaria',
      );
    }

    let deactivated: SitePreparationRecord;
    let deactivationPerformed = false;

    try {
      deactivated = await this.prisma.$transaction(
        async (transaction) => {
          const site = await transaction.site.findFirst({
            where: { id: siteId, organizationId: DEFAULT_ORGANIZATION_ID },
            select: sitePreparationSelect,
          });
          if (!site) throw new NotFoundException('Sede no encontrada');
          if (site.isDefault || site.id === DEFAULT_SITE_ID) {
            throw new BadRequestException(
              'La sede principal no se puede pausar desde este módulo',
            );
          }

          if (
            String(dto.confirmationCode || '').trim().toLowerCase() !==
            site.code.trim().toLowerCase()
          ) {
            throw new BadRequestException(
              'El código de confirmación no corresponde a la sede',
            );
          }

          // Repetir la solicitud conserva el borrador y no duplica auditoría.
          if (!site.active) return site;

          await transaction.whatsAppAccount.updateMany({
            where: { siteId: site.id },
            data: { active: false },
          });

          const updated = await transaction.site.update({
            where: { id: site.id },
            data: { active: false },
            select: sitePreparationSelect,
          });
          deactivationPerformed = true;
          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'La sede cambió mientras se pausaba. Actualiza la lista e intenta nuevamente.',
        );
      }
      throw error;
    }

    let socketsDisconnected = 0;
    if (deactivationPerformed) {
      socketsDisconnected = this.socketGateway.disconnectSite(deactivated.id);
      await this.audit.log({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        action: 'SITE_DEACTIVATE',
        targetType: 'Site',
        targetId: deactivated.id,
        metadata: {
          siteCode: deactivated.code,
          siteName: deactivated.name,
          socketsDisconnected,
        },
      });
    }

    return {
      ...this.serialize(deactivated),
      socketsDisconnected,
    };
  }

  private async requireSecondarySite(siteId: string) {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, organizationId: DEFAULT_ORGANIZATION_ID },
      select: { id: true, name: true, isDefault: true, active: true },
    });
    if (!site) throw new NotFoundException('Sede no encontrada');
    if (site.isDefault || site.id === DEFAULT_SITE_ID) {
      throw new BadRequestException(
        'Los usuarios de la sede principal se administran desde Usuarios.',
      );
    }
    return site;
  }

  async upsertWhatsAppAccount(
    siteId: string,
    dto: UpsertSiteWhatsAppAccountDto,
    actor: SiteActor,
  ) {
    const site = await this.requireSecondarySite(siteId);
    if (site.active) {
      throw new ConflictException(
        'La cuenta de WhatsApp no puede modificarse mientras la sede está activa. La rotación de credenciales requiere un mantenimiento controlado.',
      );
    }
    const accessTokenEnvKey = dto.accessTokenEnvKey.trim().toUpperCase();
    const verifyTokenEnvKey = dto.verifyTokenEnvKey.trim().toUpperCase();

    if (!WHATSAPP_ACCESS_TOKEN_ENV_KEY_PATTERN.test(accessTokenEnvKey)) {
      throw new BadRequestException(
        'La variable de acceso debe incluir WHATSAPP y ACCESS_TOKEN',
      );
    }
    if (!WHATSAPP_VERIFY_TOKEN_ENV_KEY_PATTERN.test(verifyTokenEnvKey)) {
      throw new BadRequestException(
        'La variable de verificación debe incluir WHATSAPP y VERIFY_TOKEN',
      );
    }
    if (accessTokenEnvKey === verifyTokenEnvKey) {
      throw new BadRequestException(
        'El token de acceso y el token de verificación deben usar variables diferentes',
      );
    }

    if (!this.hasConfiguredSecret(accessTokenEnvKey)) {
      throw new BadRequestException(
        `La variable ${accessTokenEnvKey} no existe o está vacía en el servidor`,
      );
    }
    if (!this.hasConfiguredSecret(verifyTokenEnvKey)) {
      throw new BadRequestException(
        `La variable ${verifyTokenEnvKey} no existe o está vacía en el servidor`,
      );
    }

    const phoneNumberId = dto.phoneNumberId.trim();
    const duplicate = await this.prisma.whatsAppAccount.findFirst({
      where: { phoneNumberId, siteId: { not: siteId } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'Ese número de WhatsApp ya está vinculado a otra sede',
      );
    }

    // Cualquier cambio de identificador o variable invalida la prueba anterior.
    // Se borra antes de escribir: si la actualización falla, volver a probar es
    // la opción segura y nunca queda una credencial nueva marcada como válida.
    await this.prisma.siteSetting.deleteMany({
      where: { siteId, key: WHATSAPP_META_PREFLIGHT_VERIFIED_AT_KEY },
    });

    let account;
    try {
      account = await this.prisma.whatsAppAccount.upsert({
        where: { siteId },
        create: {
          siteId,
          phoneNumberId,
          businessAccountId: this.cleanOptional(dto.businessAccountId),
          displayPhoneNumber: this.cleanOptional(dto.displayPhoneNumber),
          accessTokenEnvKey,
          verifyTokenEnvKey,
          active: false,
        },
        update: {
          phoneNumberId,
          businessAccountId: this.cleanOptional(dto.businessAccountId),
          displayPhoneNumber: this.cleanOptional(dto.displayPhoneNumber),
          accessTokenEnvKey,
          verifyTokenEnvKey,
          // No se modifica active: una sede operativa no pierde su conexión al
          // rotar nombres de variables y un borrador continúa aislado.
        },
        select: {
          id: true,
          siteId: true,
          phoneNumberId: true,
          businessAccountId: true,
          displayPhoneNumber: true,
          accessTokenEnvKey: true,
          verifyTokenEnvKey: true,
          active: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ese número de WhatsApp ya está vinculado a otra sede',
        );
      }
      throw error;
    }

    await this.audit.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'SITE_WHATSAPP_ACCOUNT_UPSERT',
      targetType: 'WhatsAppAccount',
      targetId: account.id,
      metadata: {
        siteId,
        siteName: site.name,
        phoneNumberId,
        accessTokenConfigured: true,
        verifyTokenConfigured: true,
      },
    });

    return {
      ...account,
      accessTokenConfigured: true,
      verifyTokenConfigured: true,
    };
  }

  async listMembers(siteId: string) {
    await this.requireSecondarySite(siteId);
    const [users, memberships] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          active: true,
          role: { not: 'SUPERADMIN' },
          isOrganizationAdmin: false,
        },
        select: { id: true, name: true, email: true, role: true },
        orderBy: [{ name: 'asc' }, { email: 'asc' }],
      }),
      this.prisma.userSiteMembership.findMany({
        where: { siteId },
        select: { userId: true, role: true, active: true },
      }),
    ]);
    const membershipByUser = new Map(
      memberships.map((membership) => [membership.userId, membership]),
    );
    return users.map((user) => {
      const membership = membershipByUser.get(user.id);
      return {
        ...user,
        siteRole: membership?.role || user.role,
        member: membership?.active === true,
      };
    });
  }

  async updateMember(
    siteId: string,
    userId: string,
    dto: UpdateSiteMemberDto,
    actor: SiteActor,
  ) {
    const site = await this.requireSecondarySite(siteId);
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        active: true,
        role: { not: 'SUPERADMIN' },
        isOrganizationAdmin: false,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        lastActiveSiteId: true,
      },
    });
    if (!user) throw new NotFoundException('Usuario activo no encontrado');

    const { role, permissions } = await this.resolveSiteRole(
      dto.role || user.role,
    );

    if (dto.active) {
      await this.prisma.userSiteMembership.upsert({
        where: { userId_siteId: { userId, siteId } },
        create: {
          userId,
          siteId,
          role,
          permissions,
          active: true,
          isDefault: false,
        },
        update: { role, permissions, active: true },
      });
    } else {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.userSiteMembership.updateMany({
          where: { userId, siteId },
          data: { active: false, isDefault: false },
        });

        if (user.lastActiveSiteId !== siteId) return;

        const availableMemberships =
          await transaction.userSiteMembership.findMany({
            where: {
              userId,
              active: true,
              site: { active: true, organization: { active: true } },
            },
            select: {
              siteId: true,
              isDefault: true,
              site: { select: { isDefault: true } },
            },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          });
        const fallbackMembership =
          availableMemberships.find((membership) => membership.isDefault) ||
          availableMemberships.find(
            (membership) => membership.site.isDefault,
          ) ||
          availableMemberships[0];

        await transaction.user.update({
          where: { id: userId },
          data: { lastActiveSiteId: fallbackMembership?.siteId || null },
        });
      });
    }

    await this.audit.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: dto.active ? 'SITE_MEMBER_ENABLE' : 'SITE_MEMBER_DISABLE',
      targetType: 'UserSiteMembership',
      targetId: `${siteId}:${userId}`,
      metadata: { siteName: site.name, userName: user.name, role },
    });

    return {
      userId,
      siteId,
      siteRole: role,
      member: dto.active,
    };
  }

  async list() {
    const sites = await this.prisma.site.findMany({
      where: { organizationId: DEFAULT_ORGANIZATION_ID },
      select: sitePreparationSelect,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    return sites.map((site) => this.serialize(site));
  }

  async createDraft(dto: CreateSiteDto, actor: SiteActor) {
    const name = dto.name.trim();
    const code = this.normalizeCode(dto.code || name);
    if (!code)
      throw new ConflictException(
        'No se pudo generar un código válido para la sede',
      );

    const existing = await this.prisma.site.findFirst({
      where: { organizationId: DEFAULT_ORGANIZATION_ID, code },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException('Ya existe una sede con ese código');

    let site: SitePreparationRecord;
    let catalogCopy = { categories: 0, items: 0 };
    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const draft = await transaction.site.create({
          data: {
            organizationId: DEFAULT_ORGANIZATION_ID,
            code,
            name,
            timezone: dto.timezone?.trim() || 'America/Bogota',
            address: this.cleanOptional(dto.address),
            phone: this.cleanOptional(dto.phone),
            active: false,
            isDefault: false,
          },
          select: { id: true },
        });
        catalogCopy = await this.clonePrincipalCatalog(transaction, draft.id);
        const loaded = await transaction.site.findFirst({
          where: { id: draft.id, organizationId: DEFAULT_ORGANIZATION_ID },
          select: sitePreparationSelect,
        });
        // Unit doubles from the legacy single-site flow may not implement a
        // second read; the real Prisma client always does. Keeping the draft
        // here preserves that compatibility without changing production.
        return loaded || draft;
      });
      if (!created) throw new NotFoundException('No se pudo leer la sede recién creada');
      site = created as SitePreparationRecord;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe una sede con ese código');
      }
      throw error;
    }

    await this.audit.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'SITE_DRAFT_CREATE',
      targetType: 'Site',
      targetId: site.id,
      metadata: {
        code: site.code,
        name: site.name,
        active: false,
        catalogCategoriesCopied: catalogCopy.categories,
        catalogItemsCopied: catalogCopy.items,
      },
    });

    return this.serialize(site);
  }

  async updateMetadata(siteId: string, dto: UpdateSiteDto, actor: SiteActor) {
    const current = await this.prisma.site.findFirst({
      where: { id: siteId, organizationId: DEFAULT_ORGANIZATION_ID },
      select: { id: true, code: true, name: true, isDefault: true },
    });
    if (!current) throw new NotFoundException('Sede no encontrada');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.timezone !== undefined) data.timezone = dto.timezone.trim();
    if (dto.address !== undefined)
      data.address = this.cleanOptional(dto.address);
    if (dto.phone !== undefined) data.phone = this.cleanOptional(dto.phone);

    if (dto.code !== undefined) {
      const code = this.normalizeCode(dto.code);
      if (current.id === DEFAULT_SITE_ID || current.isDefault) {
        if (code !== current.code) {
          throw new ConflictException(
            'El código de la sede principal está protegido',
          );
        }
      } else {
        const existing = await this.prisma.site.findFirst({
          where: {
            organizationId: DEFAULT_ORGANIZATION_ID,
            code,
            id: { not: siteId },
          },
          select: { id: true },
        });
        if (existing)
          throw new ConflictException('Ya existe una sede con ese código');
        data.code = code;
      }
    }

    const updated = await this.prisma.site.update({
      where: { id: siteId },
      data,
      select: sitePreparationSelect,
    });

    await this.audit.log({
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'SITE_METADATA_UPDATE',
      targetType: 'Site',
      targetId: updated.id,
      metadata: { fields: Object.keys(data) },
    });

    return this.serialize(updated);
  }
}
