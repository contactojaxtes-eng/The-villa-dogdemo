import { AppController } from './app.controller';
import { PrintQueueSignalService } from './print/print-queue-signal.service';

describe('AppController print queue', () => {
  let signal: PrintQueueSignalService;
  let prisma: any;
  let controller: AppController;

  beforeEach(() => {
    jest.useFakeTimers();
    signal = new PrintQueueSignalService();
    prisma = {
      printJob: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      appSetting: { findMany: jest.fn().mockResolvedValue([]) },
    };
    controller = new AppController(prisma, signal);
  });

  afterEach(() => {
    signal.onModuleDestroy();
    jest.useRealTimers();
  });

  it('mantiene la lectura inmediata para waitMs=0', async () => {
    prisma.printJob.findMany.mockResolvedValue([]);

    await expect(controller.getPrintQueue('0')).resolves.toEqual([]);

    expect(prisma.printJob.findMany).toHaveBeenCalledTimes(1);
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

    const response = controller.getPrintQueue('25000');
    await Promise.resolve();
    signal.notifyJobCreated();

    await expect(response).resolves.toEqual([
      expect.objectContaining({ id: 7, impresora_ip: 'USB:COCINA', payload: job.payload }),
    ]);
    expect(prisma.printJob.findMany).toHaveBeenCalledTimes(2);
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
});
