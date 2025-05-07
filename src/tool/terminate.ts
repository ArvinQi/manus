/**
 * 终止工具
 * 用于终止代理的执行
 */

import { BaseTool, ToolResult } from './base.js';
import { Logger } from '../utils/logger.js';

/**
 * 终止工具类
 * 用于终止代理的执行
 */
export class Terminate extends BaseTool {
  private static logger = new Logger('Terminate');
  private static isExecuting = false;
  constructor() {
    super({
      name: 'Terminate',
      description: '终止当前任务的执行。当你认为任务已经完成或无法继续时使用此工具。',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: '终止执行的原因',
          },
        },
        required: ['reason'],
      },
    });
  }

  /**
   * 执行终止操作
   * @param args 工具参数
   */
  async run(args: { reason: string }): Promise<ToolResult> {
    const reason = args.reason || '任务已完成';
    Terminate.isExecuting = false;
    Terminate.logger.info(`执行已终止: ${reason}`);
    return new ToolResult({
      output: `执行已终止: ${reason}`,
    });
  }

  /**
   * 设置执行状态
   * @param status 是否正在执行
   */
  static setExecuting(status: boolean): void {
    Terminate.isExecuting = status;
    Terminate.logger.debug(`设置执行状态: ${status}`);
  }

  /**
   * 获取执行状态
   * @returns 是否正在执行
   */
  static getExecuting(): boolean {
    return Terminate.isExecuting;
  }

  /**
   * 检查并终止
   * 如果没有任务或工具调用正在执行，则自动终止
   * @param reason 终止原因
   * @returns 是否已终止
   */
  static async checkAndTerminate(reason: string = '没有任务或工具调用'): Promise<boolean> {
    if (!Terminate.isExecuting) {
      Terminate.logger.info(`自动终止: ${reason}`);
      return true;
    }
    return false;
  }
}
