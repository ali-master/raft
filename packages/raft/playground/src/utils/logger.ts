import chalk from "chalk";

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  nodeId?: string;
  message: string;
  data?: any;
}

export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
  SUCCESS = "success",
}

export class PlaygroundLogger {
  private entries: LogEntry[] = [];
  private showTimestamps = true;
  private showNodeIds = true;
  private maxEntries = 1000;

  constructor(private minLevel: LogLevel = LogLevel.INFO) {}

  debug(message: string, nodeId?: string, data?: any) {
    this.log(LogLevel.DEBUG, message, nodeId, data);
  }

  info(message: string, nodeId?: string, data?: any) {
    this.log(LogLevel.INFO, message, nodeId, data);
  }

  warn(message: string, nodeId?: string, data?: any) {
    this.log(LogLevel.WARN, message, nodeId, data);
  }

  error(message: string, nodeId?: string, data?: any) {
    this.log(LogLevel.ERROR, message, nodeId, data);
  }

  success(message: string, nodeId?: string, data?: any) {
    this.log(LogLevel.SUCCESS, message, nodeId, data);
  }

  private log(level: LogLevel, message: string, nodeId?: string, data?: any) {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      nodeId: nodeId!,
      message,
      data,
    };

    this.entries.push(entry);

    // Keep only recent entries
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    // Only display if level is >= minLevel
    if (this.shouldLog(level)) {
      this.display(entry);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARN,
      LogLevel.ERROR,
      LogLevel.SUCCESS,
    ];
    const minIndex = levels.indexOf(this.minLevel);
    const levelIndex = levels.indexOf(level);
    return levelIndex >= minIndex;
  }

  private display(entry: LogEntry) {
    let output = "";

    // Timestamp
    if (this.showTimestamps) {
      output += chalk.gray(`[${entry.timestamp.toISOString().slice(11, 23)}] `);
    }

    // Level
    output += this.formatLevel(entry.level);

    // Node ID
    if (entry.nodeId && this.showNodeIds) {
      output += chalk.cyan(`[${entry.nodeId}] `);
    }

    // Message
    output += entry.message;

    // Data
    if (entry.data) {
      output += chalk.gray(` ${JSON.stringify(entry.data)}`);
    }

    console.log(output);
  }

  private formatLevel(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return chalk.blue("[DEBUG] ");
      case LogLevel.INFO:
        return chalk.white("[INFO]  ");
      case LogLevel.WARN:
        return chalk.yellow("[WARN]  ");
      case LogLevel.ERROR:
        return chalk.red("[ERROR] ");
      case LogLevel.SUCCESS:
        return chalk.green("[SUCCESS] ");
      default:
        return chalk.white("[INFO]  ");
    }
  }

  section(title: string) {
    console.log();
    console.log(chalk.bold.cyan(`🔍 ${title}`));
    console.log(chalk.gray("─".repeat(title.length + 4)));
  }

  step(stepNumber: number, description: string) {
    console.log(chalk.bold.yellow(`\n📋 Step ${stepNumber}: ${description}`));
  }

  result(success: boolean, message: string) {
    if (success) {
      console.log(chalk.green(`✅ ${message}`));
    } else {
      console.log(chalk.red(`❌ ${message}`));
    }
  }

  metric(name: string, value: string | number, unit?: string) {
    const displayValue = unit ? `${value} ${unit}` : value.toString();
    console.log(chalk.blue(`📊 ${name}: ${chalk.bold(displayValue)}`));
  }

  progress(current: number, total: number, description?: string) {
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
