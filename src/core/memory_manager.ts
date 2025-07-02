/**
 * 记忆管理器
 * 使用OpenMemory MCP进行执行过程记忆管理，支持压缩和提取记忆
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { MemoryConfig } from '../schema/multi_agent_config.js';
import { Task, DecisionResult } from './decision_engine.js';
import { TaskResult, TaskCheckpoint } from './task_manager.js';
import { MultiMcpManager } from '../mcp/multi_mcp_manager.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// 记忆类型
export enum MemoryType {
  TASK_SUBMISSION = 'task_submission',
  TASK_EXECUTION = 'task_execution',
  TASK_COMPLETION = 'task_completion',
  DECISION_MAKING = 'decision_making',
  SYSTEM_EVENT = 'system_event',
  USER_INTERACTION = 'user_interaction',
  ERROR_EVENT = 'error_event'
}

// 记忆条目
export interface MemoryEntry {
  id: string;
  type: MemoryType;
  timestamp: number;
  content: any;
  importance: number; // 0-1之间，1为最重要
  tags: string[];
  context?: Record<string, any>;
  compressed?: boolean;
  relatedEntries?: string[];
}

// 记忆查询条件
export interface MemoryQuery {
  types?: MemoryType[];
  tags?: string[];
  timeRange?: {
    start: number;
    end: number;
  };
  importance?: {
    min: number;
    max: number;
  };
  limit?: number;
  sortBy?: 'timestamp' | 'importance';
  sortOrder?: 'asc' | 'desc';
}

// 记忆统计信息
export interface MemoryStatistics {
  totalEntries: number;
  entriesByType: Record<MemoryType, number>;
  compressedEntries: number;
  averageImportance: number;
  oldestEntry: number;
  newestEntry: number;
  storageSize: number;
}

/**
 * 记忆管理器类
 */
export class MemoryManager extends EventEmitter {
  private logger: Logger;
  private config: MemoryConfig;
  private mcpManager?: MultiMcpManager;
  private memoryCache: Map<string, MemoryEntry> = new Map();
  private compressionQueue: MemoryEntry[] = [];
  private extractionInterval?: NodeJS.Timeout;
  private compressionInterval?: NodeJS.Timeout;
  private isInitialized = false;

  constructor(config: MemoryConfig, mcpManager?: MultiMcpManager) {
    super();
    this.logger = new Logger('MemoryManager');
    this.config = config;
    this.mcpManager = mcpManager;
  }

  /**
   * 初始化记忆管理器
   */
  async initialize(): Promise<void> {
    this.logger.info('初始化记忆管理器');

    try {
      // 根据配置选择存储提供者
      switch (this.config.provider) {
        case 'openmemory':
          await this.initializeOpenMemory();
          break;
        case 'local':
          await this.initializeLocalStorage();
          break;
        default:
          throw new Error(`不支持的记忆提供者: ${this.config.provider}`);
      }

      // 启动定期任务
      this.startPeriodicTasks();

      this.isInitialized = true;
      this.emit('initialized');

    } catch (error) {
      this.logger.error(`记忆管理器初始化失败: ${error}`);
      throw error;
    }
  }

  /**
   * 初始化OpenMemory
   */
  private async initializeOpenMemory(): Promise<void> {
    if (!this.mcpManager) {
      throw new Error('使用OpenMemory需要MCP管理器');
    }

    const mcpName = this.config.openmemory?.mcp_name || 'openmemory';

    // 检查OpenMemory MCP是否可用
    const isAvailable = await this.mcpManager.isServiceAvailable(mcpName);
    if (!isAvailable) {
      throw new Error(`OpenMemory MCP服务不可用: ${mcpName}`);
    }

    this.logger.info('OpenMemory初始化完成');
  }

  /**
   * 初始化本地存储
   */
  private async initializeLocalStorage(): Promise<void> {
    const storagePath = this.config.local?.storage_path || './.manus/memory';

    try {
      await fs.mkdir(storagePath, { recursive: true });
      this.logger.info(`本地存储初始化完成: ${storagePath}`);
    } catch (error) {
      throw new Error(`本地存储初始化失败: ${error}`);
    }
  }

  /**
   * 记录任务提交
   */
  async recordTaskSubmission(task: Task): Promise<void> {
    const entry: MemoryEntry = {
      id: `task_submit_${task.id}_${Date.now()}`,
      type: MemoryType.TASK_SUBMISSION,
      timestamp: Date.now(),
      content: {
        taskId: task.id,
        taskType: task.type,
        description: task.description,
        priority: task.priority,
        requiredCapabilities: task.requiredCapabilities
      },
      importance: this.calculateImportance(task.priority),
      tags: ['task', 'submission', task.type, task.priority],
      context: task.context
    };

    await this.storeMemory(entry);
  }

  /**
   * 记录任务执行
   */
  async recordTaskExecution(task: Task, decision: DecisionResult): Promise<void> {
    const entry: MemoryEntry = {
      id: `task_exec_${task.id}_${Date.now()}`,
      type: MemoryType.TASK_EXECUTION,
      timestamp: Date.now(),
      content: {
        taskId: task.id,
        decision: {
          targetType: decision.targetType,
          targetName: decision.targetName,
          confidence: decision.confidence,
          reasoning: decision.reasoning
        },
        startTime: Date.now()
      },
      importance: this.calculateImportance(task.priority),
      tags: ['task', 'execution', decision.targetType, decision.targetName],
      context: { taskType: task.type }
    };

    await this.storeMemory(entry);
  }

  /**
   * 记录任务完成
   */
  async recordTaskCompletion(task: Task, result: TaskResult): Promise<void> {
    const entry: MemoryEntry = {
      id: `task_complete_${task.id}_${Date.now()}`,
      type: MemoryType.TASK_COMPLETION,
      timestamp: Date.now(),
      content: {
        taskId: task.id,
        status: result.status,
        executionTime: result.executionTime,
        executedBy: result.executedBy,
        success: result.status === 'completed',
        error: result.error
      },
      importance: result.status === 'completed' ? 0.8 : 0.9, // 失败的任务重要性更高
      tags: ['task', 'completion', result.status, result.executedBy],
      context: { taskType: task.type }
    };

    await this.storeMemory(entry);
  }

  /**
   * 记录决策制定
   */
  async recordDecision(task: Task, decision: DecisionResult, context: any): Promise<void> {
    const entry: MemoryEntry = {
      id: `decision_${task.id}_${Date.now()}`,
      type: MemoryType.DECISION_MAKING,
      timestamp: Date.now(),
      content: {
        taskId: task.id,
        decision,
        context,
        reasoning: decision.reasoning
      },
      importance: 0.7,
      tags: ['decision', decision.targetType, decision.targetName],
      context: { confidence: decision.confidence }
    };

    await this.storeMemory(entry);
  }

  /**
   * 记录系统事件
   */
  async recordSystemEvent(event: string, details: any, importance: number = 0.5): Promise<void> {
    const entry: MemoryEntry = {
      id: `system_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: MemoryType.SYSTEM_EVENT,
      timestamp: Date.now(),
      content: {
        event,
        details
      },
      importance,
      tags: ['system', event],
      context: details
    };

    await this.storeMemory(entry);
  }

  /**
   * 记录用户交互
   */
  async recordUserInteraction(interaction: string, details: any): Promise<void> {
    const entry: MemoryEntry = {
      id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: MemoryType.USER_INTERACTION,
      timestamp: Date.now(),
      content: {
        interaction,
        details
      },
      importance: 0.8, // 用户交互通常比较重要
      tags: ['user', 'interaction'],
      context: details
    };

    await this.storeMemory(entry);
  }

  /**
   * 记录错误事件
   */
  async recordError(error: Error, context: any): Promise<void> {
    const entry: MemoryEntry = {
      id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: MemoryType.ERROR_EVENT,
      timestamp: Date.now(),
      content: {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        },
        context
      },
      importance: 0.9, // 错误事件重要性很高
      tags: ['error', error.name],
      context
    };

    await this.storeMemory(entry);
  }

  /**
   * 查询记忆
   */
  async queryMemories(query: MemoryQuery): Promise<MemoryEntry[]> {
    try {
      if (this.config.provider === 'openmemory') {
        return await this.queryOpenMemory(query);
      } else {
        return await this.queryLocalMemory(query);
      }
    } catch (error) {
      this.logger.error(`查询记忆失败: ${error}`);
      return [];
    }
  }

  /**
   * 获取相关记忆
   */
  async getRelatedMemories(entryId: string, limit: number = 10): Promise<MemoryEntry[]> {
    const entry = await this.getMemoryById(entryId);
    if (!entry) {
      return [];
    }

    // 基于标签和时间范围查找相关记忆
    const query: MemoryQuery = {
      tags: entry.tags,
      timeRange: {
        start: entry.timestamp - 3600000, // 前后1小时
        end: entry.timestamp + 3600000
      },
      limit
    };

    const related = await this.queryMemories(query);
    return related.filter(r => r.id !== entryId);
  }

  /**
   * 压缩记忆
   */
  async compressMemories(): Promise<void> {
    if (this.config.provider !== 'openmemory') {
      this.logger.warning('记忆压缩仅支持OpenMemory提供者');
      return;
    }

    const threshold = this.config.openmemory?.compression_threshold || 1000;
    const totalEntries = await this.getMemoryCount();

    if (totalEntries < threshold) {
      return;
    }

    this.logger.info('开始压缩记忆');

    try {
      // 获取需要压缩的记忆（较旧且重要性较低的）
      const query: MemoryQuery = {
        importance: { min: 0, max: 0.5 },
        timeRange: {
          start: 0,
          end: Date.now() - 86400000 // 24小时前
        },
        limit: 100,
        sortBy: 'timestamp',
        sortOrder: 'asc'
      };

      const toCompress = await this.queryMemories(query);

      if (toCompress.length > 0) {
        await this.performCompression(toCompress);
        this.logger.info(`压缩了 ${toCompress.length} 条记忆`);
      }

    } catch (error) {
      this.logger.error(`记忆压缩失败: ${error}`);
    }
  }

  /**
   * 提取重要记忆
   */
  async extractImportantMemories(): Promise<MemoryEntry[]> {
    const query: MemoryQuery = {
      importance: { min: 0.8, max: 1.0 },
      limit: 50,
      sortBy: 'importance',
      sortOrder: 'desc'
    };

    return await this.queryMemories(query);
  }

  /**
   * 保存检查点
   */
  async saveCheckpoint(taskId: string, checkpoint: TaskCheckpoint): Promise<void> {
    const entry: MemoryEntry = {
      id: `checkpoint_${checkpoint.id}`,
      type: MemoryType.SYSTEM_EVENT,
      timestamp: checkpoint.timestamp,
      content: {
        taskId,
        checkpoint
      },
      importance: 0.9, // 检查点很重要
      tags: ['checkpoint', 'task', taskId],
      context: { canResume: checkpoint.canResume }
    };

    await this.storeMemory(entry);
  }

  /**
   * 获取检查点
   */
  async getCheckpoints(): Promise<TaskCheckpoint[]> {
    const query: MemoryQuery = {
      tags: ['checkpoint'],
      sortBy: 'timestamp',
      sortOrder: 'desc'
    };

    const entries = await this.queryMemories(query);
    return entries.map(entry => entry.content.checkpoint).filter(Boolean);
  }

  /**
   * 根据ID获取任务
   */
  async getTaskById(taskId: string): Promise<Task | null> {
    const query: MemoryQuery = {
      types: [MemoryType.TASK_SUBMISSION],
      tags: ['task', taskId]
    };

    const entries = await this.queryMemories(query);
    if (entries.length === 0) {
      return null;
    }

    const entry = entries[0];
    return {
      id: entry.content.taskId,
      type: entry.content.taskType,
      description: entry.content.description,
      priority: entry.content.priority,
      requiredCapabilities: entry.content.requiredCapabilities,
      context: entry.context,
      createdAt: entry.timestamp
    };
  }

  /**
   * 存储记忆
   */
  private async storeMemory(entry: MemoryEntry): Promise<void> {
    // 添加到缓存
    this.memoryCache.set(entry.id, entry);

    // 根据提供者存储
    if (this.config.provider === 'openmemory') {
      await this.storeToOpenMemory(entry);
    } else {
      await this.storeToLocal(entry);
    }

    // 检查是否需要压缩
    if (entry.importance < 0.6) {
      this.compressionQueue.push(entry);
    }

    this.emit('memory_stored', entry);
  }

  /**
   * 存储到OpenMemory
   */
  private async storeToOpenMemory(entry: MemoryEntry): Promise<void> {
    if (!this.mcpManager) {
      throw new Error('MCP管理器未初始化');
    }

    const mcpName = this.config.openmemory?.mcp_name || 'openmemory';

    try {
      await this.mcpManager.callTool(mcpName, 'store_memory', {
        id: entry.id,
        type: entry.type,
        timestamp: entry.timestamp,
        content: JSON.stringify(entry.content),
        importance: entry.importance,
        tags: entry.tags,
        context: entry.context ? JSON.stringify(entry.context) : undefined
      });
    } catch (error) {
      this.logger.error(`存储到OpenMemory失败: ${error}`);
      throw error;
    }
  }

  /**
   * 存储到本地
   */
  private async storeToLocal(entry: MemoryEntry): Promise<void> {
    const storagePath = this.config.local?.storage_path || './.manus/memory';
    const filePath = path.join(storagePath, `${entry.id}.json`);

    try {
      await fs.writeFile(filePath, JSON.stringify(entry, null, 2));
    } catch (error) {
      this.logger.error(`本地存储失败: ${error}`);
      throw error;
    }
  }

  /**
   * 从OpenMemory查询
   */
  private async queryOpenMemory(query: MemoryQuery): Promise<MemoryEntry[]> {
    if (!this.mcpManager) {
      throw new Error('MCP管理器未初始化');
    }

    const mcpName = this.config.openmemory?.mcp_name || 'openmemory';

    try {
      const result = await this.mcpManager.callTool(mcpName, 'query_memory', {
        types: query.types,
        tags: query.tags,
        time_range: query.timeRange,
        importance_range: query.importance,
        limit: query.limit,
        sort_by: query.sortBy,
        sort_order: query.sortOrder
      });

      return result.memories || [];
    } catch (error) {
      this.logger.error(`OpenMemory查询失败: ${error}`);
      return [];
    }
  }

  /**
   * 从本地查询
   */
  private async queryLocalMemory(query: MemoryQuery): Promise<MemoryEntry[]> {
    const storagePath = this.config.local?.storage_path || './.manus/memory';

    try {
      const files = await fs.readdir(storagePath);
      const entries: MemoryEntry[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(storagePath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const entry: MemoryEntry = JSON.parse(content);

          if (this.matchesQuery(entry, query)) {
            entries.push(entry);
          }
        }
      }

      // 排序和限制
      this.sortEntries(entries, query.sortBy, query.sortOrder);

      if (query.limit) {
        return entries.slice(0, query.limit);
      }

      return entries;
    } catch (error) {
      this.logger.error(`本地查询失败: ${error}`);
      return [];
    }
  }

  /**
   * 检查条目是否匹配查询
   */
  private matchesQuery(entry: MemoryEntry, query: MemoryQuery): boolean {
    // 检查类型
    if (query.types && !query.types.includes(entry.type)) {
      return false;
    }

    // 检查标签
    if (query.tags && !query.tags.some(tag => entry.tags.includes(tag))) {
      return false;
    }

    // 检查时间范围
    if (query.timeRange) {
      if (entry.timestamp < query.timeRange.start || entry.timestamp > query.timeRange.end) {
        return false;
      }
    }

    // 检查重要性
    if (query.importance) {
      if (entry.importance < query.importance.min || entry.importance > query.importance.max) {
        return false;
      }
    }

    return true;
  }

  /**
   * 排序条目
   */
  private sortEntries(entries: MemoryEntry[], sortBy?: string, sortOrder?: string): void {
    if (!sortBy) return;

    entries.sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'timestamp') {
        comparison = a.timestamp - b.timestamp;
      } else if (sortBy === 'importance') {
        comparison = a.importance - b.importance;
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });
  }

  /**
   * 根据ID获取记忆
   */
  private async getMemoryById(id: string): Promise<MemoryEntry | null> {
    // 先检查缓存
    if (this.memoryCache.has(id)) {
      return this.memoryCache.get(id)!;
    }

    // 从存储中查询
    const query: MemoryQuery = { limit: 1 };
    const entries = await this.queryMemories(query);

    return entries.find(entry => entry.id === id) || null;
  }

  /**
   * 获取记忆总数
   */
  private async getMemoryCount(): Promise<number> {
    if (this.config.provider === 'openmemory') {
      // 从OpenMemory获取
      try {
        const mcpName = this.config.openmemory?.mcp_name || 'openmemory';
        const result = await this.mcpManager!.callTool(mcpName, 'get_memory_count', {});
        return result.count || 0;
      } catch (error) {
        return 0;
      }
    } else {
      // 从本地存储获取
      try {
        const storagePath = this.config.local?.storage_path || './.manus/memory';
        const files = await fs.readdir(storagePath);
        return files.filter(file => file.endsWith('.json')).length;
      } catch (error) {
        return 0;
      }
    }
  }

  /**
   * 执行压缩
   */
  private async performCompression(entries: MemoryEntry[]): Promise<void> {
    if (this.config.provider === 'openmemory') {
      const mcpName = this.config.openmemory?.mcp_name || 'openmemory';

      try {
        await this.mcpManager!.callTool(mcpName, 'compress_memories', {
          entry_ids: entries.map(e => e.id)
        });
      } catch (error) {
        this.logger.error(`OpenMemory压缩失败: ${error}`);
      }
    }
    // 本地压缩可以简单地删除文件或合并内容
  }

  /**
   * 计算重要性
   */
  private calculateImportance(priority: string): number {
    const priorityMap: Record<string, number> = {
      'low': 0.3,
      'medium': 0.5,
      'high': 0.7,
      'urgent': 0.9
    };

    return priorityMap[priority] || 0.5;
  }

  /**
   * 启动定期任务
   */
  private startPeriodicTasks(): void {
    // 定期压缩
    const compressionInterval = this.config.openmemory?.extraction_interval || 3600000;
    this.compressionInterval = setInterval(() => {
      this.compressMemories().catch(error => {
        this.logger.error(`定期压缩失败: ${error}`);
      });
    }, compressionInterval);

    // 定期清理缓存
    setInterval(() => {
      this.cleanupCache();
    }, 300000); // 5分钟
  }

  /**
   * 清理缓存
   */
  private cleanupCache(): void {
    const maxCacheSize = 1000;
    if (this.memoryCache.size > maxCacheSize) {
      const entries = Array.from(this.memoryCache.entries());
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);

      // 保留最新的条目
      const toKeep = entries.slice(0, maxCacheSize);
      this.memoryCache.clear();

      for (const [id, entry] of toKeep) {
        this.memoryCache.set(id, entry);
      }
    }
  }

  /**
   * 获取统计信息
   */
  async getStatistics(): Promise<MemoryStatistics> {
    const allEntries = await this.queryMemories({ limit: 10000 });

    const entriesByType: Record<MemoryType, number> = {
      [MemoryType.TASK_SUBMISSION]: 0,
      [MemoryType.TASK_EXECUTION]: 0,
      [MemoryType.TASK_COMPLETION]: 0,
      [MemoryType.DECISION_MAKING]: 0,
      [MemoryType.SYSTEM_EVENT]: 0,
      [MemoryType.USER_INTERACTION]: 0,
      [MemoryType.ERROR_EVENT]: 0
    };

    let totalImportance = 0;
    let compressedCount = 0;
    let oldestTimestamp = Date.now();
    let newestTimestamp = 0;

    for (const entry of allEntries) {
      entriesByType[entry.type]++;
      totalImportance += entry.importance;

      if (entry.compressed) {
        compressedCount++;
      }

      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
      }

      if (entry.timestamp > newestTimestamp) {
        newestTimestamp = entry.timestamp;
      }
    }

    return {
      totalEntries: allEntries.length,
      entriesByType,
      compressedEntries: compressedCount,
      averageImportance: allEntries.length > 0 ? totalImportance / allEntries.length : 0,
      oldestEntry: oldestTimestamp,
      newestEntry: newestTimestamp,
      storageSize: 0 // 简化实现
    };
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    if (this.compressionInterval) {
      clearInterval(this.compressionInterval);
    }

    if (this.extractionInterval) {
      clearInterval(this.extractionInterval);
    }

    this.memoryCache.clear();
    this.emit('cleanup');
  }
}
