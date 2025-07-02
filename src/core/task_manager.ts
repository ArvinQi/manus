/**
 * 任务管理器
 * 负责任务的调度、优先级管理、中断处理和执行流程控制
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { TaskManagementConfig } from '../schema/multi_agent_config.js';
import { Task, DecisionResult, DecisionEngine } from './decision_engine.js';
import { MultiMcpManager } from '../mcp/multi_mcp_manager.js';
import { A2AAgentManager } from '../agent/a2a_agent_manager.js';
import { MemoryManager } from './memory_manager.js';

// 任务状态
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  INTERRUPTED = 'interrupted',
}

// 任务执行结果
export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  result?: any;
  error?: string;
  startTime: number;
  endTime?: number;
  executionTime?: number;
  executedBy: string;
  checkpoints: TaskCheckpoint[];
}

// 任务检查点
export interface TaskCheckpoint {
  id: string;
  timestamp: number;
  state: any;
  description: string;
  canResume: boolean;
}

// 执行中的任务
export interface RunningTask {
  task: Task;
  status: TaskStatus;
  decision: DecisionResult;
  startTime: number;
  lastCheckpoint?: TaskCheckpoint;
  executionPromise?: Promise<TaskResult>;
  controller?: AbortController;
  progress: number;
  estimatedCompletion?: number;
}

// 任务队列项
export interface TaskQueueItem {
  task: Task;
  priority: number;
  insertTime: number;
  dependencies?: string[];
}

/**
 * 任务管理器类
 */
export class TaskManager extends EventEmitter {
  private logger: Logger;
  private config: TaskManagementConfig;
  private decisionEngine: DecisionEngine;
  private mcpManager: MultiMcpManager;
  private agentManager: A2AAgentManager;
  private memoryManager: MemoryManager;

  // 任务队列和状态管理
  private taskQueue: TaskQueueItem[] = [];
  private highPriorityQueue: TaskQueueItem[] = [];
  private runningTasks: Map<string, RunningTask> = new Map();
  private pausedTasks: Map<string, RunningTask> = new Map();
  private completedTasks: Map<string, TaskResult> = new Map();
  private taskHistory: TaskResult[] = [];
  private interruptionScheduled = false;
  private canInterruptFlag = false;

  // 调度和控制
  private schedulerInterval?: NodeJS.Timeout;
  private checkpointInterval?: NodeJS.Timeout;
  private isShuttingDown = false;

  // 统计信息
  private statistics = {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    averageExecutionTime: 0,
    currentLoad: 0,
  };

  constructor(
    config: TaskManagementConfig,
    decisionEngine: DecisionEngine,
    mcpManager: MultiMcpManager,
    agentManager: A2AAgentManager,
    memoryManager: MemoryManager
  ) {
    super();
    this.logger = new Logger('TaskManager');
    this.config = config;
    this.decisionEngine = decisionEngine;
    this.mcpManager = mcpManager;
    this.agentManager = agentManager;
    this.memoryManager = memoryManager;
  }

  /**
   * 启动任务管理器
   */
  async start(): Promise<void> {
    this.logger.info('启动任务管理器');

    // 启动任务调度器
    this.startScheduler();

    // 启动检查点管理
    this.startCheckpointManager();

    // 恢复未完成的任务
    if (this.config.auto_recovery) {
      await this.recoverTasks();
    }

    this.emit('started');
  }

  /**
   * 停止任务管理器
   */
  async stop(): Promise<void> {
    this.logger.info('停止任务管理器');
    this.isShuttingDown = true;

    // 停止调度器
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
    }

    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
    }

    // 等待运行中的任务完成或取消
    await this.gracefulShutdown();

    this.emit('stopped');
  }

  /**
   * 提交新任务
   */
  async submitTask(task: Task): Promise<string> {
    this.logger.info(`提交新任务: ${task.id} (${task.type})`);

    // 验证任务
    this.validateTask(task);

    // 计算优先级分数
    const priorityScore = this.calculatePriorityScore(task);

    // 添加到队列
    const queueItem: TaskQueueItem = {
      task,
      priority: priorityScore,
      insertTime: Date.now(),
      dependencies: task.metadata?.dependencies,
    };

    this.insertTaskIntoQueue(queueItem);
    this.statistics.totalTasks++;

    // 记录到内存
    await this.memoryManager.recordTaskSubmission(task);

    this.emit('task_submitted', { task, priority: priorityScore });

    return task.id;
  }

  /**
   * 插入高优先级任务（中断当前执行）
   */
  async insertHighPriorityTask(task: Task): Promise<string> {
    this.logger.info(`插入高优先级任务: ${task.id}`);

    // 强制设置为紧急优先级
    task.priority = 'urgent';

    // 根据中断策略处理当前任务
    await this.handleTaskInterruption(task);

    // 提交任务
    return this.submitTask(task);
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<boolean> {
    this.logger.info(`取消任务: ${taskId}`);

    // 检查是否在队列中
    const queueIndex = this.taskQueue.findIndex((item) => item.task.id === taskId);
    if (queueIndex !== -1) {
      this.taskQueue.splice(queueIndex, 1);
      this.emit('task_cancelled', { taskId, stage: 'queued' });
      return true;
    }

    // 检查是否正在运行
    const runningTask = this.runningTasks.get(taskId);
    if (runningTask) {
      if (runningTask.controller) {
        runningTask.controller.abort();
      }
      runningTask.status = TaskStatus.CANCELLED;
      this.emit('task_cancelled', { taskId, stage: 'running' });
      return true;
    }

    return false;
  }

  /**
   * 暂停任务
   */
  async pauseTask(taskId: string): Promise<boolean> {
    const runningTask = this.runningTasks.get(taskId);
    if (!runningTask) {
      return false;
    }

    runningTask.status = TaskStatus.PAUSED;

    // 创建检查点
    await this.createCheckpoint(runningTask);

    this.emit('task_paused', { taskId });
    return true;
  }

  /**
   * 恢复任务
   */
  async resumeTask(taskId: string): Promise<boolean> {
    const runningTask = this.runningTasks.get(taskId);
    if (!runningTask || runningTask.status !== TaskStatus.PAUSED) {
      return false;
    }

    runningTask.status = TaskStatus.RUNNING;
    this.emit('task_resumed', { taskId });
    return true;
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId: string): TaskStatus | null {
    // 检查运行中的任务
    const runningTask = this.runningTasks.get(taskId);
    if (runningTask) {
      return runningTask.status;
    }

    // 检查已完成的任务
    const completedTask = this.completedTasks.get(taskId);
    if (completedTask) {
      return completedTask.status;
    }

    // 检查队列中的任务
    const queuedTask = this.taskQueue.find((item) => item.task.id === taskId);
    if (queuedTask) {
      return TaskStatus.PENDING;
    }

    return null;
  }

  /**
   * 获取任务结果
   */
  getTaskResult(taskId: string): TaskResult | null {
    return this.completedTasks.get(taskId) || null;
  }

  /**
   * 获取队列状态
   */
  getQueueStatus(): {
    pending: number;
    running: number;
    completed: number;
    failed: number;
  } {
    return {
      pending: this.taskQueue.length,
      running: this.runningTasks.size,
      completed: this.statistics.completedTasks,
      failed: this.statistics.failedTasks,
    };
  }

  /**
   * 启动任务调度器
   */
  private startScheduler(): void {
    this.schedulerInterval = setInterval(async () => {
      if (this.isShuttingDown) return;

      try {
        await this.scheduleNextTask();
      } catch (error) {
        this.logger.error(`调度器错误: ${error}`);
      }
    }, 1000); // 每秒检查一次
  }

  /**
   * 调度下一个任务
   */
  private async scheduleNextTask(): Promise<void> {
    // 检查是否达到最大并发数
    if (this.runningTasks.size >= this.config.max_concurrent_tasks) {
      return;
    }

    // 优先从高优先级队列获取任务
    let nextTask = this.getNextExecutableTaskFromHighPriority();
    if (nextTask) {
      const index = this.highPriorityQueue.indexOf(nextTask);
      this.highPriorityQueue.splice(index, 1);
    } else {
      // 从普通队列获取任务
      nextTask = this.getNextExecutableTask();
      if (nextTask) {
        const index = this.taskQueue.indexOf(nextTask);
        this.taskQueue.splice(index, 1);
      }
    }

    if (nextTask) {
      await this.executeTask(nextTask.task);
    }
  }

  /**
   * 获取下一个可执行的任务
   */
  private getNextExecutableTask(): TaskQueueItem | null {
    for (const item of this.taskQueue) {
      // 检查依赖是否满足
      if (this.areDependenciesSatisfied(item)) {
        return item;
      }
    }
    return null;
  }

  /**
   * 检查任务依赖是否满足
   */
  private areDependenciesSatisfied(item: TaskQueueItem): boolean {
    if (!item.dependencies || item.dependencies.length === 0) {
      return true;
    }

    return item.dependencies.every((depId) => {
      const result = this.completedTasks.get(depId);
      return result && result.status === TaskStatus.COMPLETED;
    });
  }

  /**
   * 执行任务
   */
  async executeTask(task: Task): Promise<void> {
    this.logger.info(`开始执行任务: ${task.id}`);

    try {
      // 做出执行决策
      const decision = await this.decisionEngine.makeDecision(task);

      // 创建运行中的任务记录
      const controller = new AbortController();
      const runningTask: RunningTask = {
        task,
        status: TaskStatus.RUNNING,
        decision,
        startTime: Date.now(),
        controller,
        progress: 0,
      };

      this.runningTasks.set(task.id, runningTask);
      this.emit('task_started', { task, decision });

      // 记录到内存
      await this.memoryManager.recordTaskExecution(task, decision);

      // 执行任务
      const executionPromise = this.performTaskExecution(runningTask);
      runningTask.executionPromise = executionPromise;

      // 等待执行完成
      const result = await executionPromise;

      // 更新统计信息
      this.updateStatistics(result);

      // 移除运行中的任务
      this.runningTasks.delete(task.id);

      // 保存结果
      this.completedTasks.set(task.id, result);
      this.taskHistory.push(result);

      // 记录到内存
      await this.memoryManager.recordTaskCompletion(task, result);

      this.emit('task_completed', { task, result });
    } catch (error) {
      this.logger.error(`任务执行失败: ${task.id} - ${error}`);

      const result: TaskResult = {
        taskId: task.id,
        status: TaskStatus.FAILED,
        error: error instanceof Error ? error.message : String(error),
        startTime: Date.now(),
        endTime: Date.now(),
        executedBy: 'unknown',
        checkpoints: [],
      };

      this.runningTasks.delete(task.id);
      this.completedTasks.set(task.id, result);
      this.statistics.failedTasks++;

      this.emit('task_failed', { task, error });
    }
  }

  /**
   * 执行具体的任务
   */
  private async performTaskExecution(runningTask: RunningTask): Promise<TaskResult> {
    const { task, decision, controller } = runningTask;

    // 设置超时
    const timeout = setTimeout(() => {
      controller?.abort();
    }, this.config.task_timeout);

    try {
      let result: any;

      // 根据决策结果执行任务
      switch (decision.targetType) {
        case 'mcp':
          result = await this.executeMcpTask(task, decision, controller?.signal);
          break;
        case 'agent':
          result = await this.executeAgentTask(task, decision, controller?.signal);
          break;
        case 'local':
          result = await this.executeLocalTask(task, controller?.signal);
          break;
        default:
          throw new Error(`未知的目标类型: ${decision.targetType}`);
      }

      return {
        taskId: task.id,
        status: TaskStatus.COMPLETED,
        result,
        startTime: runningTask.startTime,
        endTime: Date.now(),
        executionTime: Date.now() - runningTask.startTime,
        executedBy: decision.targetName,
        checkpoints: runningTask.lastCheckpoint ? [runningTask.lastCheckpoint] : [],
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 执行MCP任务
   */
  private async executeMcpTask(
    task: Task,
    decision: DecisionResult,
    signal?: AbortSignal
  ): Promise<any> {
    return await this.mcpManager.executeTask(decision.targetName, {
      taskId: task.id,
      taskType: task.type,
      description: task.description,
      parameters: task.context || {},
      signal,
    });
  }

  /**
   * 执行代理任务
   */
  private async executeAgentTask(
    task: Task,
    decision: DecisionResult,
    signal?: AbortSignal
  ): Promise<any> {
    return await this.agentManager.executeTask(decision.targetName, {
      taskId: task.id,
      taskType: task.type,
      description: task.description,
      parameters: task.context || {},
      priority: task.priority,
      timeout: this.config.task_timeout,
      requiredCapabilities: task.requiredCapabilities,
      context: task.context,
    });
  }

  /**
   * 执行本地任务
   */
  private async executeLocalTask(task: Task, signal?: AbortSignal): Promise<any> {
    // 简化的本地任务执行
    this.logger.info(`本地执行任务: ${task.id}`);

    // 模拟任务执行
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return {
      message: `任务 ${task.id} 在本地执行完成`,
      timestamp: Date.now(),
    };
  }

  /**
   * 处理任务中断
   */
  private async handleTaskInterruption(newTask: Task): Promise<void> {
    switch (this.config.interruption_policy) {
      case 'immediate':
        await this.interruptAllTasks();
        break;
      case 'at_checkpoint':
        await this.interruptAtCheckpoint();
        break;
      case 'after_current':
        // 不中断，等待当前任务完成
        break;
    }
  }

  /**
   * 立即中断所有任务
   */
  private async interruptAllTasks(): Promise<void> {
    for (const [taskId, runningTask] of this.runningTasks) {
      if (runningTask.controller) {
        runningTask.controller.abort();
      }
      runningTask.status = TaskStatus.INTERRUPTED;

      // 创建检查点以便恢复
      await this.createCheckpoint(runningTask);
    }
  }

  /**
   * 在检查点中断任务
   */
  private async interruptAtCheckpoint(): Promise<void> {
    for (const [taskId, runningTask] of this.runningTasks) {
      runningTask.status = TaskStatus.INTERRUPTED;
      // 等待下一个检查点时中断
    }
  }

  /**
   * 启动检查点管理器
   */
  private startCheckpointManager(): void {
    this.checkpointInterval = setInterval(async () => {
      if (this.isShuttingDown) return;

      for (const runningTask of this.runningTasks.values()) {
        if (runningTask.status === TaskStatus.RUNNING) {
          await this.createCheckpoint(runningTask);
        }
      }
    }, this.config.checkpoint_interval);
  }

  /**
   * 创建任务检查点
   */
  private async createCheckpoint(runningTask: RunningTask): Promise<void> {
    if (!this.config.task_persistence) return;

    const checkpoint: TaskCheckpoint = {
      id: `${runningTask.task.id}_${Date.now()}`,
      timestamp: Date.now(),
      state: {
        progress: runningTask.progress,
        status: runningTask.status,
        decision: runningTask.decision,
      },
      description: `检查点 - 进度: ${runningTask.progress}%`,
      canResume: true,
    };

    runningTask.lastCheckpoint = checkpoint;

    // 持久化检查点
    await this.memoryManager.saveCheckpoint(runningTask.task.id, checkpoint);
  }

  /**
   * 恢复任务
   */
  private async recoverTasks(): Promise<void> {
    this.logger.info('恢复未完成的任务');

    try {
      const checkpoints = await this.memoryManager.getCheckpoints();

      for (const checkpoint of checkpoints) {
        if (checkpoint.canResume) {
          // 重新提交任务
          const task = await this.memoryManager.getTaskById(checkpoint.id.split('_')[0]);
          if (task) {
            await this.submitTask(task);
          }
        }
      }
    } catch (error) {
      this.logger.error(`任务恢复失败: ${error}`);
    }
  }

  /**
   * 优雅关闭
   */
  private async gracefulShutdown(): Promise<void> {
    this.logger.info('开始优雅关闭');

    // 等待运行中的任务完成
    const runningPromises = Array.from(this.runningTasks.values())
      .map((task) => task.executionPromise)
      .filter((promise) => promise !== undefined);

    if (runningPromises.length > 0) {
      this.logger.info(`等待 ${runningPromises.length} 个任务完成`);
      await Promise.allSettled(runningPromises);
    }
  }

  /**
   * 验证任务
   */
  private validateTask(task: Task): void {
    if (!task.id || !task.type || !task.description) {
      throw new Error('任务缺少必要字段');
    }

    if (this.runningTasks.has(task.id) || this.completedTasks.has(task.id)) {
      throw new Error(`任务ID已存在: ${task.id}`);
    }
  }

  /**
   * 计算优先级分数
   */
  private calculatePriorityScore(task: Task): number {
    const priorityMap = {
      low: 1,
      medium: 2,
      high: 3,
      urgent: 4,
    };

    let score = priorityMap[task.priority] || 1;

    // 考虑截止时间
    if (task.deadline) {
      const timeLeft = task.deadline - Date.now();
      if (timeLeft < 3600000) {
        // 1小时内
        score += 2;
      } else if (timeLeft < 86400000) {
        // 24小时内
        score += 1;
      }
    }

    return score;
  }

  /**
   * 插入任务到队列（按优先级排序）
   */
  private insertTaskIntoQueue(item: TaskQueueItem): void {
    // 找到插入位置
    let insertIndex = 0;
    for (let i = 0; i < this.taskQueue.length; i++) {
      if (this.taskQueue[i].priority < item.priority) {
        insertIndex = i;
        break;
      }
      insertIndex = i + 1;
    }

    this.taskQueue.splice(insertIndex, 0, item);
  }

  /**
   * 更新统计信息
   */
  private updateStatistics(result: TaskResult): void {
    if (result.status === TaskStatus.COMPLETED) {
      this.statistics.completedTasks++;
    } else if (result.status === TaskStatus.FAILED) {
      this.statistics.failedTasks++;
    }

    if (result.executionTime) {
      const totalTime =
        this.statistics.averageExecutionTime * (this.statistics.completedTasks - 1) +
        result.executionTime;
      this.statistics.averageExecutionTime = totalTime / this.statistics.completedTasks;
    }

    this.statistics.currentLoad = this.runningTasks.size / this.config.max_concurrent_tasks;
  }

  /**
   * 获取统计信息
   */
  getStatistics(): typeof this.statistics {
    return { ...this.statistics };
  }

  /**
   * 获取管理器状态
   */
  getStatus(): any {
    return {
      isRunning: !this.isShuttingDown,
      queueLength: this.taskQueue.length,
      highPriorityQueueLength: this.highPriorityQueue.length,
      runningTasks: this.runningTasks.size,
      pausedTasks: this.pausedTasks.size,
      completedTasks: this.statistics.completedTasks,
      failedTasks: this.statistics.failedTasks,
      averageExecutionTime: this.statistics.averageExecutionTime,
      currentLoad: this.statistics.currentLoad,
      interruptionScheduled: this.interruptionScheduled,
    };
  }

  /**
   * 添加高优先级任务
   */
  async addHighPriorityTask(task: Task): Promise<string> {
    this.logger.info(`添加高优先级任务: ${task.id}`);

    // 验证任务
    this.validateTask(task);

    // 强制设置为高优先级
    task.priority = 'high';

    // 计算优先级分数
    const priorityScore = this.calculatePriorityScore(task) + 10; // 额外加分

    // 添加到高优先级队列
    const queueItem: TaskQueueItem = {
      task,
      priority: priorityScore,
      insertTime: Date.now(),
      dependencies: task.metadata?.dependencies,
    };

    this.insertTaskIntoHighPriorityQueue(queueItem);
    this.statistics.totalTasks++;

    // 触发高优先级任务事件
    this.emit('high_priority_task', task);

    // 记录到内存
    await this.memoryManager.recordTaskSubmission(task);

    return task.id;
  }

  /**
   * 暂停当前任务
   */
  async pauseCurrentTasks(): Promise<void> {
    this.logger.info('暂停当前执行的任务');

    for (const [taskId, runningTask] of this.runningTasks) {
      if (runningTask.status === TaskStatus.RUNNING) {
        // 创建检查点
        await this.createCheckpoint(runningTask);

        // 暂停任务
        runningTask.status = TaskStatus.PAUSED;

        // 移动到暂停队列
        this.pausedTasks.set(taskId, runningTask);

        this.emit('task_paused', { taskId });
      }
    }

    // 清空运行任务队列
    this.runningTasks.clear();
  }

  /**
   * 恢复暂停的任务
   */
  async resumePausedTasks(): Promise<void> {
    this.logger.info('恢复暂停的任务');

    for (const [taskId, pausedTask] of this.pausedTasks) {
      // 恢复任务状态
      pausedTask.status = TaskStatus.RUNNING;

      // 移回运行队列
      this.runningTasks.set(taskId, pausedTask);

      this.emit('task_resumed', { taskId });
    }

    // 清空暂停队列
    this.pausedTasks.clear();
  }

  /**
   * 调度中断
   */
  scheduleInterruption(task: Task): void {
    this.logger.info(`调度中断任务: ${task.id}`);
    this.interruptionScheduled = true;

    // 在下一个检查点时处理中断
    setTimeout(() => {
      this.canInterruptFlag = true;
    }, this.config.checkpoint_interval);
  }

  /**
   * 检查是否可以在检查点中断
   */
  async canInterruptAtCheckpoint(): Promise<boolean> {
    return this.canInterruptFlag && this.interruptionScheduled;
  }

  /**
   * 执行中断任务
   */
  async executeInterruptTask(task: Task): Promise<void> {
    this.logger.info(`执行中断任务: ${task.id}`);

    // 重置中断标志
    this.interruptionScheduled = false;
    this.canInterruptFlag = false;

    // 执行任务
    await this.executeTask(task);
  }

  /**
   * 插入任务到高优先级队列
   */
  private insertTaskIntoHighPriorityQueue(item: TaskQueueItem): void {
    // 找到插入位置
    let insertIndex = 0;
    for (let i = 0; i < this.highPriorityQueue.length; i++) {
      if (this.highPriorityQueue[i].priority < item.priority) {
        insertIndex = i;
        break;
      }
      insertIndex = i + 1;
    }

    this.highPriorityQueue.splice(insertIndex, 0, item);
  }

  /**
   * 从高优先级队列获取下一个可执行任务
   */
  private getNextExecutableTaskFromHighPriority(): TaskQueueItem | null {
    for (const item of this.highPriorityQueue) {
      if (this.areDependenciesSatisfied(item)) {
        return item;
      }
    }
    return null;
  }
}
