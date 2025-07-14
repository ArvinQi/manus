/**
 * Manus 类
 * 一个多功能的通用代理，支持多种工具
 * 重构版本：优化任务持久化和继续执行功能
 */

import { ToolCallAgent } from './toolcall.js';
import { ToolCollection } from '../tool/tool_collection.js';
import { Logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { ToolCall, ToolChoice } from '../schema/index.js';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { BaseTool } from '../tool/base.js';
import { MultiAgentSystem } from '../core/multi_agent_system.js';
import { ToolRouter, RoutingStrategy } from '../core/tool_router.js';
import {
  ConversationContextManager,
  ConversationConfig,
} from '../core/conversation_context_manager.js';
import { Message, Role } from '../schema/index.js';
import { PlanManager, Plan, PlanStep, StepStatus as PlanStepStatus } from '../core/plan_manager.js';

// 系统提示词
const SYSTEM_PROMPT = `你是一个功能强大的智能助手，可以帮助用户完成各种任务。
你可以使用多种工具来解决问题，包括命令行、文件操作、搜索、浏览器操作、代码执行等。
当需要时，你应该主动使用这些工具来获取信息或执行操作。

任务执行原则：
1. 首先分析任务需求，制定详细的执行计划
2. 按步骤执行，每步完成后评估结果并更新进度
3. 自动保存任务状态，支持中断后继续执行
4. 遇到错误时自动重试和恢复，不知道下一步时从计划工具获取当前计划分析下一步
5. 持续优化执行策略，提高成功率

当前工作目录: {directory}
任务状态将自动保存到 .manus 目录中，支持中断后继续执行。`;

// 下一步提示词
const NEXT_STEP_PROMPT = '请分析当前任务状态，思考下一步应该做什么，并使用适当的工具来完成任务。';

// 任务状态枚举
enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

// 任务步骤状态枚举
enum StepStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

// 任务步骤接口
interface TaskStep {
  id: string;
  title: string;
  description: string;
  status: StepStatus;
  startTime?: number;
  endTime?: number;
  result?: any;
  error?: string;
  retryCount: number;
  maxRetries: number;
  dependencies: string[];
  estimatedDuration?: number;
  actualDuration?: number;
}

// 任务持久化接口
interface TaskPersistence {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  startTime?: number;
  endTime?: number;
  steps: TaskStep[];
  currentStepIndex: number;
  context: Record<string, any>;
  metadata: {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    progress: number;
    estimatedCompletionTime?: number;
    actualCompletionTime?: number;
    sourceFile?: string;
    userId?: string;
  };
  checkpoints: TaskCheckpoint[];
  executionHistory: ExecutionEvent[];
}

// 任务检查点接口
interface TaskCheckpoint {
  id: string;
  timestamp: number;
  stepIndex: number;
  context: Record<string, any>;
  description: string;
}

// 执行事件接口
interface ExecutionEvent {
  id: string;
  timestamp: number;
  type:
    | 'step_start'
    | 'step_complete'
    | 'step_fail'
    | 'step_retry'
    | 'step_skip'
    | 'task_start'
    | 'task_complete'
    | 'task_fail'
    | 'task_pause'
    | 'task_resume'
    | 'error'
    | 'checkpoint';
  stepId?: string;
  description: string;
  data?: any;
}

/**
 * 任务管理器类
 * 负责任务的创建、执行、持久化和恢复
 * 使用固定文件名避免多个任务计划同时存在
 */
class TaskManager {
  private workspaceRoot: string;
  private taskDir: string;
  private logger: Logger;
  private currentTask?: TaskPersistence;
  private autoSaveInterval?: NodeJS.Timeout;
  private checkpointInterval?: NodeJS.Timeout;

  // 固定的任务文件名
  private static readonly CURRENT_TASK_FILE = 'current_task.json';
  private static readonly TASK_HISTORY_FILE = 'task_history.json';

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.taskDir = path.join(workspaceRoot, '.manus', 'tasks');
    this.logger = new Logger('TaskManager');
    // 不在构造函数中立即创建目录，而是在需要时才创建
  }

  /**
   * 确保任务目录存在
   */
  private ensureTaskDirectory(): void {
    if (!fs.existsSync(this.taskDir)) {
      fs.mkdirSync(this.taskDir, { recursive: true });
    }
  }

  /**
   * 创建新任务
   * 使用固定文件名，新任务会覆盖旧任务
   */
  createTask(title: string, description: string, steps: Omit<TaskStep, 'id'>[]): TaskPersistence {
    // 确保任务目录存在（备份后重新创建）
    this.ensureTaskDirectory();

    // 在创建新任务之前，先保存当前任务到历史记录
    if (this.currentTask) {
      this.saveTaskToHistory(this.currentTask);
    }

    const taskId = this.generateTaskId();
    const now = Date.now();

    const task: TaskPersistence = {
      id: taskId,
      title,
      description,
      status: TaskStatus.PENDING,
      createdAt: now,
      updatedAt: now,
      steps: steps.map((step, index) => ({
        ...step,
        id: `${taskId}_step_${index}`,
      })),
      currentStepIndex: 0,
      context: {},
      metadata: {
        totalSteps: steps.length,
        completedSteps: 0,
        failedSteps: 0,
        progress: 0,
      },
      checkpoints: [],
      executionHistory: [],
    };

    this.currentTask = task;
    this.saveTask(task);
    this.startAutoSave();

    this.logger.info(`新任务已创建: ${title} (ID: ${taskId})`);
    return task;
  }

  /**
   * 加载当前任务
   */
  loadTask(taskId?: string): TaskPersistence | null {
    try {
      this.ensureTaskDirectory();
      const taskFile = path.join(this.taskDir, TaskManager.CURRENT_TASK_FILE);
      if (!fs.existsSync(taskFile)) {
        return null;
      }

      const taskData = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));

      // 如果指定了taskId，检查是否匹配
      if (taskId && taskData.id !== taskId) {
        this.logger.warn(`任务ID不匹配: 期望 ${taskId}, 实际 ${taskData.id}`);
        return null;
      }

      this.currentTask = taskData;
      this.startAutoSave();

      this.logger.info(`任务已加载: ${taskData.title} (ID: ${taskData.id})`);
      return taskData;
    } catch (error) {
      this.logger.error(`加载任务失败: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * 获取当前任务（如果存在且有效）
   */
  getRecentTask(): TaskPersistence | null {
    try {
      this.ensureTaskDirectory();
      const taskFile = path.join(this.taskDir, TaskManager.CURRENT_TASK_FILE);
      if (!fs.existsSync(taskFile)) {
        return null;
      }

      const taskData = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));

      // 检查任务是否在最近24小时内更新
      const maxAge = 24 * 60 * 60 * 1000; // 24小时
      if (Date.now() - taskData.updatedAt > maxAge) {
        this.logger.info('当前任务已过期，忽略');
        return null;
      }

      // 只返回未完成的任务
      if (taskData.status === TaskStatus.COMPLETED || taskData.status === TaskStatus.CANCELLED) {
        this.logger.info('当前任务已完成或已取消，忽略');
        return null;
      }

      return taskData;
    } catch (error) {
      this.logger.error(`获取当前任务失败: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * 保存任务到固定文件
   */
  private saveTask(task: TaskPersistence): void {
    try {
      this.ensureTaskDirectory();
      task.updatedAt = Date.now();
      const taskFile = path.join(this.taskDir, TaskManager.CURRENT_TASK_FILE);
      fs.writeFileSync(taskFile, JSON.stringify(task, null, 2));
    } catch (error) {
      this.logger.error(`保存任务失败: ${(error as Error).message}`);
    }
  }

  /**
   * 保存任务到历史记录
   */
  private saveTaskToHistory(task: TaskPersistence): void {
    try {
      this.ensureTaskDirectory();
      const historyFile = path.join(this.taskDir, TaskManager.TASK_HISTORY_FILE);
      let history: TaskPersistence[] = [];

      // 读取现有历史记录
      if (fs.existsSync(historyFile)) {
        try {
          const historyData = fs.readFileSync(historyFile, 'utf-8');
          history = JSON.parse(historyData);
        } catch (error) {
          this.logger.warn(`读取历史记录失败，将创建新的历史记录: ${(error as Error).message}`);
        }
      }

      // 添加当前任务到历史记录
      history.push({
        ...task,
        endTime: Date.now(),
      });

      // 保持历史记录数量限制（最多保留100个）
      if (history.length > 100) {
        history = history.slice(-100);
      }

      // 保存历史记录
      fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
      this.logger.info(`任务已保存到历史记录: ${task.title}`);
    } catch (error) {
      this.logger.error(`保存历史记录失败: ${(error as Error).message}`);
    }
  }

  /**
   * 启动当前任务
   */
  startTask(): boolean {
    if (!this.currentTask) {
      return false;
    }

    this.currentTask.status = TaskStatus.RUNNING;
    this.currentTask.startTime = Date.now();
    this.addExecutionEvent('task_start', '任务开始执行');
    this.saveTask(this.currentTask);
    this.startCheckpointSaver();

    this.logger.info(`任务开始执行: ${this.currentTask.title}`);
    return true;
  }

  /**
   * 暂停当前任务
   */
  pauseTask(): boolean {
    if (!this.currentTask || this.currentTask.status !== TaskStatus.RUNNING) {
      return false;
    }

    this.currentTask.status = TaskStatus.PAUSED;
    this.addExecutionEvent('task_pause', '任务暂停');
    this.createCheckpoint('任务暂停检查点');
    this.saveTask(this.currentTask);

    this.logger.info(`任务已暂停: ${this.currentTask.title}`);
    return true;
  }

  /**
   * 恢复当前任务
   */
  resumeTask(): boolean {
    if (!this.currentTask || this.currentTask.status !== TaskStatus.PAUSED) {
      return false;
    }

    this.currentTask.status = TaskStatus.RUNNING;
    this.addExecutionEvent('task_resume', '任务恢复执行');
    this.saveTask(this.currentTask);
    this.startCheckpointSaver();

    this.logger.info(`任务已恢复: ${this.currentTask.title}`);
    return true;
  }

  /**
   * 完成当前任务
   */
  completeTask(): boolean {
    if (!this.currentTask) {
      return false;
    }

    this.currentTask.status = TaskStatus.COMPLETED;
    this.currentTask.endTime = Date.now();
    this.currentTask.metadata.actualCompletionTime = this.currentTask.endTime;
    this.addExecutionEvent('task_complete', '任务完成');
    this.saveTask(this.currentTask);
    this.stopAutoSave();

    this.logger.info(`任务已完成: ${this.currentTask.title}`);
    return true;
  }

  /**
   * 获取当前步骤
   */
  getCurrentStep(): TaskStep | null {
    if (!this.currentTask || this.currentTask.currentStepIndex >= this.currentTask.steps.length) {
      return null;
    }

    return this.currentTask.steps[this.currentTask.currentStepIndex];
  }

  /**
   * 开始当前步骤
   */
  startCurrentStep(): boolean {
    const step = this.getCurrentStep();
    if (!step) {
      return false;
    }

    step.status = StepStatus.RUNNING;
    step.startTime = Date.now();
    this.addExecutionEvent('step_start', `开始执行步骤: ${step.title}`, step.id);
    this.saveTask(this.currentTask!);

    this.logger.info(`开始执行步骤: ${step.title}`);
    return true;
  }

  /**
   * 完成当前步骤
   */
  completeCurrentStep(result?: any): boolean {
    const step = this.getCurrentStep();
    if (!step) {
      return false;
    }

    step.status = StepStatus.COMPLETED;
    step.endTime = Date.now();
    step.result = result;
    step.actualDuration = step.endTime - (step.startTime || step.endTime);

    this.currentTask!.currentStepIndex++;
    this.currentTask!.metadata.completedSteps++;
    this.updateProgress();

    this.addExecutionEvent('step_complete', `完成步骤: ${step.title}`, step.id);
    this.createCheckpoint(`步骤完成检查点: ${step.title}`);
    this.saveTask(this.currentTask!);

    this.logger.info(`步骤完成: ${step.title}`);

    // 检查是否所有步骤都完成
    if (this.currentTask!.currentStepIndex >= this.currentTask!.steps.length) {
      this.completeTask();
    }

    return true;
  }

  /**
   * 当前步骤失败
   */
  failCurrentStep(error: string): boolean {
    const step = this.getCurrentStep();
    if (!step) {
      return false;
    }

    step.retryCount++;
    step.error = error;

    // 检查是否可以重试
    if (step.retryCount <= step.maxRetries) {
      this.addExecutionEvent(
        'step_retry',
        `步骤重试: ${step.title} (第${step.retryCount}次)`,
        step.id
      );
      this.logger.warn(`步骤重试: ${step.title} (第${step.retryCount}次)`);
      return true;
    }

    // 标记步骤失败
    step.status = StepStatus.FAILED;
    step.endTime = Date.now();
    step.actualDuration = step.endTime - (step.startTime || step.endTime);

    this.currentTask!.metadata.failedSteps++;
    this.updateProgress();

    this.addExecutionEvent('step_fail', `步骤失败: ${step.title}`, step.id);
    this.saveTask(this.currentTask!);

    this.logger.error(`步骤失败: ${step.title} - ${error}`);

    // 检查是否应该终止任务
    if (this.shouldTerminateTask()) {
      this.currentTask!.status = TaskStatus.FAILED;
      this.addExecutionEvent('task_fail', '任务因步骤失败而终止');
      this.saveTask(this.currentTask!);
      this.stopAutoSave();
    }

    return false;
  }

  /**
   * 跳过当前步骤
   */
  skipCurrentStep(reason: string): boolean {
    const step = this.getCurrentStep();
    if (!step) {
      return false;
    }

    step.status = StepStatus.SKIPPED;
    step.endTime = Date.now();
    step.error = reason;

    this.currentTask!.currentStepIndex++;
    this.updateProgress();

    this.addExecutionEvent('step_skip', `跳过步骤: ${step.title} - ${reason}`, step.id);
    this.saveTask(this.currentTask!);

    this.logger.info(`跳过步骤: ${step.title} - ${reason}`);
    return true;
  }

  /**
   * 更新任务进度
   */
  private updateProgress(): void {
    if (!this.currentTask) return;

    const { totalSteps, completedSteps, failedSteps } = this.currentTask.metadata;
    this.currentTask.metadata.progress = ((completedSteps + failedSteps) / totalSteps) * 100;
  }

  /**
   * 创建检查点
   */
  private createCheckpoint(description: string): void {
    if (!this.currentTask) return;

    const checkpoint: TaskCheckpoint = {
      id: `checkpoint_${Date.now()}`,
      timestamp: Date.now(),
      stepIndex: this.currentTask.currentStepIndex,
      context: { ...this.currentTask.context },
      description,
    };

    this.currentTask.checkpoints.push(checkpoint);
    this.addExecutionEvent('checkpoint', description);
  }

  /**
   * 添加执行事件
   */
  private addExecutionEvent(
    type: ExecutionEvent['type'],
    description: string,
    stepId?: string,
    data?: any
  ): void {
    if (!this.currentTask) return;

    const event: ExecutionEvent = {
      id: `event_${Date.now()}`,
      timestamp: Date.now(),
      type,
      stepId,
      description,
      data,
    };

    this.currentTask.executionHistory.push(event);
  }

  /**
   * 是否应该终止任务
   */
  private shouldTerminateTask(): boolean {
    if (!this.currentTask) return false;

    const { totalSteps, failedSteps } = this.currentTask.metadata;
    // 如果失败步骤超过总步骤的50%，终止任务
    return failedSteps > totalSteps * 0.5;
  }

  /**
   * 开始自动保存
   */
  private startAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    this.autoSaveInterval = setInterval(() => {
      if (this.currentTask) {
        this.saveTask(this.currentTask);
      }
    }, 10000); // 每10秒保存一次
  }

  /**
   * 停止自动保存
   */
  private stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = undefined;
    }
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
      this.checkpointInterval = undefined;
    }
  }

  /**
   * 开始检查点保存
   */
  private startCheckpointSaver(): void {
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
    }

    this.checkpointInterval = setInterval(() => {
      if (this.currentTask && this.currentTask.status === TaskStatus.RUNNING) {
        this.createCheckpoint('定时检查点');
      }
    }, 30000); // 每30秒创建一个检查点
  }

  /**
   * 生成任务ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取当前任务
   */
  getCurrentTask(): TaskPersistence | undefined {
    return this.currentTask;
  }

  /**
   * 设置任务上下文
   */
  setTaskContext(key: string, value: any): void {
    if (this.currentTask) {
      this.currentTask.context[key] = value;
      this.saveTask(this.currentTask);
    }
  }

  /**
   * 获取任务上下文
   */
  getTaskContext(key: string): any {
    return this.currentTask?.context[key];
  }

  /**
   * 获取任务历史记录
   */
  getTaskHistory(limit: number = 10): TaskPersistence[] {
    try {
      this.ensureTaskDirectory();
      const historyFile = path.join(this.taskDir, TaskManager.TASK_HISTORY_FILE);
      if (!fs.existsSync(historyFile)) {
        return [];
      }

      const historyData = fs.readFileSync(historyFile, 'utf-8');
      const history: TaskPersistence[] = JSON.parse(historyData);

      // 返回最近的记录
      return history.slice(-limit).reverse();
    } catch (error) {
      this.logger.error(`获取任务历史记录失败: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * 清理过期的任务历史记录
   */
  cleanupExpiredHistory(maxAge: number = 30 * 24 * 60 * 60 * 1000): void {
    try {
      this.ensureTaskDirectory();
      const historyFile = path.join(this.taskDir, TaskManager.TASK_HISTORY_FILE);
      if (!fs.existsSync(historyFile)) {
        return;
      }

      const historyData = fs.readFileSync(historyFile, 'utf-8');
      const history: TaskPersistence[] = JSON.parse(historyData);

      const now = Date.now();
      const filteredHistory = history.filter((task) => {
        const taskAge = now - task.updatedAt;
        return taskAge < maxAge;
      });

      if (filteredHistory.length !== history.length) {
        fs.writeFileSync(historyFile, JSON.stringify(filteredHistory, null, 2));
        this.logger.info(`清理了 ${history.length - filteredHistory.length} 条过期的历史记录`);
      }
    } catch (error) {
      this.logger.error(`清理历史记录失败: ${(error as Error).message}`);
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.stopAutoSave();
    this.currentTask = undefined;
  }
}

/**
 * Manus 类 - 重构版本
 * 一个多功能的通用代理，支持多种工具
 * 优化了任务持久化和继续执行功能
 */
export class Manus extends ToolCallAgent {
  // 浏览器上下文助手
  private browserContextHelper?: any;

  // 是否已初始化
  private _initialized: boolean = false;

  // MCP 服务器进程
  private mcpServerProcess?: any;

  // 多智能体系统
  protected multiAgentSystem?: MultiAgentSystem;

  // 工具路由器
  protected toolRouter?: ToolRouter;

  // 任务管理器
  private taskManager: TaskManager;

  // 计划管理器
  private planManager: PlanManager;

  // 对话上下文管理器
  private conversationContextManager: ConversationContextManager;

  // 执行统计
  private executionStats = {
    totalSteps: 0,
    successfulSteps: 0,
    failedSteps: 0,
    retriedSteps: 0,
    averageStepDuration: 0,
  };

  constructor(
    options: {
      name?: string;
      description?: string;
      systemPrompt?: string;
      nextStepPrompt?: string;
      maxSteps?: number;
      maxObserve?: number;
      llmConfigName?: string;
      tools?: ToolCollection;
      useMcpServer?: boolean;
      multiAgentSystem?: MultiAgentSystem;
      continueTask?: boolean;
    } = {}
  ) {
    super({
      name: options.name || 'Manus',
      description: options.description || '一个多功能的通用代理，支持任务持久化和继续执行',
      systemPrompt:
        options.systemPrompt || SYSTEM_PROMPT.replace('{directory}', config.getWorkspaceRoot()),
      nextStepPrompt: options.nextStepPrompt || NEXT_STEP_PROMPT,
      maxSteps: options.maxSteps || 30,
      llmConfigName: options.llmConfigName || 'default',
      tools: options.tools || new ToolCollection(),
      toolChoice: ToolChoice.AUTO,
      specialToolNames: ['Terminate'],
    });

    // 如果不是继续任务模式，先备份现有的.manus目录
    if (!options.continueTask) {
      this.backupManusDirectory();
    }

    // 初始化任务管理器
    this.taskManager = new TaskManager(config.getWorkspaceRoot());

    // 初始化计划管理器
    this.planManager = new PlanManager({
      workspaceRoot: config.getWorkspaceRoot(),
      planFileName: 'current_plan.json',
      autoSave: true,
      maxAge: 24 * 60 * 60 * 1000, // 24小时
    });

    // 初始化对话上下文管理器
    const conversationConfig: ConversationConfig = {
      maxContextMessages: 20,
      maxTokenLimit: 8000,
      relevanceThreshold: 0.6,
      importanceThreshold: 0.7,
      sessionTimeoutMs: 30 * 60 * 1000, // 30分钟
      summarizationThreshold: 50,
    };
    this.conversationContextManager = new ConversationContextManager(conversationConfig);

    // 设置多智能体系统
    if (options.multiAgentSystem) {
      this.multiAgentSystem = options.multiAgentSystem;
      this.setupToolRouter();
    }
  }

  /**
   * 设置工具路由器
   */
  private setupToolRouter(): void {
    if (!this.multiAgentSystem) return;

    const mcpManager = this.multiAgentSystem.getMcpManager();
    const agentManager = this.multiAgentSystem.getAgentManager();
    const decisionEngine = this.multiAgentSystem.getDecisionEngine();

    this.toolRouter = new ToolRouter(mcpManager, agentManager, decisionEngine, {
      strategy: RoutingStrategy.HYBRID,
      mcpPriority: 0.6,
      a2aPriority: 0.4,
      timeout: 30000,
      retryCount: 3,
      fallbackEnabled: true,
    });
  }

  /**
   * 备份现有的.manus目录
   * 如果.manus目录存在，将其重命名为.manus_backup_[timestamp]
   */
  private backupManusDirectory(): void {
    try {
      const workspaceRoot = config.getWorkspaceRoot();
      const manusDir = path.join(workspaceRoot, '.manus');

      // 检查.manus目录是否存在
      if (!fs.existsSync(manusDir)) {
        console.log('.manus目录不存在，无需备份');
        return;
      }

      // 生成备份目录名称（使用本地时间，方便阅读）
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hour = String(now.getHours()).padStart(2, '0');
      const minute = String(now.getMinutes()).padStart(2, '0');
      const second = String(now.getSeconds()).padStart(2, '0');

      const timestamp = `${year}-${month}-${day}_${hour}-${minute}-${second}`;
      const backupDir = path.join(workspaceRoot, `.manus_backup_${timestamp}`);

      // 重命名目录进行备份
      fs.renameSync(manusDir, backupDir);
      console.log(`已备份.manus目录到: ${path.basename(backupDir)}`);

      // 清理旧的备份（保留最近10个备份）
      this.cleanupOldBackups(workspaceRoot);
    } catch (error) {
      console.error(`备份.manus目录失败: ${(error as Error).message}`);
      // 备份失败不应该阻止任务创建，继续执行
    }
  }

  /**
   * 清理旧的备份目录，只保留最近的10个备份
   */
  private cleanupOldBackups(workspaceRoot: string): void {
    try {
      const backupPattern = /^\.manus_backup_/;
      const allItems = fs.readdirSync(workspaceRoot);

      // 找出所有备份目录
      const backupDirs = allItems
        .filter((item) => {
          const fullPath = path.join(workspaceRoot, item);
          return backupPattern.test(item) && fs.statSync(fullPath).isDirectory();
        })
        .map((item) => ({
          name: item,
          path: path.join(workspaceRoot, item),
          mtime: fs.statSync(path.join(workspaceRoot, item)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()); // 按修改时间降序排列

      // 如果备份目录超过10个，删除最旧的
      if (backupDirs.length > 10) {
        const dirsToDelete = backupDirs.slice(10);
        for (const dir of dirsToDelete) {
          try {
            fs.rmSync(dir.path, { recursive: true, force: true });
            console.log(`已清理旧备份: ${dir.name}`);
          } catch (error) {
            console.warn(`清理备份失败: ${dir.name} - ${(error as Error).message}`);
          }
        }
      }
    } catch (error) {
      console.error(`清理旧备份失败: ${(error as Error).message}`);
    }
  }

  /**
   * 创建并初始化 Manus 实例的工厂方法
   */
  static async create(
    options: {
      name?: string;
      description?: string;
      systemPrompt?: string;
      nextStepPrompt?: string;
      maxSteps?: number;
      maxObserve?: number;
      llmConfigName?: string;
      tools?: ToolCollection;
      useMcpServer?: boolean;
      continueTask?: boolean;
      multiAgentSystem?: MultiAgentSystem;
      enableMultiAgent?: boolean;
    } = {}
  ): Promise<Manus> {
    const instance = new Manus(options);
    await instance.initialize(options.useMcpServer, options.continueTask);
    return instance;
  }

  /**
   * 初始化 Manus 实例
   */
  private async initialize(
    useMcpServer: boolean = false,
    continueTask: boolean = false
  ): Promise<void> {
    // 尝试加载或恢复任务
    if (continueTask) {
      const recentTask = this.taskManager.getRecentTask();
      if (recentTask) {
        this.taskManager.loadTask(recentTask.id);
        this.logger.info(`恢复任务: ${recentTask.title}`);
      }
    }

    // 尝试加载现有计划
    const existingPlan = await this.planManager.loadPlan();
    if (existingPlan && existingPlan.isActive) {
      this.logger.info(`加载现有计划: ${existingPlan.title} (${existingPlan.steps.length} 步骤)`);
    }

    this._initialized = true;
    this.logger.info('Manus 代理已初始化');
  }

  /**
   * 创建新任务
   */
  createTask(title: string, description: string, steps: string[]): string {
    const taskSteps: Omit<TaskStep, 'id'>[] = steps.map((step, index) => ({
      title: `步骤 ${index + 1}`,
      description: step,
      status: StepStatus.PENDING,
      retryCount: 0,
      maxRetries: 3,
      dependencies: index > 0 ? [`task_step_${index - 1}`] : [],
    }));

    const task = this.taskManager.createTask(title, description, taskSteps);
    this.logger.info(`新任务已创建: ${title} (ID: ${task.id})`);
    return task.id;
  }

  /**
   * 继续任务执行
   */
  continueTask(taskId?: string): boolean {
    let task = this.taskManager.getCurrentTask();

    if (!task && taskId) {
      task = this.taskManager.loadTask(taskId) || undefined;
    }

    if (!task && !taskId) {
      task = this.taskManager.getRecentTask() || undefined;
      if (task) {
        this.taskManager.loadTask(task.id);
      }
    }

    if (!task) {
      this.logger.warn('没有找到可继续的任务');
      return false;
    }

    if (task.status === TaskStatus.COMPLETED) {
      this.logger.info('任务已完成，无需继续');
      return false;
    }

    if (task.status === TaskStatus.PAUSED) {
      this.taskManager.resumeTask();
    } else if (task.status === TaskStatus.PENDING) {
      this.taskManager.startTask();
    }

    this.logger.info(`继续执行任务: ${task.title}`);
    return true;
  }

  /**
   * 继续任务执行（别名方法，用于main.ts调用）
   */
  continueTaskExecution(): boolean {
    return this.continueTask();
  }

  /**
   * 暂停当前任务
   */
  pauseTask(): boolean {
    const currentTask = this.taskManager.getCurrentTask();
    if (!currentTask) {
      this.logger.warn('没有活跃任务可暂停');
      return false;
    }

    const success = this.taskManager.pauseTask();
    if (success) {
      this.logger.info(`任务已暂停: ${currentTask.title}`);
    }
    return success;
  }

  /**
   * 思考过程 - 重构版本
   */
  async think(): Promise<boolean> {
    if (!this._initialized) {
      await this.initialize();
    }

    // 记录用户消息到对话上下文
    await this.recordConversationContext();

    // 检查当前任务状态
    const currentTask = this.taskManager.getCurrentTask();
    if (!currentTask) {
      // 没有任务时使用原有逻辑
      const result = await super.think();

      // 记录助手响应到对话上下文
      await this.recordAssistantResponse();

      return result;
    }

    // 构建包含对话上下文的任务感知提示词
    const originalPrompt = this.nextStepPrompt;
    this.nextStepPrompt = await this.buildTaskAwarePromptWithContext(currentTask);

    try {
      // 开始或继续当前步骤
      const currentStep = this.taskManager.getCurrentStep();
      if (currentStep && currentStep.status === StepStatus.PENDING) {
        this.taskManager.startCurrentStep();
      }

      // 执行思考过程
      const result = await super.think();

      // 记录助手响应到对话上下文
      await this.recordAssistantResponse();

      // 处理执行结果
      if (result && currentStep) {
        this.taskManager.completeCurrentStep();
        this.executionStats.successfulSteps++;
      } else if (currentStep) {
        const shouldRetry = this.taskManager.failCurrentStep('步骤执行失败');
        if (shouldRetry) {
          this.executionStats.retriedSteps++;
        } else {
          this.executionStats.failedSteps++;
        }
      }

      this.executionStats.totalSteps++;
      this.updateExecutionStats();

      return result;
    } catch (error) {
      this.logger.error(`思考过程出错: ${(error as Error).message}`);

      const currentStep = this.taskManager.getCurrentStep();
      if (currentStep) {
        this.taskManager.failCurrentStep((error as Error).message);
        this.executionStats.failedSteps++;
      }

      return false;
    } finally {
      // 恢复原始提示词
      this.nextStepPrompt = originalPrompt;
    }
  }

  /**
   * 构建任务感知的提示词
   */
  private buildTaskAwarePrompt(task: TaskPersistence): string {
    const currentStep = this.taskManager.getCurrentStep();
    const progress = task.metadata.progress.toFixed(1);

    let prompt = `当前任务: ${task.title}\n`;
    prompt += `任务描述: ${task.description}\n`;
    prompt += `任务状态: ${task.status}\n`;
    prompt += `执行进度: ${progress}% (${task.metadata.completedSteps}/${task.metadata.totalSteps})\n`;

    if (currentStep) {
      prompt += `\n当前步骤: ${currentStep.title}\n`;
      prompt += `步骤描述: ${currentStep.description}\n`;
      prompt += `步骤状态: ${currentStep.status}\n`;

      if (currentStep.retryCount > 0) {
        prompt += `重试次数: ${currentStep.retryCount}/${currentStep.maxRetries}\n`;
      }
    }

    // 添加最近的检查点信息
    const recentCheckpoints = task.checkpoints.slice(-2);
    if (recentCheckpoints.length > 0) {
      prompt += `\n最近检查点:\n`;
      recentCheckpoints.forEach((checkpoint) => {
        prompt += `- ${new Date(checkpoint.timestamp).toLocaleString()}: ${checkpoint.description}\n`;
      });
    }

    prompt += `\n${NEXT_STEP_PROMPT}`;
    return prompt;
  }

  /**
   * 构建包含对话上下文的任务感知提示词
   */
  private async buildTaskAwarePromptWithContext(task: TaskPersistence): Promise<string> {
    // 获取基础的任务感知提示词
    let prompt = this.buildTaskAwarePrompt(task);

    // 添加计划信息（如果存在）
    const currentPlan = this.planManager.getCurrentPlan();
    if (currentPlan && currentPlan.isActive) {
      const planProgress = this.planManager.getProgress();
      const currentPlanStep = this.planManager.getCurrentStep();

      prompt += `\n当前计划: ${currentPlan.title}\n`;
      if (currentPlan.description) {
        prompt += `计划描述: ${currentPlan.description}\n`;
      }
      prompt += `计划进度: ${planProgress.completedSteps}/${planProgress.totalSteps} (${planProgress.progress.toFixed(1)}%)\n`;

      if (currentPlanStep) {
        prompt += `当前计划步骤: ${currentPlanStep.description}\n`;
        prompt += `步骤状态: ${currentPlanStep.status}\n`;
        if (currentPlanStep.notes) {
          prompt += `步骤备注: ${currentPlanStep.notes}\n`;
        }
      }

      // 显示计划中的下几个步骤
      const nextSteps = currentPlan.steps.slice(
        planProgress.currentStepIndex + 1,
        planProgress.currentStepIndex + 3
      );
      if (nextSteps.length > 0) {
        prompt += `接下来的计划步骤:\n`;
        nextSteps.forEach((step, index) => {
          prompt += `${planProgress.currentStepIndex + index + 2}. ${step.description}\n`;
        });
      }
    }

    try {
      // 获取相关的对话上下文
      const currentQuery = this.extractCurrentQuery();
      const relevantContext = await this.conversationContextManager.getRelevantContext(
        currentQuery,
        10
      );

      if (relevantContext.length > 0) {
        prompt += `\n相关对话上下文:\n`;
        relevantContext.forEach((msg, index) => {
          const role = msg.role === 'user' ? '用户' : '助手';
          const content = (msg.content || '').substring(0, 200);
          prompt += `${index + 1}. [${role}] ${content}${(msg.content || '').length > 200 ? '...' : ''}\n`;
        });
      }
    } catch (error) {
      this.logger.warn(`获取对话上下文失败: ${(error as Error).message}`);
    }

    return prompt;
  }

  /**
   * 记录对话上下文
   */
  private async recordConversationContext(): Promise<void> {
    try {
      // 获取最近的用户消息
      const recentMessages = this.memory.messages.slice(-5);
      const userMessages = recentMessages.filter((msg) => msg.role === 'user');

      for (const userMsg of userMessages) {
        const message: Message = {
          role: 'user' as Role,
          content: userMsg.content || '',
        };

        // 检查是否为任务创建或重要消息
        const metadata = this.extractMessageMetadata(message);

        await this.conversationContextManager.addMessage(message, metadata);
      }
    } catch (error) {
      this.logger.warn(`记录用户消息上下文失败: ${(error as Error).message}`);
    }
  }

  /**
   * 提取消息元数据，用于确定消息的重要性和保护级别
   */
  private extractMessageMetadata(message: Message): Record<string, any> {
    const content = message.content?.toLowerCase() || '';
    const currentTask = this.taskManager.getCurrentTask();

    const metadata: Record<string, any> = {
      taskId: currentTask?.id,
      source: 'manus_agent',
      timestamp: Date.now(),
    };

    // 检查是否为任务创建消息
    if (
      content.includes('创建任务') ||
      content.includes('新任务') ||
      content.includes('开始任务') ||
      content.includes('第一个任务') ||
      content.includes('首次任务') ||
      content.includes('初始任务')
    ) {
      metadata.isTaskCreation = true;
      metadata.isProtected = true;

      // 如果是第一个任务，标记为首次任务
      if (!currentTask) {
        metadata.isFirstTask = true;
      }
    }

    // 检查是否为长消息（可能包含重要信息）
    if ((message.content?.length || 0) > 200) {
      metadata.isLongMessage = true;
      metadata.isProtected = true;
    }

    // 检查是否包含重要关键词
    if (
      content.includes('重要') ||
      content.includes('关键') ||
      content.includes('必须') ||
      content.includes('一定要') ||
      content.includes('注意')
    ) {
      metadata.hasImportantKeywords = true;
      metadata.isProtected = true;
    }

    return metadata;
  }

  /**
   * 记录助手响应到对话上下文
   */
  private async recordAssistantResponse(): Promise<void> {
    try {
      // 获取最近的助手消息
      const recentMessages = this.memory.messages.slice(-3);
      const assistantMessages = recentMessages.filter((msg) => msg.role === 'assistant');

      for (const assistantMsg of assistantMessages) {
        const message: Message = {
          role: 'assistant' as Role,
          content: assistantMsg.content || '',
        };

        await this.conversationContextManager.addMessage(message, {
          taskId: this.taskManager.getCurrentTask()?.id,
          source: 'manus_agent',
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      this.logger.warn(`记录助手响应上下文失败: ${(error as Error).message}`);
    }
  }

  /**
   * 更新执行统计
   */
  private updateExecutionStats(): void {
    const { totalSteps, successfulSteps } = this.executionStats;
    if (totalSteps > 0) {
      this.executionStats.averageStepDuration =
        totalSteps > 0 ? (successfulSteps / totalSteps) * 100 : 0;
    }
  }

  /**
   * 执行工具调用 - 重构版本
   */
  protected async executeToolCall(commandOrName: ToolCall | string, args?: any): Promise<any> {
    const startTime = Date.now();

    try {
      let result: any;

      if (this.toolRouter) {
        result = await this.executeToolCallWithRouter(commandOrName, args);
      } else {
        result = await super.executeToolCall(commandOrName, args);
      }

      // 记录成功的工具调用
      const duration = Date.now() - startTime;
      this.recordToolExecution(commandOrName, true, duration);

      return result;
    } catch (error) {
      // 记录失败的工具调用
      const duration = Date.now() - startTime;
      this.recordToolExecution(commandOrName, false, duration, (error as Error).message);

      throw error;
    }
  }

  /**
   * 通过路由器执行工具调用
   */
  private async executeToolCallWithRouter(
    commandOrName: ToolCall | string,
    args?: any
  ): Promise<any> {
    let toolName: string;
    let toolArgs: any;

    if (typeof commandOrName === 'string') {
      toolName = commandOrName;
      toolArgs = args || {};
    } else {
      toolName = commandOrName.function.name;
      try {
        toolArgs = JSON.parse(commandOrName.function.arguments || '{}');
      } catch (error) {
        throw new Error(`无法解析工具参数: ${error}`);
      }
    }

    const currentTask = this.taskManager.getCurrentTask();
    const toolRequest = {
      name: toolName,
      arguments: toolArgs,
      context: {
        task: currentTask?.title || 'default_task',
        step: currentTask?.currentStepIndex ?? -1,
      },
    };

    const routerResult = await this.toolRouter!.executeToolCall(toolRequest);

    if (!routerResult.success) {
      throw new Error(routerResult.error || '工具执行失败');
    }

    // 记录工具执行结果到任务上下文
    if (currentTask) {
      this.taskManager.setTaskContext(`tool_${toolName}_result`, routerResult.result);
    }

    if (typeof commandOrName === 'string') {
      return {
        output: this.formatToolResult(routerResult.result),
        error: null,
        executedBy: routerResult.executedBy,
        executionTime: routerResult.executionTime,
      };
    }

    return `工具 \`${toolName}\` 执行完成 (由 ${routerResult.executedBy} 执行):\n${this.formatToolResult(routerResult.result)}`;
  }

  /**
   * 记录工具执行
   */
  private recordToolExecution(
    commandOrName: ToolCall | string,
    success: boolean,
    duration: number,
    error?: string
  ): void {
    const toolName =
      typeof commandOrName === 'string' ? commandOrName : commandOrName.function.name;

    const currentTask = this.taskManager.getCurrentTask();
    if (currentTask) {
      this.taskManager.setTaskContext(`last_tool_execution`, {
        toolName,
        success,
        duration,
        error,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 格式化工具结果
   */
  private formatToolResult(result: any): string {
    if (typeof result === 'string') {
      return result;
    }

    if (result && typeof result === 'object') {
      if (result.content && Array.isArray(result.content)) {
        return result.content.map((item: any) => item.text || JSON.stringify(item)).join('\n');
      }

      if (result.result !== undefined) {
        return typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
      }

      return JSON.stringify(result, null, 2);
    }

    return String(result);
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(): any {
    const currentTask = this.taskManager.getCurrentTask();
    if (!currentTask) {
      return {
        hasTask: false,
        message: '当前没有活跃任务',
      };
    }

    return {
      hasTask: true,
      task: {
        id: currentTask.id,
        title: currentTask.title,
        description: currentTask.description,
        status: currentTask.status,
        progress: currentTask.metadata.progress,
        totalSteps: currentTask.metadata.totalSteps,
        completedSteps: currentTask.metadata.completedSteps,
        failedSteps: currentTask.metadata.failedSteps,
        currentStep: this.taskManager.getCurrentStep(),
        createdAt: new Date(currentTask.createdAt).toLocaleString(),
        updatedAt: new Date(currentTask.updatedAt).toLocaleString(),
      },
      executionStats: this.executionStats,
    };
  }

  /**
   * 获取任务进度（别名方法，用于main.ts调用，返回与getTaskStatus相同的格式）
   */
  getTaskProgress(): {
    hasTask: boolean;
    message?: string;
    totalSteps: number;
    completedSteps: number;
    progress: number;
    task?: {
      id: string;
      title: string;
      description: string;
      status: string;
      progress: number;
      totalSteps: number;
      completedSteps: number;
      failedSteps: number;
      currentStep: any;
      createdAt: string;
      updatedAt: string;
    };
    executionStats?: any;
  } {
    const currentTask = this.taskManager.getCurrentTask();
    if (!currentTask) {
      return {
        hasTask: false,
        message: '当前没有活跃任务',
        totalSteps: 0,
        completedSteps: 0,
        progress: 0,
      };
    }

    return {
      hasTask: true,
      totalSteps: currentTask.metadata.totalSteps,
      completedSteps: currentTask.metadata.completedSteps,
      progress: currentTask.metadata.progress,
      task: {
        id: currentTask.id,
        title: currentTask.title,
        description: currentTask.description,
        status: currentTask.status,
        progress: currentTask.metadata.progress,
        totalSteps: currentTask.metadata.totalSteps,
        completedSteps: currentTask.metadata.completedSteps,
        failedSteps: currentTask.metadata.failedSteps,
        currentStep: this.taskManager.getCurrentStep(),
        createdAt: new Date(currentTask.createdAt).toLocaleString(),
        updatedAt: new Date(currentTask.updatedAt).toLocaleString(),
      },
      executionStats: this.executionStats,
    };
  }

  /**
   * 获取任务历史
   */
  getTaskHistory(limit: number = 10): any[] {
    const currentTask = this.taskManager.getCurrentTask();
    if (!currentTask) {
      return [];
    }

    return currentTask.executionHistory.slice(-limit).map((event) => ({
      timestamp: new Date(event.timestamp).toLocaleString(),
      type: event.type,
      description: event.description,
      stepId: event.stepId,
    }));
  }

  /**
   * 获取历史任务记录
   */
  getHistoricalTasks(limit: number = 10): any[] {
    const history = this.taskManager.getTaskHistory(limit);
    return history.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      progress: task.metadata.progress,
      createdAt: new Date(task.createdAt).toLocaleString(),
      updatedAt: new Date(task.updatedAt).toLocaleString(),
      endTime: task.endTime ? new Date(task.endTime).toLocaleString() : null,
      totalSteps: task.metadata.totalSteps,
      completedSteps: task.metadata.completedSteps,
      failedSteps: task.metadata.failedSteps,
    }));
  }

  /**
   * 获取对话上下文统计信息
   */
  getConversationStats(): any {
    return this.conversationContextManager.getDetailedSessionStats();
  }

  /**
   * 获取相关对话上下文
   */
  async getRelevantConversationContext(
    query: string,
    maxMessages: number = 10
  ): Promise<Message[]> {
    try {
      return await this.conversationContextManager.getRelevantContext(query, maxMessages);
    } catch (error) {
      this.logger.error(`获取相关对话上下文失败: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * 清除所有对话会话
   */
  clearConversationSessions(): void {
    this.conversationContextManager.clearAllSessions();
    this.logger.info('所有对话会话已清除');
  }

  /**
   * 更新对话上下文配置
   */
  updateConversationConfig(config: Partial<ConversationConfig>): void {
    this.conversationContextManager.updateConfig(config);
    this.logger.info('对话上下文配置已更新');
  }

  /**
   * 手动标记重要消息为保护状态
   */
  async markMessageAsProtected(
    messageContent: string,
    reason: string = '用户标记为重要'
  ): Promise<void> {
    try {
      const message: Message = {
        role: 'user' as Role,
        content: messageContent,
      };

      await this.conversationContextManager.addMessage(message, {
        isProtected: true,
        isManuallyProtected: true,
        protectionReason: reason,
        taskId: this.taskManager.getCurrentTask()?.id,
        source: 'user_manual_protection',
        timestamp: Date.now(),
      });

      this.logger.info(`消息已标记为保护状态: ${reason}`);
    } catch (error) {
      this.logger.error('标记保护消息失败:', error);
    }
  }

  // =================== 计划管理API ===================

  /**
   * 创建新计划
   */
  async createPlan(
    title: string,
    steps: string[],
    options?: {
      description?: string;
      sourceFile?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<string> {
    try {
      const plan = await this.planManager.createPlan(title, steps, options);

      // 标记计划创建消息为保护状态
      await this.markMessageAsProtected(
        `创建计划: ${title}，包含 ${steps.length} 个步骤`,
        '计划创建消息'
      );

      this.logger.info(`新计划已创建: ${title} (ID: ${plan.id})`);
      return plan.id;
    } catch (error) {
      this.logger.error('创建计划失败:', error);
      throw error;
    }
  }

  /**
   * 获取当前活跃计划
   */
  getCurrentPlan(): Plan | null {
    return this.planManager.getCurrentPlan();
  }

  /**
   * 获取当前计划步骤
   */
  getCurrentPlanStep(): PlanStep | null {
    return this.planManager.getCurrentStep();
  }

  /**
   * 标记当前计划步骤完成
   */
  async markPlanStepCompleted(notes?: string): Promise<boolean> {
    try {
      const success = await this.planManager.markStepCompleted(notes);
      if (success) {
        const currentStep = this.planManager.getCurrentStep();
        if (currentStep) {
          this.logger.info(`开始执行计划步骤: ${currentStep.description}`);
        } else {
          this.logger.info('所有计划步骤已完成！');
        }
      }
      return success;
    } catch (error) {
      this.logger.error('标记计划步骤完成失败:', error);
      return false;
    }
  }

  /**
   * 设置计划步骤状态
   */
  async setPlanStepStatus(
    stepIndex: number,
    status: PlanStepStatus,
    notes?: string
  ): Promise<boolean> {
    try {
      return await this.planManager.setStepStatus(stepIndex, status, notes);
    } catch (error) {
      this.logger.error('设置计划步骤状态失败:', error);
      return false;
    }
  }

  /**
   * 获取计划进度信息
   */
  getPlanProgress(): {
    isActive: boolean;
    totalSteps: number;
    completedSteps: number;
    currentStepIndex: number;
    currentStep: PlanStep | null;
    progress: number;
    remainingSteps: number;
  } {
    return this.planManager.getProgress();
  }

  /**
   * 格式化计划显示
   */
  formatCurrentPlan(): string {
    return this.planManager.formatPlan();
  }

  /**
   * 清除当前计划
   */
  async clearPlan(): Promise<boolean> {
    try {
      return await this.planManager.clearPlan();
    } catch (error) {
      this.logger.error('清除计划失败:', error);
      return false;
    }
  }

  /**
   * 检查是否有活跃计划
   */
  hasActivePlan(): boolean {
    return this.planManager.hasActivePlan();
  }

  /**
   * 获取计划和任务的综合状态
   */
  getComprehensiveStatus(): {
    task: any;
    plan: {
      isActive: boolean;
      currentPlan: Plan | null;
      progress: any;
    };
    conversation: any;
  } {
    const taskStatus = this.getTaskStatus();
    const planProgress = this.getPlanProgress();
    const conversationStats = this.getConversationStats();

    return {
      task: taskStatus,
      plan: {
        isActive: this.hasActivePlan(),
        currentPlan: this.getCurrentPlan(),
        progress: planProgress,
      },
      conversation: conversationStats,
    };
  }

  /**
   * 同步计划与任务
   * 将计划步骤转换为任务步骤，或将任务步骤转换为计划
   */
  async syncPlanWithTask(): Promise<boolean> {
    try {
      const currentTask = this.taskManager.getCurrentTask();
      const currentPlan = this.planManager.getCurrentPlan();

      if (currentTask && !currentPlan) {
        // 从任务创建计划
        const steps = currentTask.steps.map((step) => step.description);
        await this.createPlan(currentTask.title, steps, {
          description: currentTask.description,
          sourceFile: 'task_sync',
          metadata: {
            syncFromTaskId: currentTask.id,
            syncTimestamp: Date.now(),
          },
        });
        this.logger.info('从任务同步创建计划');
        return true;
      } else if (currentPlan && !currentTask) {
        // 从计划创建任务
        const steps = currentPlan.steps.map((step) => step.description);
        const taskId = this.createTask(currentPlan.title, currentPlan.description || '', steps);
        this.logger.info(`从计划同步创建任务: ${taskId}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('同步计划与任务失败:', error);
      return false;
    }
  }

  /**
   * 重写提取当前查询的方法
   */
  protected extractCurrentQuery(): string {
    const currentTask = this.taskManager.getCurrentTask();
    if (!currentTask) {
      return super.extractCurrentQuery();
    }

    const currentStep = this.taskManager.getCurrentStep();
    if (currentStep) {
      return `执行任务"${currentTask.title}"的步骤: ${currentStep.description}`;
    }

    return `继续执行任务: ${currentTask.title}`;
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    // 暂停当前任务
    this.taskManager.pauseTask();

    // 保存当前计划（如果存在）
    const currentPlan = this.planManager.getCurrentPlan();
    if (currentPlan && currentPlan.isActive) {
      await this.planManager.savePlan();
      this.logger.info('当前计划已保存');
    }

    // 清理任务管理器
    this.taskManager.cleanup();

    // 清理对话上下文管理器
    this.conversationContextManager.clearAllSessions();

    // 清理MCP资源
    if (this.mcpServerProcess) {
      try {
        this.mcpServerProcess.kill();
        this.mcpServerProcess = undefined;
      } catch (error) {
        this.logger.error(`MCP 服务器关闭失败: ${(error as Error).message}`);
      }
    }

    // 清理其他资源
    if (this.browserContextHelper) {
      // await this.browserContextHelper.cleanupBrowser();
    }

    this._initialized = false;
    this.logger.info('Manus 代理资源已清理');
  }
}
