/**
 * ReActAgent 类
 * 实现基本的思考-行动循环
 */

import { BaseAgent } from './base.js';
import { LLM } from '../llm/index.js';
import { AgentState, Memory } from '../schema/index.js';
import { MemoryConfig } from '../core/mem0_memory_manager.js';
import { config } from '../utils/config.js';

/**
 * ReActAgent 抽象类
 * 实现基本的思考-行动循环，子类需要实现具体的思考和行动逻辑
 */
export abstract class ReActAgent extends BaseAgent {
  llm: LLM;

  constructor(options: {
    name: string;
    description?: string;
    systemPrompt?: string;
    nextStepPrompt?: string;
    maxSteps?: number;
    llmConfigName?: string;
    memoryConfig?: MemoryConfig;
    userId?: string;
  }) {
    super({
      name: options.name,
      description: options.description,
      systemPrompt: options.systemPrompt,
      nextStepPrompt: options.nextStepPrompt,
      maxSteps: options.maxSteps,
      memoryConfig: options.memoryConfig,
      userId: options.userId,
    });

    // 获取记忆配置（优先使用传入的配置，否则从配置文件读取）
    const finalMemoryConfig = options.memoryConfig || config.getMemoryConfig();

    // 初始化LLM，如果有记忆管理器则传递给LLM
    this.llm = new LLM(options.llmConfigName || 'default', finalMemoryConfig, options.userId);

    // 如果LLM没有记忆管理器但Agent有，则设置给LLM
    if (this.memoryManager && !this.llm.getMemoryManager()) {
      this.llm.setMemoryManager(this.memoryManager);
    }
  }

  /**
   * 思考过程
   * 处理当前状态并决定下一步行动
   * 子类必须实现此方法
   */
  abstract think(): Promise<boolean>;

  /**
   * 行动过程
   * 执行决定的行动
   * 子类必须实现此方法
   */
  abstract act(): Promise<string>;

  /**
   * 执行单个步骤：思考和行动
   */
  async step(): Promise<string> {
    const shouldAct = await this.think();
    if (!shouldAct) {
      return '思考完成 - 无需行动';
    }
    return await this.act();
  }
}
