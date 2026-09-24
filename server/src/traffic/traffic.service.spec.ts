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
    expect(initial.days[0].routes).toEqual([{ route: '/api/orders/:id', method: 'GET', requests: 1, bytes: 128, unknownBytesRequests: 0, errors: 0 }]);

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
});
