import { BadRequestException } from '@nestjs/common';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';
import { WhatsappService } from './whatsapp.service';
import { WhatsAppSiteResolverService } from './whatsapp-site-resolver.service';

describe('WhatsApp multisite routing', () => {
  const site2 = '00000000-0000-4000-8000-000000000202';
  const phoneNumberId = '123456789012345';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createInboundFixture(accounts: any[]) {
    const prisma: any = {
      whatsAppAccount: {
        findMany: jest.fn().mockResolvedValue(accounts),
        findUnique: jest.fn(),
      },
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      site: { findFirst: jest.fn().mockResolvedValue(null) },
      whatsAppSession: { create: jest.fn(), findFirst: jest.fn() },
      whatsAppMessage: { create: jest.fn(), findFirst: jest.fn() },
    };
    const config: any = { get: jest.fn().mockReturnValue(null) };
    const socket: any = { emitWhatsApp: jest.fn() };
    const resolver = new WhatsAppSiteResolverService(prisma, config);
    const service = new WhatsappService(prisma, config, socket, undefined, resolver);
    return { prisma, socket, resolver, service };
  }

  function webhookPayload() {
    return {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          field: 'messages',
          value: {
            metadata: { phone_number_id: phoneNumberId },
            contacts: [{ wa_id: '573001234567', profile: { name: 'Cliente' } }],
            messages: [{ id: 'wamid.inbound', from: '573001234567', type: 'text', text: { body: 'Hola' } }],
            statuses: [{ id: 'wamid.outbound', status: 'delivered' }],
          },
        }],
      }],
    };
  }

  it('routes incoming messages and statuses through metadata.phone_number_id', async () => {
    const { service, prisma } = createInboundFixture([{
      id: 'account-site-2',
      siteId: site2,
      phoneNumberId,
    }]);
    const incoming = jest.spyOn(service as any, 'processIncomingMessage').mockResolvedValue(undefined);
    const status = jest.spyOn(service as any, 'processMessageStatusUpdate').mockResolvedValue(undefined);

    await (service as any)._processWebhookAsync(webhookPayload());

    expect(prisma.whatsAppAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ phoneNumberId, active: true }),
    }));
    expect(incoming).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wamid.inbound' }),
      expect.objectContaining({ wa_id: '573001234567' }),
      site2,
    );
    expect(status).toHaveBeenCalledWith(expect.objectContaining({ id: 'wamid.outbound' }), site2);
  });

  it('routes every change in a mixed-site webhook through its own context', async () => {
    const principalPhoneNumberId = '111111111111111';
    const { service, prisma } = createInboundFixture([]);
    prisma.whatsAppAccount.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve([{
        id: `account-${where.phoneNumberId}`,
        siteId: where.phoneNumberId === principalPhoneNumberId
          ? DEFAULT_SITE_ID
          : site2,
        phoneNumberId: where.phoneNumberId,
      }]),
    );
    const incoming = jest.spyOn(service as any, 'processIncomingMessage').mockResolvedValue(undefined);
    const status = jest.spyOn(service as any, 'processMessageStatusUpdate').mockResolvedValue(undefined);
    const body = webhookPayload();
    body.entry[0].changes.unshift({
      field: 'messages',
      value: {
        metadata: { phone_number_id: principalPhoneNumberId },
        contacts: [{ wa_id: '573009999999', profile: { name: 'Principal' } }],
        messages: [{ id: 'wamid.principal', from: '573009999999', type: 'text', text: { body: 'Principal' } }],
        statuses: [{ id: 'wamid.principal-out', status: 'read' }],
      },
    });

    await (service as any)._processWebhookAsync(body);

    expect(incoming).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wamid.principal' }),
      expect.objectContaining({ wa_id: '573009999999' }),
      DEFAULT_SITE_ID,
    );
    expect(incoming).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wamid.inbound' }),
      expect.objectContaining({ wa_id: '573001234567' }),
      site2,
    );
    expect(status).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wamid.principal-out' }),
      DEFAULT_SITE_ID,
    );
    expect(status).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wamid.outbound' }),
      site2,
    );
    expect(prisma.whatsAppAccount.findMany).toHaveBeenCalledTimes(2);
  });

  it('continues with later changes when one route is ambiguous', async () => {
    const ambiguousPhoneNumberId = '222222222222222';
    const { service, prisma } = createInboundFixture([]);
    prisma.whatsAppAccount.findMany.mockImplementation(({ where }: any) => {
      if (where.phoneNumberId === ambiguousPhoneNumberId) {
        return Promise.resolve([
          { id: 'duplicate-a', siteId: DEFAULT_SITE_ID, phoneNumberId: ambiguousPhoneNumberId },
          { id: 'duplicate-b', siteId: site2, phoneNumberId: ambiguousPhoneNumberId },
        ]);
      }
      return Promise.resolve([{
        id: 'account-site-2',
        siteId: site2,
        phoneNumberId: where.phoneNumberId,
      }]);
    });
    const incoming = jest.spyOn(service as any, 'processIncomingMessage').mockResolvedValue(undefined);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    const body = webhookPayload();
    body.entry[0].changes.unshift({
      field: 'messages',
      value: {
        metadata: { phone_number_id: ambiguousPhoneNumberId },
        contacts: [{ wa_id: '573008888888', profile: { name: 'Ambiguo' } }],
        messages: [{ id: 'wamid.ambiguous', from: '573008888888', type: 'text', text: { body: 'No enrutar' } }],
        statuses: [],
      },
    });

    await (service as any)._processWebhookAsync(body);

    expect(incoming).toHaveBeenCalledTimes(1);
    expect(incoming).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wamid.ambiguous' }),
      expect.anything(),
      expect.anything(),
    );
    expect(incoming).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wamid.inbound' }),
      expect.objectContaining({ wa_id: '573001234567' }),
      site2,
    );
  });

  it('ignores events for an unregistered or inactive Meta number', async () => {
    const { service, prisma, socket } = createInboundFixture([]);
    const incoming = jest.spyOn(service as any, 'processIncomingMessage').mockResolvedValue(undefined);
    const status = jest.spyOn(service as any, 'processMessageStatusUpdate').mockResolvedValue(undefined);

    await (service as any)._processWebhookAsync(webhookPayload());

    expect(incoming).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(prisma.whatsAppSession.create).not.toHaveBeenCalled();
    expect(prisma.whatsAppMessage.create).not.toHaveBeenCalled();
    expect(socket.emitWhatsApp).not.toHaveBeenCalled();
  });

  it('uses the Meta phone and secret configured for the selected site', async () => {
    const session = {
      id: 'session-site-2',
      siteId: site2,
      phone: '3001234567',
      customerPhone: '3001234567',
      customerName: 'Cliente sede 2',
      assignedToId: null,
    };
    const prisma: any = {
      whatsAppAccount: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'account-site-2',
          siteId: site2,
          phoneNumberId: 'site-2-phone-id',
          businessAccountId: null,
          displayPhoneNumber: null,
          accessTokenEnvKey: 'SITE2_WHATSAPP_TOKEN',
          verifyTokenEnvKey: null,
          active: true,
          site: { active: true },
        }),
      },
      appSetting: { findUnique: jest.fn() },
      whatsAppSession: {
        findFirst: jest.fn().mockResolvedValue(session),
        update: jest.fn().mockResolvedValue(session),
      },
      whatsAppMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'message-site-2',
          ...data,
          createdAt: new Date('2026-10-04T12:00:00.000Z'),
        })),
      },
    };
    const config: any = {
      get: jest.fn((key: string) => key === 'SITE2_WHATSAPP_TOKEN' ? 'token-site-2' : null),
    };
    const socket: any = { emitWhatsApp: jest.fn() };
    const resolver = new WhatsAppSiteResolverService(prisma, config);
    const resolverSpy = jest.spyOn(resolver, 'getSiteMetaConfig');
    const service = new WhatsappService(prisma, config, socket, undefined, resolver);
    jest.spyOn(service as any, 'resolveActiveRecipient').mockResolvedValue({
      recipientPhone: '3001234567',
      lastInWaId: null,
      isId: false,
    });
    jest.spyOn(service as any, 'resolveMessageOrderId').mockResolvedValue(null);
    jest.spyOn(service, 'markSessionMessagesAsRead').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'emitDriverOrderChatMessage').mockResolvedValue(undefined);
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.site-2' }] }),
    } as any);

    const result = await service.sendMessage(
      '3001234567',
      'Hola desde sede 2',
      undefined,
      undefined,
      session.id,
      undefined,
      site2,
    );

    expect(result.sent).toBe(true);
    expect(resolverSpy).toHaveBeenCalledWith(site2);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://graph.facebook.com/v26.0/site-2-phone-id/messages',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-site-2' }),
      }),
    );
    expect(prisma.appSetting.findUnique).not.toHaveBeenCalled();
    expect(socket.emitWhatsApp).toHaveBeenCalledWith(
      'whatsappMessage',
      expect.objectContaining({ siteId: site2, sessionId: session.id }),
      site2,
    );
  });

  it('rejects a session id from another site before reading credentials or calling Meta', async () => {
    const prisma: any = {
      whatsAppSession: { findFirst: jest.fn().mockResolvedValue(null) },
      whatsAppAccount: { findUnique: jest.fn() },
      appSetting: { findUnique: jest.fn() },
      whatsAppMessage: { create: jest.fn() },
    };
    const config: any = { get: jest.fn() };
    const socket: any = { emitWhatsApp: jest.fn() };
    const resolver = new WhatsAppSiteResolverService(prisma, config);
    const resolverSpy = jest.spyOn(resolver, 'getSiteMetaConfig');
    const service = new WhatsappService(prisma, config, socket, undefined, resolver);
    const fetchSpy = jest.spyOn(global, 'fetch' as any);

    const result = await service.sendMessage(
      '3001234567',
      'No debe salir',
      undefined,
      undefined,
      'principal-session',
      undefined,
      site2,
    );

    expect(result).toEqual({ sent: false, reason: 'session_not_found_in_site' });
    expect(prisma.whatsAppSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'principal-session', siteId: site2 },
    }));
    expect(resolverSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.whatsAppMessage.create).not.toHaveBeenCalled();
    expect(socket.emitWhatsApp).not.toHaveBeenCalled();
  });

  it('does not return a conversation that belongs to another site', async () => {
    const prisma: any = {
      whatsAppSession: {
        findUnique: jest.fn().mockResolvedValue({ id: 'principal-chat', siteId: DEFAULT_SITE_ID }),
      },
    };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, { emitWhatsApp: jest.fn() } as any);

    await expect(service.getSession('principal-chat', site2)).resolves.toBeNull();
  });

  it('applies the selected site to inbox queries and bulk release', async () => {
    const prisma: any = {
      whatsAppSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      cashClosing: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const socket: any = { emitWhatsApp: jest.fn() };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, socket);

    await expect(service.getSessions(undefined, false, 60, 1, undefined, undefined, undefined, false, site2))
      .resolves.toEqual([]);
    await service.unassignAllSessions(undefined, site2);

    expect(prisma.whatsAppSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { siteId: site2, active: true },
    }));
    expect(prisma.whatsAppSession.updateMany).toHaveBeenLastCalledWith({
      where: { siteId: site2, active: true, assignedToId: { not: null } },
      data: { assignedToId: null },
    });
    expect(socket.emitWhatsApp).toHaveBeenCalledWith(
      'whatsappSessionUpdated',
      { siteId: site2, unassignedAll: true },
      site2,
    );
  });

  it('rejects assignment to a user without an active membership in the site', async () => {
    const prisma: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'advisor-1', active: true }) },
      userSiteMembership: { findUnique: jest.fn().mockResolvedValue(null) },
      whatsAppSession: {
        findUnique: jest.fn().mockResolvedValue({ id: 'site-2-chat', siteId: site2, assignedToId: null }),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, { emitWhatsApp: jest.fn() } as any);

    await expect(service.assignSession(
      'site-2-chat',
      'advisor-1',
      { id: 'admin-2', role: 'ADMIN', siteId: site2 },
      site2,
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.whatsAppSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.whatsAppSession.update).not.toHaveBeenCalled();
  });

  it('keeps the principal payment QR unavailable to another site', async () => {
    const prisma: any = {
      whatsAppSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'site-2-chat',
          siteId: site2,
          phone: '3001234567',
        }),
      },
      appSetting: { findMany: jest.fn() },
    };
    const service = new WhatsappService(prisma, { get: jest.fn() } as any, { emitWhatsApp: jest.fn() } as any);
    const fetchSpy = jest.spyOn(global, 'fetch' as any);

    await expect(service.sendPaymentQr('3001234567', undefined, 'site-2-chat', site2)).resolves.toEqual({
      sent: false,
      reason: 'site_payment_settings_required',
    });
    expect(prisma.appSetting.findMany).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
