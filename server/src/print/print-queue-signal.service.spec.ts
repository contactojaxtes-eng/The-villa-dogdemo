import { PrintQueueSignalService } from './print-queue-signal.service';

describe('PrintQueueSignalService', () => {
  const otherSiteId = '00000000-0000-4000-8000-000000000202';
  let service: PrintQueueSignalService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new PrintQueueSignalService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('despierta inmediatamente a los puentes cuando se crea un trabajo', async () => {
    const revision = service.currentRevision();
    const waiting = service.waitForChange(revision, 25_000);

    service.notifyJobCreated();

    await expect(waiting).resolves.toBe(true);
  });

  it('finaliza sin cambio al vencer el long-poll', async () => {
    const waiting = service.waitForChange(service.currentRevision(), 25_000);

    jest.advanceTimersByTime(25_000);

    await expect(waiting).resolves.toBe(false);
  });

  it('libera la espera cuando el cliente cancela la conexión', async () => {
    const abortController = new AbortController();
    const waiting = service.waitForChange(service.currentRevision(), 25_000, abortController.signal);

    abortController.abort();

    await expect(waiting).resolves.toBe(false);
  });

  it('detecta una señal ocurrida antes de registrar la espera', async () => {
    const previousRevision = service.currentRevision();
    service.notifyJobCreated();

    await expect(service.waitForChange(previousRevision, 25_000)).resolves.toBe(true);
  });

  it('no despierta el puente de otra sede', async () => {
    const waiting = service.waitForChange(
      service.currentRevision(otherSiteId),
      25_000,
      undefined,
      otherSiteId,
    );

    service.notifyJobCreated();
    jest.advanceTimersByTime(24_999);
    let resolved = false;
    void waiting.then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);

    service.notifyJobCreated(otherSiteId);
    await expect(waiting).resolves.toBe(true);
  });
});
