// src/bw/mutex.ts

export class Mutex {
  private current: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.current;
    this.current = this.current.then(() => next);

    await prev;
    try {
      return await fn();
    } finally {
      release?.();
    }
  }
}
