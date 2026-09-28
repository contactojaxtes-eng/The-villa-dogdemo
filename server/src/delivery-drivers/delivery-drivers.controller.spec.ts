import { DeliveryDriversController } from './delivery-drivers.controller';

describe('DeliveryDriversController', () => {
  it('runs duplicate merging only through the explicit manual endpoint', async () => {
    const service: any = {
      autoMergeDuplicates: jest.fn().mockResolvedValue(undefined),
      findAll: jest.fn().mockResolvedValue([]),
    };
    const controller = new DeliveryDriversController(service);

    await expect(controller.findAll(undefined, undefined, undefined, undefined, {
      user: { role: 'SUPERADMIN' },
    })).resolves.toEqual([]);
    expect(service.autoMergeDuplicates).not.toHaveBeenCalled();
    expect(service.findAll).toHaveBeenCalledWith(false, 'CURRENT', undefined, undefined, true);

    await expect(controller.mergeDuplicates()).resolves.toEqual({
      success: true,
      message: 'Domiciliarios duplicados unificados exitosamente.',
    });
    expect(service.autoMergeDuplicates).toHaveBeenCalledTimes(1);
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

    await expect(controller.getMyOrderSnapshot('order-1', { user: { id: 'driver-user-1' } }))
      .resolves.toEqual(expect.objectContaining({ orderId: 'order-1', bucket: 'ACTIVE' }));
    expect(service.getMyOrderSnapshot).toHaveBeenCalledWith('driver-user-1', 'order-1');
  });
});
