/**
 * 基础代理抽象类
 * 提供代理状态管理、内存管理和执行循环的基础功能
 */

import { Logger } from '../utils/logger.js';
import { AgentState, Memory, Message, Role } from '../schema/index.js';
import { Mem0MemoryManager, MemoryConfig } from '../core/mem0_memory_manager.js';
import { config } from '../utils/config.js';

export abstract class BaseAgent {
  // 核心属性
  name: string;
  description?: string;

  // 提示词
  systemPrompt?: string;
  nextStepPrompt?: string;

  // 依赖
  memory: Memory;
  state: AgentState;
  memoryManager?: Mem0MemoryManager;

  // 执行控制
  maxSteps: number;
  currentStep: number;
  duplicateThreshold: number;

  protected logger: Logger;

  constructor(options: {
    name: string;
    description?: string;
    systemPrompt?: string;
    nextStepPrompt?: string;
    maxSteps?: number;
    memoryConfig?: MemoryConfig;
    userId?: string;
  }) {
    this.name = options.name;
    this.description = options.description;
    this.systemPrompt = options.systemPrompt;
    this.nextStepPrompt = options.nextStepPrompt;
    this.maxSteps = options.maxSteps || 10;
    this.currentStep = 0;
    this.duplicateThreshold = 2;
    this.memory = new Memory();
    this.state = AgentState.IDLE;
    this.logger = new Logger(this.name);

    // 获取记忆配置（优先使用传入的配置，否则从配置文件读取）
    const finalMemoryConfig = options.memoryConfig || config.getMemoryConfig();

    // 初始化记忆管理器（如果配置启用）
    if (finalMemoryConfig.enabled) {
      try {
        this.memoryManager = new Mem0MemoryManager(finalMemoryConfig, options.userId);
        this.logger.info(`${this.name} initialized with memory management`);
      } catch (error) {
        this.logger.error(`Failed to initialize memory manager for ${this.name}: ${error}`);
      }
    }
  }

  /**
   * 获取记忆管理器
   */
  getMemoryManager(): Mem0MemoryManager | undefined {
    return this.memoryManager;
  }

  /**
   * 设置记忆管理器
   */
  setMemoryManager(memoryManager: Mem0MemoryManager): void {
    this.memoryManager = memoryManager;
    this.logger.info(`Memory manager updated for ${this.name}`);
  }

  /**
   * 检查是否启用了记忆管理
   */
  isMemoryEnabled(): boolean {
    return this.memoryManager?.isEnabled() || false;
  }

  /**
   * 安全地转换代理状态
   * @param newState 要转换到的新状态
   * @param callback 在新状态下执行的回调函数
   */
  protected async withState<T>(newState: AgentState, callback: () => Promise<T>): Promise<T> {
    if (typeof newState !== 'number') {
      throw new Error(`无效的状态: ${newState}`);
    }

    const previousState = this.state;
    this.state = newState;

    try {
      return await callback();
    } finally {
      this.state = previousState;
    }
  }

  /**
   * 添加消息到内存，支持Base64图像
   * @param role 角色
   * @param content 内容
   * @param options 可选参数
   */
  updateMemory(
    role: Role,
    content: string,
    options?: { base64Image?: string; [key: string]: any }
  ): void {
    const message = new Message({ role, content, ...options });
    this.memory.addMessage(message);
  }

  /**
   * 确保工具调用配对完整性
   * 每个 tool_use 必须有对应的 tool_result
   */
  private ensureToolCallIntegrity(messages: Message[]): Message[] {
    const result: Message[] = [];
    const addedToolResults = new Set<string>();

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      result.push(message);

      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCallIds = message.tool_calls.map((call) => call.id);

        for (let j = i + 1; j < messages.length; j++) {
          const nextMessage = messages[j];

          if (
            nextMessage.tool_call_id &&
            toolCallIds.includes(nextMessage.tool_call_id) &&
            !addedToolResults.has(nextMessage.tool_call_id)
          ) {
            if (!result.includes(nextMessage)) {
              result.push(nextMessage);
              addedToolResults.add(nextMessage.tool_call_id);
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * 验证工具调用完整性
   * 确保工具调用和工具结果正确配对，防止API错误
   */
  private validateToolCallCompleteness(messages: Message[]): Message[] {
    const result: Message[] = [];
    const validToolCallIds = new Set<string>();
    const processedToolResults = new Set<string>();

    // 第一遍：收集所有有效的工具调用ID
    for (const message of messages) {
      if (message.tool_calls && message.tool_calls.length > 0) {
        message.tool_calls.forEach((call) => {
          validToolCallIds.add(call.id);
        });
      }
    }

    // 第二遍：构建结果，确保配对正确
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      // 处理工具结果消息
      if (message.tool_call_id) {
        // 检查是否有对应的工具调用
        if (!validToolCallIds.has(message.tool_call_id)) {
          this.logger.warn(
            `Removing orphaned tool result: ${message.tool_call_id} (no matching tool call)`
          );
          continue;
        }

        // 检查是否已经处理过
        if (processedToolResults.has(message.tool_call_id)) {
          this.logger.warn(`Removing duplicate tool result: ${message.tool_call_id}`);
          continue;
        }

        processedToolResults.add(message.tool_call_id);
        result.push(message);
        continue;
      }

      // 处理工具调用消息
      if (message.tool_calls && message.tool_calls.length > 0) {
        const validToolCalls = message.tool_calls.filter((call) => {
          // 确保工具调用ID是有效的
          return call.id && call.function && call.function.name;
        });

        if (validToolCalls.length === 0) {
          // 所有工具调用都无效，只保留内容
          if (message.content) {
            result.push(
              new Message({
                role: message.role,
                content: message.content,
              })
            );
          }
          continue;
        }

        // 检查这些工具调用是否都有对应的结果
        const toolCallIds = validToolCalls.map((call) => call.id);
        const hasAllResults = toolCallIds.every((id) =>
          messages.some((msg) => msg.tool_call_id === id)
        );

        if (hasAllResults) {
          // 所有工具调用都有结果，保留消息
          if (validToolCalls.length < (message.tool_calls?.length || 0)) {
            // 有些工具调用被过滤掉了，创建新消息
            result.push(
              new Message({
                role: message.role,
                content: message.content,
                tool_calls: validToolCalls,
              })
            );
          } else {
            result.push(message);
          }
        } else {
          // 有些工具调用没有结果，移除整个工具调用消息
          this.logger.warn(
            `Removing incomplete tool calls: ${toolCallIds.join(', ')} (missing results)`
          );
          if (message.content) {
            result.push(
              new Message({
                role: message.role,
                content: message.content,
              })
            );
          }
        }
      } else {
        // 普通消息，直接添加
        result.push(message);
      }
    }

    // 验证最终结果的配对完整性
    const finalValidation = this.validateMessagePairs(result);
    if (finalValidation.length !== result.length) {
      this.logger.warn(
        `Final validation removed ${result.length - finalValidation.length} messages`
      );
    }

    return finalValidation;
  }

  /**
   * 最终验证消息配对
   * 确保没有孤立的工具结果
   */
  private validateMessagePairs(messages: Message[]): Message[] {
    const result: Message[] = [];
    const availableToolCalls = new Map<string, Message>();

    for (const message of messages) {
      if (message.tool_calls && message.tool_calls.length > 0) {
        // 记录可用的工具调用
        message.tool_calls.forEach((call) => {
          availableToolCalls.set(call.id, message);
        });
        result.push(message);
      } else if (message.tool_call_id) {
        // 检查工具结果是否有对应的工具调用
        if (availableToolCalls.has(message.tool_call_id)) {
          result.push(message);
        } else {
          this.logger.warn(`Final check: removing orphaned tool result ${message.tool_call_id}`);
        }
      } else {
        // 普通消息
        result.push(message);
      }
    }

    return result;
  }

  /**
   * 获取上下文消息
   * 使用Mem0记忆管理器获取相关上下文，否则返回所有消息
   */
  async getContextualMessages(currentQuery?: string): Promise<Message[]> {
    try {
      const allMessages = this.memory.messages;
      let contextualMessages: Message[] = [];

      // 优先使用 Mem0 记忆管理器获取相关上下文
      if (this.memoryManager?.isEnabled()) {
        try {
          const query = currentQuery || this.extractCurrentQuery();
          contextualMessages = await this.memoryManager.getRelevantContext(query, allMessages);
          this.logger.debug(
            `Mem0MemoryManager returned ${contextualMessages.length} contextual messages`
          );
        } catch (error) {
          this.logger.error(`Mem0MemoryManager failed: ${error}`);
          contextualMessages = [];
        }
      }

      // 回退到原始消息
      if (contextualMessages.length === 0) {
        this.logger.debug(`Using original messages: ${allMessages.length} messages`);
        contextualMessages = allMessages;
      }

      // 确保工具调用完整性
      let processedMessages = this.ensureToolCallIntegrity(contextualMessages);
      processedMessages = this.validateToolCallCompleteness(processedMessages);

      this.logger.debug(
        `Final contextual messages: ${processedMessages.length} (after tool call validation)`
      );
      return processedMessages;
    } catch (error) {
      this.logger.error(`Failed to get contextual messages: ${error}`);
      return this.memory.messages;
    }
  }

  /**
   * 保存对话到记忆系统
   */
  async saveConversationToMemory(
    messages: Message[],
    response: { content?: string | null; tool_calls?: any[]; usage?: any }
  ): Promise<void> {
    try {
      const conversationToSave = [...messages];

      // 添加助手的回复到对话记录
      if (response.content || response.tool_calls) {
        conversationToSave.push(
          new Message({
            role: Role.ASSISTANT,
            content: response.content || null,
            tool_calls: response.tool_calls,
          })
        );
      }

      const metadata = {
        timestamp: new Date().toISOString(),
        agent: this.name,
        usage: response.usage,
      };

      // 保存到 Mem0 记忆管理器
      if (this.memoryManager?.isEnabled()) {
        await this.memoryManager.addConversation(conversationToSave, metadata);
      }

      this.logger.debug(`Saved ${conversationToSave.length} messages to memory systems`);
    } catch (error) {
      this.logger.error(`Failed to save conversation to memory: ${error}`);
    }
  }

  /**
   * 从当前消息中提取查询
   * 智能提取当前执行上下文的查询，考虑任务状态、最近对话和执行进度
   */
  protected extractCurrentQuery(): string {
    // 1. 首先尝试从最近的助手消息中提取当前关注点
    const recentMessages = this.memory.messages.slice(-10);

    // 2. 寻找最近的任务或工具相关内容
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const msg = recentMessages[i];

      // 如果是助手消息且包含明确的任务描述
      if (msg.role === Role.ASSISTANT && msg.content) {
        const content = msg.content;

        // 检查是否包含当前执行的任务或步骤信息
        const taskIndicators = [
          '正在执行',
          '当前任务',
          '下一步',
          '现在需要',
          '接下来',
          '准备',
          '开始',
        ];

        for (const indicator of taskIndicators) {
          if (content.includes(indicator)) {
            // 提取任务相关的句子
            const sentences = content.split(/[.。!！\n]/);
            for (const sentence of sentences) {
              if (sentence.includes(indicator) && sentence.trim().length > 10) {
                return sentence.trim();
              }
            }
          }
        }
      }

      // 如果是工具调用，提取工具相关的查询
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const toolCall = msg.tool_calls[0];
        const toolName = toolCall.function.name;

        try {
          const args = JSON.parse(toolCall.function.arguments || '{}');

          // 根据不同工具类型提取相关查询
          if (toolName.includes('search') || toolName.includes('Search')) {
            return args.query || args.q || args.search_term || `搜索相关信息`;
          } else if (toolName.includes('file') || toolName.includes('File')) {
            return args.path ? `处理文件: ${args.path}` : '文件操作';
          } else if (toolName.includes('browser') || toolName.includes('Browser')) {
            return args.url ? `浏览: ${args.url}` : '浏览器操作';
          } else {
            return `使用${toolName}工具`;
          }
        } catch (error) {
          return `使用${toolName}工具`;
        }
      }
    }

    // 3. 回退到分析最近的用户消息，但优先考虑最新的
    const userMessages = this.memory.messages.filter((msg) => msg.role === Role.USER);
    if (userMessages.length > 0) {
      const lastUserMessage = userMessages[userMessages.length - 1];
      const content = lastUserMessage.content || '';

      // 如果最后的用户消息很短（可能是简单回复），尝试找更有意义的消息
      if (content.length < 20) {
        for (let i = userMessages.length - 2; i >= Math.max(0, userMessages.length - 5); i--) {
          const prevMsg = userMessages[i];
          if (prevMsg.content && prevMsg.content.length > 20) {
            return prevMsg.content;
          }
        }
      }

      return content;
    }

    // 4. 最后的兜底方案
    return '继续执行当前任务';
  }

  /**
   * 执行代理的主循环
   */
  async run(request?: string): Promise<string> {
    this.state = AgentState.RUNNING;
    this.currentStep = 0;

    if (request) {
      this.updateMemory(Role.USER, request);
    }

    this.logger.info(`🚀 ${this.name} 开始执行任务${request ? `: ${request}` : ''}`);

    try {
      while (this.state === AgentState.RUNNING && this.currentStep < this.maxSteps) {
        this.currentStep++;
        this.logger.info(`⚡ ${this.name} 执行第 ${this.currentStep} 步`);

        const stepResult = await this.step();

        if (this.isStuck()) {
          this.handleStuckState();
          break;
        }
      }

      this.state = AgentState.FINISHED;
      const finalMessage = this.messages[this.messages.length - 1];
      return finalMessage?.content || '任务执行完成';
    } catch (error) {
      this.state = AgentState.ERROR;
      this.logger.error(`💥 ${this.name} 执行出错: ${error}`);
      throw error;
    }
  }

  /**
   * 执行一个步骤 - 由子类实现
   */
  abstract step(): Promise<string>;

  /**
   * 处理陷入循环的状态
   */
  protected handleStuckState(): void {
    this.logger.warn(`⚠️ ${this.name} 可能陷入循环，停止执行`);
    this.state = AgentState.FINISHED;
  }

  /**
   * 检查是否陷入循环
   */
  protected isStuck(): boolean {
    if (this.messages.length < this.duplicateThreshold * 2) {
      return false;
    }

    const recentMessages = this.messages.slice(-this.duplicateThreshold * 2);
    const firstHalf = recentMessages.slice(0, this.duplicateThreshold);
    const secondHalf = recentMessages.slice(this.duplicateThreshold);

    for (let i = 0; i < this.duplicateThreshold; i++) {
      if (
        firstHalf[i].role !== secondHalf[i].role ||
        firstHalf[i].content !== secondHalf[i].content
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    this.logger.info(`🧹 ${this.name} 清理资源中...`);
    this.state = AgentState.IDLE;
  }

  /**
   * 获取消息列表
   */
  get messages(): Message[] {
    return this.memory.messages;
  }

  /**
   * 设置消息列表
   */
  set messages(value: Message[]) {
    this.memory.messages = value;
  }
}
