import { DEFAULT_SITE_ID } from '../common/multisite.constants';
import { PrintService } from './print.service';

describe('PrintService multisede', () => {
  const secondSiteId = '00000000-0000-4000-8000-000000000202';
  let prisma: any;
  let socket: any;
  let queueSignal: any;
  let service: PrintService;

  beforeEach(() => {
    prisma = {
      siteSetting: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      appSetting: { findMany: jest.fn().mockResolvedValue([]) },
      printJob: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      order: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    socket = { emitToSite: jest.fn() };
    queueSignal = { notifyJobCreated: jest.fn() };
    service = new PrintService(prisma, socket, {} as any, queueSignal);
  });

  it('lee la configuración de una sede secundaria sin heredar impresoras de la principal', async () => {
    prisma.siteSetting.findMany.mockResolvedValue([
      { key: 'caja_printer_ip', value: '192.168.2.20' },
      {
        key: 'custom_prep_printers',
        value: JSON.stringify([{ id: 'cocina-2', name: 'Cocina sede 2', ip: 'USB:COCINA2', mode: 'local_bridge' }]),
      },
    ]);

    const settings = await service.getPrinterSettings(secondSiteId);

    expect(prisma.siteSetting.findMany).toHaveBeenCalledWith({
      where: { siteId: secondSiteId, key: { in: expect.any(Array) } },
    });
    expect(prisma.appSetting.findMany).not.toHaveBeenCalled();
    expect(settings.caja.ip).toBe('192.168.2.20');
    expect(settings.printers).toEqual([expect.objectContaining({ id: 'cocina-2' })]);
  });

  it('mantiene el legado de la principal y deja que SiteSetting lo reemplace', async () => {
    prisma.appSetting.findMany.mockResolvedValue([
      { key: 'caja_printer_ip', value: '192.168.1.10' },
      { key: 'printer_auto_print', value: 'true' },
    ]);
    prisma.siteSetting.findMany.mockResolvedValue([
      { key: 'caja_printer_ip', value: 'USB:CAJA-NUEVA' },
    ]);

    const settings = await service.getPrinterSettings(DEFAULT_SITE_ID);

    expect(settings.caja.ip).toBe('USB:CAJA-NUEVA');
    expect(settings.autoPrint).toBe(true);
  });

  it('guarda configuración y notifica solamente a la sede activa', async () => {
    await service.savePrinterSettings({
      caja: { ip: 'USB:CAJA2', mode: 'local_bridge' },
      autoPrint: true,
    }, secondSiteId);

    expect(prisma.siteSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { siteId_key: { siteId: secondSiteId, key: 'caja_printer_ip' } },
      create: { siteId: secondSiteId, key: 'caja_printer_ip', value: 'USB:CAJA2' },
    }));
    expect(socket.emitToSite).toHaveBeenCalledWith(secondSiteId, 'printerSettingsUpdated', expect.any(Object));
    expect(socket.emitToSite).toHaveBeenCalledWith(secondSiteId, 'settingsUpdated', expect.any(Object));
  });

  it('encola y despierta únicamente el puente de la misma sede', async () => {
    const result = await (service as any).dispatchPrintJob(
      'caja',
      'Pedido 42',
      { id: 'caja', name: 'Caja', mode: 'local_bridge', ip: 'USB:CAJA2', port: 9100, paper: '80' },
      false,
      secondSiteId,
    );

    expect(result.ok).toBe(true);
    expect(prisma.printJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ siteId: secondSiteId, tipo: 'caja' }),
    });
    expect(queueSignal.notifyJobCreated).toHaveBeenCalledWith(secondSiteId);
    expect(socket.emitToSite).toHaveBeenCalledWith(secondSiteId, 'printJob', expect.any(Object));
  });

  it('busca pedidos y limpia cola dentro de la sede indicada', async () => {
    await expect(service.printOrder('order-1', undefined, false, secondSiteId))
      .resolves.toEqual({ ok: false, error: 'Pedido no encontrado' });
    expect(prisma.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-1', siteId: secondSiteId },
    }));

    await service.clearPrintQueue(undefined, secondSiteId);
    expect(prisma.printJob.deleteMany).toHaveBeenCalledWith({ where: { siteId: secondSiteId } });
  });
});
