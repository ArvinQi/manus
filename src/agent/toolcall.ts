/**
 * ToolCallAgent 类
 * 实现工具调用功能的代理
 */

import { ReActAgent } from './react.js';
import { AgentState, Message, Role, ToolCall, ToolChoice } from '../schema/index.js';
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

  // 已处理的工具调用ID集合，用于防止重复处理
  private processedToolCallIds: Set<string> = new Set();

  // 当前 base64 图像
  private _currentBase64Image?: string;

  // 消息摘要相关属性
  private _maxMessagesBeforeSummary: number = 8; // 触发摘要的消息数量阈值
  private _originalMessages: Message[] = []; // 存储原始消息的备份

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
    maxMessagesBeforeSummary?: number; // 触发消息摘要的阈值
  }) {
    super(options);

    this.availableTools = options.tools || new ToolCollection();
    this.toolChoice = options.toolChoice || ToolChoice.AUTO;
    this.specialToolNames = options.specialToolNames || [];
    this.toolCalls = [];

    // 初始化消息摘要相关配置
    if (options.maxMessagesBeforeSummary !== undefined) {
      this._maxMessagesBeforeSummary = options.maxMessagesBeforeSummary;
    }
  }

  /**
   * 思考过程
   * 处理当前状态并使用工具决定下一步行动
   */
  /**
   * 对消息进行摘要处理
   * 当消息数量超过阈值时，将较早的消息进行摘要处理以减少token使用量
   */
  /**
   * 检测重复的用户消息
   * 识别并过滤掉常见的重复提示，如"请思考下一步应该做什么"
   * @param messages 需要处理的消息数组
   * @returns 去除重复后的消息数组
   */
  private filterDuplicateMessages(messages: Message[]): Message[] {
    // 常见的重复提示模式
    const commonPrompts = [
      '请思考下一步应该做什么',
      '请思考下一步',
      '请继续',
      '请使用适当的工具',
      '请使用工具完成任务',
    ];

    // 记录已经出现过的用户消息内容
    const seenUserContents = new Set<string>();

    return messages.filter((msg) => {
      // 只处理用户消息
      if (msg.role !== 'user') return true;

      const content = msg.content || '';

      // 检查是否是常见提示
      const isCommonPrompt = commonPrompts.some((prompt) => content.includes(prompt));

      // 如果是常见提示，检查是否已经出现过
      if (isCommonPrompt) {
        if (seenUserContents.has(content)) {
          this.logger.info(
            `🔍 过滤掉重复的用户提示: "${content.substring(0, 30)}${content.length > 30 ? '...' : ''}"`
          );
          return false; // 过滤掉重复的常见提示
        }
        seenUserContents.add(content);
      }

      return true;
    });
  }

  /**
   * 压缩大型消息内容
   * 对较长的消息内容使用AI提取关键信息
   * @param content 原始内容
   * @param maxLength 最大长度阈值
   * @returns 压缩后的内容
   */
  private compressMessageContent(content: string, maxLength: number): string {
    if (!content || content.length <= maxLength) return content;

    // 对于非常长的内容，进行更智能的压缩
    if (content.length > maxLength * 3) {
      // 提取开头和结尾的部分内容
      const headPart = content.substring(0, maxLength / 2);
      const tailPart = content.substring(content.length - maxLength / 2);

      // 添加中间省略的提示
      return `${headPart}\n... [内容过长，已省略${content.length - maxLength}个字符] ...\n${tailPart}`;
    }

    // 对于中等长度的内容，简单截断
    return content.substring(0, maxLength) + '...';
  }

  private summarizeMessages(): void {
    if (this.messages.length <= this._maxMessagesBeforeSummary) {
      return; // 消息数量未达到阈值，不需要摘要
    }

    // 如果已经有原始消息备份，说明已经进行过摘要，不需要重复备份
    if (this._originalMessages.length === 0) {
      // 备份原始消息
      this._originalMessages = [...this.messages];
    }

    // 保留最近的消息（最后N条，N为阈值）
    const recentMessages = this.messages.slice(-this._maxMessagesBeforeSummary);

    // 对较早的消息进行摘要
    let olderMessages = this.messages.slice(0, -this._maxMessagesBeforeSummary);

    // 过滤掉重复的用户提示消息
    olderMessages = this.filterDuplicateMessages(olderMessages);

    // *** 关键修复：确保工具调用和结果的配对完整性 ***
    // 移除所有孤立的工具调用或工具结果，防止Claude API错误
    olderMessages = this.removeUnpairedToolMessages(olderMessages);

    // 如果较早的消息中已经包含摘要消息（以系统消息形式），则需要特殊处理
    const existingSummaryIndex = olderMessages.findIndex(
      (msg) => msg.role === 'system' && msg.content && msg.content.startsWith('以下是之前')
    );

    // 创建摘要消息
    let summaryContent = '';

    if (existingSummaryIndex >= 0) {
      // 如果已经有摘要，则合并摘要
      const otherMessages = olderMessages.filter((_, index) => index !== existingSummaryIndex);
      summaryContent =
        `以下是之前 ${this._originalMessages.length - this._maxMessagesBeforeSummary} 条消息的摘要：\n` +
        otherMessages
          .map((msg) => {
            let content = msg.content || '';
            // 使用智能压缩处理内容
            content = this.compressMessageContent(content, 100);
            return `- ${msg.role}: ${content}`;
          })
          .join('\n');
    } else {
      // 创建新的摘要
      summaryContent =
        `以下是之前 ${olderMessages.length} 条消息的摘要：\n` +
        olderMessages
          .map((msg) => {
            let content = msg.content || '';
            // 使用智能压缩处理内容
            content = this.compressMessageContent(content, 150);

            // *** 修复：移除工具调用相关的特殊处理，因为已经过滤掉了 ***
            // 只保留普通消息内容的摘要
            return `- ${msg.role}: ${content}`;
          })
          .join('\n');
    }

    const summaryMessage = Message.systemMessage(summaryContent);

    // 更新消息列表，用摘要替换较早的消息
    this.messages = [summaryMessage, ...recentMessages];

    this.logger.info(
      `🔄 消息已摘要处理：${olderMessages.length} 条消息被摘要为 1 条，保留最近 ${recentMessages.length} 条消息`
    );
  }

  /**
   * 移除不完整的工具调用消息对，防止Claude API错误
   * Claude API要求每个toolUse都必须有对应的toolResult
   */
  private removeUnpairedToolMessages(messages: Message[]): Message[] {
    const result: Message[] = [];
    const toolCallIds = new Set<string>();
    const toolResultIds = new Set<string>();

    // 第一遍：收集所有工具调用ID和工具结果ID
    for (const message of messages) {
      if (message.tool_calls && message.tool_calls.length > 0) {
        message.tool_calls.forEach((call) => {
          toolCallIds.add(call.id);
        });
      }
      if (message.tool_call_id) {
        toolResultIds.add(message.tool_call_id);
      }
    }

    // 第二遍：只保留有完整配对的工具调用消息
    for (const message of messages) {
      if (message.tool_calls && message.tool_calls.length > 0) {
        // 检查工具调用是否都有对应的结果
        const completePairs = message.tool_calls.filter((call) => toolResultIds.has(call.id));

        if (completePairs.length === message.tool_calls.length) {
          // 所有工具调用都有对应结果，保留原消息
          result.push(message);
        } else if (completePairs.length > 0) {
          // 部分工具调用有结果，创建新消息只包含完整的配对
          result.push(
            new Message({
              role: message.role,
              content: message.content,
              tool_calls: completePairs,
            })
          );
        } else {
          // 没有完整配对，只保留文本内容
          if (message.content) {
            result.push(
              new Message({
                role: message.role,
                content: message.content,
              })
            );
          }
        }
      } else if (message.tool_call_id) {
        // 工具结果消息：只保留有对应工具调用的结果
        if (toolCallIds.has(message.tool_call_id)) {
          result.push(message);
        }
        // 否则跳过孤立的工具结果
      } else {
        // 普通消息，直接保留
        result.push(message);
      }
    }

    this.logger.debug(`工具消息配对验证：原始${messages.length}条，过滤后${result.length}条消息`);

    return result;
  }

  /**
   * 恢复原始消息
   * 在需要时可以恢复完整的消息历史
   */
  /**
   * 恢复原始消息
   * 在需要时可以恢复完整的消息历史，并清空原始消息备份
   * @returns 是否成功恢复原始消息
   */
  recallOriginalMessages(): boolean {
    if (this._originalMessages.length > 0) {
      this.messages = [...this._originalMessages];
      this.logger.info(`🔄 已恢复原始消息历史（${this.messages.length} 条消息）`);
      // 清空原始消息备份，防止重复恢复
      this._originalMessages = [];
      return true;
    }
    this.logger.warn('⚠️ 没有可恢复的原始消息历史');
    return false;
  }

  async think(): Promise<boolean> {
    // 在发送请求前对消息进行摘要处理
    // this.summarizeMessages();

    // 如果有下一步提示，添加用户消息
    if (this.nextStepPrompt) {
      const userMsg = Message.userMessage(this.nextStepPrompt);
      this.messages.push(userMsg);
    }

    try {
      // 获取当前查询用于上下文获取
      const currentQuery = this.extractCurrentQuery();

      // 添加调试日志来跟踪currentQuery的变化
      this.logger.debug(`当前查询提取: "${currentQuery.slice(0, 100)}"`);

      // 使用Agent的智能上下文管理获取相关消息
      const contextualMessages = await this.getContextualMessages(currentQuery);

      // 打印LLM调用前的信息
      this.logger.info(`🤔 ${this.name} 开始思考过程`);
      this.logger.info(`📚 上下文消息数量: ${contextualMessages.length}`);
      this.logger.info(`🛠️ 可用工具数量: ${this.availableTools.toParams().length}`);
      this.logger.info(`🎯 工具选择模式: ${this.toolChoice}`);

      // 获取带工具选项的响应
      const response = await this.llm.askTool({
        messages: contextualMessages,
        systemMsgs: this.systemPrompt ? [Message.systemMessage(this.systemPrompt)] : undefined,
        tools: this.availableTools.toParams(),
        toolChoice: this.toolChoice,
        currentQuery: currentQuery,
      });

      // 保存对话到记忆系统
      await this.saveConversationToMemory(contextualMessages, response);

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
            this.logger.warn(`🤔 嗯，${this.name} 尝试使用不可用的工具！`);
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
   * 清除已处理的工具调用ID
   */
  clearProcessedToolCalls(): void {
    this.processedToolCallIds.clear();
    this.logger.debug('Cleared processed tool call IDs');
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

    // 在开始执行前，先清理重复的工具调用
    const uniqueToolCalls = this.removeDuplicateToolCalls(this.toolCalls);
    if (uniqueToolCalls.length !== this.toolCalls.length) {
      this.logger.warn(
        `检测到重复工具调用，已移除 ${this.toolCalls.length - uniqueToolCalls.length} 个重复调用`
      );
      this.toolCalls = uniqueToolCalls;
    }

    const results: string[] = [];
    for (const command of this.toolCalls) {
      // 检查是否已经处理过这个工具调用
      if (this.processedToolCallIds.has(command.id)) {
        this.logger.warn(`Skipping already processed tool call: ${command.id}`);
        continue;
      }

      // 检查是否在消息历史中已经执行过相同的工具调用
      // if (this.isToolCallAlreadyExecuted(command)) {
      //   this.logger.warn(
      //     `Tool call already executed in history: ${command.id} (${command.function.name})`
      //   );
      //   this.processedToolCallIds.add(command.id);
      //   continue;
      // }

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

      this.logger.info(`💾 保存工具调用结果到内存: ${command.id} (${command.function.name})`);
      this.memory.addMessage(toolMsg);

      // 验证工具调用结果是否正确保存
      const savedMessages = this.memory.messages;
      const toolResultExists = savedMessages.some(
        (msg) => msg.tool_call_id === command.id && msg.role === Role.TOOL
      );

      if (!toolResultExists) {
        this.logger.error(`❌ 工具调用结果未正确保存到内存: ${command.id}`);
      } else {
        this.logger.info(`✅ 工具调用结果已正确保存到内存: ${command.id}`);
      }

      // 标记这个工具调用已被处理
      this.processedToolCallIds.add(command.id);

      // 如果存在原始消息备份，也更新原始消息历史
      // 这确保了在摘要处理后，原始消息历史仍然包含完整的对话
      if (this._originalMessages.length > 0) {
        this._originalMessages.push(toolMsg);
      }

      results.push(result);
    }

    // 检查消息数量是否接近阈值，如果是，提前进行摘要处理
    // 这有助于在长对话中更积极地控制token使用量
    // if (this.messages.length >= this._maxMessagesBeforeSummary * 2) {
    //   this.logger.info(`📝 消息数量(${this.messages.length})已达到阈值的两倍，主动进行摘要处理`);
    //   this.summarizeMessages();
    // }

    return results.join('\n\n');
  }

  /**
   * 移除重复的工具调用
   * 基于工具名称和参数来判断是否重复
   */
  private removeDuplicateToolCalls(toolCalls: ToolCall[]): ToolCall[] {
    const seen = new Set<string>();
    const unique: ToolCall[] = [];

    for (const call of toolCalls) {
      // 创建工具调用的唯一标识
      const signature = `${call.function.name}:${call.function.arguments}`;

      if (!seen.has(signature)) {
        seen.add(signature);
        unique.push(call);
      } else {
        this.logger.warn(`Removing duplicate tool call: ${call.function.name} with same arguments`);
      }
    }

    return unique;
  }

  /**
   * 检查工具调用是否已经在消息历史中执行过
   */
  private isToolCallAlreadyExecuted(command: ToolCall): boolean {
    // 检查消息历史中是否已经有相同的工具调用结果
    for (const message of this.messages) {
      if (message.tool_call_id === command.id) {
        return true;
      }

      // 检查是否有相同工具名称和参数的工具结果
      if (message.name === command.function.name && message.content) {
        // 这里可以添加更复杂的参数比较逻辑
        return true;
      }
    }

    return false;
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

  /**
   * 重写清理方法，清除处理过的工具调用ID
   */
  async cleanup(): Promise<void> {
    await super.cleanup();
    this.clearProcessedToolCalls();
  }
}
