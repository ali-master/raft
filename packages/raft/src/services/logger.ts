import type { PrettyLogConfig, LoggingConfig } from "../types";
import { LogLevel } from "../constants";
import { parseError } from "../utils";
import chalk from "chalk";

export class RaftLogger {
  private readonly config: LoggingConfig;
  private readonly redactPattern: RegExp;
  private readonly prettyConfig: PrettyLogConfig;

  constructor(config: LoggingConfig) {
    this.config = config;
    this.redactPattern = new RegExp(
      (config.redactedFields || []).join("|"),
      "gi",
    );

    // Set up pretty printing configuration
    if (typeof config.pretty === "boolean") {
      this.prettyConfig = {
        enabled: config.pretty,
        indent: 2,
        showTypes: false,
        maxObjectDepth: 3,
        maxArrayLength: 10,
        sortKeys: false,
        showFunctions: false,
        colorizeJson: config.enableColors !== false,
      };
    } else if (config.pretty) {
      const defaults = {
        enabled: true,
        indent: 2,
        showTypes: false,
        maxObjectDepth: 3,
        maxArrayLength: 10,
        sortKeys: false,
        showFunctions: false,
        colorizeJson: config.enableColors !== false,
      };
      this.prettyConfig = {
        ...defaults,
        ...config.pretty,
      };
    } else {
      this.prettyConfig = {
        enabled: false,
        indent: 2,
        showTypes: false,
        maxObjectDepth: 3,
        maxArrayLength: 10,
        sortKeys: false,
        showFunctions: false,
        colorizeJson: false,
      };
    }
  }

  private prettyPrint(obj: unknown, depth: number = 0): string {
    if (!this.prettyConfig.enabled) {
      return JSON.stringify(obj);
    }

    if (depth > this.prettyConfig.maxObjectDepth!) {
      return this.prettyConfig.colorizeJson
        ? chalk.gray("[Object]")
        : "[Object]";
    }

    const indent = " ".repeat(this.prettyConfig.indent * depth);
    const nextIndent = " ".repeat(this.prettyConfig.indent * (depth + 1));

    if (obj === null) {
      return this.prettyConfig.colorizeJson ? chalk.gray("null") : "null";
    }

    if (obj === undefined) {
      return this.prettyConfig.colorizeJson
        ? chalk.gray("undefined")
        : "undefined";
    }

    if (typeof obj === "string") {
      const value = `"${obj}"`;
      return this.prettyConfig.colorizeJson ? chalk.green(value) : value;
    }

    if (typeof obj === "number") {
      const value = obj.toString();
      return this.prettyConfig.colorizeJson ? chalk.yellow(value) : value;
    }

    if (typeof obj === "boolean") {
      const value = obj.toString();
      return this.prettyConfig.colorizeJson ? chalk.blue(value) : value;
    }

    if (typeof obj === "function") {
      if (!this.prettyConfig.showFunctions) {
        return this.prettyConfig.colorizeJson
          ? chalk.gray("[Function]")
          : "[Function]";
      }
      const value = `[Function: ${obj.name || "anonymous"}]`;
      return this.prettyConfig.colorizeJson ? chalk.magenta(value) : value;
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return "[]";
      }

      const items = obj.slice(0, this.prettyConfig.maxArrayLength!);
      const truncated = obj.length > this.prettyConfig.maxArrayLength!;

      let result = "[\n";
      items.forEach((item, index) => {
        result += nextIndent + this.prettyPrint(item, depth + 1);
        if (index < items.length - 1) result += ",";
        result += "\n";
      });

      if (truncated) {
        result += `${nextIndent + (this.prettyConfig.colorizeJson ? chalk.gray(`... ${obj.length - items.length} more items`) : `... ${obj.length - items.length} more items`)}\n`;
      }

      result += `${indent}]`;
      return result;
    }

    if (typeof obj === "object") {
      const keys = Object.keys(obj as Record<string, unknown>);
      if (keys.length === 0) {
        return "{}";
      }

      const sortedKeys = this.prettyConfig.sortKeys ? keys.sort() : keys;
      let result = "{\n";

      sortedKeys.forEach((key, index) => {
        const value = (obj as Record<string, unknown>)[key];
        const keyStr = this.prettyConfig.colorizeJson
          ? chalk.cyan(`"${key}"`)
          : `"${key}"`;
        const typeHint = this.prettyConfig.showTypes
          ? this.prettyConfig.colorizeJson
            ? chalk.gray(` (${typeof value})`)
            : ` (${typeof value})`
          : "";

        result += `${nextIndent + keyStr + typeHint}: ${this.prettyPrint(value, depth + 1)}`;
        if (index < sortedKeys.length - 1) result += ",";
        result += "\n";
      });

      result += `${indent}}`;
      return result;
    }

    return String(obj);
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

  private enhanceContext(
    context?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!context) return undefined;

    const enhanced = { ...context };

    // Look for error objects in the context and parse them
    for (const [key, value] of Object.entries(enhanced)) {
      if (
        value instanceof Error ||
        (value && typeof value === "object" && "message" in value)
      ) {
        enhanced[key] = parseError(value);
      }
    }

    return enhanced;
  }

  private formatLevel(level: LogLevel): string {
    if (!this.config.enableColors) {
      return `[${level.toUpperCase()}]`;
    }

    switch (level) {
      case LogLevel.DEBUG:
        return chalk.blue("[DEBUG]");
      case LogLevel.INFO:
        return chalk.white("[INFO] ");
      case LogLevel.WARN:
        return chalk.yellow("[WARN] ");
      case LogLevel.ERROR:
        return chalk.red("[ERROR]");
      case LogLevel.FATAL:
        return chalk.red.bold("[FATAL]");
      default:
        return chalk.white("[INFO] ");
    }
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    nodeId?: string,
  ): string {
    const timestamp = new Date().toISOString();
    const enhancedContext = this.enhanceContext(context);
    const redactedContext = enhancedContext
      ? this.redact(enhancedContext)
      : undefined;

    if (this.config.enableStructured) {
      return JSON.stringify({
        timestamp,
        level,
        message,
        context: redactedContext,
        nodeId,
      });
    }

    let output = "";

    // Timestamp
    if (this.config.showTimestamps !== false) {
      const timeStr = timestamp.slice(11, 23); // Extract time portion
      output +=
        this.config.enableColors !== false
          ? chalk.gray(`[${timeStr}] `)
          : `[${timeStr}] `;
    }

    // Level
    output += `${this.formatLevel(level)} `;

    // Node ID
    if (nodeId && this.config.showNodeIds !== false) {
      output +=
        this.config.enableColors !== false
          ? chalk.cyan(`[${nodeId}] `)
          : `[${nodeId}] `;
    }

    // Message
    output += message;

    // Context data
    if (redactedContext) {
      const contextStr = this.prettyConfig.enabled
        ? `\n${this.prettyPrint(redactedContext)}`
        : JSON.stringify(redactedContext);

      if (this.prettyConfig.enabled) {
        output += contextStr;
      } else {
        output +=
          this.config.enableColors !== false
            ? chalk.gray(` ${contextStr}`)
            : ` ${contextStr}`;
      }
    }

    return output;
  }

  private processLogParameters(
    context?: Record<string, unknown> | unknown,
    error?: unknown,
  ): Record<string, unknown> | undefined {
    // If context is actually an error object, move it to error parameter
    if (context instanceof Error) {
      return { error: parseError(context) };
    }

    // If we have both context and error, merge them
    if (context && error) {
      return {
        ...(context as Record<string, unknown>),
        error: parseError(error),
      };
    }

    // If we only have error, put it in context
    if (error) {
      return { error: parseError(error) };
    }

    // Return context as-is if it's a proper context object
    return context as Record<string, unknown>;
  }

  public debug(
    message: string,
    context?: Record<string, unknown> | unknown,
    error?: unknown,
  ): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const processedContext = this.processLogParameters(context, error);
      const nodeId = this.extractNodeId(processedContext);
      console.log(
        this.formatMessage(LogLevel.DEBUG, message, processedContext, nodeId),
      );
    }
  }

  public info(
    message: string,
    context?: Record<string, unknown> | unknown,
    error?: unknown,
  ): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const processedContext = this.processLogParameters(context, error);
      const nodeId = this.extractNodeId(processedContext);
      console.log(
        this.formatMessage(LogLevel.INFO, message, processedContext, nodeId),
      );
    }
  }

  public warn(
    message: string,
    context?: Record<string, unknown> | unknown,
    error?: unknown,
  ): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const processedContext = this.processLogParameters(context, error);
      const nodeId = this.extractNodeId(processedContext);
      console.warn(
        this.formatMessage(LogLevel.WARN, message, processedContext, nodeId),
      );
    }
  }

  public error(
    message: string,
    context?: Record<string, unknown> | unknown,
    error?: unknown,
  ): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const processedContext = this.processLogParameters(context, error);
      const nodeId = this.extractNodeId(processedContext);
      console.error(
        this.formatMessage(LogLevel.ERROR, message, processedContext, nodeId),
      );
    }
  }

  public fatal(
    message: string,
    context?: Record<string, unknown> | unknown,
    error?: unknown,
  ): void {
    if (this.shouldLog(LogLevel.FATAL)) {
      const processedContext = this.processLogParameters(context, error);
      const nodeId = this.extractNodeId(processedContext);
      console.error(
        this.formatMessage(LogLevel.FATAL, message, processedContext, nodeId),
      );
    }
  }

  private extractNodeId(context?: Record<string, unknown>): string | undefined {
    if (!context) return undefined;
    return context.nodeId as string;
  }

  // Additional utility methods for playground compatibility
  public success(
    message: string,
    context?: Record<string, unknown> | unknown,
    error?: unknown,
  ): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const processedContext = this.processLogParameters(context, error);
      const nodeId = this.extractNodeId(processedContext);
      const successMessage =
        this.config.enableColors !== false
          ? chalk.green(`✅ ${message}`)
          : `✅ ${message}`;
      console.log(
        this.formatMessage(
          LogLevel.INFO,
          successMessage,
          processedContext,
          nodeId,
        ),
      );
    }
  }

  public section(title: string): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log();
      const sectionTitle =
        this.config.enableColors !== false
          ? chalk.bold.cyan(`🔍 ${title}`)
          : `🔍 ${title}`;
      console.log(sectionTitle);

      const separator =
        this.config.enableColors !== false
          ? chalk.gray("─".repeat(title.length + 4))
          : "─".repeat(title.length + 4);
      console.log(separator);
    }
  }

  public step(stepNumber: number, description: string): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const stepMessage =
        this.config.enableColors !== false
          ? chalk.bold.yellow(`\n📋 Step ${stepNumber}: ${description}`)
          : `\n📋 Step ${stepNumber}: ${description}`;
      console.log(stepMessage);
    }
  }

  public result(success: boolean, message: string): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const resultMessage = success
        ? this.config.enableColors !== false
          ? chalk.green(`✅ ${message}`)
          : `✅ ${message}`
        : this.config.enableColors !== false
          ? chalk.red(`❌ ${message}`)
          : `❌ ${message}`;
      console.log(resultMessage);
    }
  }

  public metric(name: string, value: string | number, unit?: string): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const displayValue = unit ? `${value} ${unit}` : value.toString();
      const metricMessage =
        this.config.enableColors !== false
          ? chalk.blue(`📊 ${name}: ${chalk.bold(displayValue)}`)
          : `📊 ${name}: ${displayValue}`;
      console.log(metricMessage);
    }
  }

  public progress(current: number, total: number, description?: string): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const percentage = Math.round((current / total) * 100);
      const progressBar =
        "█".repeat(Math.floor(percentage / 5)) +
        "░".repeat(20 - Math.floor(percentage / 5));
      const display = description ? `${description} ` : "";
      console.log(
        `${display}[${progressBar}] ${percentage}% (${current}/${total})`,
      );
    }
  }
}
