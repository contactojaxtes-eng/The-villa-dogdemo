import { ConflictException } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

describe('WhatsApp webhook burst handling', () => {
  const createService = () => {
    let nextSession = 0;
    let nextMessage = 0;
    const prisma: any = {
      whatsAppSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: `session-${++nextSession}`,
          ...data,
          assignedToId: null,
          assignedTo: null,
        })),
      },
      whatsAppMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: `message-${++nextMessage}`,
          ...data,
          createdAt: new Date(),
        })),
      },
    };
    const socketGateway = { emitWhatsApp: jest.fn() };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, socketGateway as any);
    return { service, prisma, socketGateway };
  };

  it('keeps ten simultaneous customer conversations independent and emits each one immediately', async () => {
    const { service, prisma, socketGateway } = createService();
    jest.spyOn(service as any, 'handleChatbot').mockResolvedValue(undefined);

    const messages = Array.from({ length: 10 }, (_, index) => ({
      id: `wamid.test-${index}`,
      from: `5730012345${index}`,
      type: 'text',
      text: { body: `Pedido simultáneo ${index + 1}` },
    }));
    const contacts = messages.map((message, index) => ({
      wa_id: message.from,
      profile: { name: `Cliente ${index + 1}` },
    }));

    await (service as any)._processWebhookAsync({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { messages, contacts } }] }],
    });

    expect(prisma.whatsAppSession.create).toHaveBeenCalledTimes(10);
    expect(prisma.whatsAppMessage.create).toHaveBeenCalledTimes(10);
    expect(socketGateway.emitWhatsApp.mock.calls.filter(([event]: [string]) => event === 'whatsappMessage')).toHaveLength(10);
    expect(prisma.whatsAppMessage.create.mock.calls.map(([call]: any[]) => call.data.content)).toEqual(
      messages.map(message => message.text.body),
    );
  });

  it('accepts photo, voice note and video without delaying the live inbox', async () => {
    const { service, prisma, socketGateway } = createService();
    jest.spyOn(service as any, 'handleMultimediaChatbot').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'transcribeIncomingAudio').mockResolvedValue(undefined);
    const messages = [
      { id: 'wamid.image', from: '573001230001', type: 'image', image: { id: 'media-image', caption: 'Foto del pedido' } },
      { id: 'wamid.audio', from: '573001230002', type: 'audio', audio: { id: 'media-audio' } },
      { id: 'wamid.video', from: '573001230003', type: 'video', video: { id: 'media-video', caption: 'Video del pedido' } },
    ];
    const contacts = messages.map((message, index) => ({
      wa_id: message.from,
      profile: { name: `Multimedia ${index + 1}` },
    }));

    await (service as any)._processWebhookAsync({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { messages, contacts } }] }],
    });

    const stored = prisma.whatsAppMessage.create.mock.calls.map(([call]: any[]) => call.data);
    expect(stored.map((message: any) => message.messageType)).toEqual(['image', 'audio', 'video']);
    expect(stored.map((message: any) => message.content)).toEqual([
      '/api/whatsapp/media/media-image|Foto del pedido',
      '/api/whatsapp/media/media-audio',
      '/api/whatsapp/media/media-video|Video del pedido',
    ]);
    expect(socketGateway.emitWhatsApp.mock.calls.filter(([event]: [string]) => event === 'whatsappMessage')).toHaveLength(3);
  });
});

describe('WhatsApp voice-note transcription for order intake', () => {
  it('transcribes an incoming voice note for Nuevo pedido without replying to the customer', async () => {
    const prisma: any = {
      whatsAppMessage: {
        update: jest.fn().mockResolvedValue({
          id: 'message-audio',
          waMessageId: 'wamid.audio',
          createdAt: new Date('2026-09-09T18:00:00.000Z'),
        }),
      },
    };
    const socketGateway = { emitWhatsApp: jest.fn() };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, socketGateway as any);
    const settings: Record<string, string> = {
      order_reader_enabled: 'true',
      gemini_api_key: 'test-key',
      gemini_model: 'gemini-3.5-flash-lite',
    };
    jest.spyOn(service as any, 'getSetting').mockImplementation(async (key: string) => settings[key] || null);
    jest.spyOn(service as any, 'getMediaBuffer').mockResolvedValue({
      buffer: Buffer.from('voice-note'),
      contentType: 'audio/ogg; codecs=opus',
    });
    jest.spyOn(service as any, 'getGeminiModels').mockResolvedValue(['gemini-3.5-flash-lite']);
    jest.spyOn(service as any, 'incrementGeminiUsage').mockResolvedValue(undefined);
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Dos perros sencillos, uno sin cebolla.' }] } }] }),
    } as any);
    const sendSpy = jest.spyOn(service, 'sendMessage').mockResolvedValue({ sent: true } as any);

    try {
      await (service as any).transcribeIncomingAudio({
        session: { id: 'session-audio', phone: '573001234567', customerName: 'Cliente audio' },
        messageId: 'message-audio',
        mediaId: 'media-audio',
        content: '/api/whatsapp/media/media-audio',
      });
    } finally {
      fetchSpy.mockRestore();
    }

    expect(prisma.whatsAppMessage.update).toHaveBeenCalledWith({
      where: { id: 'message-audio' },
      data: { content: '/api/whatsapp/media/media-audio|📝 Transcripción: Dos perros sencillos, uno sin cebolla.' },
    });
    expect(socketGateway.emitWhatsApp).toHaveBeenCalledWith(
      'whatsappAudioTranscribed',
      expect.objectContaining({
        sessionId: 'session-audio',
        messageId: 'message-audio',
        transcript: 'Dos perros sencillos, uno sin cebolla.',
      }),
    );
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('does not process voice notes when the order reader is paused', async () => {
    const prisma: any = { whatsAppMessage: { update: jest.fn() } };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, { emitWhatsApp: jest.fn() } as any);
    jest.spyOn(service as any, 'getSetting').mockResolvedValue('false');
    const mediaSpy = jest.spyOn(service as any, 'getMediaBuffer');

    await (service as any).transcribeIncomingAudio({
      session: { id: 'session-audio', phone: '573001234567' },
      messageId: 'message-audio',
      mediaId: 'media-audio',
      content: '/api/whatsapp/media/media-audio',
    });

    expect(mediaSpy).not.toHaveBeenCalled();
    expect(prisma.whatsAppMessage.update).not.toHaveBeenCalled();
  });
});

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

  it('lets ten delivery managers claim different chats at the same time', async () => {
    const sessions = new Map(Array.from({ length: 10 }, (_, index) => {
      const id = `chat-${index + 1}`;
      return [id, { id, phone: `30012345${String(index).padStart(2, '0')}`, assignedToId: null, waitingForAdvisor: true }];
    }));
    const prisma: any = {
      user: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve({ id: where.id, active: true })),
      },
      whatsAppSession: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve(sessions.get(where.id) || null)),
        updateMany: jest.fn(({ where, data }: any) => {
          const id = where.id;
          if (!id) return Promise.resolve({ count: 0 });
          const session = sessions.get(id);
          if (!session || (session.assignedToId && session.assignedToId !== data.assignedToId)) {
            return Promise.resolve({ count: 0 });
          }
          Object.assign(session, data);
          return Promise.resolve({ count: 1 });
        }),
        update: jest.fn(({ where, data }: any) => {
          const session = sessions.get(where.id)!;
          Object.assign(session, data);
          return Promise.resolve({
            ...session,
            assignedTo: session.assignedToId ? { id: session.assignedToId, name: session.assignedToId } : null,
          });
        }),
      },
    };
    const { service } = createService(prisma);

    const claimed = await Promise.all(Array.from({ length: 10 }, (_, index) => {
      const advisorId = `advisor-${index + 1}`;
      return service.assignSession(`chat-${index + 1}`, advisorId, {
        id: advisorId,
        name: `Asesora ${index + 1}`,
        role: 'DELIVERY_MANAGER',
      });
    }));

    expect(claimed.map(session => session.assignedToId)).toEqual(
      Array.from({ length: 10 }, (_, index) => `advisor-${index + 1}`),
    );
    expect(prisma.whatsAppSession.updateMany).toHaveBeenCalledTimes(10);
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
      where: expect.objectContaining({ sessionId: 'chat-1' }),
      take: 120,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
    expect(prisma.whatsAppSession.findMany).not.toHaveBeenCalled();

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
      where: { key: { in: ['digital_menu_url', 'chatbot_menu_share_message', 'chatbot_menu_text'] } },
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

  it('rotates the first Gemini key evenly across configured projects', () => {
    const service = createService();
    const keys = ['project-key-A', 'project-key-B', 'project-key-C'];

    const firstKeys = Array.from({ length: 9 }, () => (
      (service as any).getGeminiKeyCandidates(keys)[0]
    ));

    expect(firstKeys).toEqual([
      'project-key-A', 'project-key-B', 'project-key-C',
      'project-key-A', 'project-key-B', 'project-key-C',
      'project-key-A', 'project-key-B', 'project-key-C',
    ]);
  });

  it('skips a limited Gemini key and returns it to rotation after its cooldown', () => {
    const service = createService();
    const keys = ['project-key-A', 'project-key-B', 'project-key-C'];
    const now = 1_000_000;

    expect((service as any).getGeminiKeyCandidates(keys, now)[0]).toBe('project-key-A');
    (service as any).geminiKeyCooldownUntil.set('project-key-B', now + 60_000);

    expect((service as any).getGeminiKeyCandidates(keys, now + 1)[0]).toBe('project-key-C');
    expect((service as any).getGeminiKeyCandidates(keys, now + 2)[0]).toBe('project-key-A');
    expect((service as any).getGeminiKeyCandidates(keys, now + 60_001)[0]).toBe('project-key-B');
  });

  it('keeps concurrent reservations fair even when requests finish out of order', () => {
    const service = createService();
    const keys = ['project-key-A', 'project-key-B', 'project-key-C'];

    const firstOperation = (service as any).getGeminiKeyCandidates(keys)[0];
    const secondOperation = (service as any).getGeminiKeyCandidates(keys)[0];
    (service as any).geminiKeyCooldownUntil.set('project-key-A', Date.now() + 60_000);
    const thirdOperation = (service as any).getGeminiKeyCandidates(keys)[0];

    expect([firstOperation, secondOperation, thirdOperation]).toEqual([
      'project-key-A',
      'project-key-B',
      'project-key-C',
    ]);
    expect((service as any).isGeminiKeyOnCooldown('project-key-A')).toBe(true);
  });

  it('keeps sandbox key pools from moving the production cursor', () => {
    const service = createService();
    const productionKeys = ['project-key-A', 'project-key-B', 'project-key-C'];

    expect((service as any).getGeminiKeyCandidates(productionKeys)[0]).toBe('project-key-A');
    expect((service as any).getGeminiKeyCandidates(['sandbox-key-X'])[0]).toBe('sandbox-key-X');
    expect((service as any).getGeminiKeyCandidates(productionKeys)[0]).toBe('project-key-B');
  });

  it('puts a limited key on cooldown before waiting for the provider error body', async () => {
    const service = createService();
    let releaseBody: ((value: string) => void) | undefined;
    const body = new Promise<string>(resolve => {
      releaseBody = resolve;
    });
    const response = {
      status: 429,
      headers: { get: jest.fn().mockReturnValue(null) },
      text: jest.fn().mockReturnValue(body),
    };

    const pending = (service as any).putGeminiKeyOnCooldown('project-key-A', response);
    expect((service as any).isGeminiKeyOnCooldown('project-key-A')).toBe(true);

    releaseBody?.('Please retry in 600s');
    await pending;
    expect((service as any).geminiKeyCooldownUntil.get('project-key-A'))
      .toBeGreaterThan(Date.now() + 9 * 60_000);
  });

  it('fails over on quota without losing the next operation reservation', async () => {
    const keys = ['project-secret-A', 'project-secret-B', 'project-secret-C'];
    const prisma: any = {
      appSetting: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.key === 'gemini_api_key') return { value: keys.join(',') };
          return null;
        }),
      },
      menuItem: { findMany: jest.fn().mockResolvedValue([]) },
      deliveryZone: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new WhatsappService(
      prisma,
      { get: jest.fn() } as any,
      { emitWhatsApp: jest.fn() } as any,
    );
    jest.spyOn(service as any, 'getSetting').mockResolvedValue(null);
    jest.spyOn(service as any, 'getGeminiModels').mockResolvedValue(['gemini-test-model']);
    jest.spyOn(service as any, 'incrementGeminiUsage').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'getGeminiUsageToday').mockResolvedValue(2);

    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: jest.fn().mockReturnValue(null) },
        json: jest.fn().mockResolvedValue({ error: { message: 'quota reached', retryDelay: '600s' } }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ candidates: [{ content: { parts: [{ text: 'Respuesta B' }] } }] }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ candidates: [{ content: { parts: [{ text: 'Respuesta B siguiente' }] } }] }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ candidates: [{ content: { parts: [{ text: 'Respuesta C' }] } }] }),
      } as any);

    try {
      const first = await service.testGeminiChat([{ role: 'user', text: 'Hola' }]);
      const second = await service.testGeminiChat([{ role: 'user', text: 'Hola otra vez' }]);
      const third = await service.testGeminiChat([{ role: 'user', text: 'Tercer mensaje' }]);

      expect(first).toEqual(expect.objectContaining({ success: true, reply: 'Respuesta B' }));
      expect(second).toEqual(expect.objectContaining({ success: true, reply: 'Respuesta B siguiente' }));
      expect(third).toEqual(expect.objectContaining({ success: true, reply: 'Respuesta C' }));
      expect(fetchSpy.mock.calls.map(call => String(call[0]))).toEqual([
        expect.stringContaining('key=project-secret-A'),
        expect.stringContaining('key=project-secret-B'),
        expect.stringContaining('key=project-secret-B'),
        expect.stringContaining('key=project-secret-C'),
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
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

  it('uses the administrator model first and keeps current production models as fallback', async () => {
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
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-2.5-flash-lite',
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
    jest.spyOn(service as any, 'incrementGeminiUsage').mockResolvedValue(undefined);
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
    jest.spyOn(service as any, 'incrementGeminiUsage').mockResolvedValue(undefined);
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

  it('pulls beverages defaulting to personal presentation and strictly excludes glass beverages', () => {
    const service = createService();
    const catalog = [
      { name: 'Coca Cola Vidrio 250 ml', category: { name: 'Gaseosas y Bebidas' } },
      { name: 'Coca Cola 400 ml', category: { name: 'Gaseosas y Bebidas' } },
      { name: 'Coca Cola Zero 400 ml', category: { name: 'Gaseosas y Bebidas' } },
      { name: 'Pepsi 400 ml', category: { name: 'Gaseosas y Bebidas' } },
      { name: 'Manzana Postobón 400 ml', category: { name: 'Gaseosas y Bebidas' } },
      { name: 'Manzana Postobón 1.5 L', category: { name: 'Gaseosas y Bebidas' } },
    ];
    const accept = (name: string, chat: string) => (service as any).isBeverageSelectionUnambiguous(
      catalog.find(item => item.name === name), catalog, chat,
    );

    // Si el cliente pide la bebida sin tamaño, la IA debe halar la presentación personal no-vidrio (400 ml)
    expect(accept('Coca Cola 400 ml', 'Cliente: Dame una Coca Cola')).toBe(true);
    expect(accept('Coca Cola 400 ml', 'Cliente: Dame una Coca Cola 400 ml')).toBe(true);
    // Las bebidas de vidrio NUNCA las debe halar la IA
    expect(accept('Coca Cola Vidrio 250 ml', 'Cliente: Dame una Coca Cola de vidrio')).toBe(false);
    expect(accept('Coca Cola Vidrio 250 ml', 'Cliente: Dame una Coca Cola')).toBe(false);
    expect(accept('Coca Cola Zero 400 ml', 'Cliente: Dame una Coca Cola 400 ml')).toBe(false);
    expect(accept('Coca Cola Zero 400 ml', 'Cliente: Dame una Coca Cola Zero')).toBe(true);
    expect(accept('Manzana Postobón 1.5 L', 'Cliente: Dame una manzana 1.5 L')).toBe(true);
    expect(accept('Manzana Postobón 400 ml', 'Cliente: Dame una manzana 1.5 L')).toBe(false);
    expect(accept('Manzana Postobón 400 ml', 'Cliente: Dame una manzana')).toBe(true);
    expect(accept('Coca Cola 400 ml', 'Cliente: Dame una Coca Cola 400 ml\nCliente: Mejor cámbiala por Pepsi 400 ml')).toBe(false);
    expect(accept('Pepsi 400 ml', 'Cliente: Dame una Coca Cola 400 ml\nCliente: Mejor cámbiala por Pepsi 400 ml')).toBe(true);
    expect(accept('Coca Cola 400 ml', 'Cliente: Cambia la Coca Cola 400 ml por Pepsi 400 ml')).toBe(false);
    expect(accept('Pepsi 400 ml', 'Cliente: Cambia la Coca Cola 400 ml por Pepsi 400 ml')).toBe(true);
    expect(accept('Coca Cola 400 ml', 'Cliente: Dame una Coca Cola 400 ml y una Pepsi 400 ml')).toBe(true);
    expect(accept('Pepsi 400 ml', 'Cliente: Dame una Coca Cola 400 ml y una Pepsi 400 ml')).toBe(true);
    expect(accept('Coca Cola 400 ml', 'Cliente: Dame una Coca Cola 400 ml\nCliente: Sí, para domicilio')).toBe(true);
  });

  it('tests a multi-turn chat with the current menu without sending a WhatsApp message', async () => {
    const apiKey = 'test-secret-key-AB12';
    const prisma: any = {
      appSetting: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.key === 'gemini_api_key') return { value: apiKey };
          if (where.key === 'gemini_model') return { value: 'gemini-2.5-flash-lite' };
          return null;
        }),
      },
      menuItem: { findMany: jest.fn().mockResolvedValue([
        { name: 'Coca Cola 400 ml', price: 4000, description: null, category: { name: 'Gaseosas y Bebidas' } },
        { name: 'Coca Cola Vidrio 250 ml', price: 2500, description: null, category: { name: 'Gaseosas y Bebidas' } },
      ]) },
      deliveryZone: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, { emitWhatsApp: jest.fn() } as any);
    jest.spyOn(service as any, 'getSetting').mockResolvedValue(null);
    jest.spyOn(service as any, 'getGeminiModels').mockResolvedValue(['gemini-2.5-flash-lite']);
    jest.spyOn(service as any, 'incrementGeminiUsage').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'getGeminiUsageToday').mockResolvedValue(1);
    const sendSpy = jest.spyOn(service, 'sendMessage');
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'Tenemos Coca Cola de 250 ml en vidrio y de 400 ml. ¿Cuál quieres?' }] } }] }),
    } as any);

    try {
      const result = await service.testGeminiChat([
        { role: 'user', text: 'Quiero una Coca Cola' },
        { role: 'model', text: '¿Cuál presentación quieres?' },
        { role: 'user', text: '¿Cuáles tienen?' },
      ], '••••AB12', 'gemini-2.5-flash-lite', 'Responde breve.');

      expect(result.success).toBe(true);
      expect(result.reply).toContain('250 ml');
      expect(sendSpy).not.toHaveBeenCalled();
      const payload = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(payload.contents).toHaveLength(1);
      const prompt = payload.contents[0].parts[0].text;
      expect(prompt).toContain('Coca Cola Vidrio 250 ml');
      expect(prompt).toContain('Responde breve.');
      expect(prompt).toContain('Cliente: Quiero una Coca Cola');
      expect(prompt).toContain('Restaurante (Tú): ¿Cuál presentación quieres?');
      expect(prompt).toContain('Cliente: ¿Cuáles tienen?');
      expect(JSON.stringify(result)).not.toContain(apiKey);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('WhatsApp order chat isolation', () => {
  it('does not attach a legacy order when more than one session has the same sender phone', async () => {
    const prisma: any = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          chatSessionId: null,
          customerPhone: '3001234567',
          transferProofs: [],
        }),
        updateMany: jest.fn(),
      },
      whatsAppSession: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'session-new', phone: '573001234567' },
          { id: 'session-old', phone: '3001234567' },
        ]),
      },
    };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, { emitWhatsApp: jest.fn() } as any);

    const result = await service.getOrderChat('order-1');

    expect(result.session).toBeNull();
    expect(result.messages).toEqual([]);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('does not treat a Colombian phone number as an order number query', async () => {
    const prisma: any = {
      cashClosing: { findFirst: jest.fn().mockResolvedValue(null) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
      whatsAppSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      whatsAppMessage: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, { emitWhatsApp: jest.fn() } as any);

    await expect(service.getSessions('3015932223', false, 20, undefined, 'ALL')).resolves.toEqual([]);

    const orderNumberQueries = prisma.order.findMany.mock.calls.filter(([args]: any[]) => args?.where?.orderNumber !== undefined);
    expect(orderNumberQueries).toHaveLength(0);
    expect((service as any).parseOrderNumberFromSearch('#243')).toBe(243);
    expect((service as any).parseOrderNumberFromSearch('pedido 3015932223')).toBeNull();
  });

  it('keeps the order chat bounded and never returns receipt bytes in its payload', async () => {
    const messageStart = Date.parse('2026-09-20T12:00:00.000Z');
    const messages = Array.from({ length: 41 }, (_, index) => ({
      id: `message-${41 - index}`,
      createdAt: new Date(messageStart + (40 - index) * 60_000),
    }));
    const prisma: any = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          orderNumber: 243,
          customerName: 'Cliente',
          customerPhone: '3001234567',
          customerAddress: 'Calle 1',
          total: 12000,
          status: 'PENDING',
          orderType: 'DELIVERY',
          paymentMethod: 'TRANSFER',
          paymentStatus: 'PENDING',
          cashAmount: 0,
          transferAmount: 12000,
          chatSessionId: 'session-1',
          transferProofs: [{
            id: 'proof-1',
            status: 'PENDING',
            method: 'TRANSFER',
            amount: 12000,
            fileBase64: 'must-not-leak',
            filePath: '/private/proof.jpg',
            originalName: 'proof.jpg',
            mimeType: 'image/jpeg',
            fileSize: 100,
            paymentId: 'payment-1',
            orderId: 'order-1',
            tableId: null,
            cashClosingId: null,
            submittedById: 'user-1',
            reviewedById: null,
            rejectionReason: null,
            purgedAt: null,
            reviewedAt: null,
            createdAt: new Date('2026-09-20T12:00:00.000Z'),
          }],
        }),
      },
      whatsAppSession: { findUnique: jest.fn().mockResolvedValue({ id: 'session-1', phone: '573001234567' }) },
      whatsAppMessage: { findMany: jest.fn().mockResolvedValue(messages) },
    };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, { emitWhatsApp: jest.fn() } as any);

    const result: any = await service.getOrderChat('order-1');

    expect(result.messages).toHaveLength(40);
    expect(result.messagePage).toEqual(expect.objectContaining({ hasPrevious: true, beforeId: 'message-2', limit: 40 }));
    expect(result.order.transferProofs).toBeUndefined();
    expect(result.transferProofs[0]).not.toHaveProperty('fileBase64');
    expect(result.transferProofs[0]).not.toHaveProperty('filePath');
    expect(prisma.order.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        transferProofs: expect.objectContaining({
          select: expect.not.objectContaining({ fileBase64: expect.anything(), filePath: expect.anything() }),
        }),
      }),
    }));
  });

  it('only resolves a proof when it belongs to the requested order', async () => {
    const prisma: any = {
      transferProof: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'proof-1',
          method: 'TRANSFER',
          mimeType: 'image/jpeg',
          fileBase64: 'private-bytes',
          filePath: null,
        }),
      },
    };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, { emitWhatsApp: jest.fn() } as any);

    await expect(service.getOrderChatProof('order-1', 'proof-1')).resolves.toEqual(expect.objectContaining({ id: 'proof-1' }));
    expect(prisma.transferProof.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'proof-1', orderId: 'order-1' },
    }));
  });
});
