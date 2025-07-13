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
   * 移除没有配对结果的工具调用，防止API错误
   */
  private validateToolCallCompleteness(messages: Message[]): Message[] {
    const result: Message[] = [];
    const processedToolResults = new Set<string>();
    const processedToolCalls = new Set<string>();

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      if (message.tool_call_id) {
        if (processedToolResults.has(message.tool_call_id)) {
          this.logger.warn(`Removing duplicate tool result: ${message.tool_call_id}`);
          continue;
        }
        processedToolResults.add(message.tool_call_id);
        result.push(message);
        continue;
      }

      if (message.tool_calls && message.tool_calls.length > 0) {
        // Check for duplicate tool calls with same IDs
        const uniqueToolCalls = message.tool_calls.filter((call) => {
          if (processedToolCalls.has(call.id)) {
            this.logger.warn(`Removing duplicate tool call: ${call.id}`);
            return false;
          }
          processedToolCalls.add(call.id);
          return true;
        });

        if (uniqueToolCalls.length === 0) {
          // All tool calls were duplicates, just add content if available
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

        const toolCallIds = uniqueToolCalls.map((call) => call.id);

        const hasMatchingResults = toolCallIds.every((id) =>
          messages.some((msg) => msg.tool_call_id === id)
        );

        if (hasMatchingResults) {
          if (uniqueToolCalls.length < message.tool_calls.length) {
            // Some tool calls were removed, create new message with unique ones
            result.push(
              new Message({
                role: message.role,
                content: message.content,
                tool_calls: uniqueToolCalls,
              })
            );
          } else {
            result.push(message);
          }
        } else {
          this.logger.warn(`Removing incomplete tool call: ${toolCallIds.join(', ')}`);
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
   */
  protected extractCurrentQuery(): string {
    const lastUserMessage = this.messages.filter((msg) => msg.role === Role.USER).pop();
    return lastUserMessage?.content || '';
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
