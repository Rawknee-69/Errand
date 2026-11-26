export type RateLimitOptions = {
  maxAttempts: number;
  windowMs: number;
};

export const DEFAULT_RATE_LIMIT: RateLimitOptions = {
  maxAttempts: 5,
  windowMs: 60_000,
};

// One owner passphrase is the whole login surface, so the limiter is global:
// rotating source addresses must not buy more guesses.
export class LoginRateLimiter {
  private failures: number[] = [];

  constructor(
    private readonly options: RateLimitOptions,
    private readonly now: () => number,
  ) {}

  retryAfterSeconds(): number | undefined {
    this.prune();
    const oldest = this.failures[0];
    if (this.failures.length < this.options.maxAttempts || oldest === undefined) return undefined;
    return Math.max(1, Math.ceil((oldest + this.options.windowMs - this.now()) / 1000));
  }

  recordAttempt(): void {
    this.prune();
    this.failures.push(this.now());
  }

  reset(): void {
    this.failures = [];
  }

  private prune(): void {
    const cutoff = this.now() - this.options.windowMs;
    this.failures = this.failures.filter((at) => at > cutoff);
  }
}
