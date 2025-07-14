/**
 * 日志工具类
 * 提供格式化的日志输出功能
 */

import * as pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';

export class Logger {
  private logger: pino.Logger;
  private context: string;
  private logFilePath: string;
  private useConsole: boolean;

  constructor(
    context: string,
    options: { useConsole?: boolean; logToFile?: boolean; category?: string } = {}
  ) {
    this.context = context;
    this.useConsole = options.useConsole !== false; // 默认使用控制台输出

    // 创建日志记录器
    const pinoOptions: pino.LoggerOptions = {
      level: process.env.LOG_LEVEL || 'info',
    };

    // 如果使用控制台输出，添加格式化配置
    if (this.useConsole) {
      pinoOptions.transport = {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      };
    }

    this.logger = pino.pino(pinoOptions);

    // 确保 .manus 目录存在
    const manusDir = path.resolve(process.cwd(), '.manus');
    if (!fs.existsSync(manusDir)) {
      fs.mkdirSync(manusDir);
    }

    // 根据分类创建子目录
    const category = options.category || this.getCategoryFromContext(context);
    const categoryDir = path.join(manusDir, category);
    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true });
    }

    // 为每个上下文创建独立的日志文件
    this.logFilePath = path.join(categoryDir, `${context.toLowerCase()}.log`);
  }

  /**
   * 根据上下文自动判断分类
   */
  private getCategoryFromContext(context: string): string {
    const lowerContext = context.toLowerCase();

    // 内存相关
    if (lowerContext.includes('memory') || lowerContext.includes('mem0')) {
      return 'memory';
    }

    // 任务相关
    if (lowerContext.includes('task') || lowerContext.includes('plan')) {
      return 'tasks';
    }

    // 工具相关
    if (lowerContext.includes('tool') || lowerContext.includes('mcp')) {
      return 'tools';
    }

    // 代理相关
    if (lowerContext.includes('agent') || lowerContext.includes('manus')) {
      return 'agents';
    }

    // 核心系统
    if (
      lowerContext.includes('system') ||
      lowerContext.includes('core') ||
      lowerContext.includes('config')
    ) {
      return 'system';
    }

    // 默认为logs
    return 'logs';
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
    if (this.useConsole) {
      this.logger.info(this.formatMessage(message), ...args);
    }
    this.appendLog('INFO', message, args);
  }

  /**
   * 记录警告级别日志
   */
  warn(message: string, ...args: unknown[]): void {
    if (this.useConsole) {
      this.logger.warn(this.formatMessage(message), ...args);
    }
    this.appendLog('WARN', message, args);
  }

  /**
   * 记录错误级别日志
   */
  error(message: string, ...args: unknown[]): void {
    if (this.useConsole) {
      this.logger.error(this.formatMessage(message), ...args);
    }
    this.appendLog('ERROR', message, args);
  }

  /**
   * 记录调试级别日志
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.useConsole) {
      this.logger.debug(this.formatMessage(message), ...args);
    }
    this.appendLog('DEBUG', message, args);
  }

  private appendLog(level: string, message: string, args: unknown[]): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      message,
      args,
    };
    try {
      if (fs.existsSync(this.logFilePath)) {
        fs.appendFileSync(this.logFilePath, JSON.stringify(logEntry) + '\n');
      } else {
        fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
        fs.writeFileSync(this.logFilePath, JSON.stringify(logEntry) + '\n');
      }
    } catch (e) {
      console.error('🚀🚀🚀🚀🚀🚀 ~ Logger ~ appendLog ~ e:', e);
    }
  }
}
