/**
 * Mem0 Memory Manager
 * 基于Mem0的智能记忆管理系统
 */

import { Memory } from 'mem0ai/oss';
import { Message, Role } from '../schema/index.js';
import { Logger } from '../utils/logger.js';
import { config as manusConfig } from '../utils/config.js';
import fs from 'fs';
import path from 'path';

export interface MemoryConfig {
  enabled: boolean;
  searchLimit: number;
  searchThreshold: number;
  maxContextMessages: number;
  compressionThreshold: number;
  autoSaveMessages: boolean;
  historyDbPath?: string;
  vectorDbPath?: string;
  taskType?: string; // 添加任务类型配置
}

export interface MemorySearchResult {
  memory: string;
  score: number;
  metadata?: Record<string, any>;
}

export interface MemoryAddResult {
  success: boolean;
  memoryId?: string;
  error?: string;
}

/**
 * Mem0 Memory Manager
 * 提供智能记忆管理功能
 */
export class Mem0MemoryManager {
  private memory?: Memory;
  private logger: Logger;
  private config: MemoryConfig;
  private userId: string;

  constructor(config: MemoryConfig, userId: string = 'default_user') {
    this.logger = new Logger('Mem0MemoryManager');
    this.config = config;
    this.userId = userId;

    if (config.enabled) {
      try {
        // 确保 .manus 目录存在
        const dbPath = config.historyDbPath || this.getDefaultDbPath();
        const vectorDbPath = config.vectorDbPath || this.getDefaultVectorDbPath();
        this.ensureDirectoryExists(dbPath);
        this.ensureDirectoryExists(vectorDbPath);

        // 根据任务类型选择合适的 LLM 配置
        const taskType = config.taskType || 'mem0';
        const llmConfig = manusConfig.getLLMConfig(taskType);
        const embeddingConfig = manusConfig.getLLMConfig('embedding');

        // 配置 Mem0 使用指定的数据库路径和 manus 配置的 LLM
        const mem0Config = {
          historyDbPath: dbPath,
          vectorDbPath: vectorDbPath,
          llm: {
            provider: 'openai',
            config: {
              model: llmConfig.model,
              apiKey: llmConfig.api_key,
              baseURL: llmConfig.base_url,
              temperature: llmConfig.temperature || 0.2,
              maxTokens: Math.min(llmConfig.max_tokens || 1500, 1500),
              modelProperties: {
                endpoint: llmConfig.base_url,
                apiVersion: '2024-02-01',
              },
            },
          },
          embedder: {
            // provider: 'openai',
            // config: {
            //   model: embeddingConfig.model,
            //   embedding_dims: 1536,
            //   apiKey: embeddingConfig.api_key,
            //   baseURL: embeddingConfig.base_url,
            // },
            provider: 'azure_openai',
            config: {
              apiKey: embeddingConfig.api_key || '',
              baseUrl: embeddingConfig.base_url,
              model: embeddingConfig.model,
              modelProperties: {
                endpoint: embeddingConfig.base_url,
                // deployment: '455-text-embedding-ada-002',
                // modelName: embeddingConfig.model,
                apiVersion: '2024-02-01',
              },
            },
          },
          vectorStore: {
            provider: 'memory',
            config: {
              collection_name: `manus_memory_${taskType}`,
              embedding_model_dims: 1536,
            },
          },
        };

        this.memory = Memory.fromConfig ? Memory.fromConfig(mem0Config) : new Memory();
        this.logger.info(`Mem0 Memory Manager initialized successfully`);
        this.logger.info(`  - Task Type: ${taskType}`);
        this.logger.info(`  - LLM Model: ${llmConfig.model}`);
        this.logger.info(`  - Embedding Model: ${embeddingConfig.model}`);
        this.logger.info(`  - Collection: manus_memory_${taskType}`);
        // this.logger.info(`  - History DB: ${dbPath}`);
        // this.logger.info(`  - Vector DB: ${vectorDbPath}`);
      } catch (error) {
        this.logger.error(`Failed to initialize Mem0: ${error}`);
        this.logger.error(`Error details:`, error);
        throw error;
      }
    } else {
      this.logger.info('Mem0 Memory Manager disabled');
    }
  }

  /**
   * 检查记忆管理是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled && this.memory !== undefined;
  }

  /**
   * 存储对话消息到记忆中
   */
  async addConversation(
    messages: Message[],
    metadata?: Record<string, any>
  ): Promise<MemoryAddResult> {
    if (!this.isEnabled() || !this.memory) {
      this.logger.warn(
        'Memory manager is disabled or memory not initialized - cannot add conversation'
      );
      return { success: false, error: 'Memory manager is disabled' };
    }

    try {
      // 转换消息格式为Mem0格式
      const mem0Messages = messages.map((msg) => ({
        role: msg.role,
        content: msg.content || '',
        ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
        ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
        ...(msg.name && { name: msg.name }),
      }));

      // 添加到Mem0
      const result = await this.memory.add(mem0Messages, {
        userId: this.userId,
        ...metadata,
      });

      this.logger.info(`Added conversation to memory`);

      return {
        success: true,
        memoryId: result.results?.[0]?.id,
      };
    } catch (error) {
      this.logger.error(`Failed to add conversation to memory: ${error}`);
      this.logger.error(`Error details:`, error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * 存储单个记忆
   */
  async addMemory(content: string, metadata?: Record<string, any>): Promise<MemoryAddResult> {
    if (!this.isEnabled() || !this.memory) {
      return { success: false, error: 'Memory manager is disabled' };
    }

    try {
      const result = await this.memory.add(content, {
        userId: this.userId,
        ...metadata,
      });

      this.logger.info(`Added memory: ${content.substring(0, 50)}...`);
      return {
        success: true,
        memoryId: result.results?.[0]?.id,
      };
    } catch (error) {
      this.logger.error(`Failed to add memory: ${error}`);
      return { success: false, error: String(error) };
    }
  }

  /**
   * 搜索相关记忆
   */
  async searchMemories(query: string, limit?: number): Promise<MemorySearchResult[]> {
    if (!this.isEnabled() || !this.memory) {
      this.logger.warn('Memory manager is disabled or memory not initialized');
      return [];
    }

    try {
      const searchLimit = limit || this.config.searchLimit;

      // 先检查是否有任何记忆存在
      const allMemories = await this.getAllMemories();

      const results = await this.memory.search(query, {
        userId: this.userId,
        limit: searchLimit,
      });

      const memories: MemorySearchResult[] =
        results.results?.map((result) => ({
          memory: result.memory,
          score: result.score || 0,
          metadata: result.metadata,
        })) || [];

      this.logger.info(
        `Found ${memories.length} relevant memories for query: ${query.substring(0, 50)}...`
      );

      if (memories.length === 0 && allMemories.length > 0) {
        this.logger.warn(
          `No search results found despite having ${allMemories.length} total memories. This might indicate a search configuration issue.`
        );
      }

      return memories;
    } catch (error) {
      this.logger.error(`Failed to search memories: ${error}`);
      this.logger.error(`Error details:`, error);
      return [];
    }
  }

  /**
   * 获取所有记忆
   */
  async getAllMemories(): Promise<MemorySearchResult[]> {
    if (!this.isEnabled() || !this.memory) {
      this.logger.warn(
        'Memory manager is disabled or memory not initialized - cannot get memories'
      );
      return [];
    }

    try {
      const results = await this.memory.getAll({ userId: this.userId });

      const memories: MemorySearchResult[] =
        results.results?.map((result: any) => ({
          memory: result.memory,
          score: 1.0,
          metadata: result.metadata,
        })) || [];

      this.logger.info(`Retrieved ${memories.length} memories`);
      return memories;
    } catch (error) {
      this.logger.error(`Failed to get all memories: ${error}`);
      this.logger.error(`Error details:`, error);
      return [];
    }
  }

  /**
   * 删除记忆
   */
  async deleteMemory(memoryId: string): Promise<boolean> {
    if (!this.isEnabled() || !this.memory) {
      return false;
    }

    try {
      await this.memory.delete(memoryId);
      this.logger.info(`Deleted memory: ${memoryId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete memory: ${error}`);
      return false;
    }
  }

  /**
   * 清空所有记忆
   */
  async clearAllMemories(): Promise<boolean> {
    if (!this.isEnabled() || !this.memory) {
      return false;
    }

    try {
      await this.memory.deleteAll({ userId: this.userId });
      this.logger.info(`Cleared all memories for user: ${this.userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to clear all memories: ${error}`);
      return false;
    }
  }

  /**
   * 智能压缩消息历史
   * 根据相关性和重要性选择保留的消息，去除重复内容但保留跟踪信息
   */
  async getRelevantContext(currentQuery: string, allMessages: Message[]): Promise<Message[]> {
    if (!this.isEnabled()) {
      // 如果禁用记忆管理，返回最近的几条消息
      return allMessages;
    }

    try {
      // 搜索相关记忆
      const relevantMemories = await this.searchMemories(currentQuery, this.config.searchLimit);

      if (relevantMemories.length === 0) {
        // 没有找到相关记忆，采用混合策略：取前5条和后面的maxContextMessages条
        this.logger.debug('No relevant memories found, using hybrid message selection strategy');
        return this.selectHybridMessages(allMessages);
      }

      // 构建上下文消息
      const contextMessages: Message[] = [];

      // 用于去重的Set，基于消息内容和角色
      const seenMessages = new Set<string>();

      // 辅助函数：生成消息的唯一标识（用于去重）
      const getMessageKey = (msg: Message): string => {
        return `${msg.role}:${msg.content?.substring(0, 100) || ''}`;
      };

      // 辅助函数：安全添加消息（避免重复）
      const addUniqueMessage = (msg: Message): void => {
        const key = getMessageKey(msg);
        if (!seenMessages.has(key)) {
          seenMessages.add(key);
          contextMessages.push(msg);
        }
      };

      // 1. 首先添加系统消息（保持在最前面）
      const systemMessages = allMessages.filter((msg) => msg.role === Role.SYSTEM);
      systemMessages.forEach(addUniqueMessage);

      // 2. 添加第一条用户消息（最高优先级，永远放在第一位）
      const firstUserMessage = allMessages.find((msg) => msg.role === Role.USER);
      if (firstUserMessage) {
        addUniqueMessage(firstUserMessage);
        this.logger.debug('Added first user message with highest priority');
      }

      // 3. 添加相关记忆作为系统消息（如果有且不重复）
      if (relevantMemories.length > 0) {
        const memoryContext = relevantMemories
          .map((mem, index) => `[记忆${index + 1}]: ${mem.memory}`)
          .join('\n');
        const memoryMessage = Message.systemMessage(
          `=== 相关记忆上下文 ===\n${memoryContext}\n=== 记忆结束 ===`
        );
        addUniqueMessage(memoryMessage);
      }

      // 4. 添加最近的非系统消息（按时间顺序，避免重复）
      const recentNonSystemMessages = allMessages
        .filter((msg) => msg.role !== Role.SYSTEM)
        .slice(-this.config.maxContextMessages);

      recentNonSystemMessages.forEach(addUniqueMessage);

      // 记录构建的上下文信息
      const messageStats = {
        total: contextMessages.length,
        system: contextMessages.filter((msg) => msg.role === Role.SYSTEM).length,
        user: contextMessages.filter((msg) => msg.role === Role.USER).length,
        assistant: contextMessages.filter((msg) => msg.role === Role.ASSISTANT).length,
        memories: relevantMemories.length,
        originalTotal: allMessages.length,
      };

      this.logger.info(
        `Built deduplicated context: ${messageStats.total} messages ` +
          `(${messageStats.system} system, ${messageStats.user} user, ${messageStats.assistant} assistant) ` +
          `with ${messageStats.memories} memories from ${messageStats.originalTotal} original messages`
      );

      return contextMessages;
    } catch (error) {
      this.logger.error(`Failed to get relevant context: ${error}`);
      // 出错时也使用混合策略：取前5条和后面的maxContextMessages条
      this.logger.debug('Error occurred, falling back to hybrid message selection strategy');
      return this.selectHybridMessages(allMessages);
    }
  }

  /**
   * 记录对话内容到记忆中
   * @param role 角色：user 或 assistant
   * @param content 对话内容
   * @param metadata 元数据
   */
  async recordConversation(
    role: 'user' | 'assistant',
    content: string,
    metadata?: any
  ): Promise<void> {
    try {
      if (!this.isEnabled() || !content || content.length < 5) {
        return;
      }

      // 转换角色为正确的 Role 枚举值并创建 Message 对象
      const messageRole = role === 'user' ? Role.USER : Role.ASSISTANT;
      const message = new Message({
        role: messageRole,
        content: content,
      });

      const result = await this.addConversation([message], metadata);

      if (!result.success) {
        this.logger.warn(`Failed to record conversation: ${result.error}`);
      } else {
        this.logger.debug(`Recorded conversation for ${role}: ${content.substring(0, 100)}...`);
      }
    } catch (error) {
      this.logger.error('Error recording conversation:', error);
    }
  }

  /**
   * 更新用户ID
   */
  setUserId(userId: string): void {
    this.userId = userId;
    this.logger.info(`Updated user ID to: ${userId}`);
  }

  /**
   * 获取当前用户ID
   */
  getUserId(): string {
    return this.userId;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<MemoryConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Updated memory configuration');
  }

  /**
   * 获取配置
   */
  getConfig(): MemoryConfig {
    return { ...this.config };
  }

  /**
   * 获取默认数据库路径
   */
  private getDefaultDbPath(): string {
    return path.join('.manus', 'memory.db');
  }

  /**
   * 获取默认向量数据库路径
   */
  private getDefaultVectorDbPath(): string {
    return path.join('.manus', 'vector_db');
  }

  /**
   * 混合消息选择策略：取前5条和后面的maxContextMessages条
   * 用于在没有相关记忆或出错时的回退方案
   * 确保第一条用户消息始终具有最高优先级
   */
  private selectHybridMessages(allMessages: Message[]): Message[] {
    const maxContext = this.config.maxContextMessages;

    if (allMessages.length <= maxContext) {
      // 如果总消息数不超过maxContext，返回所有消息
      return allMessages;
    }

    // 构建优先级消息列表
    const priorityMessages: Message[] = [];
    const seenMessages = new Set<string>();

    // 辅助函数：生成消息的唯一标识（用于去重）
    const getMessageKey = (msg: Message): string => {
      return `${msg.role}:${msg.content?.substring(0, 100) || ''}`;
    };

    // 辅助函数：安全添加消息（避免重复）
    const addUniqueMessage = (msg: Message): boolean => {
      const key = getMessageKey(msg);
      if (!seenMessages.has(key)) {
        seenMessages.add(key);
        priorityMessages.push(msg);
        return true;
      }
      return false;
    };

    // 1. 首先添加系统消息
    const systemMessages = allMessages.filter((msg) => msg.role === Role.SYSTEM);
    systemMessages.forEach(addUniqueMessage);

    // 2. 添加第一条用户消息（最高优先级）
    const firstUserMessage = allMessages.find((msg) => msg.role === Role.USER);
    if (firstUserMessage) {
      addUniqueMessage(firstUserMessage);
      this.logger.debug('Added first user message with highest priority in hybrid strategy');
    }

    // 3. 添加前几条消息（跳过已添加的）
    const prefixCount = Math.min(5, allMessages.length);
    const prefixMessages = allMessages.slice(0, prefixCount);
    prefixMessages.forEach(addUniqueMessage);

    // 4. 计算剩余可用的消息数量
    const remainingSlots = maxContext - priorityMessages.length;

    if (remainingSlots > 0) {
      // 取最后的remainingSlots条消息
      const suffixMessages = allMessages.slice(-remainingSlots);
      suffixMessages.forEach(addUniqueMessage);
    }

    this.logger.debug(
      `Hybrid strategy: ${priorityMessages.length} total messages ` +
        `(${systemMessages.length} system, first user message priority, remaining context)`
    );

    return priorityMessages;
  }

  /**
   * 确保目录存在
   */
  private ensureDirectoryExists(dbPath: string): void {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.logger.info(`Created directory: ${dir}`);
    }
  }
}
