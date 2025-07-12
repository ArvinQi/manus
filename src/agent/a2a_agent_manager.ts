/**
 * A2A (Agent-to-Agent) 代理管理器
 * 负责管理多个A2A协议的代理连接、通信和负载均衡
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
import { A2AAgentConfig } from '../schema/multi_agent_config.js';
import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';

// A2A代理状态
export enum A2AAgentStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
  BUSY = 'busy',
  MAINTENANCE = 'maintenance'
}

// A2A消息类型
export enum A2AMessageType {
  TASK_REQUEST = 'task_request',
  TASK_RESPONSE = 'task_response',
  STATUS_UPDATE = 'status_update',
  CAPABILITY_QUERY = 'capability_query',
  CAPABILITY_RESPONSE = 'capability_response',
  HEALTH_CHECK = 'health_check',
  ERROR = 'error'
}

// A2A消息接口
export interface A2AMessage {
  id: string;
  type: A2AMessageType;
  source: string;
  target: string;
  timestamp: number;
  payload: any;
  metadata?: Record<string, any>;
}

// A2A任务请求
export interface A2ATaskRequest {
  taskId: string;
  taskType: string;
  description: string;
  parameters: Record<string, any>;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  timeout?: number;
  requiredCapabilities: string[];
  context?: Record<string, any>;
}

// A2A任务响应
export interface A2ATaskResponse {
  taskId: string;
  status: 'accepted' | 'rejected' | 'completed' | 'failed' | 'in_progress';
  result?: any;
  error?: string;
  progress?: number;
  estimatedCompletion?: number;
}

// A2A代理实例
export interface A2AAgentInstance {
  config: A2AAgentConfig;
  status: A2AAgentStatus;
  lastHealthCheck: number;
  errorCount: number;
  activeConnections: number;
  currentLoad: number;
  capabilities: string[];
  specialties: string[];
  httpClient?: AxiosInstance;
  wsConnection?: WebSocket;
  metadata: Record<string, any>;
  statistics: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    lastRequestTime: number;
  };
}

/**
 * A2A代理管理器
 */
export class A2AAgentManager extends EventEmitter {
  private agents: Map<string, A2AAgentInstance> = new Map();
  private logger: Logger;
  private healthCheckInterval?: NodeJS.Timeout;
  private loadBalancingIndex = 0;
  private pendingTasks: Map<
    string,
    { resolve: Function; reject: Function; timeout: NodeJS.Timeout; agentName: string }
  > = new Map();

  constructor() {
    super();
    this.logger = new Logger('A2AAgentManager');
  }

  /**
   * 初始化所有A2A代理
   */
  async initialize(configs: A2AAgentConfig[]): Promise<void> {
    this.logger.info(`初始化 ${configs.length} 个A2A代理`);

    // 并行初始化所有代理
    const initPromises = configs.map((config) => this.initializeAgent(config));
    const results = await Promise.allSettled(initPromises);

    // 统计初始化结果
    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    this.logger.info(`A2A代理初始化完成: 成功 ${successful}, 失败 ${failed}`);

    // 启动健康检查
    this.startHealthCheck();

    this.emit('initialized', { successful, failed, total: configs.length });
  }

  /**
   * 初始化单个A2A代理
   */
  private async initializeAgent(config: A2AAgentConfig): Promise<void> {
    if (!config.enabled) {
      this.logger.info(`跳过已禁用的A2A代理: ${config.name}`);
      return;
    }

    try {
      this.logger.info(`初始化A2A代理: ${config.name}`);

      const instance: A2AAgentInstance = {
        config,
        status: A2AAgentStatus.CONNECTING,
        lastHealthCheck: Date.now(),
        errorCount: 0,
        activeConnections: 0,
        currentLoad: 0,
        capabilities: config.capabilities,
        specialties: config.specialties,
        metadata: config.metadata || {},
        statistics: {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          averageResponseTime: 0,
          lastRequestTime: 0,
        },
      };

      // 根据协议类型建立连接
      switch (config.type) {
        case 'http':
          await this.createHttpConnection(instance);
          break;
        case 'websocket':
          await this.createWebSocketConnection(instance);
          break;
        case 'grpc':
          await this.createGrpcConnection(instance);
          break;
        case 'message_queue':
          await this.createMessageQueueConnection(instance);
          break;
        default:
          throw new Error(`不支持的A2A协议类型: ${config.type}`);
      }

      // 查询代理能力
      await this.queryAgentCapabilities(instance);

      instance.status = A2AAgentStatus.CONNECTED;
      this.agents.set(config.name, instance);

      this.logger.info(`A2A代理 ${config.name} 初始化成功`);
      this.emit('agentConnected', config.name);
    } catch (error) {
      this.logger.error(`A2A代理 ${config.name} 初始化失败:`, error);
      this.emit('agentError', config.name, error);
      throw error;
    }
  }

  /**
   * 创建HTTP连接
   */
  private async createHttpConnection(instance: A2AAgentInstance): Promise<void> {
    const { config } = instance;

    // 创建HTTP客户端
    const httpClient = axios.create({
      baseURL: config.endpoint,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Manus-A2A-Client/2.0.0',
      },
    });

    // 添加认证
    if (config.auth && config.auth.type !== 'none') {
      this.addAuthentication(httpClient, config.auth);
    }

    // 添加请求拦截器
    httpClient.interceptors.request.use(
      (config) => {
        this.logger.debug(
          `发送HTTP请求到 ${instance.config.name}: ${config.method?.toUpperCase()} ${config.url}`
        );
        return config;
      },
      (error) => {
        this.logger.error(`HTTP请求错误 ${instance.config.name}:`, error);
        return Promise.reject(error);
      }
    );

    // 添加响应拦截器
    httpClient.interceptors.response.use(
      (response) => {
        this.logger.debug(`收到HTTP响应从 ${instance.config.name}: ${response.status}`);
        return response;
      },
      (error) => {
        this.logger.error(`HTTP响应错误 ${instance.config.name}:`, error);
        this.handleAgentError(instance.config.name, error);
        return Promise.reject(error);
      }
    );

    instance.httpClient = httpClient;

    // 测试连接
    await this.testHttpConnection(instance);
  }

  /**
   * 创建WebSocket连接
   */
  private async createWebSocketConnection(instance: A2AAgentInstance): Promise<void> {
    const { config } = instance;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(config.endpoint);

      ws.on('open', () => {
        this.logger.info(`WebSocket连接已建立: ${config.name}`);
        instance.wsConnection = ws;
        resolve();
      });

      ws.on('message', (data) => {
        try {
          const message: A2AMessage = JSON.parse(data.toString());
          this.handleWebSocketMessage(instance, message);
        } catch (error) {
          this.logger.error(`解析WebSocket消息失败 ${config.name}:`, error);
        }
      });

      ws.on('error', (error) => {
        this.logger.error(`WebSocket错误 ${config.name}:`, error);
        this.handleAgentError(config.name, error);
        reject(error);
      });

      ws.on('close', () => {
        this.logger.warn(`WebSocket连接关闭: ${config.name}`);
        this.handleAgentDisconnect(config.name);
      });

      // 连接超时
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          reject(new Error(`WebSocket连接超时: ${config.name}`));
        }
      }, config.timeout);
    });
  }

  /**
   * 创建gRPC连接
   */
  private async createGrpcConnection(instance: A2AAgentInstance): Promise<void> {
    // TODO: 实现gRPC连接
    throw new Error('gRPC连接暂未实现');
  }

  /**
   * 创建消息队列连接
   */
  private async createMessageQueueConnection(instance: A2AAgentInstance): Promise<void> {
    // TODO: 实现消息队列连接
    throw new Error('消息队列连接暂未实现');
  }

  /**
   * 添加认证
   */
  private addAuthentication(httpClient: AxiosInstance, auth: any): void {
    switch (auth.type) {
      case 'api_key':
        if (auth.credentials?.api_key) {
          httpClient.defaults.headers.common['Authorization'] =
            `Bearer ${auth.credentials.api_key}`;
        }
        break;
      case 'jwt':
        if (auth.credentials?.token) {
          httpClient.defaults.headers.common['Authorization'] = `Bearer ${auth.credentials.token}`;
        }
        break;
      // TODO: 实现其他认证方式
    }
  }

  /**
   * 测试HTTP连接
   */
  private async testHttpConnection(instance: A2AAgentInstance): Promise<void> {
    if (!instance.httpClient) return;

    try {
      // 发送健康检查请求
      await instance.httpClient.get('/health');
    } catch (error) {
      // 如果没有健康检查端点，尝试根路径
      try {
        await instance.httpClient.get('/');
      } catch (rootError) {
        throw new Error(`HTTP连接测试失败: ${error}`);
      }
    }
  }

  /**
   * 查询代理能力
   */
  private async queryAgentCapabilities(instance: A2AAgentInstance): Promise<void> {
    try {
      if (instance.config.type === 'http' && instance.httpClient) {
        const response = await instance.httpClient.get('/capabilities');
        if (response.data && response.data.capabilities) {
          instance.capabilities = response.data.capabilities;
        }
        if (response.data && response.data.specialties) {
          instance.specialties = response.data.specialties;
        }
      } else if (instance.config.type === 'websocket' && instance.wsConnection) {
        // 通过WebSocket查询能力
        const message: A2AMessage = {
          id: this.generateMessageId(),
          type: A2AMessageType.CAPABILITY_QUERY,
          source: 'manus',
          target: instance.config.name,
          timestamp: Date.now(),
          payload: {},
        };

        instance.wsConnection.send(JSON.stringify(message));
      }
    } catch (error) {
      this.logger.warn(`查询代理能力失败 ${instance.config.name}:`, error);
      // 使用配置中的能力作为备选
    }
  }

  /**
   * 处理WebSocket消息
   */
  private handleWebSocketMessage(instance: A2AAgentInstance, message: A2AMessage): void {
    switch (message.type) {
      case A2AMessageType.CAPABILITY_RESPONSE:
        if (message.payload.capabilities) {
          instance.capabilities = message.payload.capabilities;
        }
        if (message.payload.specialties) {
          instance.specialties = message.payload.specialties;
        }
        break;

      case A2AMessageType.TASK_RESPONSE:
        this.handleTaskResponse(message);
        break;

      case A2AMessageType.STATUS_UPDATE:
        this.handleStatusUpdate(instance, message);
        break;

      case A2AMessageType.ERROR:
        this.logger.error(`收到错误消息从 ${instance.config.name}:`, message.payload);
        break;
    }
  }

  /**
   * 选择合适的A2A代理
   */
  selectAgent(
    requiredCapabilities: string[] = [],
    specialties: string[] = [],
    priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium'
  ): A2AAgentInstance | null {
    const availableAgents = Array.from(this.agents.values()).filter(
      (agent) => agent.status === A2AAgentStatus.CONNECTED
    );

    if (availableAgents.length === 0) {
      this.logger.warn('没有可用的A2A代理');
      return null;
    }

    // 根据能力和专业领域过滤
    let candidateAgents = availableAgents.filter((agent) => {
      const hasCapabilities =
        requiredCapabilities.length === 0 ||
        requiredCapabilities.every((cap) => agent.capabilities.includes(cap));
      const hasSpecialties =
        specialties.length === 0 || specialties.some((spec) => agent.specialties.includes(spec));
      return hasCapabilities && hasSpecialties;
    });

    if (candidateAgents.length === 0) {
      this.logger.warn(
        `没有支持所需能力的A2A代理: 能力=${requiredCapabilities.join(',')}, 专业=${specialties.join(',')}`
      );
      return null;
    }

    // 根据负载均衡策略选择
    return this.selectAgentByLoadBalancing(candidateAgents);
  }

  /**
   * 根据负载均衡策略选择代理
   */
  private selectAgentByLoadBalancing(agents: A2AAgentInstance[]): A2AAgentInstance {
    // 优先级排序
    agents.sort((a, b) => b.config.priority - a.config.priority);

    // 获取最高优先级的代理
    const highestPriority = agents[0].config.priority;
    const highPriorityAgents = agents.filter((agent) => agent.config.priority === highestPriority);

    if (highPriorityAgents.length === 1) {
      return highPriorityAgents[0];
    }

    // 在同优先级代理中根据负载均衡策略选择
    const strategy = highPriorityAgents[0].config.load_balancing?.strategy || 'round_robin';

    switch (strategy) {
      case 'round_robin':
        const agent = highPriorityAgents[this.loadBalancingIndex % highPriorityAgents.length];
        this.loadBalancingIndex++;
        return agent;

      case 'weighted':
        return this.selectByWeight(highPriorityAgents);

      case 'least_connections':
        return highPriorityAgents.sort((a, b) => a.currentLoad - b.currentLoad)[0];

      default:
        return highPriorityAgents[0];
    }
  }

  /**
   * 按权重选择代理
   */
  private selectByWeight(agents: A2AAgentInstance[]): A2AAgentInstance {
    const totalWeight = agents.reduce(
      (sum, agent) => sum + (agent.config.load_balancing?.weight || 1),
      0
    );

    let random = Math.random() * totalWeight;

    for (const agent of agents) {
      random -= agent.config.load_balancing?.weight || 1;
      if (random <= 0) {
        return agent;
      }
    }

    return agents[0];
  }

  /**
   * 发送任务请求
   */
  async sendTaskRequest(agentName: string, taskRequest: A2ATaskRequest): Promise<A2ATaskResponse> {
    const agent = this.agents.get(agentName);
    if (!agent) {
      throw new Error(`A2A代理不存在: ${agentName}`);
    }

    if (agent.status !== A2AAgentStatus.CONNECTED) {
      throw new Error(`A2A代理未连接: ${agentName}`);
    }

    const startTime = Date.now();
    agent.statistics.totalRequests++;
    agent.currentLoad++;

    try {
      let response: A2ATaskResponse;

      if (agent.config.type === 'http' && agent.httpClient) {
        response = await this.sendHttpTaskRequest(agent, taskRequest);
      } else if (agent.config.type === 'websocket' && agent.wsConnection) {
        response = await this.sendWebSocketTaskRequest(agent, taskRequest);
      } else {
        throw new Error(`不支持的协议类型: ${agent.config.type}`);
      }

      // 更新统计信息
      const responseTime = Date.now() - startTime;
      agent.statistics.successfulRequests++;
      agent.statistics.averageResponseTime =
        (agent.statistics.averageResponseTime * (agent.statistics.successfulRequests - 1) +
          responseTime) /
        agent.statistics.successfulRequests;
      agent.statistics.lastRequestTime = Date.now();

      return response;
    } catch (error) {
      agent.statistics.failedRequests++;
      this.handleAgentError(agentName, error);
      throw error;
    } finally {
      agent.currentLoad--;
    }
  }

  /**
   * 发送HTTP任务请求
   */
  private async sendHttpTaskRequest(
    agent: A2AAgentInstance,
    taskRequest: A2ATaskRequest
  ): Promise<A2ATaskResponse> {
    if (!agent.httpClient) {
      throw new Error('HTTP客户端未初始化');
    }

    const response = await agent.httpClient.post('/tasks', taskRequest, {
      timeout: taskRequest.timeout || agent.config.timeout,
    });

    return response.data;
  }

  /**
   * 发送WebSocket任务请求
   */
  private async sendWebSocketTaskRequest(
    agent: A2AAgentInstance,
    taskRequest: A2ATaskRequest
  ): Promise<A2ATaskResponse> {
    if (!agent.wsConnection) {
      throw new Error('WebSocket连接未建立');
    }

    return new Promise((resolve, reject) => {
      const message: A2AMessage = {
        id: this.generateMessageId(),
        type: A2AMessageType.TASK_REQUEST,
        source: 'manus',
        target: agent.config.name,
        timestamp: Date.now(),
        payload: taskRequest,
      };

      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingTasks.delete(message.id);
        reject(new Error(`任务请求超时: ${taskRequest.taskId}`));
      }, taskRequest.timeout || agent.config.timeout);

      // 保存待处理任务
      this.pendingTasks.set(message.id, { resolve, reject, timeout, agentName: agent.config.name });

      // 发送消息
      agent.wsConnection!.send(JSON.stringify(message));
    });
  }

  /**
   * 处理任务响应
   */
  private handleTaskResponse(message: A2AMessage): void {
    const pendingTask = this.pendingTasks.get(message.id);
    if (pendingTask) {
      clearTimeout(pendingTask.timeout);
      this.pendingTasks.delete(message.id);
      pendingTask.resolve(message.payload);
    }
  }

  /**
   * 处理状态更新
   */
  private handleStatusUpdate(instance: A2AAgentInstance, message: A2AMessage): void {
    if (message.payload.status) {
      const newStatus = message.payload.status as A2AAgentStatus;
      if (instance.status !== newStatus) {
        instance.status = newStatus;
        this.emit('agentStatusChanged', instance.config.name, newStatus);
      }
    }

    if (message.payload.load !== undefined) {
      instance.currentLoad = message.payload.load;
    }
  }

  /**
   * 生成消息ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取代理统计信息
   */
  async getAgentStatistics(): Promise<{
    total: number;
    connected: number;
    busy: number;
    failed: number;
    capabilities: string[];
  }> {
    const total = this.agents.size;
    let connected = 0;
    let busy = 0;
    let failed = 0;
    const allCapabilities = new Set<string>();

    for (const agent of this.agents.values()) {
      if (agent.status === A2AAgentStatus.CONNECTED) {
        connected++;
      } else if (agent.status === A2AAgentStatus.BUSY) {
        busy++;
        connected++; // 繁忙的代理也是已连接的
      } else if (agent.status === A2AAgentStatus.ERROR) {
        failed++;
      }

      // 收集所有能力
      if (agent.capabilities) {
        agent.capabilities.forEach((cap) => allCapabilities.add(cap));
      }
    }

    return {
      total,
      connected,
      busy,
      failed,
      capabilities: Array.from(allCapabilities),
    };
  }

  /**
   * 获取代理状态
   */
  getAgentStatus(): Record<string, any> {
    const status: Record<string, any> = {};

    for (const [name, agent] of this.agents) {
      status[name] = {
        status: agent.status,
        lastHealthCheck: agent.lastHealthCheck,
        errorCount: agent.errorCount,
        currentLoad: agent.currentLoad,
        capabilities: agent.capabilities,
        specialties: agent.specialties,
        statistics: agent.statistics,
        priority: agent.config.priority,
      };
    }

    return status;
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.performHealthCheck();
      return true;
    } catch (error) {
      this.logger.error('A2A代理健康检查失败:', error);
      return false;
    }
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
   * 执行健康检查
   */
  private async performHealthCheck(): Promise<void> {
    for (const [name, agent] of this.agents) {
      if (agent.status === A2AAgentStatus.CONNECTED) {
        try {
          if (agent.config.type === 'http' && agent.httpClient) {
            await agent.httpClient.get('/health');
          } else if (agent.config.type === 'websocket' && agent.wsConnection) {
            const message: A2AMessage = {
              id: this.generateMessageId(),
              type: A2AMessageType.HEALTH_CHECK,
              source: 'manus',
              target: name,
              timestamp: Date.now(),
              payload: {},
            };
            agent.wsConnection.send(JSON.stringify(message));
          }

          agent.lastHealthCheck = Date.now();
        } catch (error) {
          this.logger.warn(`A2A代理健康检查失败 ${name}:`, error);
          this.handleAgentError(name, error);
        }
      }
    }
  }

  /**
   * 处理代理错误
   */
  private handleAgentError(agentName: string, error: any): void {
    const agent = this.agents.get(agentName);
    if (agent) {
      agent.errorCount++;
      agent.status = A2AAgentStatus.ERROR;
      this.emit('agentError', agentName, error);

      // 如果错误次数过多，尝试重连
      if (agent.errorCount >= agent.config.retry_count) {
        this.logger.warn(`A2A代理 ${agentName} 错误次数过多，尝试重连`);
        this.reconnectAgent(agentName);
      }
    }
  }

  /**
   * 处理代理断开连接
   */
  private handleAgentDisconnect(agentName: string): void {
    const agent = this.agents.get(agentName);
    if (agent) {
      agent.status = A2AAgentStatus.DISCONNECTED;
      this.emit('agentDisconnected', agentName);
    }
  }

  /**
   * 重连代理
   */
  private async reconnectAgent(agentName: string): Promise<void> {
    const agent = this.agents.get(agentName);
    if (!agent) return;

    try {
      this.logger.info(`重连A2A代理: ${agentName}`);

      // 清理旧连接
      if (agent.wsConnection) {
        agent.wsConnection.close();
      }

      // 重新初始化
      await this.initializeAgent(agent.config);
    } catch (error) {
      this.logger.error(`重连A2A代理失败 ${agentName}:`, error);
    }
  }

  /**
   * 关闭所有代理连接
   */
  async shutdown(): Promise<void> {
    this.logger.info('关闭所有A2A代理连接');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // 清理待处理任务
    for (const [id, task] of this.pendingTasks) {
      clearTimeout(task.timeout);
      task.reject(new Error('系统关闭'));
    }
    this.pendingTasks.clear();

    // 关闭所有连接
    for (const [name, agent] of this.agents) {
      try {
        if (agent.wsConnection) {
          agent.wsConnection.close();
        }
      } catch (error) {
        this.logger.error(`关闭A2A代理连接失败 ${name}:`, error);
      }
    }

    this.agents.clear();
    this.emit('shutdown');
  }

  /**
   * 获取代理实例
   */
  /**
   * 添加A2A代理
   */
  async addAgent(config: A2AAgentConfig): Promise<void> {
    if (this.agents.has(config.name)) {
      this.logger.warn(`A2A代理 ${config.name} 已存在，将被替换`);
      await this.removeAgent(config.name);
    }

    this.logger.info(`添加A2A代理: ${config.name}`);
    await this.initializeAgent(config);
  }

  /**
   * 移除代理
   */
  async removeAgent(name: string): Promise<void> {
    const agent = this.agents.get(name);
    if (!agent) {
      this.logger.warn(`尝试移除不存在的代理: ${name}`);
      return;
    }

    this.logger.info(`移除A2A代理: ${name}`);

    try {
      // 关闭WebSocket连接
      if (agent.wsConnection) {
        agent.wsConnection.close();
      }

      // 清理该代理的待处理任务
      for (const [taskId, task] of this.pendingTasks) {
        if (task.agentName === name) {
          clearTimeout(task.timeout);
          task.reject(new Error(`代理 ${name} 已被移除`));
          this.pendingTasks.delete(taskId);
        }
      }

      // 从代理列表中移除
      this.agents.delete(name);

      this.emit('agentRemoved', name);
    } catch (error) {
      this.logger.error(`移除A2A代理失败 ${name}:`, error);
      throw error;
    }
  }

  getAgent(name: string): A2AAgentInstance | undefined {
    return this.agents.get(name);
  }

  /**
   * 获取所有代理名称
   */
  getAgentNames(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * 检查代理是否可用
   */
  async isAgentAvailable(agentName: string): Promise<boolean> {
    const agent = this.agents.get(agentName);
    return agent ? agent.status === A2AAgentStatus.CONNECTED : false;
  }

  /**
   * 获取所有可用的A2A代理
   * @returns 可用代理列表
   */
  async getAvailableAgents(): Promise<A2AAgentInstance[]> {
    const availableAgents: A2AAgentInstance[] = [];

    for (const [name, agent] of this.agents) {
      // 只返回已连接且非繁忙状态的代理
      if (agent.status === A2AAgentStatus.CONNECTED || agent.status === A2AAgentStatus.BUSY) {
        availableAgents.push(agent);
      }
    }

    this.logger.debug(`找到 ${availableAgents.length} 个可用的A2A代理`);
    return availableAgents;
  }

  /**
   * 执行任务
   * @param agentName A2A代理名称
   * @param taskRequest 任务请求
   */
  async executeTask(
    agentName: string,
    taskRequest: {
      taskId: string;
      taskType: string;
      description: string;
      parameters: Record<string, any>;
      priority?: 'low' | 'medium' | 'high' | 'urgent';
      timeout?: number;
      requiredCapabilities?: string[];
      context?: Record<string, any>;
      signal?: AbortSignal;
    }
  ): Promise<any> {
    const agent = this.agents.get(agentName);
    if (!agent) {
      throw new Error(`A2A代理不存在: ${agentName}`);
    }

    if (agent.status !== A2AAgentStatus.CONNECTED) {
      throw new Error(`A2A代理未连接: ${agentName}`);
    }

    try {
      this.logger.info(`通过A2A代理 ${agentName} 执行任务: ${taskRequest.taskId}`);

      // 构建A2A任务请求
      const a2aTaskRequest: A2ATaskRequest = {
        taskId: taskRequest.taskId,
        taskType: taskRequest.taskType,
        description: taskRequest.description,
        parameters: taskRequest.parameters,
        priority: 'medium',
        timeout: 30000,
        requiredCapabilities: taskRequest.requiredCapabilities || [],
        context: taskRequest.context,
      };

      // 发送任务请求
      const result = await this.sendTaskRequest(agentName, a2aTaskRequest);

      return {
        taskId: taskRequest.taskId,
        status: 'completed',
        result: result,
        executedBy: agentName,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.error(`A2A任务执行失败 ${agentName}:`, error);
      throw new Error(`A2A任务执行失败: ${error}`);
    }
  }
}
