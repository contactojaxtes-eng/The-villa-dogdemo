import { PublicZonesController } from './public-zones.controller';

describe('PublicZonesController multisite routing', () => {
  it('reads zones from the site resolved by public code', async () => {
    const zones = { findAll: jest.fn().mockResolvedValue([]) };
    const prisma = {
      site: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'site-2',
          code: 'sede-2',
          name: 'Sede 2',
          address: null,
          phone: null,
          isDefault: false,
          whatsappAccount: null,
        }),
      },
    };
    const controller = new PublicZonesController(zones as any, prisma as any);

    await controller.findAll('sede-2');

    expect(zones.findAll).toHaveBeenCalledWith('site-2');
  });
});
