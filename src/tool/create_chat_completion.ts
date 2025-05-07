/**
 * 聊天完成工具
 * 用于创建结构化的聊天完成
 */

import { BaseTool, ToolResult } from './base.js';
import { Logger } from '../utils/logger.js';

/**
 * 聊天完成工具
 * 用于创建结构化的聊天完成，支持不同的响应类型
 */
export class CreateChatCompletionTool extends BaseTool {
  private logger = new Logger('CreateChatCompletionTool');
  private responseType: string;
  private required: string[];

  constructor(responseType: string = 'string', required: string[] = ['response']) {
    super({
      name: 'create_chat_completion',
      description: '创建结构化的聊天完成，支持指定输出格式',
      parameters: {}, // 将在初始化后设置
    });

    this.responseType = responseType;
    this.required = required;
    this.parameters = this.buildParameters();
  }

  /**
   * 构建参数架构
   */
  private buildParameters(): Record<string, any> {
    // 基于响应类型构建参数架构
    if (this.responseType === 'string') {
      return {
        type: 'object',
        properties: {
          response: {
            type: 'string',
            description: '应该传递给用户的响应文本',
          },
        },
        required: this.required,
      };
    }

    // 对于其他类型，可以扩展此方法
    // 这里是一个简化版本，实际实现可能需要更复杂的类型处理
    return {
      type: 'object',
      properties: {
        response: {
          type: this.mapTypeToJsonSchema(this.responseType),
          description: `类型为 ${this.responseType} 的响应`,
        },
      },
      required: this.required,
    };
  }

  /**
   * 将TypeScript类型映射到JSON Schema类型
   */
  private mapTypeToJsonSchema(type: string): string {
    const typeMapping: Record<string, string> = {
      string: 'string',
      number: 'number',
      boolean: 'boolean',
      object: 'object',
      array: 'array',
    };

    return typeMapping[type] || 'string';
  }

  /**
   * 执行聊天完成工具
   * @param args 工具参数
   * @returns 格式化的响应
   */
  async run(args: Record<string, any>): Promise<ToolResult> {
    try {
      // 处理必需字段
      if (this.required.length === 1) {
        const requiredField = this.required[0];
        const result = args[requiredField] || '';
        this.logger.info(`生成聊天完成: ${result}`);
        return new ToolResult({ output: result });
      } else {
        // 处理多个必需字段
        const result: Record<string, any> = {};
        for (const field of this.required) {
          result[field] = args[field] || '';
        }
        this.logger.info(`生成结构化聊天完成`);
        return new ToolResult({ output: result });
      }
    } catch (error) {
      this.logger.error(`生成聊天完成失败: ${error}`);
      return new ToolResult({ error: `生成聊天完成失败: ${error}` });
    }
  }
}
