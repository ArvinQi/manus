/**
 * Manus 类
 * 一个多功能的通用代理，支持多种工具
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

// 系统提示词
const SYSTEM_PROMPT = `你是一个功能强大的智能助手，可以帮助用户完成各种任务。
你可以使用多种工具来解决问题，包括搜索、浏览器操作、代码执行等。
当需要时，你应该主动使用这些工具来获取信息或执行操作。

如果当前存在任务计划，你必须继续执行任务计划，直到任务完成。即使对话被中断，当恢复时，你应该回顾之前的上下文并继续未完成的任务。

代码任务需要先分析需求和项目环境，然后使用合适的工具来生成代码。
你的工作目录是: {directory}`;

// 下一步提示词
const NEXT_STEP_PROMPT = '请思考下一步应该做什么，并使用适当的工具来完成任务。';

/**
 * Manus 类
 * 一个多功能的通用代理，支持多种工具
 */
export class Manus extends ToolCallAgent {
  // 浏览器上下文助手
  private browserContextHelper?: any;

  // 是否已初始化
  private _initialized: boolean = false;

  // MCP 服务器进程（如果需要的话）
  private mcpServerProcess?: any;

  // MCP 客户端（通过多智能体系统管理）
  // protected mcpClient?: McpClient;

  // 多智能体系统
  protected multiAgentSystem?: MultiAgentSystem;

  // 工具路由器
  protected toolRouter?: ToolRouter;

  // 任务状态相关属性
  private _taskState: {
    currentTask?: string; // 当前正在执行的任务描述
    originalTaskDescription?: string; // 原始任务描述（来自文件或用户输入）
    taskPlan?: string[]; // 任务计划步骤列表
    currentStepIndex?: number; // 当前执行到的步骤索引
    completedSteps?: string[]; // 已完成的步骤列表
    taskContext?: Map<string, any>; // 任务上下文信息，存储任务执行过程中的关键数据
    lastActiveTime?: number; // 最后活动时间戳
    isTaskActive?: boolean; // 任务是否处于活动状态
    taskStartTime?: number; // 任务开始时间
    taskSourceFile?: string; // 任务来源文件路径
  } = {};

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
      enableTaskContinuity?: boolean; // 是否启用任务连续性功能
      multiAgentSystem?: MultiAgentSystem;
    } = {}
  ) {
    super({
      name: options.name || 'Manus',
      description: options.description || '一个多功能的通用代理，可以使用多种工具解决各种任务',
      systemPrompt:
        options.systemPrompt || SYSTEM_PROMPT.replace('{directory}', config.getWorkspaceRoot()),
      nextStepPrompt: options.nextStepPrompt || NEXT_STEP_PROMPT,
      maxSteps: options.maxSteps || 20,
      llmConfigName: options.llmConfigName || 'default',
      tools: options.tools || new ToolCollection(),
      toolChoice: ToolChoice.AUTO,
      specialToolNames: ['Terminate'],
    });

    // MCP 客户端现在通过多智能体系统管理

    // 设置多智能体系统
    if (options.multiAgentSystem) {
      this.multiAgentSystem = options.multiAgentSystem;

      // 如果有多智能体系统，创建工具路由器
      const mcpManager = this.multiAgentSystem.getMcpManager();
      const agentManager = this.multiAgentSystem.getAgentManager();
      const decisionEngine = this.multiAgentSystem.getDecisionEngine();

      this.toolRouter = new ToolRouter(mcpManager, agentManager, decisionEngine, {
        strategy: RoutingStrategy.HYBRID, // 使用混合策略
        mcpPriority: 0.6, // MCP优先级
        a2aPriority: 0.4, // A2A优先级
        timeout: 30000, // 超时时间
        retryCount: 2, // 重试次数
        fallbackEnabled: true, // 启用回退机制
      });
    }

    // 初始化任务状态
    this._taskState = {
      isTaskActive: false,
      taskContext: new Map<string, any>(),
      lastActiveTime: Date.now(),
      completedSteps: [],
      currentStepIndex: 0,
    };
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
      continueTask?: boolean; // 新增参数，决定是否继续任务
      multiAgentSystem?: MultiAgentSystem;
      enableMultiAgent?: boolean; // 是否启用多智能体系统
    } = {}
  ): Promise<Manus> {
    let multiAgentSystem = options.multiAgentSystem;

    // 在多智能体系统初始化之前，先检查和处理 .manus 目录
    const logger = new Logger('Manus');
    const workspaceRoot = config.getWorkspaceRoot();
    const manusDir = path.join(workspaceRoot, '.manus');

    // 处理 .manus 目录
    if (fs.existsSync(manusDir)) {
      // 检查是否处于继续任务状态
      const isContinuingTask = options.continueTask;

      if (!isContinuingTask) {
        // 如果不是继续任务，则备份目录
        const backupDir = path.join(workspaceRoot, `.manus_backup_${Date.now()}`);
        logger.info(`发现现有.manus目录，正在备份到 ${backupDir}`);
        fs.cpSync(manusDir, backupDir, { recursive: true });

        // 清空原目录
        fs.rmSync(manusDir, { recursive: true, force: true });
        fs.mkdirSync(manusDir, { recursive: true });
      } else {
        logger.info('继续执行任务，保留现有.manus目录');
      }
    } else {
      // 创建.manus目录
      fs.mkdirSync(manusDir, { recursive: true });
    }

    // .manus 目录处理完成，现在可以安全地进行后续初始化

    // 如果启用多智能体系统且未提供实例，尝试创建
    if (options.enableMultiAgent && !multiAgentSystem) {
      try {
        logger.info('正在从配置文件初始化多智能体系统...');

        // 从配置文件读取MCP服务器和A2A代理配置
        const mcpServersConfig = config.getMcpServersConfig();
        const agentsConfig = config.getAgentsConfig();

        if (mcpServersConfig.length > 0 || agentsConfig.length > 0) {
          // 创建多智能体系统配置
          const multiAgentConfig = {
            mcp_services: mcpServersConfig,
            a2a_agents: agentsConfig,
            routing_rules: [],
            memory_config: {
              provider: 'local' as const,
              local: {
                storage_path: './.manus/memory',
                max_file_size: 10485760,
              },
            },
            task_management: {
              max_concurrent_tasks: 5,
              task_timeout: 300000,
              priority_queue_size: 100,
              interruption_policy: 'at_checkpoint' as const,
              checkpoint_interval: 30000,
              task_persistence: true,
              auto_recovery: true,
            },
            decision_engine: {
              strategy: 'hybrid' as const,
              fallback_strategy: 'local' as const,
              confidence_threshold: 0.7,
              learning_enabled: false,
              metrics_collection: true,
            },
            system: {
              name: 'Manus-MultiAgent',
              version: '2.0.0',
              debug_mode: false,
              log_level: 'info' as const,
            },
          };

          // 创建多智能体系统
          multiAgentSystem = new MultiAgentSystem(multiAgentConfig);

          // 启动多智能体系统
          await multiAgentSystem.start();

          logger.info(
            `多智能体系统启动成功: ${mcpServersConfig.length} 个MCP服务, ${agentsConfig.length} 个代理`
          );
        } else {
          logger.info('配置文件中未找到MCP服务器或代理配置，将使用传统模式运行');
          multiAgentSystem = undefined;
        }
      } catch (error) {
        logger.error(`初始化多智能体系统失败: ${error}`);
        logger.info('将使用传统模式运行');
        multiAgentSystem = undefined;
      }
    }

    const instance = new Manus({
      ...options,
      multiAgentSystem,
    });

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
    // 尝试恢复任务状态（如果需要）
    if (continueTask) {
      this.loadTaskState();
    }

    // MCP 服务器连接现在通过 MultiMcpManager 管理，不再在这里直接连接
    // 避免 StdioClientTransport 导致的日志解析问题
    if (useMcpServer) {
      this.logger.info('MCP 服务器连接将通过 MultiMcpManager 管理');
    }

    // 启动定期保存任务状态的功能
    // this.scheduleTaskStateSaving();

    this._initialized = true;
    this.logger.info('Manus 代理已初始化');
  }

  /**
   * 思考过程
   * 处理当前状态并决定下一步行动，添加适当的上下文
   * 支持任务连续性，能够在中断后恢复执行任务
   */
  async think(): Promise<boolean> {
    // 确保已初始化
    if (!this._initialized) {
      await this.initialize();
    }

    // 更新任务状态
    this.updateTaskState();

    // 保存原始提示词
    const originalPrompt = this.nextStepPrompt;

    // 如果存在活跃任务，添加任务上下文到提示词
    if (this._taskState.isTaskActive) {
      const taskContext = this.formatTaskContext();
      this.nextStepPrompt = `${taskContext}\n\n${originalPrompt}`;

      // 如果有任务计划，优先执行当前步骤
      const currentStep = this.getCurrentStep();
      if (currentStep) {
        this.nextStepPrompt = `${taskContext}\n\n当前需要执行的步骤: ${currentStep}\n\n${originalPrompt}`;
      }
    }

    // 获取最近的消息
    const recentMessages = this.memory.messages.slice(-5);

    // 检查是否有任务相关指令
    const hasTaskInstruction = recentMessages.some((msg) => {
      if (msg.role !== 'user' || !msg.content) return false;
      const content = msg.content.toLowerCase();
      return (
        content.includes('继续任务') ||
        content.includes('恢复任务') ||
        content.includes('任务计划') ||
        content.includes('下一步')
      );
    });

    // 如果有任务相关指令，确保任务状态为活跃
    if (hasTaskInstruction && !this._taskState.isTaskActive && this._taskState.currentTask) {
      this._taskState.isTaskActive = true;
      this.logger.info(`恢复执行任务: ${this._taskState.currentTask}`);
    }

    // 检查是否使用了浏览器工具
    const browserInUse = recentMessages.some((msg) => {
      if (!msg.tool_calls) return false;
      return msg.tool_calls.some((tc) => tc.function.name === 'BrowserUse');
    });

    // 如果使用了浏览器，添加浏览器上下文
    if (browserInUse && this.browserContextHelper) {
      // 在实际实现中，这里会格式化浏览器上下文
      const browserContext = await this.browserContextHelper.formatNextStepPrompt();
      this.nextStepPrompt = `${this.nextStepPrompt}\n\n${browserContext}`;
    }

    // 调用父类的 think 方法
    const result = await super.think();

    // 任务执行后更新状态
    this.updateTaskStateAfterThinking(result);

    // 恢复原始提示词
    this.nextStepPrompt = originalPrompt;

    return result;
  }

  /**
   * 更新任务状态
   * 分析最近的消息，更新当前任务状态
   */
  private updateTaskState(): void {
    // 初始化任务上下文（如果不存在）
    if (!this._taskState.taskContext) {
      this._taskState.taskContext = new Map<string, any>();
    }

    // 更新最后活动时间
    this._taskState.lastActiveTime = Date.now();

    // 获取最近的消息
    const recentMessages = this.memory.messages.slice(-10);

    // 检查是否有新任务指令
    for (const msg of recentMessages) {
      if (msg.role !== 'user' || !msg.content) continue;

      const content = msg.content.toLowerCase();

      // 检测任务终止指令
      if (
        content.includes('停止任务') ||
        content.includes('终止任务') ||
        content.includes('取消任务')
      ) {
        this._taskState.isTaskActive = false;
        this._taskState.currentTask = undefined;
        this._taskState.taskPlan = undefined;
        this._taskState.currentStepIndex = undefined;
        this.logger.info('任务已终止');
        return;
      }

      // 检测新任务指令
      if (content.includes('新任务') || (content.length > 15 && !this._taskState.currentTask)) {
        // 可能是新任务，保存任务描述
        this._taskState.currentTask = msg.content;
        this._taskState.isTaskActive = true;
        this._taskState.currentStepIndex = 0;
        this._taskState.taskPlan = undefined; // 清空旧计划，等待生成新计划
        this.logger.info(
          `检测到新任务: ${msg.content.substring(0, 50)}${msg.content.length > 50 ? '...' : ''}`
        );
      }
    }

    // 从助手消息中提取任务计划（如果存在）
    if (this._taskState.isTaskActive && !this._taskState.taskPlan) {
      for (const msg of recentMessages.reverse()) {
        // 从最新消息开始检查
        if (msg.role !== 'assistant' || !msg.content) continue;

        // 尝试从消息中提取任务计划
        const planMatch = msg.content.match(/计划[：:](\s*\n*)((?:(?:\d+\.)[^\n]+\n*)+)/i);
        if (planMatch && planMatch[2]) {
          const planText = planMatch[2].trim();
          const steps = planText
            .split('\n')
            .map((step) => step.replace(/^\d+\.\s*/, '').trim())
            .filter((step) => step.length > 0);

          if (steps.length > 0) {
            this._taskState.taskPlan = steps;
            this._taskState.currentStepIndex = 0;
            this.logger.info(`提取到任务计划，共 ${steps.length} 步`);
          }
        }
      }
    }
  }

  /**
   * 思考后更新任务状态
   * @param thinkResult 思考结果
   */
  private updateTaskStateAfterThinking(thinkResult: boolean): void {
    // 如果思考成功且任务处于活跃状态
    if (thinkResult && this._taskState.isTaskActive) {
      // 如果有任务计划，尝试推进到下一步
      if (this._taskState.taskPlan && this._taskState.taskPlan.length > 0) {
        const currentIndex = this._taskState.currentStepIndex || 0;

        // 检查是否完成了当前步骤
        const lastMessage = this.memory.messages[this.memory.messages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content) {
          const currentStep = this._taskState.taskPlan[currentIndex];
          const stepCompleteIndicators = [
            '完成了',
            '已完成',
            '已经完成',
            '成功',
            '完毕',
            '下一步',
            '接下来',
            '继续',
          ];

          // 检查是否有完成当前步骤的指示
          const hasCompletionIndicator = stepCompleteIndicators.some((indicator) =>
            lastMessage.content!.includes(indicator)
          );

          if (hasCompletionIndicator && currentIndex < this._taskState.taskPlan.length - 1) {
            // 推进到下一步
            this._taskState.currentStepIndex = currentIndex + 1;
            this.logger.info(
              `任务进度更新: 步骤 ${currentIndex + 1}/${this._taskState.taskPlan.length} 完成`
            );
          }

          // 检查任务是否全部完成
          if (
            (currentIndex === this._taskState.taskPlan.length - 1 &&
              lastMessage.content.includes('任务完成')) ||
            lastMessage.content.includes('全部完成')
          ) {
            this.logger.info('任务全部完成');
            this._taskState.isTaskActive = false;
          }
        }
      }
    }
  }

  /**
   * 格式化任务上下文信息
   * 生成包含当前任务状态的提示信息
   */
  private formatTaskContext(): string {
    if (!this._taskState.currentTask) {
      return '';
    }

    let contextText = `当前正在执行的任务: ${this._taskState.currentTask}\n`;

    // 添加任务计划信息
    if (this._taskState.taskPlan && this._taskState.taskPlan.length > 0) {
      contextText += '\n任务计划:\n';
      this._taskState.taskPlan.forEach((step, index) => {
        const currentIndex = this._taskState.currentStepIndex || 0;
        const status = index < currentIndex ? '✓' : index === currentIndex ? '→' : ' ';
        contextText += `${status} ${index + 1}. ${step}\n`;
      });
    }

    // 添加关键上下文数据
    if (this._taskState.taskContext && this._taskState.taskContext.size > 0) {
      contextText += '\n任务上下文:\n';
      this._taskState.taskContext.forEach((value, key) => {
        // 对于复杂对象，只显示摘要信息
        const valueStr =
          typeof value === 'object'
            ? JSON.stringify(value).substring(0, 50) + '...'
            : String(value);
        contextText += `- ${key}: ${valueStr}\n`;
      });
    }

    return contextText;
  }

  /**
   * 设置任务上下文数据
   * @param key 上下文数据键
   * @param value 上下文数据值
   */
  public setTaskContextData(key: string, value: any): void {
    if (!this._taskState.taskContext) {
      this._taskState.taskContext = new Map<string, any>();
    }
    this._taskState.taskContext.set(key, value);
  }

  /**
   * 获取任务上下文数据
   * @param key 上下文数据键
   * @returns 上下文数据值
   */
  public getTaskContextData(key: string): any {
    return this._taskState.taskContext?.get(key);
  }

  /**
   * 设置任务计划
   */
  public setTaskPlan(taskPlan: string[], originalDescription?: string, sourceFile?: string): void {
    this._taskState.taskPlan = [...taskPlan];
    this._taskState.currentStepIndex = 0;
    this._taskState.completedSteps = [];
    this._taskState.isTaskActive = true;
    this._taskState.taskStartTime = Date.now();
    this._taskState.lastActiveTime = Date.now();

    if (originalDescription) {
      this._taskState.originalTaskDescription = originalDescription;
    }

    if (sourceFile) {
      this._taskState.taskSourceFile = sourceFile;
    }

    this.logger.info(`任务计划已设置，共 ${taskPlan.length} 个步骤`);
    this.saveTaskState();
  }

  /**
   * 获取当前任务计划
   */
  public getTaskPlan(): string[] {
    return this._taskState.taskPlan || [];
  }

  /**
   * 获取当前步骤
   */
  public getCurrentStep(): string | null {
    if (!this._taskState.taskPlan || this._taskState.currentStepIndex === undefined) {
      return null;
    }

    if (this._taskState.currentStepIndex < this._taskState.taskPlan.length) {
      return this._taskState.taskPlan[this._taskState.currentStepIndex];
    }

    return null;
  }

  /**
   * 标记当前步骤为完成
   */
  public markCurrentStepCompleted(): void {
    if (!this._taskState.taskPlan || this._taskState.currentStepIndex === undefined) {
      return;
    }

    const currentStep = this.getCurrentStep();
    if (currentStep) {
      this._taskState.completedSteps = this._taskState.completedSteps || [];
      this._taskState.completedSteps.push(currentStep);
      this._taskState.currentStepIndex++;
      this._taskState.lastActiveTime = Date.now();

      this.logger.info(`步骤已完成: ${currentStep}`);
      this.logger.info(
        `进度: ${this._taskState.currentStepIndex}/${this._taskState.taskPlan.length}`
      );

      // 检查是否所有步骤都已完成
      if (this._taskState.currentStepIndex >= this._taskState.taskPlan.length) {
        this._taskState.isTaskActive = false;
        this.logger.info('所有任务步骤已完成！');
      }

      this.saveTaskState();
    }
  }

  /**
   * 获取任务进度信息
   */
  public getTaskProgress(): {
    isActive: boolean;
    totalSteps: number;
    completedSteps: number;
    currentStep: string | null;
    progress: number;
    completedStepsList: string[];
  } {
    const taskPlan = this._taskState.taskPlan || [];
    const completedSteps = this._taskState.completedSteps || [];
    const currentStepIndex = this._taskState.currentStepIndex || 0;

    return {
      isActive: this._taskState.isTaskActive || false,
      totalSteps: taskPlan.length,
      completedSteps: completedSteps.length,
      currentStep: this.getCurrentStep(),
      progress: taskPlan.length > 0 ? (completedSteps.length / taskPlan.length) * 100 : 0,
      completedStepsList: [...completedSteps],
    };
  }

  /**
   * 从已保存的任务计划继续执行
   */
  public continueTaskExecution(): boolean {
    if (!this._taskState.isTaskActive || !this._taskState.taskPlan) {
      this.logger.warn('没有可继续的任务');
      return false;
    }

    const progress = this.getTaskProgress();
    if (progress.totalSteps === progress.completedSteps) {
      this.logger.info('任务已全部完成');
      return false;
    }

    this.logger.info(`继续执行任务，当前进度: ${progress.completedSteps}/${progress.totalSteps}`);
    this.logger.info(`下一步: ${progress.currentStep}`);

    return true;
  }

  /**
   * 保存任务状态到文件
   * 将当前任务状态持久化到.manus目录
   */
  private saveTaskState(): void {
    try {
      // 如果没有活跃任务，不需要保存
      if (
        !this._taskState.isTaskActive ||
        (!this._taskState.currentTask && !this._taskState.taskPlan)
      ) {
        return;
      }

      const workspaceRoot = config.getWorkspaceRoot();
      const taskStateFile = path.join(workspaceRoot, '.manus', 'task_state.json');

      // 将Map转换为普通对象以便序列化
      const taskContextObj: Record<string, any> = {};
      this._taskState.taskContext?.forEach((value, key) => {
        // 对于复杂对象，尝试序列化
        if (typeof value === 'object') {
          try {
            taskContextObj[key] = JSON.stringify(value);
          } catch (e) {
            taskContextObj[key] = String(value);
          }
        } else {
          taskContextObj[key] = value;
        }
      });

      // 准备要保存的状态数据
      const stateToSave = {
        currentTask: this._taskState.currentTask,
        originalTaskDescription: this._taskState.originalTaskDescription,
        taskPlan: this._taskState.taskPlan,
        currentStepIndex: this._taskState.currentStepIndex,
        completedSteps: this._taskState.completedSteps,
        taskContext: taskContextObj,
        lastActiveTime: Date.now(),
        isTaskActive: this._taskState.isTaskActive,
        taskStartTime: this._taskState.taskStartTime,
        taskSourceFile: this._taskState.taskSourceFile,
      };

      // 写入文件
      fs.writeFileSync(taskStateFile, JSON.stringify(stateToSave, null, 2));
      this.logger.info('任务状态已保存');
    } catch (error) {
      this.logger.error(`保存任务状态失败: ${(error as Error).message}`);
    }
  }

  /**
   * 从文件加载任务状态
   * 从.manus目录恢复之前保存的任务状态
   */
  private loadTaskState(): void {
    try {
      const workspaceRoot = config.getWorkspaceRoot();
      const taskStateFile = path.join(workspaceRoot, '.manus', 'task_state.json');

      // 检查文件是否存在
      if (!fs.existsSync(taskStateFile)) {
        return;
      }

      // 读取并解析状态文件
      const stateData = JSON.parse(fs.readFileSync(taskStateFile, 'utf-8'));
      this._taskState.currentTask = stateData.currentTask || '';

      // 检查数据有效性和时间戳
      const maxAgeMs = 24 * 60 * 60 * 1000; // 24小时
      const now = Date.now();
      if (
        !stateData.currentTask ||
        !stateData.isTaskActive ||
        now - stateData.lastActiveTime > maxAgeMs
      ) {
        this.logger.info('找到过期的任务状态，忽略');
        return;
      }

      // 恢复任务上下文Map
      const taskContext = new Map<string, any>();
      if (stateData.taskContext) {
        Object.entries(stateData.taskContext).forEach(([key, value]) => {
          // 尝试将字符串还原为对象
          if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
            try {
              taskContext.set(key, JSON.parse(value as string));
            } catch (e) {
              taskContext.set(key, value);
            }
          } else {
            taskContext.set(key, value);
          }
        });
      }

      // 恢复任务状态
      this._taskState = {
        currentTask: stateData.currentTask,
        originalTaskDescription: stateData.originalTaskDescription,
        taskPlan: stateData.taskPlan,
        currentStepIndex: stateData.currentStepIndex,
        completedSteps: stateData.completedSteps || [],
        taskContext,
        lastActiveTime: stateData.lastActiveTime,
        isTaskActive: stateData.isTaskActive,
        taskStartTime: stateData.taskStartTime,
        taskSourceFile: stateData.taskSourceFile,
      };

      this.logger.info(
        `已恢复任务: ${stateData.currentTask.substring(0, 50)}${stateData.currentTask.length > 50 ? '...' : ''}`
      );
    } catch (error) {
      this.logger.error(`加载任务状态失败: ${(error as Error).message}`);
    }
  }

  /**
   * 定期保存任务状态
   * 在任务执行过程中定期保存状态，防止意外中断导致任务丢失
   */
  private scheduleTaskStateSaving(): void {
    // 每10秒保存一次任务状态
    const saveInterval = 10 * 1000;

    const intervalId = setInterval(() => {
      if (this._taskState.isTaskActive) {
        this.saveTaskState();
      } else {
        clearInterval(intervalId);
      }
    }, saveInterval);
  }

  /**
   * 执行工具调用
   * 通过智能工具路由器自动选择MCP服务或A2A代理来执行工具
   * @param commandOrName 工具调用命令或工具名称
   * @param args 工具参数（当第一个参数为工具名称时使用）
   */
  protected async executeToolCall(commandOrName: ToolCall | string, args?: any): Promise<any> {
    // 如果有工具路由器，使用智能路由
    if (this.toolRouter) {
      try {
        // 获取工具名称和参数
        let toolName: string;
        let toolArgs: any;

        if (typeof commandOrName === 'string') {
          toolName = commandOrName;
          toolArgs = args || {};
        } else {
          const command = commandOrName;
          if (!command || !command.function || !command.function.name) {
            return '错误: 无效的命令格式';
          }

          toolName = command.function.name;
          try {
            toolArgs = JSON.parse(command.function.arguments || '{}');
          } catch (error) {
            return `错误: 无法解析工具参数 - ${error}`;
          }
        }

        this.logger.info(`通过智能路由器调用工具: ${toolName}`);

        // 构建工具调用请求
        const toolRequest = {
          name: toolName,
          arguments: toolArgs,
          context: {
            task: this._taskState.currentTask
              ? this._taskState.currentTask.substring(0, 200)
              : 'default_task',
            step: this._taskState.currentStepIndex ?? -1,
          },
        };

        // 通过工具路由器执行
        const routerResult = await this.toolRouter.executeToolCall(toolRequest);

        if (!routerResult.success) {
          throw new Error(routerResult.error || '工具执行失败');
        }

        // 如果是直接调用（通过工具名称和参数），返回处理后的结果
        if (typeof commandOrName === 'string') {
          return {
            output: this.formatToolResult(routerResult.result),
            error: null,
            executedBy: routerResult.executedBy,
            executionTime: routerResult.executionTime,
          };
        }

        // 如果是通过 ToolCall 对象调用，返回格式化的观察结果
        return `观察到执行的命令 \`${toolName}\` 的输出 (由 ${routerResult.executedBy} 执行):\n${this.formatToolResult(routerResult.result)}`;
      } catch (error) {
        this.logger.error(`智能路由工具调用失败: ${(error as Error).message}`);

        // 如果是直接调用（通过工具名称和参数），返回错误结果
        if (typeof commandOrName === 'string') {
          return {
            output: null,
            error: (error as Error).message,
          };
        }

        // 如果是通过 ToolCall 对象调用，返回错误消息
        return `执行工具时出错: ${(error as Error).message}`;
      }
    }

    // 回退到父类的工具调用方法（保持向后兼容）
    return super.executeToolCall(commandOrName, args);
  }

  /**
   * 格式化工具结果
   */
  private formatToolResult(result: any): string {
    if (typeof result === 'string') {
      return result;
    }

    if (result && typeof result === 'object') {
      // 如果是MCP结果格式
      if (result.content && Array.isArray(result.content)) {
        return result.content.map((item: any) => item.text || JSON.stringify(item)).join('\n');
      }

      // 如果是A2A结果格式
      if (result.result !== undefined) {
        return typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
      }

      return JSON.stringify(result, null, 2);
    }

    return String(result);
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    // 保存当前任务状态
    // this.saveTaskState();

    // MCP 资源现在通过多智能体系统管理

    // 关闭 MCP 服务器进程
    if (this.mcpServerProcess) {
      try {
        this.mcpServerProcess.kill();
        this.mcpServerProcess = undefined;
      } catch (error) {
        this.logger.error(`MCP 服务器关闭失败: ${(error as Error).message}`);
      }
    }

    // 清理浏览器资源
    if (this.browserContextHelper) {
      // await this.browserContextHelper.cleanupBrowser();
    }

    // 清理其他资源
    this._initialized = false;
    this.logger.info('Manus 代理资源已清理');
  }
}
