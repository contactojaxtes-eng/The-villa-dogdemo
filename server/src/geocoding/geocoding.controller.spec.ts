import { GeocodingController } from './geocoding.controller';

describe('GeocodingController zone priority', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const mockNominatim = () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue([
        {
          lat: '8.7482',
          lon: '-75.8814',
          display_name: 'Centro Comercial Alamedas, La Granja, Montería, Córdoba, Colombia',
          address: {
            neighbourhood: 'La Granja',
            city: 'Montería',
          },
        },
      ]),
    } as any);
  };

  it('uses the Nominatim neighbourhood before a broad paid query match', async () => {
    mockNominatim();
    const zonesService: any = {
      suggestExactFreePlace: jest.fn().mockResolvedValue(null),
      suggestByName: jest.fn().mockImplementation(async (name: string) => {
        if (name === 'La Granja') {
          return { id: 'zone-granja', name: 'La Granja', rate: 5000, zoneGroup: 'Sur' };
        }
        if (name === 'Centro Comercial Alamedas') {
          return { id: 'zone-centro', name: 'Centro', rate: 4000, zoneGroup: 'Centro' };
        }
        return null;
      }),
    };
    const controller = new GeocodingController(zonesService);

    const [result] = await controller.search('Centro Comercial Alamedas', { user: { siteId: 'site-2' } });

    expect(zonesService.suggestExactFreePlace).toHaveBeenCalledWith('Centro Comercial Alamedas', 'site-2');
    expect(zonesService.suggestByName).toHaveBeenCalledWith('La Granja', 'site-2');
    expect(result.suggestedZone).toEqual(expect.objectContaining({ id: 'zone-granja' }));
    expect(result.neighbourhood).toBe('La Granja');
  });

  it('prioritizes an explicitly configured free place contained in the query', async () => {
    mockNominatim();
    const freePlace = {
      id: 'zone-university',
      name: 'Universidad de Córdoba',
      rate: 0,
      zoneGroup: 'Excepciones',
    };
    const zonesService: any = {
      suggestExactFreePlace: jest.fn().mockResolvedValue(freePlace),
      suggestByName: jest.fn(),
    };
    const controller = new GeocodingController(zonesService);

    const [result] = await controller.search('Entrada Universidad de Córdoba Montería', { user: { siteId: 'site-2' } });

    expect(result.suggestedZone).toEqual(freePlace);
    expect(result.neighbourhood).toBe('Universidad de Córdoba');
    expect(zonesService.suggestByName).not.toHaveBeenCalled();
  });
});
