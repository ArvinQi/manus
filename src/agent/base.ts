/**
 * 基础代理抽象类
 * 提供代理状态管理、内存管理和执行循环的基础功能
 */

import { Logger } from '../utils/logger.js';
import { AgentState, Memory, Message, Role } from '../schema/index.js';

export abstract class BaseAgent {
  // 核心属性
  name: string;
  description?: string;

  // 提示词
  systemPrompt?: string;
  nextStepPrompt?: string;

  // 依赖
  memory: Memory;
  state: AgentState;

  // 执行控制
  maxSteps: number;
  currentStep: number;
  duplicateThreshold: number;

  protected logger: Logger;

  constructor(options: {
    name: string;
    description?: string;
    systemPrompt?: string;
    nextStepPrompt?: string;
    maxSteps?: number;
  }) {
    this.name = options.name;
    this.description = options.description;
    this.systemPrompt = options.systemPrompt;
    this.nextStepPrompt = options.nextStepPrompt;
    this.maxSteps = options.maxSteps || 10;
    this.currentStep = 0;
    this.duplicateThreshold = 2;
    this.memory = new Memory();
    this.state = AgentState.IDLE;
    this.logger = new Logger(this.name);
  }

  /**
   * 安全地转换代理状态
   * @param newState 要转换到的新状态
   * @param callback 在新状态下执行的回调函数
   */
  protected async withState<T>(newState: AgentState, callback: () => Promise<T>): Promise<T> {
    if (typeof newState !== 'number') {
      throw new Error(`无效的状态: ${newState}`);
    }

    const previousState = this.state;
    this.state = newState;

    try {
      return await callback();
    } catch (error) {
      this.state = AgentState.ERROR;
      throw error;
    } finally {
      this.state = previousState;
    }
  }

  /**
   * 更新代理的内存
   * @param role 消息发送者的角色
   * @param content 消息内容
   * @param options 附加选项
   */
  updateMemory(
    role: Role,
    content: string,
    options?: { base64Image?: string; [key: string]: any }
  ): void {
    const messageMap: Record<Role, (content: string, options?: any) => Message> = {
      [Role.USER]: Message.userMessage,
      [Role.SYSTEM]: Message.systemMessage,
      [Role.ASSISTANT]: Message.assistantMessage,
      [Role.TOOL]: (content: string, options?: any) => Message.toolMessage(content, options),
    };

    if (!messageMap[role]) {
      throw new Error(`不支持的消息角色: ${role}`);
    }

    // 根据角色创建消息
    const message = messageMap[role](content, options);
    this.memory.addMessage(message);
  }

  /**
   * 执行代理的主循环
   * @param request 可选的初始用户请求
   * @returns 执行结果的摘要
   */
  async run(request?: string): Promise<string> {
    if (this.state !== AgentState.IDLE) {
      throw new Error(`无法从状态 ${this.state} 运行代理`);
    }

    if (request) {
      this.updateMemory(Role.USER, request);
    }

    const results: string[] = [];
    await this.withState(AgentState.RUNNING, async () => {
      while (this.currentStep < this.maxSteps && this.state !== AgentState.FINISHED) {
        this.currentStep += 1;
        this.logger.info(`执行步骤 ${this.currentStep}/${this.maxSteps}`);
        const stepResult = await this.step();

        // 检查是否陷入循环
        if (this.isStuck()) {
          this.handleStuckState();
        }

        results.push(`步骤 ${this.currentStep}: ${stepResult}`);
      }

      if (this.currentStep >= this.maxSteps) {
        this.currentStep = 0;
        this.state = AgentState.IDLE;
        results.push(`终止: 达到最大步骤数 (${this.maxSteps})`);
      }
    });

    await this.cleanup();
    return results.join('\n') || '没有执行任何步骤';
  }

  /**
   * 执行单个步骤
   * 子类必须实现此方法以定义特定行为
   */
  abstract step(): Promise<string>;

  /**
   * 处理陷入循环的状态
   */
  protected handleStuckState(): void {
    const stuckPrompt = '检测到重复响应。考虑新策略，避免重复已尝试的无效路径。';
    this.nextStepPrompt = `${stuckPrompt}\n${this.nextStepPrompt}`;
    this.logger.warning(`代理检测到陷入循环。添加提示: ${stuckPrompt}`);
  }

  /**
   * 检查代理是否陷入循环
   */
  protected isStuck(): boolean {
    if (this.memory.messages.length < 2) {
      return false;
    }

    const lastMessage = this.memory.messages[this.memory.messages.length - 1];
    if (!lastMessage.content) {
      return false;
    }

    // 计算相同内容出现的次数
    let duplicateCount = 0;
    for (let i = this.memory.messages.length - 2; i >= 0; i--) {
      const msg = this.memory.messages[i];
      if (msg.role === Role.ASSISTANT && msg.content === lastMessage.content) {
        duplicateCount += 1;
      }
    }

    return duplicateCount >= this.duplicateThreshold;
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    // 基类中的默认实现为空
    // 子类可以覆盖此方法以实现特定的清理逻辑
  }

  /**
   * 获取代理的消息列表
   */
  get messages(): Message[] {
    return this.memory.messages;
  }

  /**
   * 设置代理的消息列表
   */
  set messages(value: Message[]) {
    this.memory.messages = value;
  }
}
