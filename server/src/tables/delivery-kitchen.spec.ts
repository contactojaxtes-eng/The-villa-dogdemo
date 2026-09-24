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

  it('calculates every cook load with two grouped queries instead of an N+1', async () => {
    const { service, prisma } = makeService({
      'cook-a': { active: true, onBreak: false },
      'cook-b': { active: true, onBreak: false },
    });
    prisma.cashClosing = { findFirst: jest.fn().mockResolvedValue(null) };
    prisma.kitchenTicket.groupBy = jest.fn()
      .mockResolvedValueOnce([
        { assignedToId: 'cook-a', _count: { _all: 3 }, _max: { createdAt: new Date('2026-09-24T12:00:00Z') } },
        { assignedToId: 'cook-b', _count: { _all: 2 }, _max: { createdAt: new Date('2026-09-24T12:01:00Z') } },
      ])
      .mockResolvedValueOnce([
        { assignedToId: 'cook-a', _count: { _all: 1 } },
        { assignedToId: 'cook-b', _count: { _all: 1 } },
      ]);

    await expect((service as any).pickCook(station.id)).resolves.toBe('cook-a');

    expect(prisma.kitchenTicket.groupBy).toHaveBeenCalledTimes(2);
    expect(prisma.kitchenTicket.findMany).not.toHaveBeenCalled();
  });
});

describe('TablesService operational timers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-24T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const makeTimerService = () => {
    const delayedTicket = {
      id: 'ticket-1',
      tableId: 'table-1',
      status: 'NEW',
      createdAt: new Date(Date.now() - 15 * 60 * 1000),
      assignedToId: 'cook-a',
      station: { users: [] },
      items: [],
      order: { orderType: 'LOCAL', tableId: 'table-1', waiterId: 'waiter-1' },
    };
    const prisma: any = {
      kitchenTicket: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(delayedTicket),
      },
      appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const socketGateway: any = {
      emitDiningKitchenTicketDelayed: jest.fn(),
      server: { emit: jest.fn(), to: jest.fn(() => ({ emit: jest.fn() })) },
    };
    return { service: new TablesService(prisma, socketGateway, {} as any), prisma, socketGateway, delayedTicket };
  };

  it('emits one delayed-ticket alert when an active dining ticket reaches the limit', async () => {
    const { service, prisma, socketGateway, delayedTicket } = makeTimerService();

    (service as any).scheduleDiningDelay(delayedTicket.id, delayedTicket.createdAt);
    await jest.advanceTimersByTimeAsync(30);
    (service as any).scheduleDiningDelay(delayedTicket.id, delayedTicket.createdAt);
    await jest.advanceTimersByTimeAsync(30);

    expect(prisma.kitchenTicket.findFirst).toHaveBeenCalledTimes(1);
    expect(socketGateway.emitDiningKitchenTicketDelayed).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });

  it('cancels a pending delayed-ticket alert when the ticket is completed', async () => {
    const { service, prisma, socketGateway } = makeTimerService();
    const createdAt = new Date();

    (service as any).scheduleDiningDelay('ticket-2', createdAt);
    (service as any).syncDiningDelayTimer({
      id: 'ticket-2',
      tableId: 'table-1',
      status: 'READY',
      createdAt,
      order: { orderType: 'LOCAL' },
    });
    await jest.advanceTimersByTimeAsync(16 * 60 * 1000);

    expect(prisma.kitchenTicket.findFirst).not.toHaveBeenCalled();
    expect(socketGateway.emitDiningKitchenTicketDelayed).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('keeps only one exact reconciliation timer when a cook break is rescheduled', async () => {
    const { service } = makeTimerService();
    const check = jest.spyOn(service, 'checkExpiredCookBreaks').mockResolvedValue(undefined);

    (service as any).scheduleCookBreakTimer('DINING', 'cook-a', Date.now() + 1_000);
    (service as any).scheduleCookBreakTimer('DINING', 'cook-a', Date.now() + 2_000);
    await jest.advanceTimersByTimeAsync(1_100);
    expect(check).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(check).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });

  it('restores timers at startup with a compact ticket projection and no interval polling', async () => {
    const { service, prisma } = makeTimerService();
    const intervalSpy = jest.spyOn(global, 'setInterval');
    prisma.kitchenTicket.findMany.mockResolvedValue([
      { id: 'ticket-future', createdAt: new Date(Date.now() + 60_000) },
    ]);

    await service.onModuleInit();

    const restoreQuery = prisma.kitchenTicket.findMany.mock.calls[0][0];
    expect(restoreQuery.select).toEqual({ id: true, createdAt: true });
    expect(restoreQuery.include).toBeUndefined();
    expect(intervalSpy).not.toHaveBeenCalled();
    service.onModuleDestroy();
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
