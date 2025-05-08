/**
 * 日志工具类
 * 提供格式化的日志输出功能
 */

import * as pino from 'pino';

export class Logger {
  private logger: pino.Logger;
  private context: string;

  constructor(context: string) {
    this.context = context;
    this.logger = pino.pino({
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
      level: process.env.LOG_LEVEL || 'info',
    });
  }

  /**
   * 格式化日志消息，添加上下文
   */
  private formatMessage(message: string): string {
    return `[${this.context}] ${message}`;
  }

  /**
   * 记录信息级别日志
   */
  info(message: string, ...args: unknown[]): void {
    this.logger.info(this.formatMessage(message), ...args);
  }

  /**
   * 记录警告级别日志
   */
  warning(message: string, ...args: unknown[]): void {
    this.logger.warn(this.formatMessage(message), ...args);
  }

  /**
   * 记录错误级别日志
   */
  error(message: string, ...args: unknown[]): void {
    this.logger.error(this.formatMessage(message), ...args);
  }

  /**
   * 记录调试级别日志
   */
  debug(message: string, ...args: unknown[]): void {
    this.logger.debug(this.formatMessage(message), ...args);
  }
}
