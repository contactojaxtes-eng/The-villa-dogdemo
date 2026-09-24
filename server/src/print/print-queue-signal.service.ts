import { Injectable, OnModuleDestroy } from '@nestjs/common';

type QueueWaiter = {
  resolve: (changed: boolean) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  abortListener?: () => void;
};

/**
 * Señal local y efímera para despertar las consultas long-poll del puente.
 * La base de datos continúa siendo la única fuente de verdad de la cola.
 */
@Injectable()
export class PrintQueueSignalService implements OnModuleDestroy {
  private revision = 0;
  private readonly waiters = new Set<QueueWaiter>();

  currentRevision() {
    return this.revision;
  }

  notifyJobCreated() {
    this.revision += 1;
    for (const waiter of [...this.waiters]) {
      this.finishWaiter(waiter, true);
    }
  }

  waitForChange(revision: number, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    if (revision !== this.revision) return Promise.resolve(true);
    if (timeoutMs <= 0 || signal?.aborted) return Promise.resolve(false);

    return new Promise<boolean>((resolve) => {
      const waiter = {} as QueueWaiter;
      waiter.resolve = resolve;
      waiter.timer = setTimeout(() => this.finishWaiter(waiter, false), timeoutMs);
      waiter.signal = signal;
      waiter.abortListener = signal ? () => this.finishWaiter(waiter, false) : undefined;
      this.waiters.add(waiter);
      if (signal && waiter.abortListener) signal.addEventListener('abort', waiter.abortListener, { once: true });

      // Cierra la carrera entre capturar la revisión y registrar el waiter.
      if (revision !== this.revision) this.finishWaiter(waiter, true);
    });
  }

  onModuleDestroy() {
    for (const waiter of [...this.waiters]) {
      this.finishWaiter(waiter, false);
    }
  }

  private finishWaiter(waiter: QueueWaiter, changed: boolean) {
    if (!this.waiters.delete(waiter)) return;
    clearTimeout(waiter.timer);
    if (waiter.signal && waiter.abortListener) {
      waiter.signal.removeEventListener('abort', waiter.abortListener);
    }
    waiter.resolve(changed);
  }
}
