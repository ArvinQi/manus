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
        const taskType = config.taskType || 'default';
        const llmConfig = manusConfig.getLLMConfig(taskType);
        const embeddingConfig = manusConfig.getLLMConfig('embedding');

        // 配置 Mem0 使用指定的数据库路径和 manus 配置的 LLM
        const mem0Config = {
          historyDbPath: dbPath,
          vectorDbPath: vectorDbPath,
          llm: {
            provider: 'anthropic',
            config: {
              model: llmConfig.model,
              api_key: llmConfig.api_key,
              base_url: llmConfig.base_url,
              temperature: llmConfig.temperature || 0.2,
              max_tokens: Math.min(llmConfig.max_tokens || 1500, 1500),
            },
          },
          embedder: {
            provider: 'openai',
            config: {
              model: embeddingConfig.model,
              embedding_dims: 1536,
              api_key: embeddingConfig.api_key,
              base_url: embeddingConfig.base_url,
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
        this.logger.info(`  - Collection: manus_memory_${taskType}`);
        this.logger.info(`  - History DB: ${dbPath}`);
        this.logger.info(`  - Vector DB: ${vectorDbPath}`);
      } catch (error) {
        this.logger.error(`Failed to initialize Mem0: ${error}`);
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
      return [];
    }

    try {
      const searchLimit = limit || this.config.searchLimit;
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
      return memories;
    } catch (error) {
      this.logger.error(`Failed to search memories: ${error}`);
      return [];
    }
  }

  /**
   * 获取所有记忆
   */
  async getAllMemories(): Promise<MemorySearchResult[]> {
    if (!this.isEnabled() || !this.memory) {
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
   * 根据相关性和重要性选择保留的消息
   */
  async getRelevantContext(currentQuery: string, allMessages: Message[]): Promise<Message[]> {
    if (!this.isEnabled()) {
      // 如果禁用记忆管理，返回最近的几条消息
      return allMessages.slice(-this.config.maxContextMessages);
    }

    try {
      // 搜索相关记忆
      const relevantMemories = await this.searchMemories(currentQuery, this.config.searchLimit);

      if (relevantMemories.length === 0) {
        // 没有找到相关记忆，返回最近的消息
        return allMessages.slice(-this.config.maxContextMessages);
      }

      // 构建上下文消息
      const contextMessages: Message[] = [];

      // 添加系统消息（如果有）
      const systemMessages = allMessages.filter((msg) => msg.role === Role.SYSTEM);
      contextMessages.push(...systemMessages);

      // 添加相关记忆作为系统消息
      if (relevantMemories.length > 0) {
        const memoryContext = relevantMemories.map((mem) => `记忆: ${mem.memory}`).join('\n');
        contextMessages.push(Message.systemMessage(`相关记忆:\n${memoryContext}`));
      }

      // 添加最近的几条消息
      const recentMessages = allMessages.slice(-this.config.maxContextMessages);
      contextMessages.push(...recentMessages);

      this.logger.info(
        `Built context with ${contextMessages.length} messages including ${relevantMemories.length} relevant memories`
      );
      return contextMessages;
    } catch (error) {
      this.logger.error(`Failed to get relevant context: ${error}`);
      // 出错时返回最近的消息
      return allMessages.slice(-this.config.maxContextMessages);
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
