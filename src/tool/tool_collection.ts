/**
 * 工具集合类
 * 用于管理多个工具
 */

import { BaseTool, ToolResult } from './base.js';
import { Logger } from '../utils/logger.js';
import { AskHumanTool } from './ask_human.js';
import { CreateChatCompletionTool } from './create_chat_completion.js';
import { FileOperatorsTool } from './file_operators.js';
import { PlanningTool } from './planning.js';
import { StrReplaceEditorTool } from './str_replace_editor.js';
import { BashTool } from './bash.js';
import { SystemInfoTool } from './system_info.js';
import { Terminate } from './terminate.js';

/**
 * 工具集合类
 * 管理多个工具，提供工具查找和执行功能
 */
export class ToolCollection {
  tools: BaseTool[];
  toolMap: Record<string, BaseTool>;
  private logger: Logger;

  constructor(...tools: BaseTool[]) {
    // 创建默认工具
    const defaultTools = [
      new AskHumanTool(),
      new CreateChatCompletionTool(),
      new FileOperatorsTool(),
      new PlanningTool(),
      new StrReplaceEditorTool(),
      new BashTool(),
      new SystemInfoTool(),
      new Terminate(),
    ];

    // 合并默认工具和传入的工具
    this.tools = [...defaultTools, ...tools];
    this.toolMap = {};
    this.logger = new Logger('ToolCollection');

    // 初始化工具映射
    for (const tool of this.tools) {
      this.toolMap[tool.name] = tool;
    }
  }

  /**
   * 迭代器方法，允许使用 for...of 循环遍历工具
   */
  [Symbol.iterator]() {
    return this.tools[Symbol.iterator]();
  }

  /**
   * 转换工具集合为参数格式
   */
  toParams(): Record<string, unknown>[] {
    return this.tools.map((tool) => tool.toParam());
  }

  /**
   * 执行单个工具
   * @param name 工具名称
   * @param args 工具参数
   */
  async execute(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const tool = this.getTool(name);
    if (!tool) {
      return new ToolResult({
        error: `工具 ${name} 不存在`,
      });
    }

    return await tool.run(args);
  }

  /**
   * 顺序执行所有工具
   * @param toolCalls 工具调用列表
   */
  async executeAll(
    toolCalls: { name: string; args: Record<string, unknown> }[]
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      const result = await this.execute(call.name, call.args);
      results.push(result);
    }
    return results;
  }

  /**
   * 获取指定名称的工具
   * @param name 工具名称
   */
  getTool(name: string): BaseTool | undefined {
    return this.toolMap[name];
  }

  /**
   * 添加单个工具到集合
   * @param tool 要添加的工具
   */
  addTool(tool: BaseTool): this {
    if (this.toolMap[tool.name]) {
      this.logger.warning(`工具 ${tool.name} 已存在于集合中，跳过`);
      return this;
    }

    this.tools.push(tool);
    this.toolMap[tool.name] = tool;
    return this;
  }

  /**
   * 添加多个工具到集合
   * @param tools 要添加的工具数组
   */
  addTools(...tools: BaseTool[]): this {
    for (const tool of tools) {
      this.addTool(tool);
    }
    return this;
  }
}
