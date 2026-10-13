import { AppController } from './app.controller';
import { PrintQueueSignalService } from './print/print-queue-signal.service';
import { DEFAULT_SITE_ID } from './common/multisite.constants';

const SECOND_SITE_ID = '00000000-0000-4000-8000-000000000202';

describe('AppController print queue', () => {
  let signal: PrintQueueSignalService;
  let prisma: any;
  let printService: any;
  let controller: AppController;

  beforeEach(() => {
    jest.useFakeTimers();
    signal = new PrintQueueSignalService();
    prisma = {
      printJob: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    printService = {
      getPrinterSettings: jest.fn().mockResolvedValue({
        printers: [],
        caja: { ip: '', port: 9100 },
        cocina: { ip: '', port: 9100 },
      }),
    };
    controller = new AppController(prisma, signal, printService);
  });

  afterEach(() => {
    signal.onModuleDestroy();
    jest.useRealTimers();
  });

  it('mantiene la lectura inmediata para waitMs=0', async () => {
    prisma.printJob.findMany.mockResolvedValue([]);

    await expect(controller.getPrintQueue('0')).resolves.toEqual([]);

    expect(prisma.printJob.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.printJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { siteId: DEFAULT_SITE_ID, impreso: false },
    }));
  });

  it('despierta y vuelve a consultar cuando se encola un trabajo', async () => {
    const job = {
      id: 7,
      impresoraIp: 'USB:COCINA',
      payload: 'cGF5bG9hZA==',
      tipo: 'cocina',
    };
    prisma.printJob.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([job]);

    const response = controller.getPrintQueue('25000', {
      printBridgeSiteId: SECOND_SITE_ID,
      once: jest.fn(),
      off: jest.fn(),
    } as any);
    await Promise.resolve();
    signal.notifyJobCreated(SECOND_SITE_ID);

    await expect(response).resolves.toEqual([
      expect.objectContaining({ id: 7, impresora_ip: 'USB:COCINA', payload: job.payload }),
    ]);
    expect(prisma.printJob.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.printJob.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { siteId: SECOND_SITE_ID, impreso: false },
    }));
  });

  it('devuelve una cola vacía al vencer la espera sin repetir la consulta', async () => {
    prisma.printJob.findMany.mockResolvedValue([]);
    const response = controller.getPrintQueue('500');
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(500);

    await expect(response).resolves.toEqual([]);
    expect(prisma.printJob.findMany).toHaveBeenCalledTimes(1);
  });

  it('usa 10 segundos para puentes antiguos y limita clientes nuevos a 25 segundos', async () => {
    prisma.printJob.findMany.mockResolvedValue([]);

    let legacyResolved = false;
    const legacy = controller.getPrintQueue().then((value) => {
      legacyResolved = true;
      return value;
    });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(9_999);
    expect(legacyResolved).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(legacy).resolves.toEqual([]);

    let cappedResolved = false;
    const capped = controller.getPrintQueue('999999').then((value) => {
      cappedResolved = true;
      return value;
    });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(24_999);
    expect(cappedResolved).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(capped).resolves.toEqual([]);
  });

  it('confirma solamente trabajos pertenecientes a la sede del puente', async () => {
    prisma.printJob.deleteMany.mockResolvedValue({ count: 1 });

    await expect(controller.confirmPrint(
      { ids: [7, 9] },
      { printBridgeSiteId: SECOND_SITE_ID } as any,
    )).resolves.toEqual({ ok: true });

    expect(prisma.printJob.deleteMany).toHaveBeenCalledWith({
      where: { siteId: SECOND_SITE_ID, id: { in: [7, 9] } },
    });
  });
});
