import { PrintQueueSignalService } from './print-queue-signal.service';

describe('PrintQueueSignalService', () => {
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
});
