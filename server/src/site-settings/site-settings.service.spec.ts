import { DEFAULT_SITE_ID } from '../common/multisite.constants';
import {
  MODULE_VISIBILITY_SETTING_KEY,
  SiteSettingsService,
} from './site-settings.service';

describe('SiteSettingsService module visibility', () => {
  const secondSiteId = '00000000-0000-4000-8000-000000000202';
  let prisma: any;
  let socket: any;
  let service: SiteSettingsService;

  beforeEach(() => {
    prisma = {
      siteSetting: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    socket = { emitToSite: jest.fn() };
    service = new SiteSettingsService(prisma, socket);
  });

  it('keeps the principal local-storage fallback available while no server setting exists', async () => {
    prisma.siteSetting.findUnique.mockResolvedValue(null);

    await expect(service.getModuleVisibility()).resolves.toEqual({
      hiddenModules: [],
      configured: false,
    });
    expect(prisma.siteSetting.findUnique).toHaveBeenCalledWith({
      where: {
        siteId_key: {
          siteId: DEFAULT_SITE_ID,
          key: MODULE_VISIBILITY_SETTING_KEY,
        },
      },
      select: { value: true },
    });
  });

  it('sanitizes stored data and never hides permanent navigation', async () => {
    prisma.siteSetting.findUnique.mockResolvedValue({
      value: JSON.stringify([
        'whatsapp',
        'settings',
        'superadmin',
        'whatsapp',
        'not-valid',
        'orders_history',
      ]),
    });

    await expect(service.getModuleVisibility(secondSiteId)).resolves.toEqual({
      hiddenModules: ['whatsapp', 'orders_history'],
      configured: true,
    });
  });

  it('writes and broadcasts only inside the selected site', async () => {
    const result = await service.updateModuleVisibility(
      ['whatsapp', 'settings', 'orders_history', 'whatsapp'],
      secondSiteId,
    );

    expect(result).toEqual({
      hiddenModules: ['whatsapp', 'orders_history'],
      configured: true,
    });
    expect(prisma.siteSetting.upsert).toHaveBeenCalledWith({
      where: {
        siteId_key: {
          siteId: secondSiteId,
          key: MODULE_VISIBILITY_SETTING_KEY,
        },
      },
      create: {
        siteId: secondSiteId,
        key: MODULE_VISIBILITY_SETTING_KEY,
        value: JSON.stringify(['whatsapp', 'orders_history']),
      },
      update: {
        value: JSON.stringify(['whatsapp', 'orders_history']),
      },
    });
    expect(socket.emitToSite).toHaveBeenCalledWith(
      secondSiteId,
      'moduleVisibilityUpdated',
      result,
    );
  });
});
