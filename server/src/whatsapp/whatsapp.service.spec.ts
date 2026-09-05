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
  });
});
