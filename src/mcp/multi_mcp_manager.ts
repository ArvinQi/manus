/**
 * 多MCP服务管理器
 * 负责管理多个MCP服务的连接、健康检查、负载均衡等
 */

import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { spawn, ChildProcess } from 'child_process';
import { Logger } from '../utils/logger.js';
import { McpServiceConfig, SimpleMcpServerConfig } from '../schema/multi_agent_config.js';
import { EventEmitter } from 'events';

// 导入系统内置工具
import { BashTool } from '../tool/bash.js';
import { AskHumanTool } from '../tool/ask_human.js';
import { CreateChatCompletionTool } from '../tool/create_chat_completion.js';
import { FileOperatorsTool } from '../tool/file_operators.js';
import { PlanningTool } from '../tool/planning.js';
import { StrReplaceEditorTool } from '../tool/str_replace_editor.js';
import { SystemInfoTool } from '../tool/system_info.js';
import { Terminate } from '../tool/terminate.js';
import { BaseTool } from '../tool/base.js';

// MCP服务状态
export enum McpServiceStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
  MAINTENANCE = 'maintenance',
}

// MCP服务实例
export interface McpServiceInstance {
  config: McpServiceConfig;
  client: McpClient;
  transport: any;
  process?: ChildProcess;
  status: McpServiceStatus;
  lastHealthCheck: number;
  errorCount: number;
  tools: any[];
  resources: any[];
  metadata: Record<string, any>;
  // 系统内置工具实例
  systemTools?: Map<string, BaseTool>;
}

// 服务选择策略
export enum ServiceSelectionStrategy {
  PRIORITY = 'priority',
  ROUND_ROBIN = 'round_robin',
  LEAST_LOADED = 'least_loaded',
  CAPABILITY_MATCH = 'capability_match',
}

/**
 * 多MCP服务管理器
 */
export class MultiMcpManager extends EventEmitter {
  private services: Map<string, McpServiceInstance> = new Map();
  private logger: Logger;
  private healthCheckInterval?: NodeJS.Timeout;
  private roundRobinIndex = 0;

  constructor() {
    super();
    this.logger = new Logger('MultiMcpManager');
  }

  /**
   * 初始化所有MCP服务 (只支持新格式)
   */
  async initialize(
    configs?: Record<string, SimpleMcpServerConfig>
  ): Promise<void> {
    if (!configs) {
      this.logger.warn('未提供MCP服务配置，跳过初始化');
      return;
    }

    const normalizedConfigs = this.convertNewFormatToOldFormat(configs);
    this.logger.info(`初始化 ${normalizedConfigs.length} 个MCP服务`);

    // 首先初始化系统内置工具服务
    await this.initializeSystemTools();

    // 并行初始化所有服务
    const initPromises = normalizedConfigs.map((config) => this.initializeService(config));
    const results = await Promise.allSettled(initPromises);

    // 统计初始化结果
    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    this.logger.info(`MCP服务初始化完成: 成功 ${successful}, 失败 ${failed}`);

    // 启动健康检查
    this.startHealthCheck();

    this.emit('initialized', { successful, failed, total: normalizedConfigs.length + 1 }); // +1 for system tools
  }

  /**
   * 将新格式配置转换为旧格式配置
   */
  private convertNewFormatToOldFormat(
    newFormat: Record<string, SimpleMcpServerConfig>
  ): McpServiceConfig[] {
    return Object.entries(newFormat).map(([name, config]) => ({
      name,
      type: config.type || 'stdio',
      command: config.command,
      args: config.args,
      url: config.url,
      capabilities: config.capabilities || [],
      priority: config.priority || 1,
      enabled: config.enabled !== false, // 默认启用
      timeout: config.timeout || 30000,
      retry_count: config.retry_count || 3,
      health_check_interval: 60000, // 固定值
      metadata: config.metadata || {}
    }));
  }

  /**
   * 初始化系统内置工具
   */
  private async initializeSystemTools(): Promise<void> {
    this.logger.info('初始化系统内置工具服务');

    try {
      // 创建系统工具实例
      const systemTools = new Map<string, BaseTool>();

      // 初始化所有系统工具
      systemTools.set('bash', new BashTool());
      // systemTools.set('ask_human', new AskHumanTool());
      // systemTools.set('create_chat_completion', new CreateChatCompletionTool());
      // systemTools.set('file_operators', new FileOperatorsTool());
      systemTools.set('planning', new PlanningTool());
      systemTools.set('str_replace_editor', new StrReplaceEditorTool());
      // systemTools.set('system_info', new SystemInfoTool());
      systemTools.set('terminate', new Terminate());

      // 创建系统工具的MCP服务实例
      const systemToolsConfig: McpServiceConfig = {
        name: 'system_tools',
        type: 'stdio', // 使用stdio类型作为占位符
        enabled: true,
        capabilities: [
          'bash',
          // 'file_operations',
          'planning',
          // 'chat_completion',
          // 'system_info',
          'process_control',
        ],
        priority: 1,
        timeout: 30000,
        retry_count: 3,
        health_check_interval: 60000,
        metadata: {
          description: 'System built-in tools',
          version: '1.0.0',
          builtin: true,
        },
      };

      // 生成工具描述
      const toolDescriptions = Array.from(systemTools.entries()).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: tool.parameters || {},
      }));

      const systemInstance: McpServiceInstance = {
        config: systemToolsConfig,
        client: {} as McpClient, // 内置工具不需要真正的MCP客户端
        transport: null,
        status: McpServiceStatus.CONNECTED,
        lastHealthCheck: Date.now(),
        errorCount: 0,
        tools: toolDescriptions,
        resources: [],
        metadata: systemToolsConfig.metadata || {},
        systemTools,
      };

      this.services.set('system_tools', systemInstance);
      this.logger.info('系统内置工具服务初始化完成');
      this.emit('serviceConnected', 'system_tools');
    } catch (error) {
      this.logger.error('系统内置工具服务初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化单个MCP服务
   */
  private async initializeService(config: McpServiceConfig): Promise<void> {
    if (!config.enabled) {
      this.logger.info(`跳过已禁用的MCP服务: ${config.name}`);
      return;
    }

    try {
      this.logger.info(`初始化MCP服务: ${config.name}`);

      const instance: McpServiceInstance = {
        config,
        client: new McpClient({ name: `manus-client-${config.name}`, version: '1.0.0' }),
        transport: null,
        status: McpServiceStatus.CONNECTING,
        lastHealthCheck: Date.now(),
        errorCount: 0,
        tools: [],
        resources: [],
        metadata: config.metadata || {},
      };

      // 根据类型创建传输层
      switch (config.type) {
        case 'stdio':
          await this.createStdioTransport(instance);
          break;
        case 'http':
          await this.createHttpTransport(instance);
          break;
        case 'websocket':
          await this.createWebSocketTransport(instance);
          break;
        default:
          throw new Error(`不支持的MCP服务类型: ${config.type}`);
      }

      // 连接到服务
      await instance.client.connect(instance.transport);

      // 获取服务能力
      await this.loadServiceCapabilities(instance);

      instance.status = McpServiceStatus.CONNECTED;
      this.services.set(config.name, instance);

      this.logger.info(`MCP服务 ${config.name} 初始化成功`);
      this.emit('serviceConnected', config.name);
    } catch (error) {
      this.logger.error(`MCP服务 ${config.name} 初始化失败:`, error);
      this.emit('serviceError', config.name, error);
      throw error;
    }
  }

  /**
   * 创建Stdio传输层
   */
  private async createStdioTransport(instance: McpServiceInstance): Promise<void> {
    const { config } = instance;
    if (!config.command) {
      throw new Error(`Stdio类型的MCP服务必须提供command: ${config.name}`);
    }

    // 启动子进程
    const process = spawn(config.command, config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    instance.process = process;
    instance.transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
    });

    // 监听进程事件
    process.on('error', (error) => {
      this.logger.error(`MCP服务进程错误 ${config.name}:`, error);
      this.handleServiceError(config.name, error);
    });

    process.on('exit', (code) => {
      this.logger.warn(`MCP服务进程退出 ${config.name}, 退出码: ${code}`);
      this.handleServiceDisconnect(config.name);
    });
  }

  /**
   * 创建HTTP传输层
   */
  private async createHttpTransport(instance: McpServiceInstance): Promise<void> {
    const { config } = instance;
    if (!config.url) {
      throw new Error(`HTTP类型的MCP服务必须提供url: ${config.name}`);
    }

    instance.transport = new StreamableHTTPClientTransport(new URL(config.url));
  }

  /**
   * 创建WebSocket传输层
   */
  private async createWebSocketTransport(instance: McpServiceInstance): Promise<void> {
    // TODO: 实现WebSocket传输层
    throw new Error('WebSocket传输层暂未实现');
  }

  /**
   * 加载服务能力
   */
  private async loadServiceCapabilities(instance: McpServiceInstance): Promise<void> {
    try {
      // 获取工具列表
      const toolsResponse = await instance.client.listTools();
      instance.tools = toolsResponse.tools || [];

      // 获取资源列表
      try {
        const resourcesResponse = await instance.client.listResources();
        instance.resources = resourcesResponse.resources || [];
      } catch (error) {
        // 某些MCP服务可能不支持资源
        this.logger.debug(`MCP服务 ${instance.config.name} 不支持资源列表`);
      }

      this.logger.info(
        `MCP服务 ${instance.config.name} 加载能力: ${instance.tools.length} 个工具, ${instance.resources.length} 个资源`
      );
    } catch (error) {
      this.logger.error(`加载MCP服务能力失败 ${instance.config.name}:`, error);
      throw error;
    }
  }

  /**
   * 选择合适的MCP服务
   */
  selectService(
    requiredCapabilities: string[] = [],
    strategy: ServiceSelectionStrategy = ServiceSelectionStrategy.PRIORITY
  ): McpServiceInstance | null {
    const availableServices = Array.from(this.services.values()).filter(
      (service) => service.status === McpServiceStatus.CONNECTED
    );

    if (availableServices.length === 0) {
      this.logger.warn('没有可用的MCP服务');
      return null;
    }

    // 根据能力过滤
    let candidateServices = availableServices;
    if (requiredCapabilities.length > 0) {
      candidateServices = availableServices.filter((service) =>
        requiredCapabilities.every(
          (cap) =>
            service.config.capabilities.includes(cap) ||
            service.tools.some((tool) => tool.name === cap)
        )
      );
    }

    if (candidateServices.length === 0) {
      this.logger.warn(`没有支持所需能力的MCP服务: ${requiredCapabilities.join(', ')}`);
      return null;
    }

    // 根据策略选择服务
    switch (strategy) {
      case ServiceSelectionStrategy.PRIORITY:
        return candidateServices.sort((a, b) => b.config.priority - a.config.priority)[0];

      case ServiceSelectionStrategy.ROUND_ROBIN:
        const service = candidateServices[this.roundRobinIndex % candidateServices.length];
        this.roundRobinIndex++;
        return service;

      case ServiceSelectionStrategy.LEAST_LOADED:
        return candidateServices.sort((a, b) => a.errorCount - b.errorCount)[0];

      case ServiceSelectionStrategy.CAPABILITY_MATCH:
        // 选择能力匹配度最高的服务
        return candidateServices.sort((a, b) => {
          const aMatch = this.calculateCapabilityMatch(a, requiredCapabilities);
          const bMatch = this.calculateCapabilityMatch(b, requiredCapabilities);
          return bMatch - aMatch;
        })[0];

      default:
        return candidateServices[0];
    }
  }

  /**
   * 计算能力匹配度
   */
  private calculateCapabilityMatch(
    service: McpServiceInstance,
    requiredCapabilities: string[]
  ): number {
    if (requiredCapabilities.length === 0) return 1;

    const matchedCapabilities = requiredCapabilities.filter(
      (cap) =>
        service.config.capabilities.includes(cap) || service.tools.some((tool) => tool.name === cap)
    );

    return matchedCapabilities.length / requiredCapabilities.length;
  }

  /**
   * 执行工具调用
   */
  async callTool(serviceName: string, toolName: string, args: any): Promise<any> {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`MCP服务不存在: ${serviceName}`);
    }

    if (service.status !== McpServiceStatus.CONNECTED) {
      throw new Error(`MCP服务未连接: ${serviceName}`);
    }

    try {
      // 检查是否为系统内置工具
      if (service.systemTools) {
        const systemTool = service.systemTools.get(toolName);
        if (systemTool) {
          this.logger.info(`调用系统内置工具: ${toolName}`);
          const result = await systemTool.run(args);
          return {
            content: [
              {
                type: 'text',
                text: result.output
                  ? String(result.output)
                  : result.error
                    ? `错误: ${result.error}`
                    : '操作完成',
              },
            ],
          };
        }
      }

      // 调用外部MCP服务工具
      const result = await service.client.callTool({ name: toolName, arguments: args });
      return result;
    } catch (error) {
      this.handleServiceError(serviceName, error);
      throw error;
    }
  }

  /**
   * 获取服务统计信息
   */
  async getServiceStatistics(): Promise<{
    total: number;
    connected: number;
    failed: number;
    tools: number;
    resources: number;
  }> {
    const total = this.services.size;
    let connected = 0;
    let failed = 0;
    let totalTools = 0;
    let totalResources = 0;

    for (const service of this.services.values()) {
      if (service.status === McpServiceStatus.CONNECTED) {
        connected++;
      } else if (service.status === McpServiceStatus.ERROR) {
        failed++;
      }

      totalTools += service.tools.length;
      totalResources += service.resources.length;
    }

    return {
      total,
      connected,
      failed,
      tools: totalTools,
      resources: totalResources,
    };
  }

  /**
   * 获取服务状态
   */
  getServiceStatus(): Record<string, any> {
    const status: Record<string, any> = {};

    for (const [name, service] of this.services) {
      status[name] = {
        status: service.status,
        lastHealthCheck: service.lastHealthCheck,
        errorCount: service.errorCount,
        toolCount: service.tools.length,
        resourceCount: service.resources.length,
        priority: service.config.priority,
      };
    }

    return status;
  }

  /**
   * 启动健康检查
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 60000); // 每分钟检查一次
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.performHealthCheck();
      return true;
    } catch (error) {
      this.logger.error('MCP健康检查失败:', error);
      return false;
    }
  }

  /**
   * 检查服务是否可用
   */
  async isServiceAvailable(serviceName: string): Promise<boolean> {
    const service = this.services.get(serviceName);
    return service ? service.status === McpServiceStatus.CONNECTED : false;
  }

  /**
   * 检查代理是否可用（向后兼容）
   */
  async isAgentAvailable(agentName: string): Promise<boolean> {
    return this.isServiceAvailable(agentName);
  }

  private async performHealthCheck(): Promise<void> {
    for (const [name, service] of this.services) {
      if (service.status === McpServiceStatus.CONNECTED) {
        try {
          // 系统内置工具跳过健康检查
          if (service.systemTools) {
            service.lastHealthCheck = Date.now();
            continue;
          }

          // 简单的ping检查
          await service.client.listTools();
          service.lastHealthCheck = Date.now();
        } catch (error) {
          this.logger.warn(`MCP服务健康检查失败 ${name}:`, error);
          this.handleServiceError(name, error);
        }
      }
    }
  }

  /**
   * 处理服务错误
   */
  private handleServiceError(serviceName: string, error: any): void {
    const service = this.services.get(serviceName);
    if (service) {
      service.errorCount++;
      service.status = McpServiceStatus.ERROR;
      this.emit('serviceError', serviceName, error);

      // 如果错误次数过多，尝试重连
      if (service.errorCount >= service.config.retry_count) {
        this.logger.warn(`MCP服务 ${serviceName} 错误次数过多，尝试重连`);
        this.reconnectService(serviceName);
      }
    }
  }

  /**
   * 处理服务断开连接
   */
  private handleServiceDisconnect(serviceName: string): void {
    const service = this.services.get(serviceName);
    if (service) {
      service.status = McpServiceStatus.DISCONNECTED;
      this.emit('serviceDisconnected', serviceName);
    }
  }

  /**
   * 重连服务
   */
  private async reconnectService(serviceName: string): Promise<void> {
    const service = this.services.get(serviceName);
    if (!service) return;

    try {
      this.logger.info(`重连MCP服务: ${serviceName}`);

      // 清理旧连接
      if (service.client) {
        try {
          await service.client.close();
        } catch (error) {
          // 忽略关闭错误
        }
      }

      if (service.process) {
        service.process.kill();
      }

      // 重新初始化
      await this.initializeService(service.config);
    } catch (error) {
      this.logger.error(`重连MCP服务失败 ${serviceName}:`, error);
    }
  }

  /**
   * 关闭所有服务
   */
  async shutdown(): Promise<void> {
    this.logger.info('关闭所有MCP服务');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    const shutdownPromises = Array.from(this.services.values()).map(async (service) => {
      try {
        if (service.client) {
          await service.client.close();
        }
        if (service.process) {
          service.process.kill();
        }
      } catch (error) {
        this.logger.error(`关闭MCP服务失败 ${service.config.name}:`, error);
      }
    });

    await Promise.allSettled(shutdownPromises);
    this.services.clear();

    this.emit('shutdown');
  }

  /**
   * 获取所有可用工具
   */
  getAllAvailableTools(): Array<{ serviceName: string; tool: any }> {
    const tools: Array<{ serviceName: string; tool: any }> = [];

    for (const [serviceName, service] of this.services) {
      if (service.status === McpServiceStatus.CONNECTED) {
        for (const tool of service.tools) {
          tools.push({ serviceName, tool });
        }
      }
    }

    return tools;
  }

  /**
   * 添加MCP服务
   */
  async addService(config: McpServiceConfig): Promise<void> {
    if (this.services.has(config.name)) {
      this.logger.warn(`MCP服务 ${config.name} 已存在，将被替换`);
      await this.removeService(config.name);
    }

    this.logger.info(`添加MCP服务: ${config.name}`);
    await this.initializeService(config);
  }

  /**
   * 移除MCP服务
   */
  async removeService(name: string): Promise<void> {
    const service = this.services.get(name);
    if (!service) {
      this.logger.warn(`尝试移除不存在的MCP服务: ${name}`);
      return;
    }

    this.logger.info(`移除MCP服务: ${name}`);

    try {
      // 关闭客户端连接
      if (service.client) {
        await service.client.close();
      }

      // 关闭进程
      if (service.process) {
        service.process.kill();
      }

      // 从服务列表中移除
      this.services.delete(name);

      this.emit('serviceRemoved', name);
    } catch (error) {
      this.logger.error(`移除MCP服务失败 ${name}:`, error);
      throw error;
    }
  }

  /**
   * 获取服务实例
   */
  getService(name: string): McpServiceInstance | undefined {
    return this.services.get(name);
  }

  /**
   * 获取所有服务名称
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * 获取所有可用服务
   */
  async getAvailableServices(): Promise<
    Array<{ name: string; capabilities: string[]; tools: any[] }>
  > {
    const availableServices: Array<{ name: string; capabilities: string[]; tools: any[] }> = [];

    for (const [name, service] of this.services) {
      if (service.status === McpServiceStatus.CONNECTED) {
        availableServices.push({
          name,
          capabilities: service.config.capabilities || [],
          tools: service.tools || [],
        });
      }
    }

    return availableServices;
  }

  /**
   * 执行任务
   * @param serviceName MCP服务名称
   * @param taskRequest 任务请求
   */
  async executeTask(
    serviceName: string,
    taskRequest: {
      taskId: string;
      taskType: string;
      description: string;
      parameters: Record<string, any>;
      signal?: AbortSignal;
    }
  ): Promise<any> {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`MCP服务不存在: ${serviceName}`);
    }

    if (service.status !== McpServiceStatus.CONNECTED) {
      throw new Error(`MCP服务未连接: ${serviceName}`);
    }

    try {
      this.logger.info(`通过MCP服务 ${serviceName} 执行任务: ${taskRequest.taskId}`);

      // 根据任务类型选择合适的工具
      const availableTools = service.tools;
      let selectedTool = null;

      // 简单的工具选择逻辑 - 可以根据需要扩展
      if (taskRequest.taskType === 'file_operation') {
        selectedTool = availableTools.find(
          (tool) =>
            tool.name.includes('file') || tool.name.includes('read') || tool.name.includes('write')
        );
      } else if (taskRequest.taskType === 'memory_operation') {
        selectedTool = availableTools.find(
          (tool) =>
            tool.name.includes('memory') ||
            tool.name.includes('store') ||
            tool.name.includes('search')
        );
      } else {
        // 默认选择第一个可用工具
        selectedTool = availableTools[0];
      }

      if (!selectedTool) {
        throw new Error(`在MCP服务 ${serviceName} 中找不到适合的工具`);
      }

      // 调用选定的工具
      let result: any;
      if (service.systemTools) {
        const systemTool = service.systemTools.get(selectedTool.name);
        if (systemTool) {
          const toolResult = await systemTool.run(taskRequest.parameters);
          result = {
            content: [
              {
                type: 'text',
                text: toolResult.output
                  ? String(toolResult.output)
                  : toolResult.error
                    ? `错误: ${toolResult.error}`
                    : '操作完成',
              },
            ],
          };
        } else {
          result = await service.client.callTool({
            name: selectedTool.name,
            arguments: taskRequest.parameters,
          });
        }
      } else {
        result = await service.client.callTool({
          name: selectedTool.name,
          arguments: taskRequest.parameters,
        });
      }

      return {
        taskId: taskRequest.taskId,
        status: 'completed',
        result: result,
        executedBy: serviceName,
        toolUsed: selectedTool.name,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.handleServiceError(serviceName, error);
      throw new Error(`MCP任务执行失败: ${error}`);
    }
  }

  /**
   * 通过能力匹配执行工具调用
   * @param toolName 工具名称
   * @param args 工具参数
   * @param requiredCapabilities 所需能力
   */
  async executeToolByCapability(
    toolName: string,
    args: Record<string, any>,
    requiredCapabilities: string[] = []
  ): Promise<any> {
    // 选择具有所需能力的服务
    const suitableService = this.selectService(requiredCapabilities);

    if (!suitableService) {
      throw new Error(`找不到具有所需能力的MCP服务: ${requiredCapabilities.join(', ')}`);
    }

    // 检查服务是否有指定的工具
    const tool = suitableService.tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(`MCP服务 ${suitableService.config.name} 中找不到工具: ${toolName}`);
    }

    try {
      this.logger.info(`通过MCP服务 ${suitableService.config.name} 调用工具: ${toolName}`);

      let result: any;
      if (suitableService.systemTools) {
        const systemTool = suitableService.systemTools.get(toolName);
        if (systemTool) {
          const toolResult = await systemTool.run(args);
          result = {
            content: [
              {
                type: 'text',
                text: toolResult.output
                  ? String(toolResult.output)
                  : toolResult.error
                    ? `错误: ${toolResult.error}`
                    : '操作完成',
              },
            ],
          };
        } else {
          result = await suitableService.client.callTool({
            name: toolName,
            arguments: args,
          });
        }
      } else {
        result = await suitableService.client.callTool({
          name: toolName,
          arguments: args,
        });
      }

      return {
        result: result,
        executedBy: suitableService.config.name,
        toolName: toolName,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.handleServiceError(suitableService.config.name, error);
      throw error;
    }
  }
}
