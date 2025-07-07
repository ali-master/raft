import type { LoggingConfig } from "../types";
import { LogLevel } from "../constants";

export class RaftLogger {
  private readonly config: LoggingConfig;
  private readonly redactPattern: RegExp;

  constructor(config: LoggingConfig) {
    this.config = config;
    this.redactPattern = new RegExp(
      (config.redactedFields || []).join("|"),
      "gi",
    );
  }

  private redact<T>(data: T): T {
    if (typeof data === "string") {
      return data.replace(this.redactPattern, "[REDACTED]") as T;
    }

    if (typeof data === "object" && data !== null) {
      const redacted = { ...data } as Record<string, unknown>;
      for (const field of this.config.redactedFields || []) {
        if (field in redacted) {
          redacted[field] = "[REDACTED]";
        }
      }
      return redacted as T;
    }

    return data;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARN,
      LogLevel.ERROR,
      LogLevel.FATAL,
    ];
    return levels.indexOf(level) >= levels.indexOf(this.config.level);
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): string {
    const timestamp = new Date().toISOString();
    const redactedContext = context ? this.redact(context) : undefined;

    if (this.config.enableStructured) {
      return JSON.stringify({
        timestamp,
        level,
        message,
        context: redactedContext,
      });
    }

    return `[${timestamp}] ${level.toUpperCase()}: ${message}${
      redactedContext ? ` ${JSON.stringify(redactedContext)}` : ""
    }`;
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage(LogLevel.DEBUG, message, context));
    }
  }

  public info(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(this.formatMessage(LogLevel.INFO, message, context));
    }
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage(LogLevel.WARN, message, context));
    }
  }

  public error(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage(LogLevel.ERROR, message, context));
    }
  }

  public fatal(message: string, context?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.FATAL)) {
      console.error(this.formatMessage(LogLevel.FATAL, message, context));
    }
  }
}
