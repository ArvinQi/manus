/**
 * 多代理系统核心协调器
 * 整合MCP管理器、A2A代理管理器、决策引擎、任务管理器和记忆管理器
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { MultiAgentSystemConfig } from '../schema/multi_agent_config.js';
import { MultiMcpManager } from '../mcp/multi_mcp_manager.js';
import { A2AAgentManager } from '../agent/a2a_agent_manager.js';
import { DecisionEngine, Task } from './decision_engine.js';
import { TaskManager, TaskStatus } from './task_manager.js';
import { MemoryManager } from './memory_manager.js';
import { ToolRouter, RoutingStrategy } from './tool_router.js';

// 系统状态
export enum SystemStatus {
  INITIALIZING = 'initializing',
  RUNNING = 'running',
  PAUSED = 'paused',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  ERROR = 'error',
}

// 系统事件
export interface SystemEvent {
  type: string;
  timestamp: number;
  source: string;
  data: any;
  severity: 'info' | 'warning' | 'error';
}

// 系统指标
export interface SystemMetrics {
  uptime: number;
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  mcpServices: {
    total: number;
    active: number;
    failed: number;
  };
  agents: {
    total: number;
    active: number;
    busy: number;
  };
  memory: {
    totalEntries: number;
    cacheSize: number;
    compressionRate: number;
  };
  performance: {
    averageTaskTime: number;
    systemLoad: number;
    decisionAccuracy: number;
  };
}

/**
 * 多代理系统类
 */
export class MultiAgentSystem extends EventEmitter {
  private logger: Logger;
  private config: MultiAgentSystemConfig;
  private status: SystemStatus = SystemStatus.STOPPED;
  private startTime: number = 0;

  // 核心组件
  private mcpManager: MultiMcpManager;
  private agentManager: A2AAgentManager;
  private memoryManager: MemoryManager;
  private decisionEngine: DecisionEngine;
  private taskManager: TaskManager;
  private toolRouter: ToolRouter;

  // 系统监控
  private events: SystemEvent[] = [];
  private metricsInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  private priorityTaskInterval?: NodeJS.Timeout;
  private interruptQueue: Task[] = [];

  constructor(config: MultiAgentSystemConfig) {
    super();
    this.logger = new Logger('MultiAgentSystem');
    this.config = config;

    // 初始化组件
    this.mcpManager = new MultiMcpManager();
    this.agentManager = new A2AAgentManager();
    this.memoryManager = new MemoryManager(config.memory_config, this.mcpManager);
    this.decisionEngine = new DecisionEngine(
      config.decision_engine,
      config.routing_rules,
      this.mcpManager,
      this.agentManager
    );
    this.toolRouter = new ToolRouter(this.mcpManager, this.agentManager, this.decisionEngine, {
      strategy: RoutingStrategy.HYBRID,
      mcpPriority: 0.6,
      a2aPriority: 0.4,
      timeout: 30000,
      retryCount: 2,
      fallbackEnabled: true
    });
    this.taskManager = new TaskManager(
      config.task_management,
      this.decisionEngine,
      this.mcpManager,
      this.agentManager,
      this.memoryManager
    );

    this.setupEventHandlers();
  }

  /**
   * 启动多代理系统
   */
  async start(): Promise<void> {
    this.logger.info('启动多代理系统');
    this.status = SystemStatus.INITIALIZING;
    this.startTime = Date.now();

    try {
      // 1. 初始化记忆管理器
      this.logger.info('初始化记忆管理器...');
      await this.memoryManager.initialize();
      await this.recordSystemEvent('memory_manager_initialized', {}, 'info');

      // 2. 初始化MCP服务
      this.logger.info('初始化MCP服务...');
      await this.mcpManager.initialize(this.config.mcp_services);
      await this.recordSystemEvent(
        'mcp_services_initialized',
        {
          count: this.config.mcp_services.length,
        },
        'info'
      );

      // 3. 初始化A2A代理
      this.logger.info('初始化A2A代理...');
      await this.agentManager.initialize(this.config.a2a_agents);
      await this.recordSystemEvent(
        'a2a_agents_initialized',
        {
          count: this.config.a2a_agents.length,
        },
        'info'
      );

      // 4. 启动决策引擎
      this.logger.info('启动决策引擎...');
      this.decisionEngine.startPeriodicCleanup();
      await this.recordSystemEvent('decision_engine_started', {}, 'info');

      // 5. 启动任务管理器
      this.logger.info('启动任务管理器...');
      await this.taskManager.start();
      await this.recordSystemEvent('task_manager_started', {}, 'info');

      // 6. 启动系统监控
      this.startSystemMonitoring();

      // 7. 启动高优先级任务监听
      this.startPriorityTaskMonitoring();

      this.status = SystemStatus.RUNNING;
      this.logger.info(`多代理系统启动完成，耗时: ${Date.now() - this.startTime}ms`);

      await this.recordSystemEvent(
        'system_started',
        {
          startTime: this.startTime,
          duration: Date.now() - this.startTime,
          components: ['memory', 'mcp', 'agents', 'decision', 'tasks'],
        },
        'info'
      );

      this.emit('started');
    } catch (error) {
      this.status = SystemStatus.ERROR;
      this.logger.error('系统启动失败:', error);

      await this.recordSystemEvent(
        'system_start_failed',
        {
          error: error instanceof Error ? error.message : String(error),
        },
        'error'
      );

      throw error;
    }
  }

  /**
   * 停止多代理系统
   */
  async stop(): Promise<void> {
    this.logger.info('停止多代理系统');
    this.status = SystemStatus.STOPPING;

    try {
      // 停止系统监控
      this.stopSystemMonitoring();

      // 停止高优先级任务监听
      this.stopPriorityTaskMonitoring();

      // 停止任务管理器
      await this.taskManager.stop();

      // 停止A2A代理管理器
      await this.agentManager.shutdown();

      // 停止MCP管理器
      await this.mcpManager.shutdown();

      // 清理记忆管理器
      await this.memoryManager.cleanup();

      this.status = SystemStatus.STOPPED;
      this.logger.info('多代理系统已停止');

      await this.recordSystemEvent(
        'system_stopped',
        {
          uptime: this.getUptime(),
        },
        'info'
      );

      this.emit('stopped');
    } catch (error) {
      this.status = SystemStatus.ERROR;
      this.logger.error(`系统停止失败: ${error}`);
      throw error;
    }
  }

  /**
   * 暂停系统
   */
  async pause(): Promise<void> {
    if (this.status !== SystemStatus.RUNNING) {
      throw new Error('只能暂停运行中的系统');
    }

    this.status = SystemStatus.PAUSED;
    this.logger.info('系统已暂停');

    await this.recordSystemEvent('system_paused', {}, 'info');
    this.emit('paused');
  }

  /**
   * 恢复系统
   */
  async resume(): Promise<void> {
    if (this.status !== SystemStatus.PAUSED) {
      throw new Error('只能恢复暂停的系统');
    }

    this.status = SystemStatus.RUNNING;
    this.logger.info('系统已恢复');

    await this.recordSystemEvent('system_resumed', {}, 'info');
    this.emit('resumed');
  }

  /**
   * 提交任务
   */
  async submitTask(
    taskDescription: string,
    options: {
      type?: string;
      priority?: 'low' | 'medium' | 'high' | 'urgent';
      requiredCapabilities?: string[];
      context?: Record<string, any>;
      deadline?: number;
    } = {}
  ): Promise<string> {
    if (this.status !== SystemStatus.RUNNING) {
      throw new Error('系统未运行，无法提交任务');
    }

    const task: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: options.type || 'general',
      description: taskDescription,
      priority: options.priority || 'medium',
      requiredCapabilities: options.requiredCapabilities || [],
      context: options.context,
      createdAt: Date.now(),
      deadline: options.deadline,
    };

    this.logger.info(`提交任务: ${task.id} - ${taskDescription}`);

    // 记录用户交互
    await this.memoryManager.recordUserInteraction('task_submission', {
      taskId: task.id,
      description: taskDescription,
      options,
    });

    // 提交到任务管理器
    const taskId = await this.taskManager.submitTask(task);

    await this.recordSystemEvent(
      'task_submitted',
      {
        taskId,
        type: task.type,
        priority: task.priority,
      },
      'info'
    );

    return taskId;
  }

  /**
   * 插入高优先级任务
   */
  async insertHighPriorityTask(
    taskDescription: string,
    options: {
      type?: string;
      requiredCapabilities?: string[];
      context?: Record<string, any>;
    } = {}
  ): Promise<string> {
    const task: Task = {
      id: `urgent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: options.type || 'urgent',
      description: taskDescription,
      priority: 'urgent',
      requiredCapabilities: options.requiredCapabilities || [],
      context: options.context,
      createdAt: Date.now(),
    };

    this.logger.info(`插入高优先级任务: ${task.id} - ${taskDescription}`);

    // 记录用户交互
    await this.memoryManager.recordUserInteraction('urgent_task_submission', {
      taskId: task.id,
      description: taskDescription,
      options,
    });

    // 插入高优先级任务
    const taskId = await this.taskManager.insertHighPriorityTask(task);

    await this.recordSystemEvent(
      'urgent_task_inserted',
      {
        taskId,
        type: task.type,
      },
      'warning'
    );

    return taskId;
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const result = await this.taskManager.cancelTask(taskId);

    if (result) {
      await this.recordSystemEvent('task_cancelled', { taskId }, 'info');
    }

    return result;
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId: string): TaskStatus | null {
    return this.taskManager.getTaskStatus(taskId);
  }

  /**
   * 获取任务结果
   */
  getTaskResult(taskId: string): any {
    return this.taskManager.getTaskResult(taskId);
  }

  /**
   * 获取系统状态
   */
  getSystemStatus(): SystemStatus {
    return this.status;
  }

  /**
   * 获取系统指标
   */
  async getSystemMetrics(): Promise<SystemMetrics> {
    const taskStats = this.taskManager.getStatistics();
    const queueStatus = this.taskManager.getQueueStatus();
    const mcpServices = await this.mcpManager.getServiceStatistics();
    const agents = await this.agentManager.getAgentStatistics();
    const memoryStats = await this.memoryManager.getStatistics();
    const decisionStats = this.decisionEngine.getStatistics();

    return {
      uptime: this.getUptime(),
      totalTasks: taskStats.totalTasks,
      activeTasks: queueStatus.running,
      completedTasks: taskStats.completedTasks,
      failedTasks: taskStats.failedTasks,
      mcpServices: {
        total: mcpServices.total,
        active: mcpServices.connected,
        failed: mcpServices.failed,
      },
      agents: {
        total: agents.total,
        active: agents.connected,
        busy: agents.busy,
      },
      memory: {
        totalEntries: memoryStats.totalEntries,
        cacheSize: 0, // 简化实现
        compressionRate: memoryStats.compressedEntries / Math.max(memoryStats.totalEntries, 1),
      },
      performance: {
        averageTaskTime: taskStats.averageExecutionTime,
        systemLoad: taskStats.currentLoad,
        decisionAccuracy: decisionStats.averageConfidence,
      },
    };
  }

  /**
   * 获取系统事件
   */
  getSystemEvents(limit: number = 100): SystemEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * 查询记忆
   */
  async queryMemories(query: any): Promise<any[]> {
    return await this.memoryManager.queryMemories(query);
  }

  /**
   * 获取相关记忆
   */
  async getRelatedMemories(entryId: string, limit: number = 10): Promise<any[]> {
    return await this.memoryManager.getRelatedMemories(entryId, limit);
  }

  /**
   * 添加MCP服务
   */
  async addMcpService(config: any): Promise<void> {
    await this.mcpManager.addService(config);
    await this.recordSystemEvent(
      'mcp_service_added',
      {
        name: config.name,
        type: config.type,
      },
      'info'
    );
  }

  /**
   * 移除MCP服务
   */
  async removeMcpService(name: string): Promise<void> {
    await this.mcpManager.removeService(name);
    await this.recordSystemEvent('mcp_service_removed', { name }, 'info');
  }

  /**
   * 添加A2A代理
   */
  async addAgent(config: any): Promise<void> {
    await this.agentManager.addAgent(config);
    await this.recordSystemEvent(
      'agent_added',
      {
        name: config.name,
        type: config.type,
      },
      'info'
    );
  }

  /**
   * 移除A2A代理
   */
  async removeAgent(name: string): Promise<void> {
    await this.agentManager.removeAgent(name);
    await this.recordSystemEvent('agent_removed', { name }, 'info');
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    // MCP管理器事件
    this.mcpManager.on('service_connected', (data) => {
      this.recordSystemEvent('mcp_service_connected', data, 'info');
    });

    this.mcpManager.on('service_disconnected', (data) => {
      this.recordSystemEvent('mcp_service_disconnected', data, 'warning');
    });

    this.mcpManager.on('service_error', (data) => {
      this.recordSystemEvent('mcp_service_error', data, 'error');
    });

    // A2A代理管理器事件
    this.agentManager.on('agent_connected', (data) => {
      this.recordSystemEvent('agent_connected', data, 'info');
    });

    this.agentManager.on('agent_disconnected', (data) => {
      this.recordSystemEvent('agent_disconnected', data, 'warning');
    });

    this.agentManager.on('agent_error', (data) => {
      this.recordSystemEvent('agent_error', data, 'error');
    });

    // 任务管理器事件
    this.taskManager.on('task_started', (data) => {
      this.recordSystemEvent('task_started', data, 'info');
    });

    this.taskManager.on('task_completed', (data) => {
      this.recordSystemEvent('task_completed', data, 'info');
    });

    this.taskManager.on('task_failed', (data) => {
      this.recordSystemEvent('task_failed', data, 'error');
    });

    // 决策引擎事件
    this.decisionEngine.on('decision_made', (data) => {
      this.recordSystemEvent('decision_made', data, 'info');
    });

    // 记忆管理器事件
    this.memoryManager.on('memory_stored', (data) => {
      this.recordSystemEvent('memory_stored', data, 'info');
    });
  }

  /**
   * 记录系统事件
   */
  private async recordSystemEvent(
    type: string,
    data: any,
    severity: 'info' | 'warning' | 'error'
  ): Promise<void> {
    const event: SystemEvent = {
      type,
      timestamp: Date.now(),
      source: 'MultiAgentSystem',
      data,
      severity,
    };

    this.events.push(event);

    // 限制事件历史大小
    if (this.events.length > 10000) {
      this.events = this.events.slice(-5000);
    }

    // 记录到内存管理器
    try {
      await this.memoryManager.recordSystemEvent(type, data, severity === 'error' ? 0.9 : 0.5);
    } catch (error) {
      this.logger.error(`记录系统事件失败: ${error}`);
    }

    this.emit('system_event', event);
  }

  /**
   * 启动系统监控
   */
  private startSystemMonitoring(): void {
    // 定期收集指标
    this.metricsInterval = setInterval(async () => {
      try {
        const metrics = await this.getSystemMetrics();
        this.emit('metrics_updated', metrics);
      } catch (error) {
        this.logger.error(`指标收集失败: ${error}`);
      }
    }, 60000); // 每分钟

    // 健康检查
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error(`健康检查失败: ${error}`);
      }
    }, 30000); // 每30秒
  }

  /**
   * 停止系统监控
   */
  private stopSystemMonitoring(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }

  /**
   * 执行健康检查
   */
  private async performHealthCheck(): Promise<void> {
    const checks = {
      mcpServices: await this.mcpManager.healthCheck(),
      agents: await this.agentManager.healthCheck(),
      taskManager: this.taskManager.getStatistics().currentLoad < 0.9,
      memoryManager: true, // 简化实现
    };

    const allHealthy = Object.values(checks).every((check) => check);

    if (!allHealthy) {
      await this.recordSystemEvent('health_check_failed', checks, 'warning');
    }
  }

  /**
   * 获取系统运行时间
   */
  private getUptime(): number {
    return this.startTime > 0 ? Date.now() - this.startTime : 0;
  }

  /**
   * 获取配置
   */
  getConfig(): MultiAgentSystemConfig {
    return this.config;
  }

  /**
   * 获取决策引擎
   */
  getDecisionEngine(): DecisionEngine {
    return this.decisionEngine;
  }

  /**
   * 获取工具路由器
   */
  getToolRouter(): ToolRouter {
    return this.toolRouter;
  }

  /**
   * 获取任务管理器
   */
  getTaskManager(): TaskManager {
    return this.taskManager;
  }

  /**
   * 更新配置
   */
  async updateConfig(newConfig: Partial<MultiAgentSystemConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig };
    await this.recordSystemEvent('config_updated', newConfig, 'info');
    this.emit('config_updated', this.config);
  }

  /**
   * 启动高优先级任务监听
   */
  private startPriorityTaskMonitoring(): void {
    this.logger.info('启动高优先级任务监听');

    // 监听任务管理器的高优先级任务事件
    this.taskManager.on('high_priority_task', this.handleHighPriorityTask.bind(this));
    this.taskManager.on('urgent_task', this.handleUrgentTask.bind(this));

    // 定期检查中断队列
    this.priorityTaskInterval = setInterval(() => {
      this.processInterruptQueue();
    }, 5000); // 每5秒检查一次
  }

  /**
   * 停止高优先级任务监听
   */
  private stopPriorityTaskMonitoring(): void {
    this.logger.info('停止高优先级任务监听');

    if (this.priorityTaskInterval) {
      clearInterval(this.priorityTaskInterval);
      this.priorityTaskInterval = undefined;
    }

    // 移除事件监听器
    this.taskManager.removeAllListeners('high_priority_task');
    this.taskManager.removeAllListeners('urgent_task');
  }

  /**
   * 处理高优先级任务
   */
  private async handleHighPriorityTask(task: Task): Promise<void> {
    this.logger.info(`收到高优先级任务: ${task.id}`);

    try {
      // 记录高优先级任务事件
      await this.recordSystemEvent(
        'high_priority_task_received',
        {
          taskId: task.id,
          priority: task.priority,
          type: task.type,
        },
        'info'
      );

      // 根据中断策略处理
      switch (this.config.task_management.interruption_policy) {
        case 'immediate':
          await this.handleImmediateInterruption(task);
          break;
        case 'at_checkpoint':
          await this.handleCheckpointInterruption(task);
          break;
        case 'after_current':
          await this.handleAfterCurrentInterruption(task);
          break;
      }

      // 记录到OpenMemory
      await this.memoryManager.recordTaskSubmission(task);
    } catch (error) {
      this.logger.error('处理高优先级任务失败:', error);
      await this.recordSystemEvent(
        'high_priority_task_failed',
        {
          taskId: task.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'error'
      );
    }
  }

  /**
   * 处理紧急任务
   */
  private async handleUrgentTask(task: Task): Promise<void> {
    this.logger.warning(`收到紧急任务: ${task.id}`);

    try {
      // 紧急任务总是立即中断
      await this.handleImmediateInterruption(task);

      // 记录紧急任务事件
      await this.recordSystemEvent(
        'urgent_task_received',
        {
          taskId: task.id,
          priority: task.priority,
          type: task.type,
        },
        'warning'
      );

      // 记录到OpenMemory
      await this.memoryManager.recordTaskSubmission(task);
    } catch (error) {
      this.logger.error('处理紧急任务失败:', error);
      await this.recordSystemEvent(
        'urgent_task_failed',
        {
          taskId: task.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'error'
      );
    }
  }

  /**
   * 立即中断处理
   */
  private async handleImmediateInterruption(task: Task): Promise<void> {
    this.logger.info(`立即中断当前任务，执行: ${task.id}`);

    // 暂停当前正在执行的任务
    await this.taskManager.pauseCurrentTasks();

    // 立即执行高优先级任务
    await this.taskManager.executeTask(task);

    // 恢复之前暂停的任务
    await this.taskManager.resumePausedTasks();
  }

  /**
   * 检查点中断处理
   */
  private async handleCheckpointInterruption(task: Task): Promise<void> {
    this.logger.info(`在检查点中断，执行: ${task.id}`);

    // 添加到中断队列，等待检查点
    this.interruptQueue.push(task);

    // 通知任务管理器在下一个检查点中断
    this.taskManager.scheduleInterruption(task);
  }

  /**
   * 当前任务完成后中断处理
   */
  private async handleAfterCurrentInterruption(task: Task): Promise<void> {
    this.logger.info(`当前任务完成后执行: ${task.id}`);

    // 添加到高优先级队列
    await this.taskManager.addHighPriorityTask(task);
  }

  /**
   * 处理中断队列
   */
  private async processInterruptQueue(): Promise<void> {
    if (this.interruptQueue.length === 0) {
      return;
    }

    // 检查是否可以处理中断队列中的任务
    const canInterrupt = await this.taskManager.canInterruptAtCheckpoint();

    if (canInterrupt && this.interruptQueue.length > 0) {
      const task = this.interruptQueue.shift()!;
      this.logger.info(`从中断队列处理任务: ${task.id}`);

      try {
        await this.taskManager.executeInterruptTask(task);

        await this.recordSystemEvent(
          'interrupt_task_executed',
          {
            taskId: task.id,
            queueLength: this.interruptQueue.length,
          },
          'info'
        );
      } catch (error) {
        this.logger.error('执行中断任务失败:', error);

        // 如果执行失败，可以选择重新加入队列或丢弃
        if (task.retryCount && task.retryCount < 3) {
          task.retryCount = (task.retryCount || 0) + 1;
          this.interruptQueue.unshift(task); // 重新加入队列头部
        }
      }
    }
  }

  /**
   * 获取中断队列状态
   */
  getInterruptQueueStatus(): { length: number; tasks: Task[] } {
    return {
      length: this.interruptQueue.length,
      tasks: [...this.interruptQueue],
    };
  }

  /**
   * 导出系统状态
   */
  async exportSystemState(): Promise<any> {
    return {
      status: this.status,
      uptime: this.getUptime(),
      config: this.config,
      metrics: await this.getSystemMetrics(),
      events: this.getSystemEvents(1000),
      timestamp: Date.now(),
    };
  }

  /**
   * 导入系统状态
   */
  async importSystemState(state: any): Promise<void> {
    // 简化实现，实际应该验证状态并恢复系统
    this.logger.info('导入系统状态');
    await this.recordSystemEvent(
      'system_state_imported',
      {
        timestamp: state.timestamp,
      },
      'info'
    );
  }
}
