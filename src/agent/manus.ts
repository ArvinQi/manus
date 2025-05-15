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
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { BaseTool } from '../tool/base.js';

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

  // MCP 客户端
  private mcpClient?: McpClient;

  // MCP 服务器进程
  private mcpServerProcess?: any;

  // 任务状态相关属性
  private _taskState: {
    currentTask?: string; // 当前正在执行的任务描述
    taskPlan?: string[]; // 任务计划步骤列表
    currentStepIndex?: number; // 当前执行到的步骤索引
    taskContext?: Map<string, any>; // 任务上下文信息，存储任务执行过程中的关键数据
    lastActiveTime?: number; // 最后活动时间戳
    isTaskActive?: boolean; // 任务是否处于活动状态
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

    // 初始化任务状态
    this._taskState = {
      isTaskActive: false,
      taskContext: new Map<string, any>(),
      lastActiveTime: Date.now(),
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
    // 检查.manus目录
    const workspaceRoot = config.getWorkspaceRoot();
    const manusDir = path.join(workspaceRoot, '.manus');

    if (fs.existsSync(manusDir)) {
      // 尝试恢复任务状态
      if (continueTask) {
        this.loadTaskState();
      }

      // 检查是否处于继续任务状态
      const isContinuingTask = this._taskState.isTaskActive && this._taskState.currentTask;

      if (!isContinuingTask) {
        // 如果不是继续任务，则备份目录
        const backupDir = path.join(workspaceRoot, `.manus_backup_${Date.now()}`);
        this.logger.info(`发现现有.manus目录，正在备份到 ${backupDir}`);
        fs.cpSync(manusDir, backupDir, { recursive: true });

        // 清空原目录
        fs.rmSync(manusDir, { recursive: true, force: true });
        fs.mkdirSync(manusDir, { recursive: true });
      } else {
        this.logger.info('继续执行任务，保留现有.manus目录');
      }
    } else {
      // 创建.manus目录
      fs.mkdirSync(manusDir, { recursive: true });
    }

    // 如果使用 MCP Server，则启动服务器并连接客户端
    if (useMcpServer) {
      await this.initializeMcpServer();
    }

    // 启动定期保存任务状态的功能
    // this.scheduleTaskStateSaving();

    this._initialized = true;
    this.logger.info('Manus 代理已初始化');
  }

  /**
   * 初始化 MCP 服务器和客户端
   */
  private async initializeMcpServer(): Promise<void> {
    try {
      // 读取 MCP Server 地址（可从配置或环境变量获取）
      // const serverUrl = process.env.MCP_SERVER_URL || 'http://localhost:41741/mcp';
      // this.logger.info(`连接到 MCP 服务器: ${serverUrl}`);
      this.logger.info(`连接到 MCP 服务器`);
      // 创建 MCP 客户端
      const transport = new StdioClientTransport({
        command: 'node',
        args: ['dist/mcp/server.js'],
        stderr: 'inherit',
      });

      // 创建 MCP 客户端
      this.mcpClient = new McpClient({
        name: 'manus-client',
        version: '1.0.0',
      });

      await this.mcpClient.connect(transport);

      this.mcpClient.onerror = (error: any) => {
        this.logger.error('MCP 客户端错误: ' + error);
      };

      // 使用 HTTP 传输层连接 MCP Server
      // const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
      // await this.mcpClient.connect(transport);
      // 获取可用工具
      const toolsResult = await this.mcpClient.request(
        { method: 'tools/list', params: {} },
        z.object({ tools: z.array(z.any()) })
      );

      const tools = toolsResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.inputSchema.description || '',
        parameters: tool.inputSchema,
      }));

      // this.availableTools = new ToolCollection(...tools);
      this.logger.info(
        `已连接到 MCP 服务器，可用工具: ${tools.map((t: any) => t.name).join(', ')}`
      );
    } catch (error) {
      this.logger.error(`MCP 服务器初始化失败: ${(error as Error).message}`);
      throw error;
    }
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
    if (this._taskState.isTaskActive && this._taskState.currentTask) {
      const taskContext = this.formatTaskContext();
      this.nextStepPrompt = `${taskContext}\n\n${originalPrompt}`;
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
   * 保存任务状态到文件
   * 将当前任务状态持久化到.manus目录
   */
  private saveTaskState(): void {
    try {
      // 如果没有活跃任务，不需要保存
      if (!this._taskState.isTaskActive || !this._taskState.currentTask) {
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
        taskPlan: this._taskState.taskPlan,
        currentStepIndex: this._taskState.currentStepIndex,
        taskContext: taskContextObj,
        lastActiveTime: Date.now(),
        isTaskActive: this._taskState.isTaskActive,
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
        taskPlan: stateData.taskPlan,
        currentStepIndex: stateData.currentStepIndex,
        taskContext,
        lastActiveTime: stateData.lastActiveTime,
        isTaskActive: stateData.isTaskActive,
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
   * 如果使用 MCP 服务器，则通过 MCP 客户端调用工具
   * 否则使用父类的工具调用方法
   * @param commandOrName 工具调用命令或工具名称
   * @param args 工具参数（当第一个参数为工具名称时使用）
   */
  protected async executeToolCall(commandOrName: ToolCall | string, args?: any): Promise<any> {
    // 如果使用 MCP 客户端，则通过 MCP 调用工具
    if (this.mcpClient) {
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

        this.logger.info(`通过 MCP 调用工具: ${toolName}`);
        const result = await this.mcpClient.callTool({
          name: toolName,
          arguments: toolArgs,
          context: {
            task: this._taskState.currentTask
              ? this._taskState.currentTask.substring(0, 200)
              : 'default_task',
            step: this._taskState.currentStepIndex ?? -1,
          },
        });

        // 如果是直接调用（通过工具名称和参数），返回处理后的结果
        if (typeof commandOrName === 'string') {
          return {
            output: (result as any).content?.[0]?.text || JSON.stringify(result),
            error: null,
          };
        }

        // 如果是通过 ToolCall 对象调用，返回格式化的观察结果
        return `观察到执行的命令 \`${toolName}\` 的输出:\n${(result as any).content?.[0]?.text || JSON.stringify(result)}`;
      } catch (error) {
        this.logger.error(`MCP 工具调用失败: ${(error as Error).message}`);

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

    // 否则使用父类的工具调用方法
    return super.executeToolCall(commandOrName, args);
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    // 保存当前任务状态
    // this.saveTaskState();

    // 清理 MCP 资源
    if (this.mcpClient) {
      try {
        // await this.mcpClient.disconnect(); // SDK 没有 disconnect 方法
        this.mcpClient = undefined;
      } catch (error) {
        this.logger.error(`MCP 客户端断开连接失败: ${(error as Error).message}`);
      }
    }

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
