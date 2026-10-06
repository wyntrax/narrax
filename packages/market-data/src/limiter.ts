/**
 * Spaces calls at least `minIntervalMs` apart. Reservations are made synchronously, so concurrent callers queue in order.
 * In-process only: if you run several worker processes against one free API, divide the budget between them.
 */
export class RateLimiter {
  private next = 0;
  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async wait(): Promise<void> {
    const t = this.now();
    const start = Math.max(t, this.next);
    this.next = start + this.minIntervalMs;
    if (start > t) await this.sleep(start - t);
  }
}
