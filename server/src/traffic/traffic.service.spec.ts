import { EventEmitter } from 'events';
import { TrafficService, responseBodyLength, trafficRouteLabel } from './traffic.service';

describe('HTTP traffic measurements', () => {
  it('uses bounded route labels without exposing dynamic IDs or query strings', () => {
    expect(trafficRouteLabel('/api/whatsapp/sessions/private-phone/messages', '/api/whatsapp/sessions/:id/messages'))
      .toBe('/api/whatsapp/sessions/:id/messages');
    expect(trafficRouteLabel('/api/whatsapp/media/123-secret', '/api/whatsapp/media/:mediaId'))
      .toBe('/api/whatsapp/media/*');
    expect(trafficRouteLabel('/assets/index-1234.js')).toBe('/assets/*.js');
    expect(trafficRouteLabel('/downloads/TheVillaDogBridge.exe')).toBe('/downloads/*.exe');
    expect(trafficRouteLabel('/TheVillaDog-Puente-Portable.zip')).toBe('/downloads/*.zip');
    expect(trafficRouteLabel('/api/orders/private-id', '/orders/:id')).toBe('/api/orders/:id');
    expect(trafficRouteLabel('/api/unknown/private-phone')).toBe('/api/other');
    expect(trafficRouteLabel('/unknown/private-phone')).toBe('/other');
  });

  it('treats bodyless responses as zero and missing lengths as unknown', () => {
    expect(responseBodyLength('GET', 304, '500')).toBe(0);
    expect(responseBodyLength('HEAD', 200, '500')).toBe(0);
    expect(responseBodyLength('GET', 200, undefined)).toBeNull();
    expect(responseBodyLength('GET', 200, '42')).toBe(42);
  });

  it('aggregates finished responses and does not double count its persisted snapshot', async () => {
    const prisma = { appSetting: { findMany: jest.fn().mockResolvedValue([]) } } as any;
    const traffic = new TrafficService(prisma);
    const req = { path: '/api/orders/private-id', route: { path: '/api/orders/:id' }, method: 'GET' } as any;
    const response = new EventEmitter() as any;
    response.statusCode = 200;
    response.getHeader = () => '128';
    traffic.observe(req, response);
    response.emit('finish');
    const initial = await traffic.getLastSevenDays();
    expect(initial.days).toHaveLength(1);
    expect(initial.days[0].routes).toEqual([{ route: '/api/orders/:id', method: 'GET', requests: 1, bytes: 128, unknownBytesRequests: 0, errors: 0, status2xx: 1, status3xx: 0, status4xx: 0, status5xx: 0 }]);

    const date = initial.days[0].date;
    prisma.appSetting.findMany.mockResolvedValue([{
      key: `http_traffic_v1:${(traffic as any).instanceId}:${date}`,
      value: JSON.stringify(initial.days[0]),
    }]);
    const afterSnapshot = await traffic.getLastSevenDays();
    expect(afterSnapshot.days[0].requests).toBe(1);
    expect(afterSnapshot.days[0].bytes).toBe(128);
  });

  it('keeps the logical body size when HTTP compression removes Content-Length', async () => {
    const prisma = { appSetting: { findMany: jest.fn().mockResolvedValue([]) } } as any;
    const traffic = new TrafficService(prisma);
    const req = { path: '/api/orders', route: { path: '/api/orders' }, method: 'GET' } as any;
    const response = new EventEmitter() as any;
    const headers = new Map<string, unknown>();
    response.statusCode = 200;
    response.getHeader = (name: string) => headers.get(name.toLowerCase());
    response.setHeader = (name: string, value: unknown) => headers.set(name.toLowerCase(), value);
    response.removeHeader = (name: string) => headers.delete(name.toLowerCase());

    traffic.observe(req, response);
    response.setHeader('Content-Length', '4096');
    response.setHeader('Content-Encoding', 'br');
    response.removeHeader('Content-Length');
    response.emit('finish');

    const totals = await traffic.getLastSevenDays();
    expect(totals.days[0].bytes).toBe(4096);
    expect(totals.days[0].unknownBytesRequests).toBe(0);
  });
  it('distinguishes 2xx, 3xx, 4xx, and 5xx responses for route visibility', async () => {
    const prisma = { appSetting: { findMany: jest.fn().mockResolvedValue([]) } } as any;
    const traffic = new TrafficService(prisma);
    const mediaReq = { path: '/api/whatsapp/media/missing-media-id', route: { path: '/api/whatsapp/media/:mediaId' }, method: 'GET' } as any;
    const res404 = new EventEmitter() as any;
    res404.statusCode = 404;
    res404.getHeader = () => null;
    traffic.observe(mediaReq, res404);
    res404.emit('finish');

    const totals = await traffic.getLastSevenDays();
    const mediaRoute = totals.days[0].routes.find(r => r.route === '/api/whatsapp/media/*');
    expect(mediaRoute).toBeDefined();
    expect(mediaRoute?.status4xx).toBe(1);
    expect(totals.days[0].status4xx).toBe(1);
  });

  it('keeps authenticated and public traffic isolated by site', async () => {
    const secondSiteId = '00000000-0000-4000-8000-000000000202';
    const prisma = {
      appSetting: { findMany: jest.fn().mockResolvedValue([]) },
      siteSetting: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const traffic = new TrafficService(prisma);
    const responseFor = (length: string) => {
      const response = new EventEmitter() as any;
      response.statusCode = 200;
      response.getHeader = () => length;
      return response;
    };

    const principalRequest = {
      path: '/api/orders',
      route: { path: '/api/orders' },
      method: 'GET',
      user: { siteId: '00000000-0000-4000-8000-000000000101' },
    } as any;
    const secondaryPublicRequest = {
      path: '/api/public/menu/categories',
      route: { path: '/api/public/menu/categories' },
      method: 'GET',
      trafficSiteId: secondSiteId,
    } as any;
    const principalResponse = responseFor('100');
    const secondaryResponse = responseFor('250');

    traffic.observe(principalRequest, principalResponse);
    traffic.observe(secondaryPublicRequest, secondaryResponse);
    principalResponse.emit('finish');
    secondaryResponse.emit('finish');

    const principal = await traffic.getLastSevenDays();
    const secondary = await traffic.getLastSevenDays(secondSiteId);
    expect(principal.days[0]).toMatchObject({ requests: 1, bytes: 100 });
    expect(secondary.days[0]).toMatchObject({ requests: 1, bytes: 250 });
    expect(secondary.siteId).toBe(secondSiteId);
    expect(prisma.siteSetting.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ siteId: secondSiteId }) }),
    );
  });

  it('persists secondary-site snapshots in SiteSetting without mixing them into principal metrics', async () => {
    const secondSiteId = '00000000-0000-4000-8000-000000000202';
    const prisma = {
      appSetting: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      siteSetting: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as any;
    const traffic = new TrafficService(prisma);
    const request = {
      path: '/api/public/menu/categories',
      route: { path: '/api/public/menu/categories' },
      method: 'GET',
      trafficSiteId: secondSiteId,
    } as any;
    const response = new EventEmitter() as any;
    response.statusCode = 200;
    response.getHeader = () => '512';

    traffic.observe(request, response);
    response.emit('finish');
    await (traffic as any).flush();

    expect(prisma.siteSetting.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.siteSetting.upsert).toHaveBeenCalledWith({
      where: {
        siteId_key: {
          siteId: secondSiteId,
          key: expect.stringMatching(
            /^http_traffic_v1:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}$/,
          ),
        },
      },
      create: expect.objectContaining({
        siteId: secondSiteId,
        key: expect.stringMatching(
          /^http_traffic_v1:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}$/,
        ),
        value: expect.stringContaining('"bytes":512'),
      }),
      update: {
        value: expect.stringContaining('"bytes":512'),
      },
    });
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
  });

});
