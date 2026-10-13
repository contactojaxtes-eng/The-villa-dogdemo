import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS } from '../auth/permissions.constant';
import { SiteManagementService } from './site-management.service';

describe('SiteManagementService', () => {
  const actor = { id: 'admin-1', name: 'Admin', role: 'SUPERADMIN' };
  const readyDraft = (overrides: Record<string, any> = {}) => ({
    id: 'site-2',
    organizationId: 'org-1',
    code: 'sede-2',
    name: 'Sede 2',
    timezone: 'America/Bogota',
    address: 'Calle 2',
    phone: '3001234567',
    active: false,
    isDefault: false,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    settings: [
      {
        key: 'custom_prep_printers',
        value: JSON.stringify([
          {
            id: 'cocina-2',
            name: 'Cocina sede 2',
            ip: 'USB:COCINA2',
            enabled: true,
          },
        ]),
      },
      {
        key: 'whatsapp_meta_preflight_verified_at',
        value: new Date().toISOString(),
      },
    ],
    whatsappAccount: {
      active: false,
      phoneNumberId: 'phone-2',
      businessAccountId: 'business-2',
      displayPhoneNumber: '+57 300 000 0000',
      accessTokenEnvKey: 'WHATSAPP_SITE_2_ACCESS_TOKEN',
      verifyTokenEnvKey: 'WHATSAPP_SITE_2_VERIFY_TOKEN',
    },
    _count: {
      memberships: 2,
      deliveryZones: 3,
      cashRegisters: 1,
      kitchenStations: 1,
      menuItems: 12,
    },
    ...overrides,
  });
  let prisma: any;
  let audit: any;
  let socketGateway: any;
  let configValues: Record<string, string | undefined>;
  let service: SiteManagementService;

  beforeEach(() => {
    prisma = {
      site: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      userSiteMembership: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
      customRole: {
        findFirst: jest.fn(),
      },
      whatsAppAccount: {
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      siteSetting: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma.$transaction = jest.fn((callback: (transaction: any) => unknown) =>
      callback(prisma),
    );
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    socketGateway = { disconnectSite: jest.fn().mockReturnValue(0) };
    configValues = {
      WHATSAPP_SITE_2_ACCESS_TOKEN: 'access-token',
      WHATSAPP_SITE_2_VERIFY_TOKEN: 'verify-token',
      WHATSAPP_ACCESS_TOKEN_VERIFY_TOKEN: 'wrongly-shared-secret',
      JWT_SECRET: 'jwt-secret',
    };
    const config = {
      get: jest.fn((key: string) => configValues[key]),
    };
    service = new SiteManagementService(
      prisma,
      audit,
      config as any,
      socketGateway,
    );
  });

  it('creates every new site as an inactive draft', async () => {
    prisma.site.findFirst.mockResolvedValue(null);
    prisma.site.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'site-2',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: [],
        whatsappAccount: null,
        _count: {
          memberships: 0,
          deliveryZones: 0,
          cashRegisters: 0,
          kitchenStations: 0,
          menuItems: 0,
        },
      }),
    );

    const result = await service.createDraft({ name: 'Villa Luz 2' }, actor);

    expect(prisma.site.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'villa-luz-2',
          active: false,
          isDefault: false,
        }),
      }),
    );
    expect(result.status).toBe('DRAFT');
    expect(result.canActivate).toBe(false);
    expect(result.readiness).toMatchObject({
      completed: 0,
      total: 9,
      configurationReady: false,
    });
  });

  it('clones the principal catalog with independent IDs and remapped combo references', async () => {
    const sourceCategories = [
      {
        id: 'category-principal',
        name: 'Perros',
        description: 'Categoría principal',
        active: true,
        sortOrder: 1,
        items: [
          {
            id: 'item-sencillo',
            name: 'Perro sencillo',
            code: 'PERRO-SENCILLO',
            description: 'Producto base',
            price: 5000,
            image: '/images/perro.jpg',
            active: true,
            availableForDelivery: true,
            sortOrder: 1,
            type: 'NORMAL',
            comboItems: null,
            prepTime: 10,
            recipe: {
              items: [
                {
                  ingredientId: 'ingredient-1',
                  quantity: 1,
                  wastePercentage: 0,
                  unit: 'unidad',
                },
              ],
            },
          },
          {
            id: 'item-combo',
            name: 'Combo perro',
            code: 'COMBO-PERRO',
            description: 'Combo',
            price: 9000,
            image: null,
            active: true,
            availableForDelivery: true,
            sortOrder: 2,
            type: 'COMBO',
            comboItems: [{ itemId: 'item-sencillo', quantity: 1 }],
            prepTime: 12,
            recipe: null,
          },
        ],
      },
    ];
    prisma.menuCategory = {
      findMany: jest.fn().mockResolvedValue(sourceCategories),
      create: jest.fn().mockResolvedValue({ id: 'category-sede-2' }),
    };
    prisma.menuItem = {
      create: jest
        .fn()
        .mockResolvedValueOnce({ id: 'item-sencillo-sede-2' })
        .mockResolvedValueOnce({ id: 'item-combo-sede-2' }),
      update: jest.fn().mockResolvedValue({}),
    };
    prisma.recipe = {
      create: jest.fn().mockResolvedValue({ id: 'recipe-sede-2' }),
    };
    prisma.recipeIngredient = {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    prisma.order = { findMany: jest.fn() };
    prisma.site.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        readyDraft({
          active: false,
          settings: [],
          whatsappAccount: null,
          _count: {
            memberships: 0,
            deliveryZones: 0,
            cashRegisters: 0,
            kitchenStations: 0,
            menuItems: 2,
          },
        }),
      );
    prisma.site.create.mockResolvedValue({ id: 'site-2' });

    const result = await service.createDraft({ name: 'Sede 2' }, actor);

    expect(prisma.menuCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { siteId: '00000000-0000-4000-8000-000000000101' },
      }),
    );
    expect(prisma.menuCategory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        siteId: 'site-2',
        name: 'Perros',
      }),
    });
    expect(prisma.menuItem.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          siteId: 'site-2',
          categoryId: 'category-sede-2',
          code: 'PERRO-SENCILLO',
        }),
      }),
    );
    expect(prisma.menuItem.update).toHaveBeenCalledWith({
      where: { id: 'item-combo-sede-2' },
      data: { comboItems: [{ itemId: 'item-sencillo-sede-2', quantity: 1 }] },
    });
    expect(prisma.recipe.create).toHaveBeenCalledWith({
      data: { menuItemId: 'item-sencillo-sede-2' },
    });
    expect(prisma.recipeIngredient.createMany).toHaveBeenCalledWith({
      data: [
        {
          recipeId: 'recipe-sede-2',
          ingredientId: 'ingredient-1',
          quantity: 1,
          wastePercentage: 0,
          unit: 'unidad',
        },
      ],
    });
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SITE_DRAFT_CREATE',
        targetId: 'site-2',
        metadata: expect.objectContaining({
          catalogCategoriesCopied: 1,
          catalogItemsCopied: 2,
        }),
      }),
    );
    expect(result).toMatchObject({ id: 'site-2', active: false });
  });

  it('reports draft preparation without enabling activation', async () => {
    prisma.site.findMany.mockResolvedValue([
      {
        id: 'site-2',
        organizationId: 'org-1',
        code: 'sede-2',
        name: 'Sede 2',
        timezone: 'America/Bogota',
        address: 'Calle 2',
        phone: '3001234567',
        active: false,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: [
          {
            key: 'custom_prep_printers',
            value: JSON.stringify([
              {
                id: 'cocina-2',
                name: 'Cocina sede 2',
                ip: 'USB:COCINA2',
                enabled: true,
              },
            ]),
          },
          {
            key: 'whatsapp_meta_preflight_verified_at',
            value: new Date().toISOString(),
          },
        ],
        whatsappAccount: {
          active: true,
          phoneNumberId: 'phone-2',
          accessTokenEnvKey: 'WHATSAPP_SITE_2_ACCESS_TOKEN',
          verifyTokenEnvKey: 'WHATSAPP_SITE_2_VERIFY_TOKEN',
        },
        _count: {
          memberships: 3,
          deliveryZones: 5,
          cashRegisters: 1,
          kitchenStations: 2,
          menuItems: 12,
        },
      },
    ]);

    const [result] = await service.list();

    expect(result.readiness).toMatchObject({
      completed: 9,
      total: 9,
      configurationReady: true,
    });
    expect(prisma.site.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          _count: {
            select: expect.objectContaining({
              memberships: {
                where: { active: true, user: { active: true } },
              },
            }),
          },
        }),
      }),
    );
    expect(result.canActivate).toBe(false);
  });

  it('does not report secondary WhatsApp ready when an env secret is absent', async () => {
    prisma.site.findMany.mockResolvedValue([
      {
        id: 'site-2',
        code: 'sede-2',
        name: 'Sede 2',
        timezone: 'America/Bogota',
        address: 'Calle 2',
        phone: '3001234567',
        active: false,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: [],
        whatsappAccount: {
          active: true,
          phoneNumberId: 'phone-2',
          accessTokenEnvKey: 'WHATSAPP_SITE_2_ACCESS_TOKEN',
          verifyTokenEnvKey: 'WHATSAPP_SITE_2_VERIFY_TOKEN_MISSING',
        },
        _count: {
          memberships: 1,
          deliveryZones: 1,
          cashRegisters: 1,
          kitchenStations: 1,
          menuItems: 12,
        },
      },
    ]);

    const [result] = await service.list();

    expect(
      result.readiness.checks.find((check) => check.key === 'whatsapp'),
    ).toEqual(expect.objectContaining({ ready: false }));
  });

  it('does not allow duplicate site codes', async () => {
    prisma.site.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(
      service.createDraft({ name: 'Segunda sede', code: 'principal' }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.site.create).not.toHaveBeenCalled();
  });

  it('translates a concurrent duplicate site code into a conflict', async () => {
    prisma.site.findFirst.mockResolvedValue(null);
    prisma.site.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['organizationId', 'code'] },
      }),
    );

    await expect(
      service.createDraft({ name: 'Segunda sede', code: 'sede-2' }, actor),
    ).rejects.toThrow('Ya existe una sede con ese código');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('does not mark an incomplete printer record as ready', async () => {
    prisma.site.findMany.mockResolvedValue([
      readyDraft({
        settings: [
          {
            key: 'custom_prep_printers',
            value: JSON.stringify([{ id: 'cocina-2', enabled: true }]),
          },
          {
            key: 'whatsapp_meta_preflight_verified_at',
            value: new Date().toISOString(),
          },
        ],
      }),
    ]);

    const [result] = await service.list();

    expect(
      result.readiness.checks.find((check) => check.key === 'printing'),
    ).toEqual(expect.objectContaining({ ready: false }));
    expect(result.readiness.configurationReady).toBe(false);
  });

  it('prepares a secondary WhatsApp account without storing secret values', async () => {
    prisma.site.findFirst.mockResolvedValue({
      id: 'site-2',
      name: 'Sede 2',
      isDefault: false,
      active: false,
    });
    prisma.whatsAppAccount.findFirst.mockResolvedValue(null);
    prisma.whatsAppAccount.upsert.mockResolvedValue({
      id: 'wa-2',
      siteId: 'site-2',
      phoneNumberId: '123456789012345',
      businessAccountId: '998877665544332',
      displayPhoneNumber: '+57 300 000 0000',
      accessTokenEnvKey: 'WHATSAPP_SITE_2_ACCESS_TOKEN',
      verifyTokenEnvKey: 'WHATSAPP_SITE_2_VERIFY_TOKEN',
      active: false,
    });

    const result = await service.upsertWhatsAppAccount(
      'site-2',
      {
        phoneNumberId: '123456789012345',
        businessAccountId: '998877665544332',
        displayPhoneNumber: '+57 300 000 0000',
        accessTokenEnvKey: 'WHATSAPP_SITE_2_ACCESS_TOKEN',
        verifyTokenEnvKey: 'WHATSAPP_SITE_2_VERIFY_TOKEN',
      },
      actor,
    );

    expect(prisma.whatsAppAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { siteId: 'site-2' },
        create: expect.objectContaining({
          siteId: 'site-2',
          active: false,
          accessTokenEnvKey: 'WHATSAPP_SITE_2_ACCESS_TOKEN',
          verifyTokenEnvKey: 'WHATSAPP_SITE_2_VERIFY_TOKEN',
        }),
      }),
    );
    const serialized = JSON.stringify(
      prisma.whatsAppAccount.upsert.mock.calls[0][0],
    );
    expect(serialized).not.toContain('access-token');
    expect(serialized).not.toContain('verify-token');
    expect(result).toMatchObject({
      active: false,
      accessTokenConfigured: true,
      verifyTokenConfigured: true,
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SITE_WHATSAPP_ACCOUNT_UPSERT' }),
    );
  });

  it('rejects changing the WhatsApp account of an active secondary site', async () => {
    prisma.site.findFirst.mockResolvedValue({
      id: 'site-2',
      name: 'Sede 2',
      isDefault: false,
      active: true,
    });

    const attempt = service.upsertWhatsAppAccount(
      'site-2',
      {
        phoneNumberId: '123456789012345',
        accessTokenEnvKey: 'WHATSAPP_SITE_2_ACCESS_TOKEN',
        verifyTokenEnvKey: 'WHATSAPP_SITE_2_VERIFY_TOKEN',
      },
      actor,
    );

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.whatsAppAccount.findFirst).not.toHaveBeenCalled();
    expect(prisma.whatsAppAccount.upsert).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rejects secondary WhatsApp setup when an environment secret is missing', async () => {
    prisma.site.findFirst.mockResolvedValue({
      id: 'site-2',
      name: 'Sede 2',
      isDefault: false,
      active: false,
    });

    await expect(
      service.upsertWhatsAppAccount(
        'site-2',
        {
          phoneNumberId: '123456789012345',
          accessTokenEnvKey: 'WHATSAPP_SITE_2_ACCESS_TOKEN',
          verifyTokenEnvKey: 'WHATSAPP_SITE_2_VERIFY_TOKEN_MISSING',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.whatsAppAccount.upsert).not.toHaveBeenCalled();
  });

  it('rejects a WhatsApp phone number already assigned to another site', async () => {
    prisma.site.findFirst.mockResolvedValue({
      id: 'site-2',
      name: 'Sede 2',
      isDefault: false,
      active: false,
    });
    prisma.whatsAppAccount.findFirst.mockResolvedValue({ id: 'wa-existing' });

    await expect(
      service.upsertWhatsAppAccount(
        'site-2',
        {
          phoneNumberId: '123456789012345',
          accessTokenEnvKey: 'WHATSAPP_SITE_2_ACCESS_TOKEN',
          verifyTokenEnvKey: 'WHATSAPP_SITE_2_VERIFY_TOKEN',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.whatsAppAccount.upsert).not.toHaveBeenCalled();
  });

  it('rejects unrelated server secrets as WhatsApp environment variables', async () => {
    prisma.site.findFirst.mockResolvedValue({
      id: 'site-2',
      name: 'Sede 2',
      isDefault: false,
      active: false,
    });

    await expect(
      service.upsertWhatsAppAccount(
        'site-2',
        {
          phoneNumberId: '123456789012345',
          accessTokenEnvKey: 'JWT_SECRET',
          verifyTokenEnvKey: 'WHATSAPP_SITE_2_VERIFY_TOKEN',
        },
        actor,
      ),
    ).rejects.toThrow('WHATSAPP y ACCESS_TOKEN');
    expect(prisma.whatsAppAccount.upsert).not.toHaveBeenCalled();
  });

  it('rejects reusing one environment variable for both WhatsApp secrets', async () => {
    prisma.site.findFirst.mockResolvedValue({
      id: 'site-2',
      name: 'Sede 2',
      isDefault: false,
      active: false,
    });

    await expect(
      service.upsertWhatsAppAccount(
        'site-2',
        {
          phoneNumberId: '123456789012345',
          accessTokenEnvKey: 'WHATSAPP_ACCESS_TOKEN_VERIFY_TOKEN',
          verifyTokenEnvKey: 'WHATSAPP_ACCESS_TOKEN_VERIFY_TOKEN',
        },
        actor,
      ),
    ).rejects.toThrow('variables diferentes');
    expect(prisma.whatsAppAccount.upsert).not.toHaveBeenCalled();
  });

  it('protects the principal site code', async () => {
    prisma.site.findFirst.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000101',
      code: 'principal',
      name: 'Sede Principal',
      isDefault: true,
    });
    await expect(
      service.updateMetadata(
        '00000000-0000-4000-8000-000000000101',
        { code: 'otra' },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.site.update).not.toHaveBeenCalled();
  });

  it('adds an existing user only to the selected secondary site', async () => {
    prisma.site.findFirst.mockResolvedValue({
      id: 'site-2',
      name: 'Sede 2',
      isDefault: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-2',
      name: 'Operador 2',
      email: 'operador@example.com',
      role: 'CASHIER',
      permissions: ['orders.view'],
      lastActiveSiteId: 'site-1',
    });
    prisma.userSiteMembership.upsert.mockResolvedValue({});

    const result = await service.updateMember(
      'site-2',
      'user-2',
      { active: true },
      actor,
    );

    expect(prisma.userSiteMembership.upsert).toHaveBeenCalledWith({
      where: { userId_siteId: { userId: 'user-2', siteId: 'site-2' } },
      create: expect.objectContaining({
        userId: 'user-2',
        siteId: 'site-2',
        role: 'CASHIER',
        permissions: DEFAULT_ROLE_PERMISSIONS.CASHIER,
        active: true,
        isDefault: false,
      }),
      update: {
        role: 'CASHIER',
        permissions: DEFAULT_ROLE_PERMISSIONS.CASHIER,
        active: true,
      },
    });
    expect(result).toMatchObject({
      userId: 'user-2',
      siteId: 'site-2',
      member: true,
    });
  });

  it('rejects SUPERADMIN and unknown roles as site roles', async () => {
    prisma.site.findFirst.mockResolvedValue({
      id: 'site-2',
      name: 'Sede 2',
      isDefault: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-2',
      name: 'Operador 2',
      email: 'operador@example.com',
      role: 'ADMIN',
      lastActiveSiteId: 'site-1',
    });
    prisma.customRole.findFirst.mockResolvedValue(null);

    await expect(
      service.updateMember(
        'site-2',
        'user-2',
        { active: true, role: 'superadmin' },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateMember(
        'site-2',
        'user-2',
        { active: true, role: 'NOT_A_ROLE' },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.userSiteMembership.upsert).not.toHaveBeenCalled();
  });

  it('recalculates permissions when lowering a site role', async () => {
    prisma.site.findFirst.mockResolvedValue({
      id: 'site-2',
      name: 'Sede 2',
      isDefault: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-2',
      name: 'Administrador global',
      email: 'admin@example.com',
      role: 'ADMIN',
      permissions: ['*'],
      lastActiveSiteId: 'site-1',
    });
    prisma.userSiteMembership.upsert.mockResolvedValue({});

    await service.updateMember(
      'site-2',
      'user-2',
      { active: true, role: 'CASHIER' },
      actor,
    );

    const operation = prisma.userSiteMembership.upsert.mock.calls[0][0];
    expect(operation.create.permissions).toEqual(
      DEFAULT_ROLE_PERMISSIONS.CASHIER,
    );
    expect(operation.update.permissions).toEqual(
      DEFAULT_ROLE_PERMISSIONS.CASHIER,
    );
    expect(operation.create.permissions).not.toContain('*');
    expect(operation.update.permissions).not.toContain('*');
  });

  it('revokes only the membership and keeps the global account active', async () => {
    prisma.site.findFirst.mockResolvedValue({
      id: 'site-2',
      name: 'Sede 2',
      isDefault: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-2',
      name: 'Operador 2',
      email: 'operador@example.com',
      role: 'CASHIER',
      permissions: [],
      lastActiveSiteId: 'site-1',
    });
    prisma.userSiteMembership.updateMany.mockResolvedValue({ count: 1 });

    await service.updateMember('site-2', 'user-2', { active: false }, actor);

    expect(prisma.userSiteMembership.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-2', siteId: 'site-2' },
      data: { active: false, isDefault: false },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('moves lastActiveSiteId to a valid default membership when revoking the active site', async () => {
    prisma.site.findFirst.mockResolvedValue({
      id: 'site-2',
      name: 'Sede 2',
      isDefault: false,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-2',
      name: 'Operador 2',
      email: 'operador@example.com',
      role: 'CASHIER',
      lastActiveSiteId: 'site-2',
    });
    prisma.userSiteMembership.updateMany.mockResolvedValue({ count: 1 });
    prisma.userSiteMembership.findMany.mockResolvedValue([
      {
        siteId: 'site-3',
        isDefault: false,
        site: { isDefault: false },
      },
      {
        siteId: 'site-1',
        isDefault: true,
        site: { isDefault: true },
      },
    ]);
    prisma.user.update.mockResolvedValue({});

    await service.updateMember('site-2', 'user-2', { active: false }, actor);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.userSiteMembership.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-2',
        active: true,
        site: { active: true, organization: { active: true } },
      },
      select: {
        siteId: true,
        isDefault: true,
        site: { select: { isDefault: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: { lastActiveSiteId: 'site-1' },
    });
  });

  it('keeps activation closed when the rollout flag and site allowlist are absent', async () => {
    prisma.site.findFirst.mockResolvedValue(readyDraft());

    await expect(
      service.activateSite(
        'site-2',
        { confirmationCode: 'sede-2', acknowledgeIsolation: true },
        actor,
      ),
    ).rejects.toThrow('ventana controlada');

    expect(prisma.whatsAppAccount.update).not.toHaveBeenCalled();
    expect(prisma.site.update).not.toHaveBeenCalled();
  });

  it('refuses activation when the readiness check changes before the transaction', async () => {
    configValues.MULTISITE_ACTIVATION_ENABLED = 'true';
    configValues.MULTISITE_ACTIVATION_SITE_CODES = 'sede-2';
    prisma.site.findFirst.mockResolvedValue(
      readyDraft({
        settings: [],
        _count: {
          memberships: 2,
          deliveryZones: 0,
          cashRegisters: 1,
          kitchenStations: 1,
          menuItems: 12,
        },
      }),
    );

    await expect(
      service.activateSite(
        'site-2',
        { confirmationCode: 'sede-2', acknowledgeIsolation: true },
        actor,
      ),
    ).rejects.toThrow('Barrios y tarifas');

    expect(prisma.whatsAppAccount.update).not.toHaveBeenCalled();
    expect(prisma.site.update).not.toHaveBeenCalled();
  });

  it('activates the site and its WhatsApp account atomically after every gate passes', async () => {
    configValues.MULTISITE_ACTIVATION_ENABLED = 'true';
    configValues.MULTISITE_ACTIVATION_SITE_CODES = 'sede-2';
    const draft = readyDraft();
    const active = readyDraft({
      active: true,
      whatsappAccount: { ...draft.whatsappAccount, active: true },
    });
    prisma.site.findFirst.mockResolvedValue(draft);
    prisma.whatsAppAccount.update.mockResolvedValue({ count: 1 });
    prisma.site.update.mockResolvedValue(active);

    const result = await service.activateSite(
      'site-2',
      { confirmationCode: 'sede-2', acknowledgeIsolation: true },
      actor,
    );

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(prisma.whatsAppAccount.update).toHaveBeenCalledWith({
      where: { siteId: 'site-2' },
      data: { active: true },
    });
    expect(prisma.site.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'site-2' },
        data: { active: true },
      }),
    );
    expect(result).toMatchObject({
      active: true,
      status: 'ACTIVE',
      canActivate: false,
      whatsapp: { active: true },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SITE_ACTIVATE' }),
    );
  });

  it('pauses a secondary site, its WhatsApp account and only its sockets atomically', async () => {
    const activeSite = readyDraft({
      active: true,
      whatsappAccount: {
        ...readyDraft().whatsappAccount,
        active: true,
      },
    });
    const pausedSite = readyDraft();
    prisma.site.findFirst.mockResolvedValue(activeSite);
    prisma.whatsAppAccount.updateMany.mockResolvedValue({ count: 1 });
    prisma.site.update.mockResolvedValue(pausedSite);
    socketGateway.disconnectSite.mockReturnValue(3);

    const result = await service.deactivateSite(
      'site-2',
      { confirmationCode: 'sede-2', acknowledgePause: true },
      actor,
    );

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(prisma.whatsAppAccount.updateMany).toHaveBeenCalledWith({
      where: { siteId: 'site-2' },
      data: { active: false },
    });
    expect(prisma.site.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'site-2' },
        data: { active: false },
      }),
    );
    expect(socketGateway.disconnectSite).toHaveBeenCalledWith('site-2');
    expect(result).toMatchObject({
      active: false,
      status: 'DRAFT',
      whatsapp: { active: false },
      socketsDisconnected: 3,
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SITE_DEACTIVATE',
        metadata: expect.objectContaining({ socketsDisconnected: 3 }),
      }),
    );
  });

  it('never pauses the principal site', async () => {
    prisma.site.findFirst.mockResolvedValue(
      readyDraft({ id: 'site-1', code: 'principal', isDefault: true, active: true }),
    );

    await expect(
      service.deactivateSite(
        'site-1',
        { confirmationCode: 'principal', acknowledgePause: true },
        actor,
      ),
    ).rejects.toThrow('sede principal');

    expect(prisma.whatsAppAccount.updateMany).not.toHaveBeenCalled();
    expect(prisma.site.update).not.toHaveBeenCalled();
    expect(socketGateway.disconnectSite).not.toHaveBeenCalled();
  });

  it('keeps repeated pause requests idempotent', async () => {
    prisma.site.findFirst.mockResolvedValue(readyDraft());

    const result = await service.deactivateSite(
      'site-2',
      { confirmationCode: 'sede-2', acknowledgePause: true },
      actor,
    );

    expect(result).toMatchObject({ active: false, status: 'DRAFT' });
    expect(prisma.whatsAppAccount.updateMany).not.toHaveBeenCalled();
    expect(prisma.site.update).not.toHaveBeenCalled();
    expect(socketGateway.disconnectSite).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SITE_DEACTIVATE' }),
    );
  });
});
