/**
 * Bash工具类
 * 用于执行shell命令，类似于Python的subprocess模块
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { BaseTool, ToolResult, ToolFailure } from './base.js';
import { Logger } from '../utils/logger.js';

const execPromise = promisify(exec);

/**
 * Bash工具类
 * 用于执行shell命令
 */
export class BashTool extends BaseTool {
  private logger = new Logger('BashTool');

  constructor() {
    super({
      name: 'bash',
      description: '执行bash命令并返回结果',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的bash命令',
          },
          cwd: {
            type: 'string',
            description: '命令执行的工作目录',
          },
          timeout: {
            type: 'number',
            description: '命令执行超时时间（毫秒）',
          },
        },
        required: ['command'],
      },
    });
  }

  /**
   * 执行bash命令
   * @param args 命令参数
   * @returns 命令执行结果
   */
  async run(args: { command: string; cwd?: string; timeout?: number }): Promise<ToolResult> {
    const { command, cwd, timeout } = args;

    this.logger.info(`执行命令: ${command}`);

    try {
      const options: { cwd?: string; timeout?: number } = {};

      if (cwd) {
        options.cwd = cwd;
      }

      if (timeout) {
        options.timeout = timeout;
      }

      const { stdout, stderr } = await execPromise(command, options);

      // 如果有错误输出但命令成功执行，将错误输出添加到结果中
      if (stderr) {
        this.logger.warn(`命令警告: ${stderr}`);
      }

      return new ToolResult({ output: stdout });
    } catch (error) {
      this.logger.error(`命令执行失败: ${error}`);
      return new ToolFailure({ error: `命令执行失败: ${error}` });
    }
  }
}
