import { DEFAULT_SITE_ID } from '../common/multisite.constants';
import { WhatsappService } from './whatsapp.service';

const SECOND_SITE_ID = '00000000-0000-4000-8000-000000000202';

function createHarness(overrides: Record<string, any> = {}) {
  const prisma: any = {
    siteSetting: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    appSetting: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    site: {
      findUnique: jest.fn().mockResolvedValue({ code: 'sede-dos' }),
    },
    menuCategory: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const socket = { emitWhatsApp: jest.fn() };
  const service = new WhatsappService(prisma, config as any, socket as any);
  return { prisma, config, socket, service };
}

describe('WhatsApp settings scoped by site', () => {
  it('keeps AppSetting as fallback only for the principal site', async () => {
    const { prisma, service } = createHarness();
    prisma.appSetting.findUnique.mockResolvedValue({ value: 'true' });

    await expect((service as any).getSetting('chatbot_enabled', DEFAULT_SITE_ID)).resolves.toBe('true');
    await expect((service as any).getSetting('chatbot_enabled', SECOND_SITE_ID)).resolves.toBeNull();

    expect(prisma.appSetting.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.siteSetting.findUnique).toHaveBeenCalledWith({
      where: { siteId_key: { siteId: SECOND_SITE_ID, key: 'chatbot_enabled' } },
    });
  });

  it('treats an empty SiteSetting value as an intentional override', async () => {
    const { prisma, config, service } = createHarness();
    prisma.siteSetting.findUnique.mockResolvedValue({ value: '' });
    prisma.appSetting.findUnique.mockResolvedValue({ value: 'legacy-value' });
    config.get.mockReturnValue('environment-value');

    await expect((service as any).getSetting('chatbot_ai_instructions', DEFAULT_SITE_ID)).resolves.toBe('');
    expect(prisma.appSetting.findUnique).not.toHaveBeenCalled();
    expect(config.get).not.toHaveBeenCalled();
  });

  it('keeps the same setting cached independently for each site', async () => {
    const { prisma, service } = createHarness();
    prisma.siteSetting.findUnique.mockImplementation(({ where }: any) => Promise.resolve({
      value: where.siteId_key.siteId === DEFAULT_SITE_ID ? 'principal' : 'secondary',
    }));

    await expect((service as any).getSetting('gemini_model', DEFAULT_SITE_ID)).resolves.toBe('principal');
    await expect((service as any).getSetting('gemini_model', SECOND_SITE_ID)).resolves.toBe('secondary');
    await expect((service as any).getSetting('gemini_model', DEFAULT_SITE_ID)).resolves.toBe('principal');
    await expect((service as any).getSetting('gemini_model', SECOND_SITE_ID)).resolves.toBe('secondary');

    expect(prisma.siteSetting.findUnique).toHaveBeenCalledTimes(2);
  });

  it('stores operational settings for a secondary site without touching legacy credentials', async () => {
    const { prisma, socket, service } = createHarness();
    jest.spyOn(service, 'getSettings').mockResolvedValue({ chatbotEnabled: true } as any);

    await service.updateSettings({
      chatbotEnabled: true,
      phoneId: '123456789012345',
      token: 'must-not-be-stored-here',
    }, SECOND_SITE_ID);

    expect(prisma.siteSetting.upsert).toHaveBeenCalledWith({
      where: { siteId_key: { siteId: SECOND_SITE_ID, key: 'chatbot_enabled' } },
      create: { siteId: SECOND_SITE_ID, key: 'chatbot_enabled', value: 'true' },
      update: { value: 'true' },
    });
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
    expect(socket.emitWhatsApp).toHaveBeenCalledWith(
      'whatsappSettingsUpdated',
      { chatbotEnabled: true, siteId: SECOND_SITE_ID },
      SECOND_SITE_ID,
    );
  });

  it('starts a site without rows with the chatbot disabled and no principal fallback', async () => {
    const { prisma, service } = createHarness();
    jest.spyOn(service as any, 'buildMessagingMenuText').mockResolvedValue('Carta compartida');

    const settings = await service.getSettings(SECOND_SITE_ID);

    expect(settings.chatbotEnabled).toBe(false);
    expect(settings.orderReaderEnabled).toBe(false);
    expect(settings.geminiKeyCount).toBe(0);
    expect(settings.menuText).toBe('Carta compartida');
    expect(prisma.appSetting.findMany).not.toHaveBeenCalled();
    expect(prisma.appSetting.findUnique).not.toHaveBeenCalled();
  });

  it('never derives a secondary menu link from the principal fallback', async () => {
    const { config, service } = createHarness();
    config.get.mockImplementation((key: string) => {
      if (key === 'CLIENT_URL') return 'https://app.example';
      return undefined;
    });

    await expect(
      (service as any).resolveDigitalMenuUrlForSite(undefined, SECOND_SITE_ID),
    ).resolves.toBeNull();
  });

  it('adds the secondary site code only to an explicitly public menu base', async () => {
    const { config, service } = createHarness();
    config.get.mockImplementation((key: string) => {
      if (key === 'PUBLIC_MENU_URL') return 'https://menu.example/menu';
      return undefined;
    });

    await expect(
      (service as any).resolveDigitalMenuUrlForSite(undefined, SECOND_SITE_ID),
    ).resolves.toBe('https://menu.example/menu/sede-dos');
  });

  it('uses the session site for live chatbot settings', async () => {
    const { service } = createHarness();
    const getSetting = jest.spyOn(service as any, 'getSetting').mockResolvedValue('false');
    const send = jest.spyOn(service, 'sendMessage').mockResolvedValue({ sent: true } as any);

    await (service as any).handleChatbot({
      id: '',
      siteId: SECOND_SITE_ID,
      phone: '573001234567',
      assignedToId: null,
      waitingForAdvisor: false,
    }, 'hola');

    expect(getSetting).toHaveBeenCalled();
    for (const [, siteId] of getSetting.mock.calls) {
      expect(siteId).toBe(SECOND_SITE_ID);
    }
    expect(send).not.toHaveBeenCalled();
  });
});
