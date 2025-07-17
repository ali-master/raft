import { RaftLogger, LogLevel } from "@usex/raft";

// Create a logger instance with playground-specific configuration
const createPlaygroundLogger = (minLevel: LogLevel = LogLevel.INFO) => {
  return new RaftLogger({
    level: minLevel,
    enableColors: true,
    showTimestamps: true,
    showNodeIds: true,
    enableStructured: false,
    enableConsole: true,
    enableFile: false,
    pretty: false,
  });
};

// Export the logger class and a factory function
export { LogLevel };
export const PlaygroundLogger = class {
  private logger: RaftLogger;

  constructor(minLevel: LogLevel = LogLevel.INFO) {
    this.logger = createPlaygroundLogger(minLevel);
  }

  debug(message: string, nodeId?: string, data?: any) {
    const context = { nodeId };
    if (data instanceof Error) {
      this.logger.debug(message, context, data);
    } else {
      this.logger.debug(message, { ...context, ...data });
    }
  }

  info(message: string, nodeId?: string, data?: any) {
    const context = { nodeId };
    if (data instanceof Error) {
      this.logger.info(message, context, data);
    } else {
      this.logger.info(message, { ...context, ...data });
    }
  }

  warn(message: string, nodeId?: string, data?: any) {
    const context = { nodeId };
    if (data instanceof Error) {
      this.logger.warn(message, context, data);
    } else {
      this.logger.warn(message, { ...context, ...data });
    }
  }

  error(message: string, nodeId?: string, data?: any) {
    const context = { nodeId };
    if (data instanceof Error) {
      this.logger.error(message, context, data);
    } else {
      this.logger.error(message, { ...context, ...data });
    }
  }

  success(message: string, nodeId?: string, data?: any) {
    const context = { nodeId };
    if (data instanceof Error) {
      this.logger.success(message, context, data);
    } else {
      this.logger.success(message, { ...context, ...data });
    }
  }

  section(title: string) {
    this.logger.section(title);
  }

  step(stepNumber: number, description: string) {
    this.logger.step(stepNumber, description);
  }

  result(success: boolean, message: string) {
    this.logger.result(success, message);
  }

  metric(name: string, value: string | number, unit?: string) {
    this.logger.metric(name, value, unit);
  }

  progress(current: number, total: number, description?: string) {
    this.logger.progress(current, total, description);
  }
};
