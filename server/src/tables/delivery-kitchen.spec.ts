import { TablesService } from './tables.service';

describe('TablesService delivery kitchen assignment', () => {
  const station = {
    id: 'delivery-station',
    users: [
      { id: 'cook-a', name: 'A', active: true },
      { id: 'cook-b', name: 'B', active: true },
    ],
  };

  const makeService = (deliveryStatuses: Record<string, any>, channel = 'DELIVERY') => {
    const prisma: any = {
      kitchenStation: {
        findUnique: jest.fn().mockResolvedValue(station),
      },
      appSetting: {
        findUnique: jest.fn(({ where }: any) => {
          if (where.key === 'kitchen_routing_settings') {
            return Promise.resolve({ value: JSON.stringify({ stationChannels: { [station.id]: channel } }) });
          }
          if (where.key === 'delivery_kitchen_cook_status') {
            return Promise.resolve({ value: JSON.stringify(deliveryStatuses) });
          }
          if (where.key === 'kitchen_cook_status') {
            return Promise.resolve({ value: JSON.stringify(deliveryStatuses) });
          }
          return Promise.resolve(null);
        }),
        upsert: jest.fn(),
      },
      kitchenTicket: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const socketGateway: any = { server: { emit: jest.fn(), to: jest.fn(() => ({ emit: jest.fn() })) } };
    return { service: new TablesService(prisma, socketGateway, {} as any), prisma };
  };

  it('routes a delivery ticket to the remaining cook without pausing the tablet', async () => {
    const future = Date.now() + 15 * 60 * 1000;
    const { service } = makeService({
      'cook-a': { active: true, onBreak: true, breakUntil: future },
      'cook-b': { active: true, onBreak: false },
    });

    await expect((service as any).pickCook(station.id)).resolves.toBe('cook-b');
  });

  it('leaves a delivery ticket unassigned when every cook is unavailable', async () => {
    const future = Date.now() + 15 * 60 * 1000;
    const { service } = makeService({
      'cook-a': { active: true, onBreak: true, breakUntil: future },
      'cook-b': { active: false, onBreak: false },
    });

    await expect((service as any).pickCook(station.id)).resolves.toBeNull();
  });

  it('keeps the previous dining fallback when its only cook is paused', async () => {
    const diningStation = { ...station, users: [station.users[0]] };
    const { service, prisma } = makeService({
      'cook-a': { active: true, onBreak: true, breakUntil: Date.now() + 15 * 60 * 1000 },
    }, 'DINING');
    prisma.kitchenStation.findUnique.mockResolvedValue(diningStation);

    await expect((service as any).pickCook(station.id)).resolves.toBe('cook-a');
  });
});

describe('TablesService operational summaries', () => {
  it('uses the compact table projection only when the board requests it', async () => {
    const prisma: any = {
      diningTable: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new TablesService(prisma, {} as any, {} as any);

    await service.listTables({ summary: true });

    const query = prisma.diningTable.findMany.mock.calls[0][0];
    expect(query.select.orders.select.items).toBeUndefined();
    expect(query.select.orders.select.kitchenTickets.select.assignedTo).toBeDefined();
    expect(query.include).toBeUndefined();
  });

  it('keeps legacy payment image blobs out of the validation queue', async () => {
    const prisma: any = {
      cashClosing: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new TablesService(prisma, {} as any, {} as any);

    await service.listPaymentValidation();

    const query = prisma.payment.findMany.mock.calls[0][0];
    expect(query.select.proofImage).toBeUndefined();
    expect(query.select.transferProofs.select.fileBase64).toBeUndefined();
    expect(query.select.order.select.orderNumber).toBe(true);
  });
});
