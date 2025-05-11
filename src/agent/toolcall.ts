/**
 * ToolCallAgent 类
 * 实现工具调用功能的代理
 */

import { ReActAgent } from './react.js';
import { AgentState, Message, ToolCall, ToolChoice } from '../schema/index.js';
import { ToolCollection } from '../tool/tool_collection.js';
import { Logger } from '../utils/logger.js';

// 工具调用错误消息
const TOOL_CALL_REQUIRED = '需要工具调用但未提供';

/**
 * ToolCallAgent 类
 * 处理工具/函数调用的增强抽象代理
 */
export class ToolCallAgent extends ReActAgent {
  // 可用工具集合
  availableTools: ToolCollection;

  // 工具选择模式
  toolChoice: ToolChoice;

  // 特殊工具名称列表
  specialToolNames: string[];

  // 当前工具调用
  toolCalls: ToolCall[];

  // 当前 base64 图像
  private _currentBase64Image?: string;

  constructor(options: {
    name: string;
    description?: string;
    systemPrompt?: string;
    nextStepPrompt?: string;
    maxSteps?: number;
    llmConfigName?: string;
    tools?: ToolCollection;
    toolChoice?: ToolChoice;
    specialToolNames?: string[];
  }) {
    super(options);

    this.availableTools = options.tools || new ToolCollection();
    this.toolChoice = options.toolChoice || ToolChoice.AUTO;
    this.specialToolNames = options.specialToolNames || [];
    this.toolCalls = [];
  }

  /**
   * 思考过程
   * 处理当前状态并使用工具决定下一步行动
   */
  async think(): Promise<boolean> {
    // 如果有下一步提示，添加用户消息
    if (this.nextStepPrompt) {
      const userMsg = Message.userMessage(this.nextStepPrompt);
      this.messages.push(userMsg);
    }

    try {
      // 获取带工具选项的响应
      const response = await this.llm.askTool({
        messages: this.messages,
        systemMsgs: this.systemPrompt ? [Message.systemMessage(this.systemPrompt)] : undefined,
        tools: this.availableTools.toParams(),
        toolChoice: this.toolChoice,
      });

      // 保存工具调用
      this.toolCalls = response.tool_calls || [];
      const content = response.content || '';

      // 记录响应信息
      this.logger.info(`✨ ${this.name} 的思考: ${content}`);
      this.logger.info(`🛠️ ${this.name} 选择了 ${this.toolCalls.length || 0} 个工具使用`);

      if (this.toolCalls.length > 0) {
        this.logger.info(
          `🧰 准备使用的工具: ${this.toolCalls.map((call) => call.function.name).join(', ')}`
        );
        this.logger.info(`🔧 工具参数: ${this.toolCalls[0].function.arguments}`);
      }

      try {
        if (!response) {
          throw new Error('未从 LLM 收到响应');
        }

        // 处理不同的工具选择模式
        if (this.toolChoice === ToolChoice.NONE) {
          if (this.toolCalls.length > 0) {
            this.logger.warning(`🤔 嗯，${this.name} 尝试使用不可用的工具！`);
          }
          if (content) {
            this.memory.addMessage(Message.assistantMessage(content));
            return true;
          }
          return false;
        }

        // 创建并添加助手消息
        const assistantMsg =
          this.toolCalls.length > 0
            ? Message.fromToolCalls({ content, tool_calls: this.toolCalls })
            : Message.assistantMessage(content);

        this.memory.addMessage(assistantMsg);

        if (this.toolChoice === ToolChoice.REQUIRED && this.toolCalls.length === 0) {
          return true; // 将在 act() 中处理
        }

        // 对于 'auto' 模式，如果没有命令但有内容，则继续
        if (this.toolChoice === ToolChoice.AUTO && this.toolCalls.length === 0) {
          return !!content;
        }

        return this.toolCalls.length > 0;
      } catch (error) {
        this.logger.error(`🚨 糟糕！${this.name} 的思考过程遇到了问题: ${error}`);
        this.memory.addMessage(Message.assistantMessage(`处理时遇到错误: ${error}`));
        return false;
      }
    } catch (error) {
      // 检查是否是令牌限制错误
      if (error instanceof Error && error.message.includes('token limit')) {
        this.logger.error(`🚨 令牌限制错误: ${error}`);
        this.memory.addMessage(
          Message.assistantMessage(`达到最大令牌限制，无法继续执行: ${error}`)
        );
        this.state = AgentState.FINISHED;
        return false;
      }
      throw error;
    }
  }

  /**
   * 行动过程
   * 执行工具调用并处理结果
   */
  async act(): Promise<string> {
    if (this.toolCalls.length === 0) {
      if (this.toolChoice === ToolChoice.REQUIRED) {
        throw new Error(TOOL_CALL_REQUIRED);
      }
      // 如果没有工具调用，直接终止执行
      this.state = AgentState.FINISHED;
      this.logger.info(`工具未选择，终止执行`);
      return this.messages[this.messages.length - 1].content || '没有内容或命令可执行';
    }

    const results: string[] = [];
    for (const command of this.toolCalls) {
      // 重置每个工具调用的 base64 图像
      this._currentBase64Image = undefined;

      // 执行工具
      const result = await this.executeToolCall(command);

      this.logger.info(`🎯 工具 '${command.function.name}' 完成了任务！结果: ${result}`);

      // 添加工具响应到内存
      const toolMsg = Message.toolMessage(result, {
        tool_call_id: command.id,
        name: command.function.name,
        base64_image: this._currentBase64Image,
      });

      this.memory.addMessage(toolMsg);
      results.push(result);
    }

    return results.join('\n\n');
  }

  /**
   * 执行单个工具调用
   * @param command 工具调用命令
   */
  // protected async executeToolCall(command: ToolCall): Promise<string>;
  // /**
  //  * 执行单个工具调用（通过工具名称和参数）
  //  * @param toolName 工具名称
  //  * @param args 工具参数
  //  */
  // protected async executeToolCall(toolName: string, args: any): Promise<any>;
  protected async executeToolCall(commandOrName: ToolCall | string, args?: any): Promise<any> {
    let name: string;
    let toolArgs: any;

    // 处理不同的调用方式
    if (typeof commandOrName === 'string') {
      // 直接使用工具名称和参数
      name = commandOrName;
      toolArgs = args || {};
    } else {
      // 使用 ToolCall 对象
      const command = commandOrName;
      if (!command || !command.function || !command.function.name) {
        return '错误: 无效的命令格式';
      }

      name = command.function.name;
      try {
        toolArgs = JSON.parse(command.function.arguments || '{}');
      } catch (error) {
        return `错误: 无法解析工具参数 - ${error}`;
      }
    }

    // 检查工具是否存在
    if (!this.availableTools.toolMap[name]) {
      return `错误: 未知工具 '${name}'`;
    }

    try {
      // 执行工具
      this.logger.info(`🔧 激活工具: '${name}'...`);
      const result = await this.availableTools.execute(name, toolArgs);

      // 处理特殊工具
      await this.handleSpecialTool(name, result);

      // 如果是直接调用（通过工具名称和参数），返回原始结果
      if (typeof commandOrName === 'string') {
        return result;
      }

      // 以下是通过 ToolCall 对象调用的情况

      // 检查结果是否包含 base64 图像
      if (result.base64Image) {
        // 存储 base64 图像以便在工具消息中使用
        this._currentBase64Image = result.base64Image;

        // 格式化结果以便显示
        const observation = result
          ? `观察到执行的命令 \`${name}\` 的输出:\n${result}`
          : `命令 \`${name}\` 完成，没有输出`;

        return observation;
      }

      // 格式化结果以便显示（标准情况）
      const observation = result
        ? `观察到执行的命令 \`${name}\` 的输出:\n${result}`
        : `命令 \`${name}\` 完成，没有输出`;

      return observation;
    } catch (error) {
      this.logger.error(`执行工具 ${name} 时出错: ${error}`);
      return `执行工具 ${name} 时出错: ${error}`;
    }
  }

  /**
   * 处理特殊工具
   * @param name 工具名称
   * @param result 工具结果
   */
  private async handleSpecialTool(name: string, result: any): Promise<void> {
    // 检查是否是特殊工具
    if (this.specialToolNames.includes(name)) {
      // 如果是终止工具，设置状态为已完成
      if (name === 'Terminate') {
        this.state = AgentState.FINISHED;
      }
    }
  }
}
