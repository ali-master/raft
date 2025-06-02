import { Injectable, Logger } from "@nestjs/common";
import * as chalk from "chalk";

@Injectable()
export class LoggerService {
  private readonly logger = new Logger(LoggerService.name);

  log(message: string, context?: string) {
    this.logger.log(chalk.green(message), context);
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error(chalk.red(message), trace, context);
  }

  warn(message: string, context?: string) {
    this.logger.warn(chalk.yellow(message), context);
  }

  debug(message: string, context?: string) {
    this.logger.debug(chalk.blue(message), context);
  }

  verbose(message: string, context?: string) {
    this.logger.verbose(chalk.gray(message), context);
  }

  logEvent(event: string, data?: any) {
    const timestamp = new Date().toISOString();
    const formatted = chalk.cyan(`[${timestamp}] ${event}`);

    if (data) {
      this.logger.log(`${formatted}\n${JSON.stringify(data, null, 2)}`);
    } else {
      this.logger.log(formatted);
    }
  }

  logRaftEvent(eventType: string, nodeId: string, data?: any) {
    const emoji = this.getEventEmoji(eventType);
    const color = this.getEventColor(eventType);

    const message = color(`${emoji} [${nodeId}] ${eventType}`);
    this.logger.log(message);

    if (data) {
      this.logger.verbose(JSON.stringify(data, null, 2));
    }
  }

  private getEventEmoji(eventType: string): string {
    const emojiMap = {
      leader_elected: "👑",
      state_change: "🔄",
      vote_granted: "✅",
      vote_denied: "❌",
      peer_discovered: "🤝",
      peer_lost: "👻",
      error_occurred: "🔥",
      heartbeat: "💓",
      snapshot_created: "📸",
      log_replicated: "📝",
    };

    return emojiMap[eventType] || "📌";
  }

  private getEventColor(eventType: string): (text: string) => string {
    if (eventType.includes("error")) return chalk.red;
    if (eventType.includes("leader")) return chalk.magenta;
    if (eventType.includes("vote")) return chalk.cyan;
    if (eventType.includes("peer")) return chalk.yellow;
    return chalk.white;
  }
}
