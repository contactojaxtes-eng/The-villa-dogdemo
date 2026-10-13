import { OrdersController } from './orders.controller';

describe('OrdersController create actor', () => {
  it('uses the authenticated SUPERADMIN as the default order actor for the selected site', () => {
    const ordersService: any = { create: jest.fn().mockReturnValue({ id: 'order-1' }) };
    const controller = new OrdersController(ordersService);

    controller.create(
      { customerName: 'Cliente', items: [{ menuItemId: 'item-1', quantity: 1 }] },
      { user: { id: 'superadmin-1', role: 'SUPERADMIN', siteId: 'site-2' } },
    );

    expect(ordersService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        waiterId: 'superadmin-1',
        assignedTo: 'superadmin-1',
        userId: 'superadmin-1',
        userRole: 'SUPERADMIN',
        siteId: 'site-2',
      }),
    );
  });

  it('does not let request data spoof the authenticated actor or its role', () => {
    const ordersService: any = { create: jest.fn() };
    const controller = new OrdersController(ordersService);

    controller.create(
      {
        waiterId: 'site-waiter-1',
        userId: 'forged-superadmin',
        userRole: 'SUPERADMIN',
        siteId: 'site-forged',
      },
      { user: { id: 'waiter-1', role: 'WAITER', siteId: 'site-1' } },
    );

    expect(ordersService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        waiterId: 'site-waiter-1',
        assignedTo: 'waiter-1',
        userId: 'waiter-1',
        userRole: 'WAITER',
        siteId: 'site-1',
      }),
    );
  });
});
