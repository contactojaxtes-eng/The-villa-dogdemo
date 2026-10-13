import { WhatsappService } from './whatsapp.service';

describe('WhatsApp Meta draft preflight isolation', () => {
  const secondSiteId = '00000000-0000-4000-8000-000000000102';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createService(preparedConfig: any, operationalConfig: any = null) {
    const prisma: any = {
      siteSetting: {
        upsert: jest.fn().mockResolvedValue(null),
      },
      whatsAppSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-site-2',
          siteId: secondSiteId,
          phone: '573001234567',
          customerPhone: '3001234567',
        }),
      },
    };
    const resolver: any = {
      getPreparedSiteMetaConfig: jest.fn().mockResolvedValue(preparedConfig),
      getSiteMetaConfig: jest.fn().mockResolvedValue(operationalConfig),
    };
    const service = new WhatsappService(
      prisma,
      { get: jest.fn() } as any,
      { emitWhatsApp: jest.fn() } as any,
      undefined,
      resolver,
    );
    return { service, prisma, resolver };
  }

  it('tests exactly the stored draft account with one read-only Graph request', async () => {
    const { service, prisma, resolver } = createService({
      siteId: secondSiteId,
      phoneNumberId: '123456789012345',
      accessToken: 'stored-draft-token',
    });
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        display_phone_number: '+57 300 123 4567',
        verified_name: 'Sede Dos',
        quality_rating: 'GREEN',
        code_verification_status: 'VERIFIED',
      }),
    } as any);

    const result = await service.testMetaConnection(
      'token-que-no-debe-usarse',
      '999999999999999',
      secondSiteId,
    );

    expect(result).toEqual(expect.objectContaining({
      success: true,
      displayPhoneNumber: '+57 300 123 4567',
      verifiedName: 'Sede Dos',
    }));
    expect(result).not.toHaveProperty('token');
    expect(resolver.getPreparedSiteMetaConfig).toHaveBeenCalledWith(secondSiteId);
    expect(resolver.getSiteMetaConfig).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/123456789012345?fields=display_phone_number,verified_name,quality_rating,code_verification_status',
      {
        headers: { Authorization: 'Bearer stored-draft-token' },
      },
    );
    expect(fetchSpy.mock.calls[0][0]).not.toContain('/messages');
    expect(fetchSpy.mock.calls[0][0]).not.toContain('/media');
    expect(prisma.siteSetting.upsert).toHaveBeenCalledWith({
      where: {
        siteId_key: {
          siteId: secondSiteId,
          key: 'whatsapp_meta_preflight_verified_at',
        },
      },
      create: expect.objectContaining({
        siteId: secondSiteId,
        key: 'whatsapp_meta_preflight_verified_at',
      }),
      update: { value: expect.any(String) },
    });
  });

  it('fails closed when the configured draft environment secret is unavailable', async () => {
    const { service } = createService({
      siteId: secondSiteId,
      phoneNumberId: '123456789012345',
      accessToken: null,
    });
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(service.testMetaConnection(undefined, undefined, secondSiteId)).resolves.toEqual({
      success: false,
      message: 'Falta configurar el Phone Number ID o el Token de acceso de Meta.',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not turn a successful preflight into permission to send messages', async () => {
    const { service, resolver } = createService({
      siteId: secondSiteId,
      phoneNumberId: '123456789012345',
      accessToken: 'stored-draft-token',
    });
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(service.sendMessage(
      '3001234567',
      'Este mensaje no debe salir',
      undefined,
      undefined,
      'session-site-2',
      undefined,
      secondSiteId,
    )).resolves.toEqual({ sent: false, reason: 'not_configured' });

    expect(resolver.getSiteMetaConfig).toHaveBeenCalledWith(secondSiteId);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
