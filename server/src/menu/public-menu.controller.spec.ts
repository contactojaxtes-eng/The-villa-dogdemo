import { PublicMenuController } from './public-menu.controller';

describe('PublicMenuController multisite identity', () => {
  it('uses the secondary site phone without reading principal AppSetting', async () => {
    const menu = { findAllCategories: jest.fn() };
    const prisma = {
      site: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'site-2',
          code: 'sede-2',
          name: 'Sede 2',
          address: 'Calle 2',
          phone: '300 555 0102',
          isDefault: false,
          whatsappAccount: null,
        }),
      },
      appSetting: { findUnique: jest.fn() },
    };
    const controller = new PublicMenuController(menu as any, prisma as any);

    await expect(controller.getPublicInfo('sede-2')).resolves.toEqual({
      site: { id: 'site-2', code: 'sede-2', name: 'Sede 2', address: 'Calle 2' },
      whatsappPhone: '3005550102',
    });
    expect(prisma.appSetting.findUnique).not.toHaveBeenCalled();
  });
});
