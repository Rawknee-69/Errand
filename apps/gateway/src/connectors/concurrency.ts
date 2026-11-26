// One FIFO semaphore per connector, so a single slow upstream cannot occupy
// every worker while another connector waits.
export class ConnectorLimiter {
  private readonly active = new Map<string, number>();
  private readonly waiting = new Map<string, Array<() => void>>();

  constructor(private readonly perConnector: number) {
    if (!Number.isInteger(perConnector) || perConnector < 1) {
      throw new Error("Connector concurrency must be a positive integer");
    }
  }

  async run<T>(connectorId: string, task: () => Promise<T>): Promise<T> {
    await this.acquire(connectorId);
    try {
      return await task();
    } finally {
      this.release(connectorId);
    }
  }

  private acquire(connectorId: string): Promise<void> {
    const active = this.active.get(connectorId) ?? 0;
    if (active < this.perConnector) {
      this.active.set(connectorId, active + 1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const queue = this.waiting.get(connectorId) ?? [];
      queue.push(() => {
        this.active.set(connectorId, (this.active.get(connectorId) ?? 0) + 1);
        resolve();
      });
      this.waiting.set(connectorId, queue);
    });
  }

  private release(connectorId: string): void {
    const next = this.waiting.get(connectorId)?.shift();
    if (next !== undefined) {
      next();
      return;
    }
    const active = (this.active.get(connectorId) ?? 1) - 1;
    if (active <= 0) this.active.delete(connectorId);
    else this.active.set(connectorId, active);
  }
}
