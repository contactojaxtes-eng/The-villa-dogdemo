import { ConflictException } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

describe('WhatsApp scheduled closing', () => {
  it('sends the configured closing notice even when the conversational bot is paused', async () => {
    const service = new WhatsappService(
      {} as any,
      { get: jest.fn() } as any,
      { emitWhatsApp: jest.fn() } as any,
    );
    const settings: Record<string, string> = {
      out_of_service_enabled: 'false',
      business_hours_enabled: 'true',
      out_of_service_message: 'Estamos cerrados. Volvemos desde las {abre}.',
      restaurant_hours: '12:00 - 23:00',
      chatbot_enabled: 'false',
    };
    jest.spyOn(service as any, 'getSetting').mockImplementation(async (key: string) => settings[key] || null);
    jest.spyOn(service as any, 'checkIfWithinBusinessHours').mockReturnValue(false);
    const send = jest.spyOn(service, 'sendMessage').mockResolvedValue({ sent: true } as any);

    await (service as any).handleChatbot({ phone: '573001234567', assignedToId: null }, 'Hola');

    expect(send).toHaveBeenCalledWith('573001234567', 'Estamos cerrados. Volvemos desde las 12:00.');
  });
});

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
  it('sends the live text menu and appends a configured URL when available', async () => {
    const prisma: any = {
      appSetting: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'digital_menu_url', value: 'https://pedidos.example/menu' },
          { key: 'chatbot_menu_share_message', value: 'Carta actualizada: {url}' },
        ]),
      },
      menuCategory: {
        findMany: jest.fn().mockResolvedValue([
          {
            name: 'Perros Calientes',
            items: [{ name: 'Perro Sencillo', price: 3500, sortOrder: 1 }],
          },
          {
            name: 'Adiciones',
            items: [{ name: 'Adición de Queso', price: 1500, sortOrder: 1 }],
          },
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

    expect(send).toHaveBeenCalledWith(
      '573001234567',
      expect.stringContaining('Carta actualizada:\n\n📋 *MENÚ Y PRECIOS VILLA DOG*'),
    );
    const sentMessage = send.mock.calls[0][1] as string;
    expect(sentMessage).toContain('- Perro Sencillo: $3.500');
    expect(sentMessage).not.toContain('Adición de Queso');
    expect(sentMessage).toContain('https://pedidos.example/menu');
    expect(prisma.appSetting.findMany).toHaveBeenCalledWith({
      where: { key: { in: ['digital_menu_url', 'chatbot_menu_share_message'] } },
    });
  });

  it('does not share the Railway fallback before a public domain is configured', async () => {
    const prisma: any = {
      appSetting: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'digital_menu_url', value: 'https://the-villa-dog-backend-production.up.railway.app/menu' },
        ]),
      },
      menuCategory: {
        findMany: jest.fn().mockResolvedValue([
          { name: 'Perros Calientes', items: [{ name: 'Perro Sencillo', price: 3500, sortOrder: 1 }] },
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

    const sentMessage = send.mock.calls[0][1] as string;
    expect(sentMessage).toContain('- Perro Sencillo: $3.500');
    expect(sentMessage).not.toContain('railway.app');
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

  it('configures Flash-Lite without a reasoning budget for fast extraction', () => {
    const service = createService();

    expect((service as any).buildGeminiGenerationConfig('gemini-2.5-flash-lite', {
      temperature: 0.3,
      maxOutputTokens: 120,
    })).toEqual({
      maxOutputTokens: 120,
      thinkingConfig: { thinkingBudget: 0 },
    });
  });

  it('uses nullable values instead of empty enum entries for incomplete orders', () => {
    const service = createService();
    const schema = (service as any).buildGeminiOrderResponseSchema();

    expect(schema.properties.detectedOrderType).toEqual({
      type: 'STRING',
      enum: ['delivery', 'pickup'],
      nullable: true,
    });
    expect(schema.properties.paymentMethod).toEqual({
      type: 'STRING',
      enum: ['CASH', 'TRANSFER'],
      nullable: true,
    });
    expect(JSON.stringify(schema)).not.toContain('""');
  });

  it('uses the administrator model first and keeps stable models only as fallback', async () => {
    const appSetting = {
      findUnique: jest.fn().mockResolvedValue({ value: 'gemini-custom-flash' }),
    };
    const service = new WhatsappService(
      { appSetting } as any,
      { get: jest.fn() } as any,
      { emitWhatsApp: jest.fn() } as any,
    );

    await expect((service as any).getGeminiModels()).resolves.toEqual([
      'gemini-custom-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
    ]);
  });

  it('extracts an explicit neighborhood without treating payment data as part of its name', () => {
    const service = createService();

    expect((service as any).extractExplicitNeighborhood([
      'Cra 56-34, barrio La Pradera y pago en efectivo',
    ])).toBe('La Pradera');
    expect((service as any).isMeaningfulGeminiReply('.')).toBe(false);
    expect((service as any).isMeaningfulGeminiReply('Listo')).toBe(true);
  });

  it('hands the chat to an advisor when a model tries to invent a total', async () => {
    const prisma: any = {
      whatsAppMessage: {
        findMany: jest.fn().mockResolvedValue([
          { direction: 'IN', content: 'Dos perros sencillos a domicilio, barrio La Pradera.' },
        ]),
      },
      menuItem: { findMany: jest.fn().mockResolvedValue([]) },
      deliveryZone: { findMany: jest.fn().mockResolvedValue([{ id: 'zone-1', name: 'La Pradera', rate: 5000 }]) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
      appSetting: {
        findUnique: jest.fn().mockResolvedValue({ value: 'gemini-3.5-flash' }),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue(null),
        delete: jest.fn().mockResolvedValue(null),
      },
      whatsAppSession: { update: jest.fn().mockResolvedValue(null) },
    };
    const socketGateway = { emitWhatsApp: jest.fn() };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, socketGateway as any);
    const send = jest.spyOn(service, 'sendMessage').mockResolvedValue({ sent: true } as any);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: 'El total a pagar es $15.000.' }] } }],
      }),
    } as any);

    await (service as any).handleGeminiChatbot(
      { id: 'chat-1', phone: '3001234567', customerName: 'José' },
      'Dos perros sencillos a domicilio, barrio La Pradera.',
      ['test-key'],
    );

    expect(send).toHaveBeenCalledWith(
      '3001234567',
      'Gracias. Un asesor verificará la tarifa, el tiempo y el total antes de confirmar tu pedido.',
    );
    expect(prisma.whatsAppSession.update).toHaveBeenCalledWith({
      where: { id: 'chat-1' },
      data: { waitingForAdvisor: true },
    });
    expect(socketGateway.emitWhatsApp).toHaveBeenCalledWith(
      'whatsappAgentRequest',
      expect.objectContaining({ sessionId: 'chat-1', waitingForAdvisor: true }),
    );
    fetchSpy.mockRestore();
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
