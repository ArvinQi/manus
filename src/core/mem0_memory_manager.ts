/**
 * Mem0 Memory Manager
 * 基于Mem0的智能记忆管理系统
 */

import { Memory } from 'mem0ai/oss';
import { Message, Role } from '../schema/index.js';
import { Logger } from '../utils/logger.js';
import { config as manusConfig } from '../utils/config.js';
import { EventEmitter } from 'events';
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

// 添加任务检查点接口
export interface TaskCheckpoint {
  id: string;
  taskId: string;
  timestamp: number;
  canResume: boolean;
  data?: any;
}

// 添加统计信息接口
export interface MemoryStatistics {
  totalEntries: number;
  compressedEntries: number;
}

/**
 * Mem0 Memory Manager
 * 提供智能记忆管理功能
 */
export class Mem0MemoryManager extends EventEmitter {
  private memory?: Memory;
  private logger: Logger;
  private config: MemoryConfig;
  private userId: string;

  // 添加本地存储用于兼容性
  private checkpoints: Map<string, TaskCheckpoint> = new Map();
  private tasks: Map<string, any> = new Map();
  private statistics: MemoryStatistics = {
    totalEntries: 0,
    compressedEntries: 0,
  };

  // 新增：本地消息缓存，用于解决立即读取问题
  private localMessageCache: Map<string, any> = new Map();
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL = 5000; // 5秒缓存时间

  constructor(config: MemoryConfig, userId: string = 'default_user') {
    super();
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
              dbPath: vectorDbPath,
            },
          },
          historyStore: {
            provider: 'sqlite',
            config: {
              historyDbPath: dbPath,
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

      // 立即更新本地缓存，解决立即读取问题
      this.updateLocalCache(mem0Messages, metadata);

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
   * 更新本地缓存
   */
  private updateLocalCache(messages: any[], metadata?: any): void {
    const now = Date.now();
    this.cacheTimestamp = now;

    for (const message of messages) {
      const cacheKey = `${message.role}:${message.content?.substring(0, 50)}`;
      this.localMessageCache.set(cacheKey, {
        message,
        metadata,
        timestamp: now,
      });
    }

    // 清理过期缓存
    this.cleanupExpiredCache();
  }

  /**
   * 清理过期缓存
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, value] of this.localMessageCache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.localMessageCache.delete(key);
    }
  }

  /**
   * 强制刷新缓存，确保最新消息可立即读取
   */
  async refreshCache(): Promise<void> {
    try {
      if (!this.isEnabled() || !this.memory) {
        return;
      }

      // 清空本地缓存
      this.localMessageCache.clear();
      this.cacheTimestamp = 0;

      // 从 Mem0 重新加载最近的记忆
      const recentMemories = await this.memory.search('', {
        limit: 50,
        userId: this.userId,
      });

      // 重新构建本地缓存
      for (const result of recentMemories.results || []) {
        const cacheKey = `recent:${result.id || Date.now()}`;
        this.localMessageCache.set(cacheKey, {
          message: {
            role: 'assistant',
            content: result.memory || '',
          },
          metadata: result.metadata || {},
          timestamp: Date.now(),
        });
      }

      this.logger.debug(`Refreshed cache with ${this.localMessageCache.size} items`);
    } catch (error) {
      this.logger.error(`Failed to refresh cache: ${error}`);
    }
  }

  /**
   * 获取缓存状态信息
   */
  getCacheStatus(): {
    size: number;
    timestamp: number;
    ttl: number;
    isExpired: boolean;
  } {
    const now = Date.now();
    const isExpired = now - this.cacheTimestamp > this.CACHE_TTL;

    return {
      size: this.localMessageCache.size,
      timestamp: this.cacheTimestamp,
      ttl: this.CACHE_TTL,
      isExpired,
    };
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
   * 搜索记忆
   */
  async searchMemories(query: string, limit: number = 10): Promise<MemorySearchResult[]> {
    if (!this.isEnabled() || !this.memory) {
      return [];
    }

    try {
      const results: MemorySearchResult[] = [];

      // 1. 首先从本地缓存搜索（解决立即读取问题）
      const localResults = this.searchLocalCache(query, limit);
      results.push(...localResults);

      // 2. 从 Mem0 搜索
      const mem0Results = await this.memory.search(query, {
        limit: Math.max(limit - localResults.length, 1),
        userId: this.userId,
      });

      // 转换 Mem0 结果格式
      for (const result of mem0Results.results || []) {
        results.push({
          memory: result.memory || '',
          score: result.score || 0,
          metadata: result.metadata || {},
        });
      }

      // 去重并按分数排序
      const uniqueResults = this.deduplicateResults(results);
      return uniqueResults.slice(0, limit);
    } catch (error) {
      this.logger.error(`Failed to search memories: ${error}`);
      return [];
    }
  }

  /**
   * 从本地缓存搜索
   */
  private searchLocalCache(query: string, limit: number): MemorySearchResult[] {
    const results: MemorySearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const [key, value] of this.localMessageCache.entries()) {
      const content = value.message.content?.toLowerCase() || '';
      if (content.includes(lowerQuery)) {
        // 计算简单的相关性分数
        const score = this.calculateRelevanceScore(content, lowerQuery);
        results.push({
          memory: value.message.content,
          score,
          metadata: value.metadata || {},
        });
      }
    }

    // 按分数排序
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * 计算相关性分数
   */
  private calculateRelevanceScore(content: string, query: string): number {
    const words = query.split(' ');
    let score = 0;

    for (const word of words) {
      if (content.includes(word)) {
        score += 0.3;
        // 完全匹配加分
        if (content.includes(` ${word} `) || content.startsWith(word) || content.endsWith(word)) {
          score += 0.2;
        }
      }
    }

    return Math.min(score, 1.0);
  }

  /**
   * 去重搜索结果
   */
  private deduplicateResults(results: MemorySearchResult[]): MemorySearchResult[] {
    const seen = new Set<string>();
    const unique: MemorySearchResult[] = [];

    for (const result of results) {
      const key = `${result.memory}:${result.score}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(result);
      }
    }

    return unique;
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
   * 保留第一条和最后十条消息的原始信息，中间消息通过memory查询压缩
   */
  async getRelevantContext(currentQuery: string, _allMessages: Message[]): Promise<Message[]> {
    const allMessages = _allMessages.filter(
      (msg) =>
        !(
          msg.role === Role.USER &&
          msg.content === '请分析当前任务状态，思考下一步应该做什么，并使用适当的工具来完成任务。'
        )
    );
    allMessages.push({
      role: Role.USER,
      content: '请分析当前任务状态，思考下一步应该做什么，并使用适当的工具来完成任务。',
    });
    if (!this.isEnabled() || _allMessages.length <= 11) {
      return _allMessages;
    }

    try {
      const contextMessages: Message[] = [];

      // 1. 保留第一条消息的原始信息
      const firstMessage = allMessages[0];
      contextMessages.push({ ...firstMessage }); // 使用展开运算符创建新对象，保持原始信息

      // 2. 对中间消息进行处理
      if (allMessages.length > 11) {
        const middleMessages = allMessages.slice(1, -10);

        // 获取所有记忆的摘要信息
        const allMemories = await this.getAllMemories();
        // 搜索相关记忆
        const relevantMemories = await this.searchMemories(currentQuery, this.config.searchLimit);
        // 创建记忆摘要消息
        if (allMemories.length > 0) {
          // 将所有记忆转换为摘要
          const memorySummary = {
            role: Role.SYSTEM,
            content: `[记忆摘要] 系统共有 ${allMemories.length} 条记忆。主要内容包括：${allMemories
              .slice(0, 5)
              .map((mem) => mem.memory.substring(0, 50) + (mem.memory.length > 50 ? '...' : ''))
              .join(
                '; '
              )}${allMemories.length > 5 ? ` 以及其他 ${allMemories.length - 5} 条记忆。` : ''}`,
          };
          contextMessages.push(memorySummary);
        }

        if (relevantMemories.length > 0) {
          // 将相关记忆转换为消息格式
          // const memoryMessages = relevantMemories.map((mem) => ({
          //   role: Role.SYSTEM,
          //   content: `[相关上下文] ${mem.memory}`,
          // }));

          // 从中间消息中找出与当前任务相关的消息
          const taskRelatedMessages = await this.findTaskRelatedMessages(
            middleMessages,
            currentQuery
          );

          // 添加相关消息
          contextMessages.push({
            role: Role.SYSTEM,
            content: `[相关上下文] ${relevantMemories.map((mem) => mem.memory.substring(0, 50)).join('; ')}`,
          });
          contextMessages.push(...taskRelatedMessages);
        }
      }

      // 3. 保留最后10条消息的原始信息
      const lastTenMessages = allMessages.slice(-10).map((msg) => ({ ...msg })); // 使用展开运算符创建新对象，保持原始信息
      contextMessages.push(...lastTenMessages);

      this.logger.info(
        `压缩后的消息: 总数 ${contextMessages.length} (第一条原始消息 + ${
          contextMessages.length - 11
        } 条相关消息 + 最后10条原始消息)`
      );

      return contextMessages;
    } catch (error) {
      this.logger.error(`获取相关上下文失败: ${error}`);
      // 出错时保留第一条和最后10条的原始信息
      return [{ ...allMessages[0] }, ...allMessages.slice(-10).map((msg) => ({ ...msg }))];
    }
  }

  /**
   * 从消息列表中找出与当前任务相关的消息
   */
  private async findTaskRelatedMessages(
    messages: Message[],
    currentQuery: string
  ): Promise<Message[]> {
    try {
      // 构建搜索文本
      const searchTexts = messages.map((msg) => {
        let text = msg.content || '';
        if (msg.tool_calls) {
          text +=
            ' ' +
            msg.tool_calls
              .map((call) => `${call.function.name} ${call.function.arguments}`)
              .join(' ');
        }
        return text;
      });

      // 使用memory搜索相关内容
      const searchResults = await Promise.all(
        searchTexts.map(async (text, index) => {
          try {
            const similarity = await this.calculateSimilarity(text, currentQuery);
            return { message: messages[index], similarity };
          } catch {
            return { message: messages[index], similarity: 0 };
          }
        })
      );

      // 按相关性排序并选择最相关的消息
      const relatedMessages = searchResults
        .filter((result) => result.similarity > 0.6) // 只保留相关性较高的消息
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5) // 最多保留5条相关消息
        .map((result) => ({ ...result.message })); // 创建消息的副本

      this.logger.debug(`找到 ${relatedMessages.length} 条相关消息 (相关性阈值 > 0.6)`);

      return relatedMessages;
    } catch (error) {
      this.logger.error(`查找相关消息失败: ${error}`);
      return [];
    }
  }

  /**
   * 计算两段文本的相似度
   * 如果memory支持搜索相似度，则使用memory的方法
   * 否则使用简单的关键词匹配
   */
  private async calculateSimilarity(text: string, query: string): Promise<number> {
    // 尝试使用memory的搜索功能
    if (this.memory && typeof this.memory.search === 'function') {
      try {
        const results = await this.memory.search(query, { limit: 1 });
        if (results.results && results.results.length > 0) {
          // 使用search结果的分数作为相似度参考
          return results.results[0].score || 0;
        }
      } catch (e) {
        // 忽略错误，继续使用简单匹配
      }
    }

    // 简单关键词匹配算法
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);

    if (queryWords.length === 0) return 0;

    let matchCount = 0;
    for (const word of queryWords) {
      if (textLower.includes(word)) {
        matchCount++;
        // 完全匹配加分
        if (
          textLower.includes(` ${word} `) ||
          textLower.startsWith(word) ||
          textLower.endsWith(word)
        ) {
          matchCount += 0.5;
        }
      }
    }

    return Math.min(matchCount / queryWords.length, 1.0);
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
      if (!this.isEnabled() || !content || content.length < 10) {
        return;
      }

      // 只记录关键对话：任务创建、重要决策、错误处理
      const isKeyConversation = this.isKeyConversation(content, role, metadata);
      if (!isKeyConversation) {
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
        this.logger.debug(`Recorded key conversation for ${role}: ${content.substring(0, 100)}...`);

        // 立即更新本地缓存，确保可以立即读取
        this.updateLocalCache([{ role, content }], metadata);
      }
    } catch (error) {
      this.logger.error('Error recording conversation:', error);
    }
  }

  /**
   * 判断是否为关键对话
   */
  private isKeyConversation(content: string, role: 'user' | 'assistant', metadata?: any): boolean {
    const lowerContent = content.toLowerCase();

    // 用户关键对话
    if (role === 'user') {
      // 任务相关关键词
      const taskKeywords = [
        'create',
        'task',
        'project',
        'build',
        'develop',
        'implement',
        'fix',
        'bug',
        'error',
        'problem',
        'issue',
        'help',
        'important',
        'urgent',
        'critical',
        'priority',
      ];

      // 检查是否包含任务相关关键词
      const hasTaskKeywords = taskKeywords.some((keyword) => lowerContent.includes(keyword));
      if (hasTaskKeywords) return true;

      // 检查元数据中的重要性
      if (metadata?.importance > 0.8) return true;

      // 检查是否为任务创建消息
      if (
        metadata?.messageType === 'task_creation' ||
        metadata?.messageType === 'task_instruction'
      ) {
        return true;
      }
    }

    // 助手关键回复
    if (role === 'assistant') {
      // 包含工具调用的回复
      if (metadata?.tool_calls && metadata.tool_calls.length > 0) return true;

      // 包含重要决策或解决方案的回复
      const decisionKeywords = [
        'solution',
        'plan',
        'strategy',
        'approach',
        'recommendation',
        'decision',
        'conclusion',
        'result',
        'success',
        'completed',
        'error',
        'failed',
        'warning',
        'critical',
      ];

      const hasDecisionKeywords = decisionKeywords.some((keyword) =>
        lowerContent.includes(keyword)
      );
      if (hasDecisionKeywords) return true;

      // 长回复通常包含重要信息
      if (content.length > 200) return true;
    }

    return false;
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
    return path.join('.manus', 'vector_store.db');
  }

  /**
   * 混合消息选择策略：取前5条和后面的maxContextMessages条
   * 用于在没有相关记忆或出错时的回退方案
   * 确保第一条用户消息始终具有最高优先级，并且保留最近的消息
   */
  private selectHybridMessages(allMessages: Message[]): Message[] {
    const maxContext = Math.max(5, this.config.maxContextMessages);

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

    // 4. 确保添加最近的5条消息
    const lastFiveMessages = allMessages.slice(-5);
    lastFiveMessages.forEach(addUniqueMessage);

    // 5. 如果还有剩余空间，添加中间的消息
    const remainingSlots = maxContext - priorityMessages.length;
    if (remainingSlots > 0) {
      const middleMessages = allMessages.slice(prefixCount, -5);
      const step = Math.ceil(middleMessages.length / remainingSlots);
      for (let i = 0; i < middleMessages.length; i += step) {
        addUniqueMessage(middleMessages[i]);
      }
    }

    this.logger.debug(
      `Hybrid strategy selected ${priorityMessages.length} messages (including last 5) from ${allMessages.length} total`
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

  /**
   * 记录重要事件（兼容性方法）
   */
  async recordImportantEvent(type: string, data: any, importance?: number): Promise<void> {
    try {
      if (!this.isEnabled()) {
        return;
      }

      // 只记录真正重要的事件
      const criticalEvents = [
        'system_start',
        'system_shutdown',
        'service_failure',
        'critical_error',
        'task_completed',
        'task_failed',
        'config_change',
        'recovery',
      ];

      // 检查是否为关键事件
      const isCriticalEvent = criticalEvents.includes(type);
      const hasHighImportance = (importance || 0) > 0.8;

      if (!isCriticalEvent && !hasHighImportance) {
        return;
      }

      const eventContent = `重要事件: ${type} - ${JSON.stringify(data)}`;
      await this.recordConversation('assistant', eventContent, {
        type: 'important_event',
        eventType: type,
        importance: importance || 0.5,
        timestamp: Date.now(),
      });

      this.statistics.totalEntries++;
      this.emit('memory_stored', { type, data, importance });
    } catch (error) {
      this.logger.error(`Failed to record important event: ${error}`);
    }
  }

  /**
   * 获取统计信息（兼容性方法）
   */
  async getStatistics(): Promise<MemoryStatistics> {
    return this.statistics;
  }

  /**
   * 查询记忆（兼容性方法）
   */
  async queryMemories(query: any): Promise<any[]> {
    try {
      if (!this.isEnabled()) {
        return [];
      }

      const results: any[] = [];

      // 1. 从本地缓存查询（解决立即读取问题）
      const localResults = this.queryLocalCache(query);
      results.push(...localResults);

      // 2. 从 Mem0 查询
      if (this.memory) {
        try {
          const mem0Query = this.buildMem0Query(query);
          const mem0Results = await this.memory.search(mem0Query.query, {
            limit: mem0Query.limit,
            userId: this.userId,
          });

          // 转换结果格式
          for (const result of mem0Results.results || []) {
            results.push({
              id: result.id || `mem0_${Date.now()}`,
              content: result.memory || '',
              score: result.score || 0,
              metadata: result.metadata || {},
              timestamp: Date.now(),
            });
          }
        } catch (error) {
          this.logger.warn(`Mem0 query failed, using local cache only: ${error}`);
        }
      }

      // 去重并按相关性排序
      return this.deduplicateQueryResults(results);
    } catch (error) {
      this.logger.error(`Failed to query memories: ${error}`);
      return [];
    }
  }

  /**
   * 从本地缓存查询
   */
  private queryLocalCache(query: any): any[] {
    const results: any[] = [];
    const queryText = query.query || query.text || '';

    for (const [key, value] of this.localMessageCache.entries()) {
      const content = value.message.content || '';
      const metadata = value.metadata || {};

      // 检查是否匹配查询条件
      if (this.matchesQuery(value, query)) {
        results.push({
          id: key,
          content,
          score: this.calculateRelevanceScore(content, queryText),
          metadata,
          timestamp: value.timestamp,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * 检查是否匹配查询条件
   */
  private matchesQuery(cacheItem: any, query: any): boolean {
    const content = cacheItem.message.content?.toLowerCase() || '';
    const queryText = (query.query || query.text || '').toLowerCase();

    // 文本匹配
    if (queryText && content.includes(queryText)) {
      return true;
    }

    // 标签匹配
    if (query.tags && Array.isArray(query.tags)) {
      const metadata = cacheItem.metadata || {};
      const itemTags = metadata.tags || [];
      return query.tags.some((tag: string) => itemTags.includes(tag));
    }

    // 类型匹配
    if (query.types && Array.isArray(query.types)) {
      const metadata = cacheItem.metadata || {};
      const itemType = metadata.type || 'conversation';
      return query.types.includes(itemType);
    }

    return false;
  }

  /**
   * 构建 Mem0 查询
   */
  private buildMem0Query(query: any): { query: string; limit: number } {
    let searchQuery = '';
    let limit = 10;

    if (typeof query === 'string') {
      searchQuery = query;
    } else if (query.query || query.text) {
      searchQuery = query.query || query.text;
    } else {
      // 从标签或类型构建查询
      const parts = [];
      if (query.tags) parts.push(...query.tags);
      if (query.types) parts.push(...query.types);
      searchQuery = parts.join(' ');
    }

    if (query.limit) {
      limit = Math.min(query.limit, 50);
    }

    return { query: searchQuery, limit };
  }

  /**
   * 去重查询结果
   */
  private deduplicateQueryResults(results: any[]): any[] {
    const seen = new Set<string>();
    const unique: any[] = [];

    for (const result of results) {
      const key = `${result.content}:${result.score}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(result);
      }
    }

    return unique;
  }

  /**
   * 获取相关记忆（兼容性方法）
   */
  async getRelatedMemories(entryId: string, limit: number = 10): Promise<any[]> {
    try {
      if (!this.isEnabled() || !this.memory) {
        return [];
      }

      // 简化实现：使用 entryId 作为查询词
      const searchResults = await this.searchMemories(entryId, limit);

      return searchResults.map((result) => ({
        id: entryId,
        content: result.memory,
        score: result.score,
        metadata: result.metadata,
      }));
    } catch (error) {
      this.logger.error(`Failed to get related memories: ${error}`);
      return [];
    }
  }

  /**
   * 保存检查点（兼容性方法）
   */
  async saveCheckpoint(taskId: string, checkpoint: TaskCheckpoint): Promise<void> {
    try {
      this.checkpoints.set(checkpoint.id, checkpoint);
      this.logger.debug(`Saved checkpoint for task ${taskId}: ${checkpoint.id}`);
    } catch (error) {
      this.logger.error(`Failed to save checkpoint: ${error}`);
    }
  }

  /**
   * 获取检查点（兼容性方法）
   */
  async getCheckpoints(): Promise<TaskCheckpoint[]> {
    return Array.from(this.checkpoints.values());
  }

  /**
   * 根据ID获取任务（兼容性方法）
   */
  async getTaskById(taskId: string): Promise<any | null> {
    return this.tasks.get(taskId) || null;
  }

  /**
   * 保存任务（兼容性方法）
   */
  async saveTask(taskId: string, task: any): Promise<void> {
    this.tasks.set(taskId, task);
    this.logger.debug(`Saved task: ${taskId}`);
  }
}
