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
});
