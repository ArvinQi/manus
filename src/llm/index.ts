/**
 * LLM 接口类
 * 负责与语言模型进行交互
 * 专注于纯粹的语言模型请求，不处理消息优化
 */

import OpenAI from 'openai';
import { promises as fs } from 'fs';
import { Message, ToolChoice, Role } from '../schema/index.js';
import { config } from '../utils/config.js';
import { Logger } from '../utils/logger.js';

// LLM 响应接口
interface LLMResponse {
  content: string | null;
  tool_calls?: any[];
  usage?: any;
}

// 任务类型枚举
export enum TaskType {
  DEFAULT = 'default',
  CODING = 'coding',
  VISION = 'vision',
  PLANNING = 'planning',
  ANALYSIS = 'analysis',
}

// 任务类型到模型配置的映射
const TASK_TO_MODEL_CONFIG: Record<TaskType, string> = {
  [TaskType.DEFAULT]: 'default',
  [TaskType.CODING]: 'coder',
  [TaskType.VISION]: 'vision',
  [TaskType.PLANNING]: 'default',
  [TaskType.ANALYSIS]: 'default',
};

// 重试配置
interface RetryConfig {
  enabled: boolean;
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  enabled: true,
  maxRetries: 3,
  initialDelayMs: 6000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

/**
 * LLM 类
 * 处理与语言模型的交互，专注于纯粹的模型请求
 */
export class LLM {
  private client: OpenAI;
  private logger: Logger;
  private configName: string;
  private retryConfig: RetryConfig;

  constructor(configName: string = 'default', retryConfig?: Partial<RetryConfig>) {
    this.configName = configName;
    this.logger = new Logger('LLM');
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };

    // 获取 LLM 配置
    const llmConfig = config.getLLMConfig(configName);

    // 初始化 OpenAI 客户端
    this.client = new OpenAI({
      apiKey: llmConfig.api_key,
      baseURL: llmConfig.base_url,
    });
  }

  /**
   * 根据任务类型创建 LLM 实例
   */
  static createForTask(taskType: TaskType, retryConfig?: Partial<RetryConfig>): LLM {
    const configName = TASK_TO_MODEL_CONFIG[taskType];
    return new LLM(configName, retryConfig);
  }

  /**
   * 获取当前使用的模型信息
   */
  getModelInfo(): { configName: string; model: string; baseUrl: string } {
    const llmConfig = config.getLLMConfig(this.configName);
    return {
      configName: this.configName,
      model: llmConfig.model,
      baseUrl: llmConfig.base_url,
    };
  }

  /**
   * 确保消息有效性（至少一条非系统消息）
   */
  private ensureValidMessages(messages: Message[]): Message[] {
    const hasNonSystemMessage = messages.some((msg) => msg.role !== Role.SYSTEM);

    if (hasNonSystemMessage) {
      return messages;
    }

    // 创建默认消息
    const defaultMessage = new Message({
      role: Role.USER,
      content: '请继续对话',
    });

    this.logger.warn('No non-system messages found, adding default user message');
    return [...messages, defaultMessage];
  }

  /**
   * 延迟函数
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 检查是否为可重试的错误
   */
  private isRetryableError(error: any): boolean {
    if (!error.status) return false;

    // 429 (Rate Limit), 500, 502, 503, 504 是可重试的错误
    const retryableStatuses = [429, 500, 502, 503, 504];
    return retryableStatuses.includes(error.status);
  }

  /**
   * 计算重试延迟时间
   */
  private calculateRetryDelay(attempt: number): number {
    const delay =
      this.retryConfig.initialDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attempt);
    return Math.min(delay, this.retryConfig.maxDelayMs);
  }

  /**
   * 发送请求到语言模型
   */
  private async sendRequest(options: {
    messages: Message[];
    systemMsgs?: Message[];
    tools?: any[];
    toolChoice?: ToolChoice;
    currentQuery?: string;
  }): Promise<LLMResponse> {
    const startTime = Date.now();
    let lastError: any;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        // 如果不是第一次尝试，需要等待
        if (attempt > 0 && this.retryConfig.enabled) {
          const delayMs = this.calculateRetryDelay(attempt - 1);
          this.logger.warn(
            `Rate limit hit, retrying in ${delayMs}ms (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1})`
          );
          await this.delay(delayMs);
        }

        const llmConfig = config.getLLMConfig(this.configName);

        // 合并系统消息和用户消息
        const allMessages = [...(options.systemMsgs || []), ...options.messages];

        // 确保消息有效性
        const validatedMessages = this.ensureValidMessages(allMessages);

        // 准备消息格式
        const formattedMessages = validatedMessages.map((msg: Message) => ({
          role: msg.role as any, // 类型转换以匹配 OpenAI API
          content: msg.content,
          ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
          ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
          ...(msg.name && { name: msg.name }),
        }));

        // 发送请求
        const response = await this.client.chat.completions.create({
          model: llmConfig.model,
          messages: formattedMessages as any, // 类型转换以匹配 OpenAI API
          tools: options.tools,
          tool_choice: options.toolChoice,
          temperature: llmConfig.temperature,
          max_tokens: llmConfig.max_tokens,
        });

        const llmResponse: LLMResponse = {
          content: response.choices[0].message.content,
          tool_calls: response.choices[0].message.tool_calls,
          usage: response.usage,
        };

        const executionTime = Date.now() - startTime;

        // 记录详细任务日志
        await this.logTaskDetails(options, llmResponse, undefined, executionTime);

        // 记录简单使用日志
        await this.logUsage(llmResponse, formattedMessages.length);

        return llmResponse;
      } catch (error: any) {
        lastError = error;

        // 如果是可重试的错误且还有重试次数
        if (
          this.retryConfig.enabled &&
          this.isRetryableError(error) &&
          attempt < this.retryConfig.maxRetries
        ) {
          this.logger.warn(
            `Request failed with retryable error (attempt ${attempt + 1}), will retry: ${error.message || error}`
          );
          continue;
        }

        // 如果不可重试或已达到最大重试次数，记录错误并抛出
        const executionTime = Date.now() - startTime;
        await this.logTaskDetails(options, undefined, error, executionTime);

        this.logger.error(
          `LLM request failed after ${attempt + 1} attempts: ${error.message || error}`
        );
        throw error;
      }
    }

    // 理论上不应该到达这里，但为了类型安全
    throw lastError || new Error('Unknown error occurred');
  }

  /**
   * 记录详细的任务日志到 task_log.jsonl
   */
  private async logTaskDetails(
    input: {
      messages: Message[];
      systemMsgs?: Message[];
      tools?: any[];
      toolChoice?: ToolChoice;
      currentQuery?: string;
    },
    response?: LLMResponse,
    error?: any,
    executionTime?: number
  ): Promise<void> {
    try {
      const logDir = './.manus';
      const logFile = `${logDir}/task_log.jsonl`;

      // 确保目录存在
      try {
        await fs.mkdir(logDir, { recursive: true });
      } catch (mkdirError) {
        // 目录可能已存在，忽略错误
      }

      const logEntry = {
        timestamp: new Date().toISOString(),
        type: 'llm_call',
        model: this.getModelInfo(),
        input: {
          systemMessages:
            input.systemMsgs?.map((msg) => ({
              role: msg.role,
              content: msg.content,
              ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
              ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
              ...(msg.name && { name: msg.name }),
            })) || [],
          messages: input.messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
            ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
            ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
            ...(msg.name && { name: msg.name }),
          })),
          tools: input.tools || [],
          toolChoice: input.toolChoice,
          currentQuery: input.currentQuery,
          totalInputMessages: (input.systemMsgs?.length || 0) + input.messages.length,
        },
        ...(response && {
          output: {
            content: response.content,
            tool_calls: response.tool_calls || [],
            usage: response.usage,
          },
        }),
        ...(error && {
          error: {
            message: error.message || String(error),
            status: error.status,
            type: error.constructor.name,
          },
        }),
        executionTime: executionTime,
        success: !error,
      };

      await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n', 'utf-8');
    } catch (logError) {
      this.logger.error(`记录任务日志失败: ${logError}`);
    }
  }

  /**
   * 记录使用情况
   */
  private async logUsage(response: LLMResponse, messageCount: number): Promise<void> {
    if (response.usage) {
      try {
        const logDir = './.manus';
        const logFile = `${logDir}/token_usage.jsonl`;

        // 确保目录存在
        try {
          await fs.mkdir(logDir, { recursive: true });
        } catch (mkdirError) {
          // 目录可能已存在，忽略错误
        }

        const logObj = {
          timestamp: new Date().toISOString(),
          model: config.getLLMConfig(this.configName).model,
          messageCount,
          ...response.usage,
        };

        await fs.appendFile(logFile, JSON.stringify(logObj) + '\n', 'utf-8');
      } catch (error) {
        this.logger.error(`记录使用情况失败: ${error}`);
      }
    }
  }

  /**
   * 向语言模型发送普通请求
   */
  async ask(options: {
    messages: Message[];
    systemMsgs?: Message[];
    currentQuery?: string;
  }): Promise<string> {
    const response = await this.sendRequest(options);
    return response.content || '';
  }

  /**
   * 向语言模型发送工具调用请求
   */
  async askTool(options: {
    messages: Message[];
    systemMsgs?: Message[];
    tools?: any[];
    toolChoice?: ToolChoice;
    currentQuery?: string;
  }): Promise<LLMResponse> {
    return await this.sendRequest(options);
  }
}
