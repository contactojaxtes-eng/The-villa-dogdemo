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
