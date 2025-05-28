import type { RaftConfiguration } from "../types";
import { RaftException } from "../exceptions";

export class RetryStrategy {
  private readonly config: RaftConfiguration["retry"];

  constructor(config: RaftConfiguration["retry"]) {
    this.config = config;
  }

  public async execute<T>(
    operation: () => Promise<T>,
    context: string,
  ): Promise<T> {
    let lastError: Error;
    let delay = this.config!.initialDelay;

    for (let attempt = 1; attempt <= this.config!.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === this.config!.maxAttempts) {
          throw new RaftException(
            `Failed after ${this.config!.maxAttempts} attempts in ${context}: ${lastError.message}`,
          );
        }

        await this.sleep(delay);
        delay *= this.config!.backoffFactor;
      }
    }

    throw new Error(lastError!.message);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Static methods for backward compatibility
  public static async exponentialBackoff<T>(
    operation: () => Promise<T>,
    options: { maxRetries: number; baseDelay: number } = {
      maxRetries: 3,
      baseDelay: 100,
    },
  ): Promise<T> {
    let lastError: Error;
    let delay = options.baseDelay;

    for (let attempt = 0; attempt < options.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        if (attempt === options.maxRetries - 1) {
          throw lastError;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }

    throw lastError!;
  }

  public static async execute<T>(
    operation: () => Promise<T>,
    context: string,
    maxRetries: number = 3,
  ): Promise<T> {
    const strategy = new RetryStrategy({
      maxAttempts: maxRetries,
      backoffFactor: 2,
      initialDelay: 100,
    });
    return strategy.execute(operation, context);
  }
}
