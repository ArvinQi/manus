/**
 * 字符串替换编辑工具
 * 用于文本内容的模式匹配和替换
 */

import { BaseTool, ToolResult } from './base.js';
import { Logger } from '../utils/logger.js';

/**
 * 字符串替换编辑工具
 * 提供文本内容的模式匹配和替换功能
 */
export class StrReplaceEditorTool extends BaseTool {
  private logger = new Logger('StrReplaceEditorTool');

  constructor() {
    super({
      name: 'str_replace_editor',
      description: '对文本内容进行模式匹配和替换',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: '要编辑的文本内容',
          },
          pattern: {
            type: 'string',
            description: '要匹配的模式（字符串或正则表达式）',
          },
          replacement: {
            type: 'string',
            description: '替换内容',
          },
          global: {
            type: 'boolean',
            description: '是否全局替换（默认为true）',
            default: true,
          },
          case_sensitive: {
            type: 'boolean',
            description: '是否区分大小写（默认为true）',
            default: true,
          },
          use_regex: {
            type: 'boolean',
            description: '是否使用正则表达式（默认为false）',
            default: false,
          },
        },
        required: ['content', 'pattern', 'replacement'],
      },
    });
  }

  /**
   * 执行字符串替换编辑工具
   * @param args 工具参数
   * @returns 替换后的文本内容
   */
  async run(args: {
    content: string;
    pattern: string;
    replacement: string;
    global?: boolean;
    case_sensitive?: boolean;
    use_regex?: boolean;
  }): Promise<ToolResult> {
    const {
      content,
      pattern,
      replacement,
      global = true,
      case_sensitive = true,
      use_regex = false,
    } = args;

    try {
      this.logger.info(`执行字符串替换: 模式=${pattern}, 替换=${replacement}`);

      let result: string;
      let matchCount = 0;

      if (use_regex) {
        // 使用正则表达式替换
        const flags = [global ? 'g' : '', !case_sensitive ? 'i' : ''].filter(Boolean).join('');

        const regex = new RegExp(pattern, flags);
        const originalContent = content;
        result = content.replace(regex, replacement);

        // 计算匹配次数
        const matches = originalContent.match(regex);
        matchCount = matches ? matches.length : 0;
      } else {
        // 使用字符串替换
        if (global) {
          // 全局替换
          let tempContent = content;
          const searchPattern = case_sensitive ? pattern : pattern.toLowerCase();
          let lastIndex = 0;
          result = '';

          while (true) {
            let index;
            if (case_sensitive) {
              index = tempContent.indexOf(searchPattern, lastIndex);
            } else {
              index = tempContent.toLowerCase().indexOf(searchPattern, lastIndex);
            }

            if (index === -1) break;

            result += tempContent.substring(lastIndex, index) + replacement;
            lastIndex = index + pattern.length;
            matchCount++;
          }

          result += tempContent.substring(lastIndex);
        } else {
          // 替换第一次出现
          if (case_sensitive) {
            const index = content.indexOf(pattern);
            if (index !== -1) {
              result =
                content.substring(0, index) +
                replacement +
                content.substring(index + pattern.length);
              matchCount = 1;
            } else {
              result = content;
            }
          } else {
            const lowerContent = content.toLowerCase();
            const lowerPattern = pattern.toLowerCase();
            const index = lowerContent.indexOf(lowerPattern);
            if (index !== -1) {
              result =
                content.substring(0, index) +
                replacement +
                content.substring(index + pattern.length);
              matchCount = 1;
            } else {
              result = content;
            }
          }
        }
      }

      return new ToolResult({
        output: {
          result,
          matchCount,
          replaced: matchCount > 0,
        },
      });
    } catch (error) {
      this.logger.error(`字符串替换失败: ${error}`);
      return new ToolResult({ error: `字符串替换失败: ${error}` });
    }
  }
}
