/**
 * LLM Factory
 * 负责管理不同任务类型的 LLM 实例，提供单例模式和性能优化
 */

import { LLM, TaskType } from './index.js';
import { MemoryConfig } from '../core/mem0_memory_manager.js';
import { ConversationConfig } from '../core/conversation_context_manager.js';
import { Logger } from '../utils/logger.js';

/**
 * LLM 实例缓存项
 */
interface LLMCacheItem {
  llm: LLM;
  taskType: TaskType;
  createdAt: number;
  lastUsed: number;
  useCount: number;
}

/**
 * LLM Factory 配置
 */
interface LLMFactoryConfig {
  maxCacheSize?: number; // 最大缓存大小
  cacheExpiryMs?: number; // 缓存过期时间（毫秒）
  enablePreload?: boolean; // 是否预加载常用模型
}

/**
 * LLM Factory
 * 管理和复用 LLM 实例以提高性能
 */
export class LLMFactory {
  private static instance: LLMFactory;
  private logger: Logger;
  private cache = new Map<string, LLMCacheItem>();
  private config: LLMFactoryConfig;

  private constructor(config: LLMFactoryConfig = {}) {
    this.logger = new Logger('LLMFactory');
    this.config = {
      maxCacheSize: 10,
      cacheExpiryMs: 30 * 60 * 1000, // 30分钟
      enablePreload: true,
      ...config,
    };

    // 预加载常用模型
    if (this.config.enablePreload) {
      this.preloadCommonModels();
    }
  }

  /**
   * 获取 LLMFactory 单例
   */
  static getInstance(config?: LLMFactoryConfig): LLMFactory {
    if (!LLMFactory.instance) {
      LLMFactory.instance = new LLMFactory(config);
    }
    return LLMFactory.instance;
  }

  /**
   * 获取指定任务类型的 LLM 实例
   * 支持缓存和复用
   */
  getLLM(
    taskType: TaskType,
    memoryConfig?: MemoryConfig,
    userId?: string,
    conversationConfig?: ConversationConfig
  ): LLM {
    const cacheKey = this.getCacheKey(taskType, userId);
    const cached = this.cache.get(cacheKey);

    // 检查缓存是否有效
    if (cached && this.isCacheValid(cached)) {
      cached.lastUsed = Date.now();
      cached.useCount++;
      this.logger.debug(`Cache hit for ${taskType}, user: ${userId || 'default'}`);
      return cached.llm;
    }

    // 创建新的 LLM 实例（简化参数，记忆管理由Agent负责）
    const llm = LLM.createForTask(taskType);

    // 缓存实例
    this.cacheInstance(cacheKey, llm, taskType);

    this.logger.info(`Created new LLM for task: ${taskType}, user: ${userId || 'default'}`);
    return llm;
  }

  /**
   * 预加载常用模型以提高响应速度
   */
  private async preloadCommonModels(): Promise<void> {
    if (!this.config.enablePreload) {
      return;
    }

    const commonTasks: TaskType[] = [TaskType.DEFAULT, TaskType.CODING, TaskType.PLANNING];

    this.logger.info('Preloading common LLM models...');

    for (const taskType of commonTasks) {
      try {
        const llm = LLM.createForTask(taskType);
        const cacheKey = this.getCacheKey(taskType);
        this.cacheInstance(cacheKey, llm, taskType);
        this.logger.debug(`Preloaded LLM for task: ${taskType}`);
      } catch (error) {
        this.logger.error(`Failed to preload LLM for task ${taskType}: ${error}`);
      }
    }

    this.logger.info(`Preloaded ${commonTasks.length} LLM models`);
  }

  /**
   * 生成缓存键
   */
  private getCacheKey(taskType: TaskType, userId?: string): string {
    return `${taskType}_${userId || 'default'}`;
  }

  /**
   * 检查缓存是否有效
   */
  private isCacheValid(cached: LLMCacheItem): boolean {
    const now = Date.now();
    return now - cached.createdAt < this.config.cacheExpiryMs!;
  }

  /**
   * 缓存 LLM 实例
   */
  private cacheInstance(cacheKey: string, llm: LLM, taskType: TaskType): void {
    // 如果缓存已满，清理最久未使用的实例
    if (this.cache.size >= this.config.maxCacheSize!) {
      this.evictOldestCache();
    }

    const cacheItem: LLMCacheItem = {
      llm,
      taskType,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      useCount: 1,
    };

    this.cache.set(cacheKey, cacheItem);
  }

  /**
   * 清理最久未使用的缓存
   */
  private evictOldestCache(): void {
    let oldestKey = '';
    let oldestTime = Date.now();

    for (const [key, item] of this.cache.entries()) {
      if (item.lastUsed < oldestTime) {
        oldestTime = item.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.logger.debug(`Evicted oldest cache entry: ${oldestKey}`);
    }
  }

  /**
   * 清理过期缓存
   */
  cleanupExpiredCache(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, item] of this.cache.entries()) {
      if (now - item.createdAt > this.config.cacheExpiryMs!) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    if (keysToDelete.length > 0) {
      this.logger.info(`Cleaned up ${keysToDelete.length} expired cache entries`);
    }
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): {
    totalCached: number;
    hitRate: number;
    taskTypeBreakdown: Record<TaskType, number>;
  } {
    const taskTypeBreakdown = {} as Record<TaskType, number>;
    let totalUseCount = 0;

    for (const item of this.cache.values()) {
      taskTypeBreakdown[item.taskType] = (taskTypeBreakdown[item.taskType] || 0) + 1;
      totalUseCount += item.useCount;
    }

    return {
      totalCached: this.cache.size,
      hitRate: totalUseCount > 0 ? (totalUseCount - this.cache.size) / totalUseCount : 0,
      taskTypeBreakdown,
    };
  }

  /**
   * 清空所有缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.info('Cleared all LLM cache');
  }
}

// 导出单例实例
export const llmFactory = LLMFactory.getInstance();
