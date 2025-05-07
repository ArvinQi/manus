/**
 * 人类询问工具
 * 用于向人类用户请求输入
 */

import { BaseTool, ToolResult } from './base.js';
import { Logger } from '../utils/logger.js';

/**
 * 人类询问工具
 * 用于向人类用户请求输入或确认
 */
export class AskHumanTool extends BaseTool {
  private logger = new Logger('AskHumanTool');

  constructor() {
    super({
      name: 'ask_human',
      description: '向人类用户请求输入或确认',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: '要向人类用户提出的问题',
          },
          options: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: '可选的选项列表，如果提供，用户将从这些选项中选择',
          },
          default_value: {
            type: 'string',
            description: '如果用户没有提供输入，使用的默认值',
          },
          timeout: {
            type: 'number',
            description: '等待用户输入的超时时间（毫秒），默认为无限',
          },
        },
        required: ['question'],
      },
    });
  }

  /**
   * 执行人类询问工具
   * @param args 工具参数
   * @returns 用户的回答
   */
  async run(args: {
    question: string;
    options?: string[];
    default_value?: string;
    timeout?: number;
  }): Promise<ToolResult> {
    const { question, options, default_value, timeout } = args;

    this.logger.info(`向用户提问: ${question}`);

    try {
      // 在实际实现中，这里应该有一个UI交互或命令行交互来获取用户输入
      // 这里只是一个模拟实现，实际项目中需要根据具体的UI框架或交互方式来实现
      console.log(`\n[问题] ${question}`);

      if (options && options.length > 0) {
        console.log('选项:');
        options.forEach((option, index) => {
          console.log(`${index + 1}. ${option}`);
        });
      }

      // 这里应该等待用户输入
      // 由于无法在这个简单实现中获取实际用户输入，我们返回一个提示信息
      const message = '请在实际UI中实现用户输入获取逻辑';
      this.logger.info(`用户回答: ${default_value || message}`);

      return new ToolResult({
        output: default_value || message,
        system: '此工具需要在实际应用中实现用户交互逻辑',
      });
    } catch (error) {
      this.logger.error(`获取用户输入失败: ${error}`);
      return new ToolResult({
        error: `获取用户输入失败: ${error}`,
        output: default_value,
      });
    }
  }
}
