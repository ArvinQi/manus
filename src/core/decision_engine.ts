/**
 * 决策引擎
 * 负责根据任务需求选择合适的MCP服务或A2A代理
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import {
  TaskRoutingRule,
  DecisionEngineConfig,
  McpServiceConfig,
  A2AAgentConfig
} from '../schema/multi_agent_config.js';
import { MultiMcpManager } from '../mcp/multi_mcp_manager.js';
import { A2AAgentManager } from '../agent/a2a_agent_manager.js';

// 任务类型定义
export interface Task {
  id: string;
  type: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  requiredCapabilities: string[];
  context?: Record<string, any>;
  metadata?: Record<string, any>;
  createdAt: number;
  deadline?: number;
  retryCount?: number;
}

// 决策结果
export interface DecisionResult {
  targetType: 'mcp' | 'agent' | 'local';
  targetName: string;
  confidence: number;
  reasoning: string;
  fallbackOptions: string[];
  estimatedDuration?: number;
}

// 执行上下文
export interface ExecutionContext {
  task: Task;
  availableResources: {
    mcpServices: string[];
    agents: string[];
  };
  systemLoad: {
    cpu: number;
    memory: number;
    activeConnections: number;
  };
  historicalPerformance: Map<string, PerformanceMetrics>;
}

// 性能指标
export interface PerformanceMetrics {
  averageResponseTime: number;
  successRate: number;
  lastUsed: number;
  totalUsage: number;
  errorRate: number;
}

/**
 * 决策引擎类
 */
export class DecisionEngine extends EventEmitter {
  private logger: Logger;
  private config: DecisionEngineConfig;
  private routingRules: TaskRoutingRule[];
  private mcpManager: MultiMcpManager;
  private agentManager: A2AAgentManager;
  private performanceHistory: Map<string, PerformanceMetrics> = new Map();
  private decisionCache: Map<string, { result: DecisionResult; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 300000; // 5分钟缓存

  constructor(
    config: DecisionEngineConfig,
    routingRules: TaskRoutingRule[],
    mcpManager: MultiMcpManager,
    agentManager: A2AAgentManager
  ) {
    super();
    this.logger = new Logger('DecisionEngine');
    this.config = config;
    this.routingRules = routingRules.filter(rule => rule.enabled);
    this.mcpManager = mcpManager;
    this.agentManager = agentManager;

    // 按优先级排序路由规则
    this.routingRules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 为任务做出执行决策
   */
  async makeDecision(task: Task): Promise<DecisionResult> {
    this.logger.info(`为任务 ${task.id} 做出执行决策`);

    try {
      // 检查缓存
      const cacheKey = this.generateCacheKey(task);
      const cached = this.decisionCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        this.logger.debug(`使用缓存的决策结果: ${cached.result.targetName}`);
        return cached.result;
      }

      // 构建执行上下文
      const context = await this.buildExecutionContext(task);

      // 应用路由规则
      const ruleBasedResult = await this.applyRoutingRules(task, context);
      if (ruleBasedResult) {
        this.cacheDecision(cacheKey, ruleBasedResult);
        return ruleBasedResult;
      }

      // 使用决策策略
      const decision = await this.executeDecisionStrategy(task, context);

      // 缓存决策结果
      this.cacheDecision(cacheKey, decision);

      this.emit('decision_made', { task, decision });
      return decision;

    } catch (error) {
      this.logger.error(`决策制定失败: ${error}`);
      return this.getFallbackDecision(task);
    }
  }

  /**
   * 应用路由规则
   */
  private async applyRoutingRules(task: Task, context: ExecutionContext): Promise<DecisionResult | null> {
    for (const rule of this.routingRules) {
      if (await this.matchesRule(task, rule, context)) {
        this.logger.info(`任务 ${task.id} 匹配路由规则: ${rule.name}`);

        const decision: DecisionResult = {
          targetType: rule.target.type,
          targetName: rule.target.name,
          confidence: 0.9, // 规则匹配的置信度较高
          reasoning: `匹配路由规则: ${rule.name}`,
          fallbackOptions: rule.target.fallback || []
        };

        // 验证目标是否可用
        if (await this.isTargetAvailable(decision.targetType, decision.targetName)) {
          return decision;
        } else {
          // 尝试备选方案
          for (const fallback of decision.fallbackOptions) {
            if (await this.isTargetAvailable(decision.targetType, fallback)) {
              decision.targetName = fallback;
              decision.reasoning += ` (使用备选方案: ${fallback})`;
              return decision;
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * 检查任务是否匹配路由规则
   */
  private async matchesRule(task: Task, rule: TaskRoutingRule, context: ExecutionContext): Promise<boolean> {
    const condition = rule.condition;

    // 检查关键词匹配
    if (condition.keywords && condition.keywords.length > 0) {
      const taskText = `${task.description} ${task.type}`.toLowerCase();
      const hasKeyword = condition.keywords.some(keyword =>
        taskText.includes(keyword.toLowerCase())
      );
      if (!hasKeyword) return false;
    }

    // 检查任务类型
    if (condition.task_type && task.type !== condition.task_type) {
      return false;
    }

    // 检查优先级
    if (condition.priority_level && task.priority !== condition.priority_level) {
      return false;
    }

    // 检查所需能力
    if (condition.capabilities_required && condition.capabilities_required.length > 0) {
      const hasAllCapabilities = condition.capabilities_required.every(cap =>
        task.requiredCapabilities.includes(cap)
      );
      if (!hasAllCapabilities) return false;
    }

    // 检查上下文模式
    if (condition.context_patterns && condition.context_patterns.length > 0) {
      const contextText = JSON.stringify(task.context || {}).toLowerCase();
      const hasPattern = condition.context_patterns.some(pattern =>
        contextText.includes(pattern.toLowerCase())
      );
      if (!hasPattern) return false;
    }

    return true;
  }

  /**
   * 执行决策策略
   */
  private async executeDecisionStrategy(task: Task, context: ExecutionContext): Promise<DecisionResult> {
    switch (this.config.strategy) {
      case 'rule_based':
        return this.ruleBasedDecision(task, context);
      case 'ml_based':
        return this.mlBasedDecision(task, context);
      case 'hybrid':
        return this.hybridDecision(task, context);
      default:
        return this.ruleBasedDecision(task, context);
    }
  }

  /**
   * 基于规则的决策
   */
  private async ruleBasedDecision(task: Task, context: ExecutionContext): Promise<DecisionResult> {
    const candidates = await this.getCandidates(task, context);

    if (candidates.length === 0) {
      return this.getFallbackDecision(task);
    }

    // 根据能力匹配度和性能指标评分
    const scoredCandidates = candidates.map(candidate => {
      const capabilityScore = this.calculateCapabilityScore(task, candidate);
      const performanceScore = this.calculatePerformanceScore(candidate.name);
      const loadScore = this.calculateLoadScore(candidate);

      const totalScore = (capabilityScore * 0.4) + (performanceScore * 0.4) + (loadScore * 0.2);

      return {
        ...candidate,
        score: totalScore
      };
    });

    // 选择得分最高的候选者
    scoredCandidates.sort((a, b) => b.score - a.score);
    const best = scoredCandidates[0];

    return {
      targetType: best.type,
      targetName: best.name,
      confidence: Math.min(best.score, 1.0),
      reasoning: `基于规则的决策: 能力匹配度和性能评分最高`,
      fallbackOptions: scoredCandidates.slice(1, 4).map(c => c.name)
    };
  }

  /**
   * 基于机器学习的决策（占位符实现）
   */
  private async mlBasedDecision(task: Task, context: ExecutionContext): Promise<DecisionResult> {
    // TODO: 实现机器学习决策逻辑
    this.logger.warn('ML决策策略尚未实现，回退到规则决策');
    return this.ruleBasedDecision(task, context);
  }

  /**
   * 混合决策策略
   */
  private async hybridDecision(task: Task, context: ExecutionContext): Promise<DecisionResult> {
    const ruleResult = await this.ruleBasedDecision(task, context);

    // 如果规则决策的置信度足够高，直接使用
    if (ruleResult.confidence >= this.config.confidence_threshold) {
      return ruleResult;
    }

    // 否则尝试ML决策
    try {
      const mlResult = await this.mlBasedDecision(task, context);
      if (mlResult.confidence > ruleResult.confidence) {
        return mlResult;
      }
    } catch (error) {
      this.logger.warn(`ML决策失败，使用规则决策: ${error}`);
    }

    return ruleResult;
  }

  /**
   * 获取候选执行者
   */
  private async getCandidates(task: Task, context: ExecutionContext): Promise<Array<{type: 'mcp' | 'agent'; name: string; capabilities: string[]}>> {
    const candidates: Array<{type: 'mcp' | 'agent'; name: string; capabilities: string[]}> = [];

    // 获取可用的MCP服务
    const mcpServices = await this.mcpManager.getAvailableServices();
    for (const service of mcpServices) {
      if (this.hasRequiredCapabilities(task.requiredCapabilities, service.capabilities)) {
        candidates.push({
          type: 'mcp',
          name: service.name,
          capabilities: service.capabilities
        });
      }
    }

    // 获取可用的A2A代理
    const agents = await this.agentManager.getAvailableAgents();
    for (const agent of agents) {
      if (this.hasRequiredCapabilities(task.requiredCapabilities, agent.capabilities)) {
        candidates.push({
          type: 'agent',
          name: agent.config.name,
          capabilities: agent.capabilities,
        });
      }
    }

    return candidates;
  }

  /**
   * 检查是否具备所需能力
   */
  private hasRequiredCapabilities(required: string[], available: string[]): boolean {
    return required.every(cap => available.includes(cap));
  }

  /**
   * 计算能力匹配分数
   */
  private calculateCapabilityScore(task: Task, candidate: {capabilities: string[]}): number {
    if (task.requiredCapabilities.length === 0) return 0.5;

    const matchedCapabilities = task.requiredCapabilities.filter(cap =>
      candidate.capabilities.includes(cap)
    );

    return matchedCapabilities.length / task.requiredCapabilities.length;
  }

  /**
   * 计算性能分数
   */
  private calculatePerformanceScore(targetName: string): number {
    const metrics = this.performanceHistory.get(targetName);
    if (!metrics) return 0.5; // 默认分数

    // 综合考虑成功率、响应时间和错误率
    const successScore = metrics.successRate;
    const responseScore = Math.max(0, 1 - (metrics.averageResponseTime / 10000)); // 假设10秒为满分
    const errorScore = Math.max(0, 1 - metrics.errorRate);

    return (successScore * 0.4) + (responseScore * 0.3) + (errorScore * 0.3);
  }

  /**
   * 计算负载分数
   */
  private calculateLoadScore(candidate: {type: 'mcp' | 'agent'; name: string}): number {
    // 简化的负载计算，实际应该根据具体的负载指标
    return Math.random() * 0.3 + 0.7; // 0.7-1.0之间的随机值
  }

  /**
   * 检查目标是否可用
   */
  private async isTargetAvailable(type: 'mcp' | 'agent' | 'local', name: string): Promise<boolean> {
    try {
      if (type === 'mcp') {
        return await this.mcpManager.isServiceAvailable(name);
      } else if (type === 'agent') {
        return await this.agentManager.isAgentAvailable(name);
      } else {
        return true; // 本地执行总是可用
      }
    } catch (error) {
      this.logger.error(`检查目标可用性失败: ${error}`);
      return false;
    }
  }

  /**
   * 构建执行上下文
   */
  private async buildExecutionContext(task: Task): Promise<ExecutionContext> {
    const mcpServices = await this.mcpManager.getAvailableServices();
    const agents = await this.agentManager.getAvailableAgents();

    return {
      task,
      availableResources: {
        mcpServices: mcpServices.map((s: any) => s.name),
        agents: agents.map((a: any) => a.config.name),
      },
      systemLoad: {
        cpu: 0.5, // 简化实现
        memory: 0.6,
        activeConnections: mcpServices.length + agents.length,
      },
      historicalPerformance: this.performanceHistory,
    };
  }

  /**
   * 获取回退决策
   */
  private getFallbackDecision(task: Task): DecisionResult {
    let targetName = 'local';

    switch (this.config.fallback_strategy) {
      case 'local':
        targetName = 'local';
        break;
      case 'random':
        // 随机选择一个可用的服务
        const allTargets = [...this.mcpManager.getServiceNames(), ...this.agentManager.getAgentNames()];
        if (allTargets.length > 0) {
          targetName = allTargets[Math.floor(Math.random() * allTargets.length)];
        }
        break;
      case 'priority':
        // 选择优先级最高的服务
        targetName = this.getHighestPriorityTarget();
        break;
    }

    return {
      targetType: targetName === 'local' ? 'local' : 'mcp',
      targetName,
      confidence: 0.3,
      reasoning: `回退策略: ${this.config.fallback_strategy}`,
      fallbackOptions: []
    };
  }

  /**
   * 获取最高优先级的目标
   */
  private getHighestPriorityTarget(): string {
    // 简化实现，实际应该根据配置的优先级
    const mcpServices = this.mcpManager.getServiceNames();
    return mcpServices.length > 0 ? mcpServices[0] : 'local';
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(task: Task): string {
    return `${task.type}_${task.requiredCapabilities.join('_')}_${task.priority}`;
  }

  /**
   * 缓存决策结果
   */
  private cacheDecision(key: string, result: DecisionResult): void {
    this.decisionCache.set(key, {
      result,
      timestamp: Date.now()
    });
  }

  /**
   * 更新性能指标
   */
  updatePerformanceMetrics(targetName: string, metrics: Partial<PerformanceMetrics>): void {
    const existing = this.performanceHistory.get(targetName) || {
      averageResponseTime: 0,
      successRate: 1,
      lastUsed: Date.now(),
      totalUsage: 0,
      errorRate: 0
    };

    this.performanceHistory.set(targetName, {
      ...existing,
      ...metrics,
      lastUsed: Date.now()
    });
  }

  /**
   * 清理过期缓存
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, cached] of this.decisionCache.entries()) {
      if (now - cached.timestamp > this.CACHE_TTL) {
        this.decisionCache.delete(key);
      }
    }
  }

  /**
   * 启动定期清理
   */
  startPeriodicCleanup(): void {
    setInterval(() => {
      this.cleanupCache();
    }, this.CACHE_TTL);
  }

  /**
   * 获取决策统计信息
   */
  getStatistics(): {
    totalDecisions: number;
    cacheHitRate: number;
    averageConfidence: number;
    targetDistribution: Record<string, number>;
  } {
    // 简化的统计实现
    return {
      totalDecisions: this.decisionCache.size,
      cacheHitRate: 0.8, // 占位符
      averageConfidence: 0.75, // 占位符
      targetDistribution: {} // 占位符
    };
  }
}
