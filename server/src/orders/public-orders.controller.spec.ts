import { NotFoundException } from '@nestjs/common';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';
import { PublicOrdersController } from './public-orders.controller';

describe('PublicOrdersController multisite routing', () => {
  const validBody = {
    customerName: 'Cliente',
    customerPhone: '3001234567',
    orderType: 'PICKUP',
    paymentMethod: 'CASH',
    items: [{ menuItemId: 'menu-1', quantity: 1 }],
  };

  function harness(site: any) {
    const orders = { create: jest.fn().mockResolvedValue({ id: 'order-1' }) };
    const prisma = { site: { findFirst: jest.fn().mockResolvedValue(site) } };
    return {
      controller: new PublicOrdersController(orders as any, prisma as any),
      orders,
      prisma,
    };
  }

  it('keeps the historic public URL assigned to the principal site', async () => {
    const { controller, orders, prisma } = harness({
      id: DEFAULT_SITE_ID,
      code: 'principal',
      name: 'Principal',
      address: null,
      phone: null,
      isDefault: true,
      whatsappAccount: null,
    });

    await controller.createPublicOrder(validBody);

    expect(prisma.site.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: DEFAULT_SITE_ID }) }),
    );
    expect(orders.create).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: DEFAULT_SITE_ID }),
    );
  });

  it('routes an explicit public site code only to that active site', async () => {
    const { controller, orders, prisma } = harness({
      id: 'site-2',
      code: 'villa-luz',
      name: 'Villa Luz',
      address: null,
      phone: null,
      isDefault: false,
      whatsappAccount: null,
    });

    await controller.createPublicOrder({ ...validBody, siteCode: 'VILLA-LUZ' });

    expect(prisma.site.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ code: 'villa-luz', active: true }),
      }),
    );
    expect(orders.create).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 'site-2' }),
    );
  });

  it('rejects an unknown site code without creating in the principal site', async () => {
    const { controller, orders } = harness(null);

    await expect(
      controller.createPublicOrder({ ...validBody, siteCode: 'no-existe' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(orders.create).not.toHaveBeenCalled();
  });
});
