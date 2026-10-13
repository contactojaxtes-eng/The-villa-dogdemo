import { DEFAULT_SITE_ID } from '../common/multisite.constants';
import { WhatsappService } from './whatsapp.service';

const SECONDARY_SITE_ID = '00000000-0000-4000-8000-000000000202';

type SettingStore = Map<string, string>;

const matchesKey = (key: string, condition: any): boolean => {
  if (condition === undefined) return true;
  if (typeof condition === 'string') return key === condition;
  if (Array.isArray(condition?.in) && !condition.in.includes(key)) return false;
  if (typeof condition?.startsWith === 'string' && !key.startsWith(condition.startsWith)) return false;
  if (typeof condition?.gte === 'string' && key < condition.gte) return false;
  if (typeof condition?.lte === 'string' && key > condition.lte) return false;
  return true;
};

const createHarness = (
  initialApp: Record<string, string> = {},
  initialSites: Record<string, Record<string, string>> = {},
) => {
  const appSettings: SettingStore = new Map(Object.entries(initialApp));
  const siteSettings = new Map<string, SettingStore>(
    Object.entries(initialSites).map(([siteId, values]) => [siteId, new Map(Object.entries(values))]),
  );
  const getSiteStore = (siteId: string) => {
    let store = siteSettings.get(siteId);
    if (!store) {
      store = new Map();
      siteSettings.set(siteId, store);
    }
    return store;
  };

  const appSetting = {
    findUnique: jest.fn(async ({ where }: any) => {
      const value = appSettings.get(where.key);
      return value === undefined ? null : { key: where.key, value };
    }),
    findMany: jest.fn(async ({ where = {} }: any = {}) => [...appSettings]
      .filter(([key]) => matchesKey(key, where.key))
      .map(([key, value]) => ({ key, value }))),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const key = where.key;
      const value = appSettings.has(key) ? update.value : create.value;
      appSettings.set(key, value);
      return { key, value };
    }),
    deleteMany: jest.fn(async ({ where = {} }: any) => {
      let count = 0;
      for (const [key, value] of [...appSettings]) {
        if (!matchesKey(key, where.key)) continue;
        if (where.value !== undefined && value !== where.value) continue;
        appSettings.delete(key);
        count++;
      }
      return { count };
    }),
  };

  const siteSetting = {
    findUnique: jest.fn(async ({ where }: any) => {
      const { siteId, key } = where.siteId_key;
      const value = siteSettings.get(siteId)?.get(key);
      return value === undefined ? null : { id: `${siteId}:${key}`, siteId, key, value };
    }),
    findMany: jest.fn(async ({ where = {} }: any = {}) => {
      const rows: Array<{ id: string; siteId: string; key: string; value: string }> = [];
      for (const [siteId, settings] of siteSettings) {
        if (where.siteId !== undefined && siteId !== where.siteId) continue;
        for (const [key, value] of settings) {
          const id = `${siteId}:${key}`;
          if (!matchesKey(key, where.key)) continue;
          if (Array.isArray(where.id?.in) && !where.id.in.includes(id)) continue;
          rows.push({ id, siteId, key, value });
        }
      }
      return rows;
    }),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const { siteId, key } = where.siteId_key;
      const store = getSiteStore(siteId);
      const value = store.has(key) ? update.value : create.value;
      store.set(key, value);
      return { id: `${siteId}:${key}`, siteId, key, value };
    }),
    deleteMany: jest.fn(async ({ where = {} }: any) => {
      let count = 0;
      for (const [siteId, settings] of siteSettings) {
        if (where.siteId !== undefined && siteId !== where.siteId) continue;
        for (const [key, value] of [...settings]) {
          const id = `${siteId}:${key}`;
          if (!matchesKey(key, where.key)) continue;
          if (Array.isArray(where.id?.in) && !where.id.in.includes(id)) continue;
          if (where.value !== undefined && value !== where.value) continue;
          settings.delete(key);
          count++;
        }
      }
      return { count };
    }),
  };

  const prisma: any = {
    appSetting,
    siteSetting,
    $transaction: jest.fn(async (operation: any) => (
      typeof operation === 'function'
        ? operation({ appSetting, siteSetting })
        : Promise.all(operation)
    )),
  };
  const service = new WhatsappService(
    prisma,
    { get: jest.fn().mockReturnValue(undefined) } as any,
    { emitWhatsApp: jest.fn() } as any,
  );

  return { service, prisma, appSettings, siteSettings };
};

const principalExample = {
  context: 'Consulta general de la sede principal',
  clientPrompt: '¿Qué productos tienen disponibles para llevar?',
  advisorResponse: 'Con gusto te comparto las opciones disponibles para llevar.',
};

const secondaryExample = {
  context: 'Consulta general de la sede secundaria',
  clientPrompt: '¿Qué combos tienen disponibles para recoger?',
  advisorResponse: 'Con gusto te comparto los combos disponibles para recoger.',
};

describe('WhatsApp AI multisite isolation', () => {
  afterEach(() => jest.useRealTimers());

  it('keeps training config, toggles and approvals in each site storage', async () => {
    const { service, appSettings, siteSettings } = createHarness(
      {
        chatbot_learning_candidates_v1: JSON.stringify([principalExample]),
        chatbot_learning_candidate_set_id_v1: 'principal-candidates',
      },
      {
        [SECONDARY_SITE_ID]: {
          chatbot_learning_candidates_v1: JSON.stringify([secondaryExample]),
          chatbot_learning_candidate_set_id_v1: 'secondary-candidates',
        },
      },
    );

    const principalInitial = await service.getAutoTrainingConfig(DEFAULT_SITE_ID);
    const secondaryInitial = await service.getAutoTrainingConfig(SECONDARY_SITE_ID);
    expect(principalInitial.candidates).toEqual([principalExample]);
    expect(secondaryInitial.candidates).toEqual([secondaryExample]);

    await service.toggleAutoTraining(true, DEFAULT_SITE_ID);
    expect((await service.getAutoTrainingConfig(DEFAULT_SITE_ID)).enabled).toBe(true);
    expect((await service.getAutoTrainingConfig(SECONDARY_SITE_ID)).enabled).toBe(false);
    expect(appSettings.get('chatbot_learning_schedule_enabled_v2')).toBe('true');
    expect(siteSettings.get(SECONDARY_SITE_ID)?.has('chatbot_learning_schedule_enabled_v2')).toBe(false);

    await service.toggleAutoTraining(true, SECONDARY_SITE_ID);
    await service.approveAutoTrainingExamples(
      [principalExample],
      'principal-candidates',
      DEFAULT_SITE_ID,
    );
    await service.approveAutoTrainingExamples(
      [secondaryExample],
      'secondary-candidates',
      SECONDARY_SITE_ID,
    );

    const principal = await service.getAutoTrainingConfig(DEFAULT_SITE_ID);
    const secondary = await service.getAutoTrainingConfig(SECONDARY_SITE_ID);
    expect(principal).toMatchObject({ enabled: true, examples: [principalExample], candidates: [] });
    expect(secondary).toMatchObject({ enabled: true, examples: [secondaryExample], candidates: [] });
    expect(JSON.parse(appSettings.get('chatbot_learning_approved_examples_v1') || '[]'))
      .toEqual([principalExample]);
    expect(JSON.parse(
      siteSettings.get(SECONDARY_SITE_ID)?.get('chatbot_learning_approved_examples_v1') || '[]',
    )).toEqual([secondaryExample]);
    expect(siteSettings.get(DEFAULT_SITE_ID)?.has('chatbot_learning_approved_examples_v1') ?? false)
      .toBe(false);
  });

  it('separates Gemini attempt metrics in memory and in persisted site storage', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-07T15:00:00.000Z'));
    const { service, prisma, appSettings, siteSettings } = createHarness();

    service.recordGeminiAttempt({
      siteId: DEFAULT_SITE_ID,
      operation: 'CHATBOT',
      apiKey: 'principal-secret-1111',
      allKeys: ['principal-secret-1111'],
      model: 'gemini-test',
      statusCode: 200,
      success: true,
    });
    service.recordGeminiAttempt({
      siteId: SECONDARY_SITE_ID,
      operation: 'ORDER_READER',
      apiKey: 'secondary-secret-2222',
      allKeys: ['secondary-secret-2222'],
      model: 'gemini-test',
      statusCode: 429,
      success: false,
    });
    service.recordGeminiAttempt({
      siteId: SECONDARY_SITE_ID,
      operation: 'ORDER_READER',
      apiKey: 'secondary-secret-2222',
      allKeys: ['secondary-secret-2222'],
      model: 'gemini-test',
      statusCode: 200,
      success: true,
    });

    const principalMemory = await service.getGeminiMetrics(1, DEFAULT_SITE_ID);
    const secondaryMemory = await service.getGeminiMetrics(1, SECONDARY_SITE_ID);
    expect(principalMemory[0]).toMatchObject({ attempts: 1, successes: 1, failures: 0 });
    expect(principalMemory[0].entries).toEqual([
      expect.objectContaining({ operation: 'CHATBOT', attempts: 1, successes: 1 }),
    ]);
    expect(secondaryMemory[0]).toMatchObject({ attempts: 2, successes: 1, failures: 1 });
    expect(secondaryMemory[0].entries).toEqual([
      expect.objectContaining({ operation: 'ORDER_READER', attempts: 2, successes: 1, http429: 1 }),
    ]);

    await (service as any).flushGeminiMetrics();

    const principalMetricKeys = [...appSettings.keys()]
      .filter(key => key.startsWith('gemini_metrics_v1:'));
    const secondaryMetricKeys = [...(siteSettings.get(SECONDARY_SITE_ID)?.keys() || [])]
      .filter(key => key.startsWith('gemini_metrics_v1:'));
    expect(principalMetricKeys).toHaveLength(1);
    expect(secondaryMetricKeys).toHaveLength(1);
    expect(JSON.parse(appSettings.get(principalMetricKeys[0]) || '{}')).toMatchObject({ attempts: 1 });
    expect(JSON.parse(
      siteSettings.get(SECONDARY_SITE_ID)?.get(secondaryMetricKeys[0]) || '{}',
    )).toMatchObject({ attempts: 2 });

    const reloadedService = new WhatsappService(
      prisma,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      { emitWhatsApp: jest.fn() } as any,
    );
    const principalPersisted = await reloadedService.getGeminiMetrics(1, DEFAULT_SITE_ID);
    const secondaryPersisted = await reloadedService.getGeminiMetrics(1, SECONDARY_SITE_ID);
    expect(principalPersisted[0]).toMatchObject({ attempts: 1, successes: 1, failures: 0 });
    expect(secondaryPersisted[0]).toMatchObject({ attempts: 2, successes: 1, failures: 1 });
    expect(JSON.stringify(principalPersisted)).not.toContain('secondary-secret');
    expect(JSON.stringify(secondaryPersisted)).not.toContain('principal-secret');
  });

  it('generates secondary-site candidates from secondary operational data only', async () => {
    const { service, prisma, appSettings, siteSettings } = createHarness({}, {
      [SECONDARY_SITE_ID]: {
        gemini_api_key: 'secondary-gemini-key',
        restaurant_hours: '5:00 p. m. - 11:00 p. m.',
        chatbot_ai_instructions: 'Ofrece únicamente productos disponibles.',
      },
    });
    prisma.order = {
      findMany: jest.fn().mockResolvedValue([{
        chatSessionId: 'secondary-session',
        orderType: 'DELIVERY',
        items: [{
          quantity: 1,
          notes: 'Sin salsas',
          menuItem: { name: 'Perro sencillo' },
        }],
      }]),
    };
    prisma.whatsAppSession = {
      findMany: jest.fn().mockResolvedValue([{
        id: 'secondary-session',
        phone: '573001234567',
        customerName: 'Cliente temporal',
        messages: [{ content: 'Quiero conocer las opciones disponibles para domicilio.' }],
      }]),
    };
    prisma.menuItem = {
      findMany: jest.fn().mockResolvedValue([{
        name: 'Perro sencillo',
        price: 5000,
        description: 'Producto disponible',
      }]),
    };
    prisma.deliveryZone = {
      findMany: jest.fn().mockResolvedValue([{
        name: 'Zona habilitada',
        rate: 3000,
      }]),
    };
    jest.spyOn(service as any, 'getGeminiModels').mockResolvedValue(['gemini-test']);
    const incrementUsage = jest.spyOn(service, 'incrementGeminiUsage').mockResolvedValue(undefined);
    const generatedCandidates = [
      {
        context: 'Consulta de productos para domicilio',
        clientPrompt: '¿Qué productos tienen disponibles para domicilio?',
        advisorResponse: 'Con gusto te comparto las opciones disponibles para domicilio.',
      },
      {
        context: 'Consulta de opciones para recoger',
        clientPrompt: '¿Puedo pedir para recoger en el restaurante?',
        advisorResponse: 'Sí, puedes elegir la opción de recoger al confirmar tu pedido.',
      },
      {
        context: 'Consulta general de bebidas',
        clientPrompt: '¿Qué bebidas tienen disponibles?',
        advisorResponse: 'Con gusto te comparto las bebidas disponibles en el menú actual.',
      },
    ];
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(generatedCandidates) }] } }],
      }),
    } as any);

    try {
      await (service as any).generateAutoTrainingCandidates('manual', SECONDARY_SITE_ID);
    } finally {
      fetchSpy.mockRestore();
    }

    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ siteId: SECONDARY_SITE_ID }),
    }));
    expect(prisma.whatsAppSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ siteId: SECONDARY_SITE_ID }),
    }));
    expect(prisma.deliveryZone.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ siteId: SECONDARY_SITE_ID }),
    }));
    expect(incrementUsage).toHaveBeenCalledWith(SECONDARY_SITE_ID);

    const secondarySettings = siteSettings.get(SECONDARY_SITE_ID);
    expect(JSON.parse(secondarySettings?.get('chatbot_learning_candidates_v1') || '[]'))
      .toEqual(generatedCandidates);
    expect(JSON.parse(secondarySettings?.get('chatbot_auto_training_stats') || '{}'))
      .toMatchObject({
        ordersAnalyzed: 1,
        sessionsAnalyzed: 1,
        candidatesCount: 3,
        source: 'manual',
      });
    expect(appSettings.has('chatbot_learning_candidates_v1')).toBe(false);
    expect(appSettings.has('chatbot_auto_training_stats')).toBe(false);
    expect(siteSettings.get(DEFAULT_SITE_ID)?.has('chatbot_learning_candidates_v1') ?? false)
      .toBe(false);
  });
});
