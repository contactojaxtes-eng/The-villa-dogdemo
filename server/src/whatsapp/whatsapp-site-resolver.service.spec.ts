import { ConflictException } from '@nestjs/common';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';
import { WhatsAppSiteResolverService } from './whatsapp-site-resolver.service';

describe('WhatsAppSiteResolverService', () => {
  const secondSiteId = '00000000-0000-4000-8000-000000000102';

  function createHarness(env: Record<string, string> = {}) {
    const prisma = {
      whatsAppAccount: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      appSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      site: {
        findFirst: jest.fn().mockResolvedValue({ id: DEFAULT_SITE_ID }),
      },
    };
    const config = {
      get: jest.fn((key: string) => env[key]),
    };
    const service = new WhatsAppSiteResolverService(
      prisma as any,
      config as any,
    );
    return { service, prisma, config };
  }

  const webhookChange = (phoneNumberId: unknown) => ({
    field: 'messages',
    value: { metadata: { phone_number_id: phoneNumberId } },
  });

  it('returns no route when metadata.phone_number_id is absent', async () => {
    const { service, prisma } = createHarness();

    await expect(
      service.resolveIncomingWebhookChangeContext(webhookChange(undefined)),
    ).resolves.toBeNull();
    expect(prisma.whatsAppAccount.findMany).not.toHaveBeenCalled();
  });

  it('routes a Meta phone number to exactly one active site', async () => {
    const { service, prisma } = createHarness();
    prisma.whatsAppAccount.findMany.mockResolvedValue([
      {
        id: 'account-second',
        siteId: secondSiteId,
        phoneNumberId: '123456789012345',
      },
    ]);

    await expect(
      service.resolveIncomingWebhookChangeContext(webhookChange('123456789012345')),
    ).resolves.toEqual({
      siteId: secondSiteId,
      phoneNumberId: '123456789012345',
      accountId: 'account-second',
      source: 'ACCOUNT_ROUTE',
    });
    expect(prisma.whatsAppAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          phoneNumberId: '123456789012345',
          active: true,
        }),
        take: 2,
      }),
    );
  });

  it('rejects an ambiguous duplicated route instead of crossing sites', async () => {
    const { service, prisma } = createHarness();
    prisma.whatsAppAccount.findMany.mockResolvedValue([
      {
        id: 'account-a',
        siteId: DEFAULT_SITE_ID,
        phoneNumberId: '123456789012345',
      },
      {
        id: 'account-b',
        siteId: secondSiteId,
        phoneNumberId: '123456789012345',
      },
    ]);

    await expect(
      service.resolveIncomingWebhookChangeContext(webhookChange('123456789012345')),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resolves changes for two Meta numbers independently', async () => {
    const { service, prisma } = createHarness();
    const changes = [
      webhookChange('123456789012345'),
      webhookChange('987654321098765'),
    ];
    prisma.whatsAppAccount.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve([{
        id: `account-${where.phoneNumberId}`,
        siteId: where.phoneNumberId === '123456789012345'
          ? DEFAULT_SITE_ID
          : secondSiteId,
        phoneNumberId: where.phoneNumberId,
      }]),
    );

    await expect(Promise.all(changes.map(change =>
      service.resolveIncomingWebhookChangeContext(change),
    ))).resolves.toEqual([
      expect.objectContaining({
        siteId: DEFAULT_SITE_ID,
        phoneNumberId: '123456789012345',
      }),
      expect.objectContaining({
        siteId: secondSiteId,
        phoneNumberId: '987654321098765',
      }),
    ]);
    expect(prisma.whatsAppAccount.findMany).toHaveBeenCalledTimes(2);
  });

  it('keeps the historical principal number as an inbound fallback', async () => {
    const { service, prisma } = createHarness();
    prisma.appSetting.findUnique.mockResolvedValue({
      value: '123456789012345',
    });

    await expect(
      service.resolveIncomingWebhookChangeContext(
        webhookChange('123456789012345'),
      ),
    ).resolves.toEqual({
      siteId: DEFAULT_SITE_ID,
      phoneNumberId: '123456789012345',
      accountId: null,
      source: 'PRINCIPAL_LEGACY',
    });
    expect(prisma.site.findFirst).toHaveBeenCalledWith({
      where: { id: DEFAULT_SITE_ID, active: true },
      select: { id: true },
    });
  });

  it('keeps the legacy AppSetting fallback exclusive to principal', async () => {
    const { service, prisma } = createHarness({
      SECOND_SITE_TOKEN: 'secret-from-env',
    });
    prisma.whatsAppAccount.findUnique.mockImplementation(
      ({ where }: any) =>
        Promise.resolve(
          where.siteId === secondSiteId
            ? {
                id: 'account-second',
                siteId: secondSiteId,
                phoneNumberId: '123456789012345',
                businessAccountId: 'business-second',
                displayPhoneNumber: '+57 300 000 0000',
                accessTokenEnvKey: 'SECOND_SITE_TOKEN',
                verifyTokenEnvKey: null,
                active: true,
                site: { active: true },
              }
            : null,
        ),
    );
    prisma.appSetting.findUnique.mockResolvedValue({ value: 'legacy-secret' });

    await expect(service.getSiteMetaConfig(secondSiteId)).resolves.toEqual(
      expect.objectContaining({
        siteId: secondSiteId,
        accessToken: 'secret-from-env',
        verifyToken: null,
      }),
    );
    expect(prisma.appSetting.findUnique).not.toHaveBeenCalled();
  });

  it('reads a draft account only for the Meta preflight while operational sending stays blocked', async () => {
    const { service, prisma } = createHarness({
      SECOND_SITE_WHATSAPP_ACCESS_TOKEN: 'draft-access-token',
      SECOND_SITE_WHATSAPP_VERIFY_TOKEN: 'draft-verify-token',
    });
    prisma.whatsAppAccount.findUnique.mockResolvedValue({
      id: 'account-second',
      siteId: secondSiteId,
      phoneNumberId: '123456789012345',
      businessAccountId: 'business-second',
      displayPhoneNumber: '+57 300 000 0000',
      accessTokenEnvKey: 'SECOND_SITE_WHATSAPP_ACCESS_TOKEN',
      verifyTokenEnvKey: 'SECOND_SITE_WHATSAPP_VERIFY_TOKEN',
      active: false,
      site: {
        active: false,
        organization: { active: true },
      },
    });

    await expect(service.getSiteMetaConfig(secondSiteId)).resolves.toBeNull();
    await expect(service.getPreparedSiteMetaConfig(secondSiteId)).resolves.toEqual(
      expect.objectContaining({
        siteId: secondSiteId,
        phoneNumberId: '123456789012345',
        accessToken: 'draft-access-token',
        verifyToken: 'draft-verify-token',
      }),
    );
  });

  it('accepts the draft verification handshake but keeps inbound messages disabled', async () => {
    const { service, prisma } = createHarness({
      SECOND_SITE_WHATSAPP_VERIFY_TOKEN: 'draft-verify-token',
    });
    prisma.whatsAppAccount.findMany
      .mockResolvedValueOnce([{
        verifyTokenEnvKey: 'SECOND_SITE_WHATSAPP_VERIFY_TOKEN',
      }])
      .mockResolvedValueOnce([]);

    await expect(service.acceptsVerificationToken('draft-verify-token')).resolves.toBe(true);
    await expect(
      service.resolveIncomingWebhookChangeContext(webhookChange('123456789012345')),
    ).resolves.toBeNull();

    expect(prisma.whatsAppAccount.findMany.mock.calls[0][0]).toEqual({
      where: {
        verifyTokenEnvKey: { not: null },
        site: { organization: { active: true } },
      },
      select: { verifyTokenEnvKey: true },
    });
    expect(prisma.whatsAppAccount.findMany.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          phoneNumberId: '123456789012345',
          active: true,
          site: { active: true },
        }),
      }),
    );
  });
});
