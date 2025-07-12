/**
 * LLM 接口类
 * 负责与语言模型进行交互
 */

import OpenAI from 'openai';
import { Message, ToolChoice, Role } from '../schema/index.js';
import { config } from '../utils/config.js';
import { Logger } from '../utils/logger.js';
import { Mem0MemoryManager, MemoryConfig } from '../core/mem0_memory_manager.js';
import {
  ConversationContextManager,
  ConversationConfig,
} from '../core/conversation_context_manager.js';

// LLM 响应接口
interface LLMResponse {
  content: string | null;
  tool_calls?: any[];
  usage?: any;
}

// 任务类型枚举
export enum TaskType {
  DEFAULT = 'default',
  CODING = 'coding',
  VISION = 'vision',
  PLANNING = 'planning',
  ANALYSIS = 'analysis',
}

// 任务类型到模型配置的映射
const TASK_TO_MODEL_CONFIG: Record<TaskType, string> = {
  [TaskType.DEFAULT]: 'default',
  [TaskType.CODING]: 'coder',
  [TaskType.VISION]: 'vision',
  [TaskType.PLANNING]: 'default',
  [TaskType.ANALYSIS]: 'default',
};

/**
 * LLM 类
 * 处理与语言模型的交互，支持智能记忆管理
 */
export class LLM {
  private client: OpenAI;
  private logger: Logger;
  private configName: string;
  private memoryManager?: Mem0MemoryManager;
  private conversationManager?: ConversationContextManager;

  constructor(
    configName: string = 'default',
    memoryConfig?: MemoryConfig,
    userId?: string,
    conversationConfig?: ConversationConfig
  ) {
    this.configName = configName;
    this.logger = new Logger('LLM');

    // 获取 LLM 配置
    const llmConfig = config.getLLMConfig(configName);

    // 初始化 OpenAI 客户端
    this.client = new OpenAI({
      apiKey: llmConfig.api_key,
      baseURL: llmConfig.base_url,
    });

    // 获取记忆配置（优先使用传入的配置，否则从配置文件读取）
    const finalMemoryConfig = memoryConfig || config.getMemoryConfig();

    // 初始化记忆管理器（如果配置启用）
    if (finalMemoryConfig.enabled) {
      try {
        // 将当前模型配置名称传递给记忆管理器
        const memoryConfigWithTask = {
          ...finalMemoryConfig,
          taskType: configName,
        };
        this.memoryManager = new Mem0MemoryManager(memoryConfigWithTask, userId);
        this.logger.info(`LLM initialized with memory management for task type: ${configName}`);
      } catch (error) {
        this.logger.error(`Failed to initialize memory manager: ${error}`);
      }
    }

    // 获取对话配置（优先使用传入的配置，否则从配置文件读取）
    const finalConversationConfig = conversationConfig || config.getConversationConfig();

    // 初始化对话上下文管理器（默认启用）
    try {
      // 如果没有记忆管理器，创建一个默认的记忆管理器
      const memMgr =
        this.memoryManager ||
        (finalMemoryConfig.enabled
          ? new Mem0MemoryManager({ ...finalMemoryConfig, taskType: configName }, userId)
          : undefined);
      this.conversationManager = new ConversationContextManager(
        finalConversationConfig,
        memMgr as any
      );
      this.logger.info(
        `LLM initialized with intelligent conversation context management for task type: ${configName}`
      );
    } catch (error) {
      this.logger.error(`Failed to initialize conversation manager: ${error}`);
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
    this.logger.info('Memory manager updated');
  }

  /**
   * 获取对话上下文管理器
   */
  getConversationManager(): ConversationContextManager | undefined {
    return this.conversationManager;
  }

  /**
   * 设置对话上下文管理器
   */
  setConversationManager(conversationManager: ConversationContextManager): void {
    this.conversationManager = conversationManager;
    this.logger.info('Conversation context manager updated');
  }

  /**
   * 创建默认的对话上下文配置
   */
  static createDefaultConversationConfig(): ConversationConfig {
    return {
      maxContextMessages: 10,
      maxTokenLimit: 4000,
      relevanceThreshold: 0.5,
      importanceThreshold: 0.6,
      sessionTimeoutMs: 30 * 60 * 1000, // 30分钟
      summarizationThreshold: 20,
    };
  }

  /**
   * 根据任务类型创建优化的 LLM 实例
   * @param taskType 任务类型
   * @param memoryConfig 记忆配置
   * @param userId 用户ID
   * @param conversationConfig 对话配置
   * @returns 优化的 LLM 实例
   */
  static createForTask(
    taskType: TaskType,
    memoryConfig?: MemoryConfig,
    userId?: string,
    conversationConfig?: ConversationConfig
  ): LLM {
    const configName = TASK_TO_MODEL_CONFIG[taskType];
    const llm = new LLM(configName, memoryConfig, userId, conversationConfig);

    // 记录任务类型信息
    llm.logger.info(`LLM created for task type: ${taskType} using config: ${configName}`);

    return llm;
  }

  /**
   * 获取当前使用的模型配置名称
   */
  getConfigName(): string {
    return this.configName;
  }

  /**
   * 获取当前使用的模型信息
   */
  getModelInfo(): { configName: string; model: string; baseUrl: string } {
    const llmConfig = config.getLLMConfig(this.configName);
    return {
      configName: this.configName,
      model: llmConfig.model,
      baseUrl: llmConfig.base_url,
    };
  }

  /**
   * 智能处理消息上下文
   * 优先使用ConversationContextManager，回退到Mem0MemoryManager或原始消息
   */
  private async getContextualMessages(options: {
    messages: Message[];
    systemMsgs?: Message[];
    currentQuery?: string;
  }): Promise<Message[]> {
    const { messages, systemMsgs = [], currentQuery } = options;

    // 1. 优先使用智能对话上下文管理器
    if (this.conversationManager) {
      try {
        const query = currentQuery || this.extractCurrentQuery(messages);
        const relevantMessages = await this.conversationManager.getRelevantContext(query);

        // 合并系统消息和相关上下文
        const result = [...systemMsgs, ...relevantMessages];

        this.logger.info(`Using ConversationContextManager: ${result.length} contextual messages`);
        return result;
      } catch (error) {
        this.logger.error(`ConversationContextManager failed, falling back: ${error}`);
      }
    }

    // 2. 回退到Mem0记忆管理器
    if (this.memoryManager && this.memoryManager.isEnabled()) {
      try {
        const query = currentQuery || this.extractCurrentQuery(messages);
        const contextualMessages = await this.memoryManager.getRelevantContext(query, messages);

        // 合并系统消息和上下文消息
        const result = [...systemMsgs, ...contextualMessages];

        this.logger.info(`Using Mem0MemoryManager: ${result.length} contextual messages`);
        return result;
      } catch (error) {
        this.logger.error(`Mem0MemoryManager failed, using original messages: ${error}`);
      }
    }

    // 3. 最终回退：返回原始消息
    this.logger.info(
      `Using original messages: ${systemMsgs.length + messages.length} total messages`
    );
    return [...systemMsgs, ...messages];
  }

  /**
   * 从消息中提取当前查询
   */
  private extractCurrentQuery(messages: Message[]): string {
    // 获取最后一条用户消息作为查询
    const lastUserMessage = messages.filter((msg) => msg.role === 'user').pop();

    return lastUserMessage?.content || '';
  }

  /**
   * 保存对话到记忆系统中
   */
  private async saveConversationToMemory(
    messages: Message[],
    response: LLMResponse
  ): Promise<void> {
    try {
      // 准备要保存的对话
      const conversationToSave = [...messages];

      // 添加AI响应
      if (response.content || response.tool_calls) {
        const assistantMessage = new Message({
          role: Role.ASSISTANT,
          content: response.content,
          tool_calls: response.tool_calls,
        });
        conversationToSave.push(assistantMessage);
      }

      const metadata = {
        timestamp: new Date().toISOString(),
        model: config.getLLMConfig(this.configName).model,
        usage: response.usage,
      };

      // 1. 保存到对话上下文管理器（如果启用）
      if (this.conversationManager) {
        for (const message of conversationToSave) {
          await this.conversationManager.addMessage(message, metadata);
        }
        this.logger.debug('Conversation saved to ConversationContextManager');
      }

      // 2. 保存到Mem0记忆管理器（如果启用）
      if (this.memoryManager && this.memoryManager.isEnabled()) {
        await this.memoryManager.addConversation(conversationToSave, metadata);
        this.logger.debug('Conversation saved to Mem0MemoryManager');
      }
    } catch (error) {
      this.logger.error(`Failed to save conversation to memory: ${error}`);
    }
  }

  /**
   * 发送请求到语言模型
   */
  private async sendRequest(options: {
    messages: Message[];
    systemMsgs?: Message[];
    tools?: any[];
    toolChoice?: ToolChoice;
    currentQuery?: string;
  }): Promise<LLMResponse> {
    try {
      const llmConfig = config.getLLMConfig(this.configName);

      // 获取上下文消息（智能记忆管理）
      const contextualMessages = await this.getContextualMessages({
        messages: options.messages,
        systemMsgs: options.systemMsgs,
        currentQuery: options.currentQuery,
      });

      // 记录消息处理情况
      const originalMessageCount = (options.systemMsgs?.length || 0) + options.messages.length;
      const contextualMessageCount = contextualMessages.length;

      if (this.memoryManager?.isEnabled()) {
        this.logger.info(
          `Message optimization: ${originalMessageCount} → ${contextualMessageCount} messages`
        );
      }

      // 准备消息
      const allMessages = contextualMessages.map((msg) => {
        const result: any = {
          role: msg.role,
          content: msg.content,
        };

        // 添加工具调用信息
        if (msg.tool_calls) {
          result.tool_calls = msg.tool_calls;
        }

        // 添加工具调用 ID
        if (msg.tool_call_id) {
          result.tool_call_id = msg.tool_call_id;
        }

        // 添加名称
        if (msg.name) {
          result.name = msg.name;
        }

        return result;
      });

      // 发送请求
      const response = await this.client.chat.completions.create({
        model: llmConfig.model,
        messages: allMessages,
        tools: options.tools,
        tool_choice: options.toolChoice,
        temperature: llmConfig.temperature,
        max_tokens: llmConfig.max_tokens,
      });

      // 处理响应
      const choice = response.choices[0];
      const llmResponse: LLMResponse = {
        content: choice.message.content,
        tool_calls: choice.message.tool_calls,
        usage: response.usage,
      };

      // 保存对话到记忆中
      await this.saveConversationToMemory(options.messages, llmResponse);

      // 记录任务执行日志到 .manus 目录，采用 JSON 行格式
      try {
        const fs = await import('fs');
        const logPath = './.manus/task_log.jsonl';
        const logObj = {
          timestamp: new Date().toISOString(),
          model: llmConfig.model,
          messages: allMessages,
          response: {
            content: choice.message.content,
            tool_calls: choice.message.tool_calls,
            usage: response.usage,
          },
          memoryEnabled: this.memoryManager?.isEnabled() || false,
          messageOptimization: {
            original: originalMessageCount,
            contextual: contextualMessageCount,
            savedMessages: Math.max(0, originalMessageCount - contextualMessageCount),
          },
        };
        fs.promises.appendFile(logPath, JSON.stringify(logObj) + '\n', 'utf-8');
      } catch (e) {
        this.logger.error(`记录任务执行日志失败: ${e}`);
      }

      // 记录 token 消耗到 .manus 目录，采用 JSON 行格式
      if (response.usage) {
        try {
          const fs = await import('fs');
          const path = './.manus/token_usage.jsonl';
          const logObj = {
            timestamp: new Date().toISOString(),
            model: llmConfig.model,
            prompt_tokens: response.usage.prompt_tokens,
            completion_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens,
            memoryEnabled: this.memoryManager?.isEnabled() || false,
            messageOptimization: {
              original: originalMessageCount,
              contextual: contextualMessageCount,
              savedMessages: Math.max(0, originalMessageCount - contextualMessageCount),
            },
          };
          fs.promises.appendFile(path, JSON.stringify(logObj) + '\n', 'utf-8');
        } catch (e) {
          this.logger.error(`记录 token 消耗失败: ${e}`);
        }
      }

      return llmResponse;
    } catch (error) {
      this.logger.error(`LLM 请求失败: ${error}`);
      throw error;
    }
  }

  /**
   * 向语言模型发送普通请求
   */
  async ask(options: {
    messages: Message[];
    systemMsgs?: Message[];
    currentQuery?: string;
  }): Promise<string> {
    const response = await this.sendRequest({
      messages: options.messages,
      systemMsgs: options.systemMsgs,
      currentQuery: options.currentQuery,
    });

    return response.content || '';
  }

  /**
   * 向语言模型发送工具调用请求
   */
  async askTool(options: {
    messages: Message[];
    systemMsgs?: Message[];
    tools?: any[];
    toolChoice?: ToolChoice;
    currentQuery?: string;
  }): Promise<LLMResponse> {
    return await this.sendRequest({
      messages: options.messages,
      systemMsgs: options.systemMsgs,
      tools: options.tools,
      toolChoice: options.toolChoice,
      currentQuery: options.currentQuery,
    });
  }
}
