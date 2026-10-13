import { DeliveryDriversController } from './delivery-drivers.controller';

const SITE_ID = '00000000-0000-4000-8000-000000000202';

describe('DeliveryDriversController', () => {
  it('runs duplicate merging only through the explicit manual endpoint', async () => {
    const service: any = {
      autoMergeDuplicates: jest.fn().mockResolvedValue(undefined),
      findAll: jest.fn().mockResolvedValue([]),
    };
    const controller = new DeliveryDriversController(service);

    await expect(controller.findAll(undefined, undefined, undefined, undefined, {
      user: { role: 'SUPERADMIN', siteId: SITE_ID },
    })).resolves.toEqual([]);
    expect(service.autoMergeDuplicates).not.toHaveBeenCalled();
    expect(service.findAll).toHaveBeenCalledWith(false, 'CURRENT', undefined, undefined, true, SITE_ID);

    await expect(controller.mergeDuplicates({ user: { siteId: SITE_ID } })).resolves.toEqual({
      success: true,
      message: 'Domiciliarios duplicados unificados exitosamente.',
    });
    expect(service.autoMergeDuplicates).toHaveBeenCalledWith(SITE_ID);
  });

  it('requests a single private order snapshot for realtime reconciliation', async () => {
    const service: any = {
      getMyOrderSnapshot: jest.fn().mockResolvedValue({
        orderId: 'order-1',
        bucket: 'ACTIVE',
        order: { id: 'order-1' },
      }),
    };
    const controller = new DeliveryDriversController(service);

    await expect(controller.getMyOrderSnapshot('order-1', { user: { id: 'driver-user-1', siteId: SITE_ID } }))
      .resolves.toEqual(expect.objectContaining({ orderId: 'order-1', bucket: 'ACTIVE' }));
    expect(service.getMyOrderSnapshot).toHaveBeenCalledWith('driver-user-1', 'order-1', SITE_ID);
  });
});
