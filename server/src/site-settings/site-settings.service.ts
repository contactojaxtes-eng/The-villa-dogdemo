import { Injectable } from '@nestjs/common';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';
import { PrismaService } from '../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';

export const MODULE_VISIBILITY_SETTING_KEY = 'ui_hidden_modules';

const PERMANENT_MODULES = new Set(['settings', 'superadmin']);

export interface ModuleVisibilitySetting {
  hiddenModules: string[];
  configured: boolean;
}

@Injectable()
export class SiteSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly socketGateway: SocketGateway,
  ) {}

  private normalizeSiteId(siteId?: string | null) {
    return String(siteId || DEFAULT_SITE_ID).trim() || DEFAULT_SITE_ID;
  }

  private sanitizeHiddenModules(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => /^[a-z][a-z0-9_]{0,63}$/.test(item))
      .filter((item) => !PERMANENT_MODULES.has(item)))]
      .slice(0, 64);
  }

  async getModuleVisibility(siteId?: string | null): Promise<ModuleVisibilitySetting> {
    const resolvedSiteId = this.normalizeSiteId(siteId);
    const setting = await this.prisma.siteSetting.findUnique({
      where: {
        siteId_key: {
          siteId: resolvedSiteId,
          key: MODULE_VISIBILITY_SETTING_KEY,
        },
      },
      select: { value: true },
    });

    if (!setting) return { hiddenModules: [], configured: false };

    let parsed: unknown = [];
    try {
      parsed = JSON.parse(setting.value);
    } catch {
      // Una configuración dañada no debe ocultar Configuración ni bloquear la
      // navegación. Se devuelve una lista segura hasta que un administrador la
      // vuelva a guardar.
    }

    return {
      hiddenModules: this.sanitizeHiddenModules(parsed),
      configured: true,
    };
  }

  async updateModuleVisibility(hiddenModules: unknown, siteId?: string | null) {
    const resolvedSiteId = this.normalizeSiteId(siteId);
    const sanitized = this.sanitizeHiddenModules(hiddenModules);

    await this.prisma.siteSetting.upsert({
      where: {
        siteId_key: {
          siteId: resolvedSiteId,
          key: MODULE_VISIBILITY_SETTING_KEY,
        },
      },
      create: {
        siteId: resolvedSiteId,
        key: MODULE_VISIBILITY_SETTING_KEY,
        value: JSON.stringify(sanitized),
      },
      update: { value: JSON.stringify(sanitized) },
    });

    const result: ModuleVisibilitySetting = {
      hiddenModules: sanitized,
      configured: true,
    };
    this.socketGateway.emitToSite(
      resolvedSiteId,
      'moduleVisibilityUpdated',
      result,
    );
    return result;
  }
}
