/**
 * Manus 类
 * 一个多功能的通用代理，支持多种工具
 */

import { ToolCallAgent } from './toolcall.js';
import { ToolCollection } from '../tool/tool_collection.js';
import { Logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { ToolChoice } from '../schema/index.js';

// 系统提示词
const SYSTEM_PROMPT = `你是一个功能强大的智能助手，可以帮助用户完成各种任务。
你可以使用多种工具来解决问题，包括搜索、浏览器操作、代码执行等。
当需要时，你应该主动使用这些工具来获取信息或执行操作。
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
    } = {}
  ): Promise<Manus> {
    const instance = new Manus(options);
    await instance.initialize();
    return instance;
  }

  /**
   * 初始化 Manus 实例
   */
  private async initialize(): Promise<void> {
    // 这里可以添加初始化逻辑，例如连接到外部服务、加载工具等
    this._initialized = true;
    this.logger.info('Manus 代理已初始化');
  }

  /**
   * 思考过程
   * 处理当前状态并决定下一步行动，添加适当的上下文
   */
  async think(): Promise<boolean> {
    // 确保已初始化
    if (!this._initialized) {
      await this.initialize();
    }

    // 保存原始提示词
    const originalPrompt = this.nextStepPrompt;

    // 获取最近的消息
    const recentMessages = this.memory.messages.slice(-3);

    // 检查是否使用了浏览器工具
    const browserInUse = recentMessages.some((msg) => {
      if (!msg.tool_calls) return false;
      return msg.tool_calls.some((tc) => tc.function.name === 'BrowserUse');
    });

    // 如果使用了浏览器，添加浏览器上下文
    if (browserInUse && this.browserContextHelper) {
      // 在实际实现中，这里会格式化浏览器上下文
      // this.nextStepPrompt = await this.browserContextHelper.formatNextStepPrompt();
    }

    // 调用父类的 think 方法
    const result = await super.think();

    // 恢复原始提示词
    this.nextStepPrompt = originalPrompt;

    return result;
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    // 清理浏览器资源
    if (this.browserContextHelper) {
      // await this.browserContextHelper.cleanupBrowser();
    }

    // 清理其他资源
    this._initialized = false;
    this.logger.info('Manus 代理资源已清理');
  }
}
