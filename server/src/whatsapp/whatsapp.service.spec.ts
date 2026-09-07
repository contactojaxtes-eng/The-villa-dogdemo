import { ConflictException } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

describe('WhatsApp advisor concurrency', () => {
  const createService = (prisma: any) => {
    const socketGateway = { emitWhatsApp: jest.fn() };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, socketGateway as any);
    return { service, socketGateway };
  };

  it('claims an unassigned conversation with one conditional database update', async () => {
    const session = { id: 'chat-1', phone: '3001234567', assignedToId: null };
    const updated = {
      ...session,
      assignedToId: 'advisor-1',
      waitingForAdvisor: false,
      assignedTo: { id: 'advisor-1', name: 'Ana' },
    };
    const prisma: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'advisor-1', active: true }) },
      whatsAppSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(updated),
      },
    };
    const { service, socketGateway } = createService(prisma);

    await expect(service.assignSession('chat-1', 'advisor-1', {
      id: 'advisor-1', name: 'Ana', role: 'DELIVERY_MANAGER',
    })).resolves.toEqual(updated);

    expect(prisma.whatsAppSession.updateMany.mock.calls[0][0].where).toEqual({
      id: 'chat-1',
      OR: [{ assignedToId: null }, { assignedToId: 'advisor-1' }],
    });
    expect(socketGateway.emitWhatsApp).toHaveBeenCalledWith(
      'chatSessionAssigned',
      expect.objectContaining({ sessionId: 'chat-1', assignedToId: 'advisor-1' }),
    );
  });

  it('rejects the second advisor when the conversation was already claimed', async () => {
    const prisma: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'advisor-2', active: true }) },
      whatsAppSession: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 'chat-1', phone: '3001234567', assignedToId: null })
          .mockResolvedValueOnce({
            id: 'chat-1',
            assignedToId: 'advisor-1',
            assignedTo: { id: 'advisor-1', name: 'Ana' },
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn(),
      },
    };
    const { service, socketGateway } = createService(prisma);

    await expect(service.assignSession('chat-1', 'advisor-2', {
      id: 'advisor-2', name: 'Luisa', role: 'DELIVERY_MANAGER',
    })).rejects.toThrow(new ConflictException('Esta conversación ya fue tomada por Ana'));
    expect(prisma.whatsAppSession.update).not.toHaveBeenCalled();
    expect(socketGateway.emitWhatsApp).not.toHaveBeenCalled();
  });

  it('loads a bounded message page and returns it in chronological order', async () => {
    const newest = { id: 'm2', createdAt: new Date('2026-09-05T15:00:00Z') };
    const oldest = { id: 'm1', createdAt: new Date('2026-09-05T14:00:00Z') };
    const prisma: any = {
      whatsAppSession: {
        findUnique: jest.fn().mockResolvedValue({ id: 'chat-1', phone: '3001234567' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'chat-1' }]),
      },
      whatsAppMessage: {
        findMany: jest.fn().mockResolvedValue([newest, oldest]),
      },
    };
    const { service } = createService(prisma);

    await expect(service.getSessionMessages('chat-1')).resolves.toEqual([oldest, newest]);
    expect(prisma.whatsAppMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 120,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));

    await service.getSessionMessages('chat-1', '2026-09-05T14:00:00.000Z', 120, 'm1');
    expect(prisma.whatsAppMessage.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { createdAt: { lt: new Date('2026-09-05T14:00:00.000Z') } },
          { createdAt: new Date('2026-09-05T14:00:00.000Z'), id: { lt: 'm1' } },
        ],
      }),
    }));
  });

  it('paginates the conversation inbox with a stable timestamp and id cursor', async () => {
    const sessions = [
      { id: 'chat-3', phone: '3000000003', lastMessageAt: new Date('2026-09-05T15:00:00Z'), messages: [] },
      { id: 'chat-2', phone: '3000000002', lastMessageAt: new Date('2026-09-05T14:00:00Z'), messages: [] },
      { id: 'chat-1', phone: '3000000001', lastMessageAt: new Date('2026-09-05T13:00:00Z'), messages: [] },
    ];
    const prisma: any = {
      whatsAppSession: { findMany: jest.fn().mockResolvedValueOnce(sessions).mockResolvedValueOnce([]) },
      whatsAppMessage: { groupBy: jest.fn().mockResolvedValue([]) },
      cashClosing: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const { service } = createService(prisma);

    const firstPage: any = await service.getSessions(undefined, false, 2, undefined, 'ALL', 'advisor-1', undefined, true);
    expect(firstPage.items.map((session: any) => session.id)).toEqual(['chat-3', 'chat-2']);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(prisma.whatsAppSession.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({
      take: 3,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    }));

    await service.getSessions(undefined, false, 2, undefined, 'ALL', 'advisor-1', firstPage.nextCursor, true);
    const cursorWhere = prisma.whatsAppSession.findMany.mock.calls[1][0].where;
    expect(cursorWhere.AND).toEqual(expect.arrayContaining([
      {
        OR: [
          { lastMessageAt: { lt: new Date('2026-09-05T14:00:00Z') } },
          { lastMessageAt: new Date('2026-09-05T14:00:00Z'), id: { lt: 'chat-2' } },
        ],
      },
    ]));
  });
});

describe('WhatsApp live menu sharing', () => {
  it('sends the configured live menu URL in the configurable message', async () => {
    const prisma: any = {
      appSetting: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'digital_menu_url', value: 'https://pedidos.example/menu' },
          { key: 'chatbot_menu_share_message', value: 'Carta actualizada: {url}' },
        ]),
      },
    };
    const service = new WhatsappService(
      prisma,
      { get: jest.fn() } as any,
      { emitWhatsApp: jest.fn() } as any,
    );
    jest.spyOn(service as any, 'resolveSessionForDispatch').mockResolvedValue({ id: 'chat-1' });
    jest.spyOn(service as any, 'resolveActiveRecipient').mockResolvedValue({ recipientPhone: '3001234567' });
    const send = jest.spyOn(service, 'sendMessage').mockResolvedValue({ sent: true } as any);

    await service.sendMenuCarta('3001234567');

    expect(send).toHaveBeenCalledWith('573001234567', 'Carta actualizada: https://pedidos.example/menu');
    expect(prisma.appSetting.findMany).toHaveBeenCalledWith({
      where: { key: { in: ['digital_menu_url', 'chatbot_menu_share_message'] } },
    });
  });
});

describe('WhatsApp Gemini settings', () => {
  const createService = () => new WhatsappService(
    {} as any,
    { get: jest.fn() } as any,
    { emitWhatsApp: jest.fn() } as any,
  );

  it('keeps masked keys matched by suffix when their order changes', () => {
    const service = createService();
    const existing = ['first-secret-AB12', 'second-secret-CD34'];

    const resolved = (service as any).resolveGeminiKeys(
      ['••••••••CD34', 'new-secret-EF56', '••••••••AB12'],
      existing,
    );

    expect(resolved).toEqual(['second-secret-CD34', 'new-secret-EF56', 'first-secret-AB12']);
  });

  it('rejects model names that could alter the provider URL', () => {
    const service = createService();

    expect(() => (service as any).normalizeGeminiModel('../invalid?key=value'))
      .toThrow('El nombre del modelo de Gemini no es válido');
  });

  it('returns a safe diagnostic from a real provider-shaped response', async () => {
    const apiKey = 'test-secret-key-AB12';
    const prisma: any = {
      appSetting: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.key === 'gemini_api_key') return { value: apiKey };
          if (where.key === 'gemini_model') return { value: 'gemini-flash-latest' };
          return null;
        }),
        upsert: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new WhatsappService(
      prisma,
      { get: jest.fn() } as any,
      { emitWhatsApp: jest.fn() } as any,
    );
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: 'Conexión correcta' }] } }],
      }),
    } as any);

    const result = await service.testGeminiConnection('••••AB12', 'Prueba', 'gemini-flash-latest');

    expect(result).toEqual(expect.objectContaining({
      success: true,
      validKeys: 1,
      model: 'gemini-flash-latest',
      reply: 'Conexión correcta',
    }));
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/models/gemini-flash-latest:generateContent'),
      expect.any(Object),
    );
    fetchSpy.mockRestore();
  });
});
