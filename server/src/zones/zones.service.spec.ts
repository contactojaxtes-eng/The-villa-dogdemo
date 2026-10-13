import { BadRequestException } from '@nestjs/common';
import { ZonesService } from './zones.service';

describe('ZonesService exact delivery tariffs', () => {
  const createService = (activeZones: any[] = []) => {
    const prisma: any = {
      deliveryZone: {
        findMany: jest.fn().mockResolvedValue(activeZones),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'zone-new', active: true, ...data })),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const cache: any = { invalidateByPrefix: jest.fn() };
    const socketGateway: any = { emitToSite: jest.fn() };
    return {
      service: new ZonesService(prisma, cache, socketGateway),
      prisma,
    };
  };

  it('allows an exact place with an explicitly configured $0 tariff', async () => {
    const { service, prisma } = createService([]);

    await expect(service.create({
      name: 'Universidad de Córdoba',
      rate: 0,
      zoneGroup: 'Excepciones',
    })).resolves.toEqual(expect.objectContaining({
      name: 'Universidad de Córdoba',
      rate: 0,
    }));
    expect(prisma.deliveryZone.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        siteId: '00000000-0000-4000-8000-000000000101',
        name: 'Universidad de Córdoba',
        rate: 0,
      }),
    });
  });

  it('rejects an active duplicate even when accents and casing differ', async () => {
    const { service, prisma } = createService([
      { id: 'zone-existing', name: 'Universidad de Córdoba' },
    ]);

    await expect(service.create({
      name: ' universidad de cordoba ',
      rate: 0,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.deliveryZone.create).not.toHaveBeenCalled();
  });

  it('prefers the exact and most specific place over a broader paid zone', async () => {
    const { service } = createService([]);
    jest.spyOn(service, 'findAll').mockResolvedValue([
      { id: 'zone-broad', name: 'Universidad', rate: 3000, zoneGroup: 'General' },
      { id: 'zone-exact', name: 'Universidad de Córdoba', rate: 0, zoneGroup: 'Excepciones' },
    ] as any);

    await expect(service.suggestByName('Universidad de Córdoba')).resolves.toEqual({
      id: 'zone-exact',
      name: 'Universidad de Córdoba',
      rate: 0,
      zoneGroup: 'Excepciones',
    });
    await expect(service.suggestByName('Entrada Universidad de Córdoba Montería')).resolves.toEqual(
      expect.objectContaining({ id: 'zone-exact', rate: 0 }),
    );
  });

  it('only gives search priority to a complete configured free place', async () => {
    const { service } = createService([]);
    jest.spyOn(service, 'findAll').mockResolvedValue([
      { id: 'zone-centro', name: 'Centro', rate: 4000, zoneGroup: 'Centro' },
      { id: 'zone-university', name: 'Universidad de Córdoba', rate: 0, zoneGroup: 'Excepciones' },
      { id: 'zone-university-short', name: 'Universidad', rate: 0, zoneGroup: 'Excepciones' },
    ] as any);

    await expect(service.suggestExactFreePlace('Centro Comercial Alamedas')).resolves.toBeNull();
    await expect(service.suggestExactFreePlace('Entrada Universidad de Córdoba Montería')).resolves.toEqual({
      id: 'zone-university',
      name: 'Universidad de Córdoba',
      rate: 0,
      zoneGroup: 'Excepciones',
    });
  });
});
