import { WhatsappService } from './whatsapp.service';

describe('Gemini usage history', () => {
  afterEach(() => jest.useRealTimers());

  it('uses one atomic UPSERT per response and keeps yesterday after UTC midnight', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-19T23:59:55.000Z'));
    const counters = new Map<string, number>();
    const prisma: any = {
      $executeRaw: jest.fn(async (parts: TemplateStringsArray, ...params: unknown[]) => {
        const sql = parts.join('?');
        expect(sql).toContain('ON CONFLICT ("key") DO UPDATE');
        expect(sql).toContain('"app_settings"."value"::bigint + 1');
        const key = String(params[1]);
        counters.set(key, (counters.get(key) || 0) + 1);
        return 1;
      }),
      appSetting: {
        findMany: jest.fn(async ({ where }: any) => [...counters]
          .filter(([key]) => key >= where.key.gte && key <= where.key.lte)
          .map(([key, value]) => ({ key, value: String(value) }))
          .sort((a, b) => b.key.localeCompare(a.key))),
        findUnique: jest.fn(async ({ where }: any) => {
          const count = counters.get(where.key);
          return count === undefined ? null : { value: String(count) };
        }),
      },
    };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, {} as any);

    await Promise.all(Array.from({ length: 24 }, () => service.incrementGeminiUsage()));
    jest.setSystemTime(new Date('2026-09-20T00:00:05.000Z'));
    await Promise.all(Array.from({ length: 15 }, () => service.incrementGeminiUsage()));

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(39);
    expect(prisma.appSetting.findUnique).not.toHaveBeenCalled();
    expect(await service.getGeminiUsageDaily(2)).toEqual([
      { date: '2026-09-20', success: 15 },
      { date: '2026-09-19', success: 24 },
    ]);
    expect(await service.getGeminiUsageToday()).toBe(15);
  });

  it('puts a 401 unauthorized Gemini key on 24h cooldown without testing all models', async () => {
    const prisma: any = {
      appSetting: {
        findUnique: jest.fn(),
      },
    };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, {} as any);
    const mockResponse = {
      status: 401,
      text: jest.fn().mockResolvedValue('API_KEY_INVALID'),
      headers: { get: () => null },
    };

    const delay = (service as any).geminiRetryDelayMs(401, mockResponse);
    expect(delay).toBe(24 * 60 * 60 * 1000);

    await (service as any).putGeminiKeyOnCooldown('invalid-key-xyz', mockResponse);
    expect((service as any).isGeminiKeyOnCooldown('invalid-key-xyz')).toBe(true);

    const candidates = (service as any).getGeminiKeyCandidates(['invalid-key-xyz', 'valid-key-abc']);
    expect(candidates).toEqual(['valid-key-abc']);
  });

  it('preserves negative cache for 404 Meta media to prevent repeated requests', async () => {
    const prisma: any = {
      appSetting: {
        findUnique: jest.fn().mockResolvedValue({ value: 'mock-meta-token' }),
      },
    };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, {} as any);

    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: jest.fn().mockResolvedValue({ error: 'Media not found' }),
    });
    global.fetch = fetchMock;

    try {
      const first = await service.getMediaUrl('expired-media-123');
      expect(first).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call should hit negative cache and NOT call fetch
      const second = await service.getMediaUrl('expired-media-123');
      expect(second).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('aggregates Gemini daily metrics without leaking secrets', async () => {
    const prisma: any = {
      appSetting: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, {} as any);

    (service as any).recordGeminiAttempt({
      operation: 'ORDER_READER',
      apiKey: 'secret-key-12345678',
      allKeys: ['secret-key-12345678'],
      model: 'gemini-3.5-flash-lite',
      statusCode: 401,
      success: false,
    });

    (service as any).recordGeminiAttempt({
      operation: 'ORDER_READER',
      apiKey: 'secret-key-87654321',
      allKeys: ['secret-key-12345678', 'secret-key-87654321'],
      model: 'gemini-3.5-flash-lite',
      statusCode: 200,
      success: true,
    });

    const metrics = await service.getGeminiMetrics(1);
    expect(metrics.length).toBeGreaterThanOrEqual(1);
    const today = metrics[0];
    expect(today.attempts).toBe(2);
    expect(today.successes).toBe(1);
    expect(today.failures).toBe(1);

    const entry401 = today.entries.find(e => e.http401 > 0);
    expect(entry401).toBeDefined();
    expect(entry401?.keyLabel).toBe('Llave 1 (…5678)');
    expect(JSON.stringify(metrics)).not.toContain('secret-key-12345678');
  });
});