/**
 * 智能工具路由器
 * 负责将工具调用路由到合适的MCP服务或A2A代理
 * 避免工具解析硬编码
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { MultiMcpManager } from '../mcp/multi_mcp_manager.js';
import { A2AAgentManager } from '../agent/a2a_agent_manager.js';
import { DecisionEngine, Task } from './decision_engine.js';

// 工具调用请求
export interface ToolCallRequest {
  name: string;
  arguments: Record<string, any>;
  context?: {
    task?: string;
    step?: number;
    userId?: string;
  };
}

// 工具调用结果
export interface ToolCallResult {
  success: boolean;
  result?: any;
  error?: string;
  executedBy: string;
  executionTime: number;
  metadata?: Record<string, any>;
}

// 工具路由策略
export enum RoutingStrategy {
  MCP_FIRST = 'mcp_first', // 优先使用MCP服务
  A2A_FIRST = 'a2a_first', // 优先使用A2A代理
  CAPABILITY_BASED = 'capability_based', // 基于能力匹配
  LOAD_BALANCED = 'load_balanced', // 负载均衡
  HYBRID = 'hybrid', // 混合策略
}

// 工具路由配置
export interface ToolRouterConfig {
  strategy: RoutingStrategy;
  timeout: number;
  retryCount: number;
  fallbackEnabled: boolean;
  mcpPriority: number;
  a2aPriority: number;
}

/**
 * 智能工具路由器类
 */
export class ToolRouter extends EventEmitter {
  private logger: Logger;
  private config: ToolRouterConfig;
  private mcpManager: MultiMcpManager;
  private agentManager: A2AAgentManager;
  private decisionEngine: DecisionEngine;

  // 工具能力映射缓存
  private toolCapabilityCache: Map<string, string[]> = new Map();

  // 性能统计
  private stats = {
    totalCalls: 0,
    mcpCalls: 0,
    a2aCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    averageExecutionTime: 0,
  };

  constructor(
    mcpManager: MultiMcpManager,
    agentManager: A2AAgentManager,
    decisionEngine: DecisionEngine,
    config: Partial<ToolRouterConfig> = {}
  ) {
    super();
    this.logger = new Logger('ToolRouter');
    this.mcpManager = mcpManager;
    this.agentManager = agentManager;
    this.decisionEngine = decisionEngine;

    this.config = {
      strategy: RoutingStrategy.CAPABILITY_BASED,
      timeout: 30000,
      retryCount: 2,
      fallbackEnabled: true,
      mcpPriority: 8,
      a2aPriority: 6,
      ...config,
    };

    this.initializeToolCapabilityCache();
  }

  /**
   * 执行工具调用
   * @param request 工具调用请求
   */
  async executeToolCall(request: ToolCallRequest): Promise<ToolCallResult> {
    const startTime = Date.now();
    this.stats.totalCalls++;

    try {
      this.logger.info(`路由工具调用: ${request.name}`);

      // 根据策略选择执行方式
      const routingDecision = await this.makeRoutingDecision(request);

      let result: ToolCallResult;

      if (routingDecision.type === 'mcp') {
        result = await this.executeMcpTool(request, routingDecision.target);
        this.stats.mcpCalls++;
      } else if (routingDecision.type === 'a2a') {
        result = await this.executeA2ATool(request, routingDecision.target);
        this.stats.a2aCalls++;
      } else {
        throw new Error(`未知的路由类型: ${routingDecision.type}`);
      }

      // 更新统计信息
      const executionTime = Date.now() - startTime;
      result.executionTime = executionTime;
      this.updateStats(true, executionTime);

      this.emit('toolCallCompleted', {
        request,
        result,
        routingDecision,
      });

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.updateStats(false, executionTime);

      this.logger.error(`工具调用失败: ${request.name}`, error);

      // 如果启用了回退机制，尝试其他方式
      if (this.config.fallbackEnabled) {
        try {
          const fallbackResult = await this.executeFallback(request);
          fallbackResult.executionTime = Date.now() - startTime;
          return fallbackResult;
        } catch (fallbackError) {
          this.logger.error(`回退执行也失败: ${request.name}`, fallbackError);
        }
      }

      const result: ToolCallResult = {
        success: false,
        error: (error as Error).message,
        executedBy: 'none',
        executionTime: executionTime,
      };

      this.emit('toolCallFailed', {
        request,
        result,
        error,
      });

      return result;
    }
  }

  /**
   * 做出路由决策
   */
  private async makeRoutingDecision(request: ToolCallRequest): Promise<{
    type: 'mcp' | 'a2a';
    target: string;
    confidence: number;
    reasoning: string;
  }> {
    switch (this.config.strategy) {
      case RoutingStrategy.MCP_FIRST:
        return this.mcpFirstStrategy(request);
      case RoutingStrategy.A2A_FIRST:
        return this.a2aFirstStrategy(request);
      case RoutingStrategy.CAPABILITY_BASED:
        return this.capabilityBasedStrategy(request);
      case RoutingStrategy.LOAD_BALANCED:
        return this.loadBalancedStrategy(request);
      case RoutingStrategy.HYBRID:
        return this.hybridStrategy(request);
      default:
        return this.capabilityBasedStrategy(request);
    }
  }

  /**
   * MCP优先策略
   */
  private async mcpFirstStrategy(request: ToolCallRequest): Promise<any> {
    // 首先尝试在MCP服务中找到工具
    const mcpTools = this.mcpManager.getAllAvailableTools();
    const mcpTool = mcpTools.find((t) => t.tool.name === request.name);

    if (mcpTool) {
      return {
        type: 'mcp',
        target: mcpTool.serviceName,
        confidence: 0.9,
        reasoning: 'MCP优先策略: 在MCP服务中找到匹配工具',
      };
    }

    // 如果MCP中没有，尝试A2A代理
    const a2aAgents = await this.agentManager.getAvailableAgents();
    const suitableAgent = a2aAgents.find((agent) =>
      agent.capabilities.some((cap) => this.isToolRelatedToCapability(request.name, cap))
    );

    if (suitableAgent) {
      return {
        type: 'a2a',
        target: suitableAgent.config.name,
        confidence: 0.7,
        reasoning: 'MCP优先策略: MCP中未找到，回退到A2A代理',
      };
    }

    throw new Error(`无法找到执行工具 ${request.name} 的服务`);
  }

  /**
   * A2A优先策略
   */
  private async a2aFirstStrategy(request: ToolCallRequest): Promise<any> {
    // 首先尝试在A2A代理中找到合适的能力
    const a2aAgents = await this.agentManager.getAvailableAgents();
    const suitableAgent = a2aAgents.find((agent) =>
      agent.capabilities.some((cap) => this.isToolRelatedToCapability(request.name, cap))
    );

    if (suitableAgent) {
      return {
        type: 'a2a',
        target: suitableAgent.config.name,
        confidence: 0.9,
        reasoning: 'A2A优先策略: 在A2A代理中找到匹配能力',
      };
    }

    // 如果A2A中没有，尝试MCP服务
    const mcpTools = this.mcpManager.getAllAvailableTools();
    const mcpTool = mcpTools.find((t) => t.tool.name === request.name);

    if (mcpTool) {
      return {
        type: 'mcp',
        target: mcpTool.serviceName,
        confidence: 0.7,
        reasoning: 'A2A优先策略: A2A中未找到，回退到MCP服务',
      };
    }

    throw new Error(`无法找到执行工具 ${request.name} 的服务`);
  }

  /**
   * 基于能力的策略
   */
  private async capabilityBasedStrategy(request: ToolCallRequest): Promise<any> {
    // 分析工具所需的能力
    const requiredCapabilities = this.analyzeToolCapabilities(request.name);

    // 创建虚拟任务用于决策引擎
    const virtualTask: Task = {
      id: `tool_${Date.now()}`,
      type: 'tool_execution',
      description: `执行工具: ${request.name}`,
      priority: 'medium',
      requiredCapabilities,
      context: request.arguments,
      createdAt: Date.now(),
    };

    // 使用决策引擎做出决策
    const decision = await this.decisionEngine.makeDecision(virtualTask);

    return {
      type: decision.targetType === 'mcp' ? 'mcp' : 'a2a',
      target: decision.targetName,
      confidence: decision.confidence,
      reasoning: `能力匹配策略: ${decision.reasoning}`,
    };
  }

  /**
   * 负载均衡策略
   */
  private async loadBalancedStrategy(request: ToolCallRequest): Promise<any> {
    // 获取MCP和A2A的负载情况
    const mcpServices = this.mcpManager.getServiceStatus();
    const a2aAgents = this.agentManager.getAgentStatus();

    // 简化的负载计算
    const mcpLoad = Object.keys(mcpServices).length > 0 ? 0.5 : 1.0;
    const agentNames = Object.keys(a2aAgents);
    const busyAgents = agentNames.filter((name) => a2aAgents[name].status === 'busy').length;
    const a2aLoad = agentNames.length > 0 ? busyAgents / agentNames.length : 1.0;

    if (mcpLoad < a2aLoad) {
      return this.mcpFirstStrategy(request);
    } else {
      return this.a2aFirstStrategy(request);
    }
  }

  /**
   * 混合策略
   */
  private async hybridStrategy(request: ToolCallRequest): Promise<any> {
    // 结合能力匹配和负载均衡
    const capabilityDecision = await this.capabilityBasedStrategy(request);

    // 如果置信度足够高，直接使用
    if (capabilityDecision.confidence >= 0.8) {
      return capabilityDecision;
    }

    // 否则考虑负载均衡
    const loadDecision = await this.loadBalancedStrategy(request);

    return loadDecision.confidence > capabilityDecision.confidence
      ? loadDecision
      : capabilityDecision;
  }

  /**
   * 执行MCP工具
   */
  private async executeMcpTool(
    request: ToolCallRequest,
    serviceName: string
  ): Promise<ToolCallResult> {
    try {
      const result = await this.mcpManager.callTool(serviceName, request.name, request.arguments);

      return {
        success: true,
        result: result,
        executedBy: `mcp:${serviceName}`,
        executionTime: 0, // 将在调用方设置
        metadata: {
          type: 'mcp',
          serviceName,
        },
      };
    } catch (error) {
      throw new Error(`MCP工具执行失败: ${error}`);
    }
  }

  /**
   * 执行A2A工具
   */
  private async executeA2ATool(
    request: ToolCallRequest,
    agentName: string
  ): Promise<ToolCallResult> {
    try {
      const taskRequest = {
        taskId: `tool_${Date.now()}`,
        taskType: 'tool_execution',
        description: `执行工具: ${request.name}`,
        parameters: {
          toolName: request.name,
          ...request.arguments,
        },
        priority: 'medium' as const,
        requiredCapabilities: this.analyzeToolCapabilities(request.name),
      };

      const result = await this.agentManager.executeTask(agentName, taskRequest);

      return {
        success: true,
        result: result,
        executedBy: `a2a:${agentName}`,
        executionTime: 0, // 将在调用方设置
        metadata: {
          type: 'a2a',
          agentName,
        },
      };
    } catch (error) {
      throw new Error(`A2A工具执行失败: ${error}`);
    }
  }

  /**
   * 执行回退策略
   */
  private async executeFallback(request: ToolCallRequest): Promise<ToolCallResult> {
    this.logger.info(`执行回退策略: ${request.name}`);

    // 尝试相反的策略
    if (this.config.strategy === RoutingStrategy.MCP_FIRST) {
      const decision = await this.a2aFirstStrategy(request);
      return decision.type === 'a2a'
        ? this.executeA2ATool(request, decision.target)
        : this.executeMcpTool(request, decision.target);
    } else {
      const decision = await this.mcpFirstStrategy(request);
      return decision.type === 'mcp'
        ? this.executeMcpTool(request, decision.target)
        : this.executeA2ATool(request, decision.target);
    }
  }

  /**
   * 分析工具所需能力
   */
  private analyzeToolCapabilities(toolName: string): string[] {
    // 从缓存中获取
    if (this.toolCapabilityCache.has(toolName)) {
      return this.toolCapabilityCache.get(toolName)!;
    }

    // 基于工具名称推断能力
    const capabilities: string[] = [];
    const lowerName = toolName.toLowerCase();

    if (lowerName.includes('file') || lowerName.includes('read') || lowerName.includes('write')) {
      capabilities.push('file_operations');
    }
    if (
      lowerName.includes('memory') ||
      lowerName.includes('store') ||
      lowerName.includes('search')
    ) {
      capabilities.push('memory_management');
    }
    if (
      lowerName.includes('bash') ||
      lowerName.includes('shell') ||
      lowerName.includes('command')
    ) {
      capabilities.push('command_execution');
    }
    if (lowerName.includes('plan') || lowerName.includes('strategy')) {
      capabilities.push('planning');
    }
    if (lowerName.includes('chat') || lowerName.includes('completion')) {
      capabilities.push('language_processing');
    }

    // 缓存结果
    this.toolCapabilityCache.set(toolName, capabilities);

    return capabilities;
  }

  /**
   * 检查工具是否与能力相关
   */
  private isToolRelatedToCapability(toolName: string, capability: string): boolean {
    const toolCapabilities = this.analyzeToolCapabilities(toolName);
    return toolCapabilities.includes(capability);
  }

  /**
   * 初始化工具能力缓存
   */
  private async initializeToolCapabilityCache(): Promise<void> {
    // 预定义一些常见工具的能力映射
    const predefinedMappings = {
      FileOperatorsTool: ['file_operations'],
      BashTool: ['command_execution'],
      PlanningTool: ['planning'],
      StrReplaceEditorTool: ['file_operations', 'text_processing'],
      CreateChatCompletionTool: ['language_processing'],
      AskHumanTool: ['human_interaction'],
      SystemInfoTool: ['system_monitoring'],
      Terminate: ['process_control'],
    };

    for (const [toolName, capabilities] of Object.entries(predefinedMappings)) {
      this.toolCapabilityCache.set(toolName, capabilities);
    }
  }

  /**
   * 更新统计信息
   */
  private updateStats(success: boolean, executionTime: number): void {
    if (success) {
      this.stats.successfulCalls++;
    } else {
      this.stats.failedCalls++;
    }

    // 更新平均执行时间
    const totalTime = this.stats.averageExecutionTime * (this.stats.totalCalls - 1) + executionTime;
    this.stats.averageExecutionTime = totalTime / this.stats.totalCalls;
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    return { ...this.stats };
  }

  /**
   * 重置统计信息
   */
  resetStatistics(): void {
    this.stats = {
      totalCalls: 0,
      mcpCalls: 0,
      a2aCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      averageExecutionTime: 0,
    };
  }

  /**
   * 获取配置
   */
  getConfig(): ToolRouterConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<ToolRouterConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('configUpdated', this.config);
  }
}
