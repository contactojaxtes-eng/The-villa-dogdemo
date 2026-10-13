import { DEFAULT_SITE_ID } from '../common/multisite.constants';
import { MenuService } from './menu.service';

describe('MenuService WhatsApp menu synchronization', () => {
  const secondarySiteId = 'site-secondary';
  const customSiteId = 'site-custom';

  const createService = (options: {
    sites?: Array<{ id: string }>;
    customRows?: Array<{ siteId: string; value: string }>;
    recheckedCustomValues?: Record<string, string | undefined>;
    principalCustom?: string;
    includeMultisiteModels?: boolean;
  } = {}) => {
    const includeMultisiteModels = options.includeMultisiteModels !== false;
    const prisma: any = {
      appSetting: {
        findUnique: jest.fn().mockResolvedValue({ value: options.principalCustom || 'false' }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      menuCategory: {
        findMany: jest.fn().mockResolvedValue([
          {
            name: 'Perros',
            items: [{ name: 'Perro sencillo', price: 3500 }],
          },
        ]),
      },
    };

    if (includeMultisiteModels) {
      prisma.site = {
        findMany: jest.fn().mockResolvedValue(options.sites || [
          { id: DEFAULT_SITE_ID },
          { id: secondarySiteId },
          { id: customSiteId },
        ]),
      };
      prisma.siteSetting = {
        findMany: jest.fn().mockResolvedValue(options.customRows || [
          { siteId: secondarySiteId, value: 'false' },
          { siteId: customSiteId, value: 'true' },
        ]),
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          const siteId = where?.siteId_key?.siteId;
          const value = options.recheckedCustomValues?.[siteId];
          return Promise.resolve(value === undefined ? null : { value });
        }),
        upsert: jest.fn().mockResolvedValue({}),
      };
    }

    const socketGateway: any = {
      server: { emit: jest.fn() },
      emitToSite: jest.fn(),
      emitWhatsApp: jest.fn(),
    };
    const cache: any = { invalidateByPrefix: jest.fn() };
    return {
      service: new MenuService(prisma, cache, socketGateway),
      prisma,
      socketGateway,
    };
  };

  it('refreshes automatic secondary menus without touching custom site text', async () => {
    const { service, prisma, socketGateway } = createService();

    await (service as any).syncWhatsappMenuText();

    expect(prisma.siteSetting.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.siteSetting.upsert).toHaveBeenCalledWith({
      where: { siteId_key: { siteId: secondarySiteId, key: 'chatbot_menu_text' } },
      create: expect.objectContaining({ siteId: secondarySiteId, key: 'chatbot_menu_text' }),
      update: expect.objectContaining({ value: expect.stringContaining('Perro sencillo') }),
    });
    expect(socketGateway.emitWhatsApp).toHaveBeenCalledWith(
      'whatsappSettingsUpdated',
      { menuText: expect.stringContaining('Perro sencillo') },
    );
    expect(socketGateway.emitWhatsApp).toHaveBeenCalledWith(
      'whatsappSettingsUpdated',
      { menuText: expect.stringContaining('Perro sencillo'), siteId: secondarySiteId },
      secondarySiteId,
    );
    expect(socketGateway.emitWhatsApp.mock.calls.some(([, payload]: [string, any]) => payload?.siteId === customSiteId))
      .toBe(false);
  });

  it('rechecks a secondary custom flag before writing an automatic menu', async () => {
    const { service, prisma, socketGateway } = createService({
      recheckedCustomValues: { [secondarySiteId]: 'true' },
    });

    await (service as any).syncWhatsappMenuText();

    expect(prisma.siteSetting.upsert).not.toHaveBeenCalled();
    expect(socketGateway.emitWhatsApp).toHaveBeenCalledTimes(1);
    expect(socketGateway.emitWhatsApp).toHaveBeenCalledWith(
      'whatsappSettingsUpdated',
      { menuText: expect.stringContaining('Perro sencillo') },
    );
  });

  it('keeps the legacy principal-only event when multisite models are unavailable', async () => {
    const { service, socketGateway } = createService({ includeMultisiteModels: false });

    await (service as any).syncWhatsappMenuText();

    expect(socketGateway.emitWhatsApp).toHaveBeenCalledTimes(1);
    expect(socketGateway.emitWhatsApp).toHaveBeenCalledWith(
      'whatsappSettingsUpdated',
      { menuText: expect.stringContaining('Perro sencillo') },
    );
  });

  it('does not regenerate or emit when only the principal exists and its menu is custom', async () => {
    const { service, prisma, socketGateway } = createService({
      principalCustom: 'true',
      sites: [{ id: DEFAULT_SITE_ID }],
    });

    await (service as any).syncWhatsappMenuText();

    expect(prisma.menuCategory.findMany).not.toHaveBeenCalled();
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
    expect(socketGateway.emitWhatsApp).not.toHaveBeenCalled();
  });

  it('preserves a custom principal text while refreshing an automatic secondary menu', async () => {
    const { service, prisma, socketGateway } = createService({
      principalCustom: 'true',
      sites: [{ id: DEFAULT_SITE_ID }, { id: secondarySiteId }],
      customRows: [{ siteId: secondarySiteId, value: 'false' }],
    });

    await (service as any).syncWhatsappMenuText();

    expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
    expect(prisma.siteSetting.upsert).toHaveBeenCalledTimes(1);
    expect(socketGateway.emitWhatsApp).toHaveBeenCalledTimes(1);
    expect(socketGateway.emitWhatsApp).toHaveBeenCalledWith(
      'whatsappSettingsUpdated',
      { menuText: expect.stringContaining('Perro sencillo'), siteId: secondarySiteId },
      secondarySiteId,
    );
  });

  it('notifies only the affected staff site when its menu changes', async () => {
    const { service, socketGateway } = createService();
    const publicMenuGateway = { emitMenuUpdated: jest.fn() };
    (service as any).publicMenuGateway = publicMenuGateway;

    await (service as any).invalidateCache(secondarySiteId);

    expect(socketGateway.emitToSite).toHaveBeenCalledWith(
      secondarySiteId,
      'menuUpdated',
      { siteId: secondarySiteId },
    );
    expect(publicMenuGateway.emitMenuUpdated).toHaveBeenCalledWith(secondarySiteId);
    expect(socketGateway.server.emit).not.toHaveBeenCalled();
  });
});
