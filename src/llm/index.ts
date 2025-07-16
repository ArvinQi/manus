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

    let validatedMessages = messages;

    // 首先验证工具调用完整性，防止Claude API错误
    validatedMessages = this.validateToolCallPairs(validatedMessages);

    if (hasNonSystemMessage) {
      return validatedMessages;
    }

    // 创建默认消息
    const defaultMessage = new Message({
      role: Role.USER,
      content: '请继续对话',
    });

    this.logger.warn('No non-system messages found, adding default user message');
    return [...validatedMessages, defaultMessage];
  }

  /**
   * 验证工具调用配对完整性 - LLM最终安全检查
   * 确保发送给Claude的消息中每个toolUse都有对应的toolResult
   */
  private validateToolCallPairs(messages: Message[]): Message[] {
    const result: Message[] = [];
    const pendingToolCalls = new Map<string, Message>();
    const processedToolResults = new Set<string>();

    for (const message of messages) {
      if (message.tool_calls && message.tool_calls.length > 0) {
        // 工具调用消息：记录待处理的工具调用
        const validToolCalls = message.tool_calls.filter((call) => call.id && call.function?.name);

        if (validToolCalls.length > 0) {
          // 记录这些工具调用，等待匹配的结果
          validToolCalls.forEach((call) => {
            pendingToolCalls.set(call.id, message);
          });

          // 只保留有效的工具调用
          if (validToolCalls.length === message.tool_calls.length) {
            result.push(message);
          } else {
            result.push(new Message({
              role: message.role,
              content: message.content,
              tool_calls: validToolCalls,
            }));
          }
        } else {
          // 没有有效的工具调用，只保留内容
          if (message.content) {
            result.push(new Message({
              role: message.role,
              content: message.content,
            }));
          }
        }
      } else if (message.tool_call_id) {
        // 工具结果消息：检查是否有对应的工具调用
        if (pendingToolCalls.has(message.tool_call_id) && !processedToolResults.has(message.tool_call_id)) {
          result.push(message);
          processedToolResults.add(message.tool_call_id);
        } else {
          this.logger.warn(`Removing orphaned or duplicate tool result: ${message.tool_call_id}`);
        }
      } else {
        // 普通消息，直接添加
        result.push(message);
      }
    }

    // 检查是否有未配对的工具调用
    const unpairedToolCalls = Array.from(pendingToolCalls.keys()).filter(
      (id) => !processedToolResults.has(id)
    );

    if (unpairedToolCalls.length > 0) {
      this.logger.warn(`Found ${unpairedToolCalls.length} unpaired tool calls, removing them`);

      // 移除没有对应结果的工具调用消息
      const finalResult: Message[] = [];
      for (const message of result) {
        if (message.tool_calls && message.tool_calls.length > 0) {
          const pairedToolCalls = message.tool_calls.filter((call) =>
            !unpairedToolCalls.includes(call.id)
          );

          if (pairedToolCalls.length > 0) {
            finalResult.push(new Message({
              role: message.role,
              content: message.content,
              tool_calls: pairedToolCalls,
            }));
          } else if (message.content) {
            finalResult.push(new Message({
              role: message.role,
              content: message.content,
            }));
          }
        } else {
          finalResult.push(message);
        }
      }

      return finalResult;
    }

    if (result.length !== messages.length) {
      this.logger.debug(`Final tool call validation: ${messages.length} -> ${result.length} messages`);
    }

    return result;
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

    // 打印LLM调用开始日志
    const llmConfig = config.getLLMConfig(this.configName);
    this.logger.info(`🚀 开始LLM调用 - 模型: ${llmConfig.model}, 配置: ${this.configName}`);
    this.logger.info(
      `📝 输入消息数量: ${options.messages.length}, 系统消息数量: ${options.systemMsgs?.length || 0}`
    );
    this.logger.info(
      `🛠️ 工具数量: ${options.tools?.length || 0}, 工具选择模式: ${options.toolChoice || 'auto'}`
    );

    // 打印第一条和最后一条消息的摘要
    if (options.messages.length > 0) {
      // const firstMsg = options.messages[0];
      const lastMsg = options.messages[options.messages.length - 1];

      this.logger.info(
        `📤 最后一条消息: ${lastMsg.role} - ${(lastMsg.content || '').substring(0, 100)}${(lastMsg.content || '').length > 100 ? '...' : ''}`
      );
    }

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

        // 合并系统消息和用户消息
        const allMessages = [...(options.systemMsgs || []), ...options.messages];

        // 确保消息有效性
        // const validatedMessages = this.ensureValidMessages(allMessages);

        // 准备消息格式
        const formattedMessages = allMessages.map((msg: Message) => ({
          role: msg.role as any, // 类型转换以匹配 OpenAI API
          content: msg.content,
          ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
          ...(msg.tool_call_id && {
            tool_call_id: msg.tool_call_id,
            tool_result: msg.content,
            role: 'user',
            // content: [
            //   {
            //     type: 'tool_result',
            //     tool_use_id: msg.tool_call_id,
            //     content: [{ type: 'text', text: msg.content }],
            //   },
            // ],
            // content: [
            //   {
            //     toolResult: {
            //       content: [{ text: msg.content }],
            //       toolUseId: msg.tool_call_id,
            //     },
            //   },
            // ],
          }),
          ...(msg.name && { name: msg.name }),
        }));

        // 打印请求参数
        this.logger.info(`📡 发送LLM请求 - 尝试次数: ${attempt + 1}`);
        this.logger.info(
          `🔧 请求参数: model=${llmConfig.model}, temperature=${llmConfig.temperature}, max_tokens=${llmConfig.max_tokens}`
        );

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

        // 打印响应结果
        this.logger.info(`✅ LLM调用成功 - 执行时间: ${executionTime}ms`);
        this.logger.info(`📄 响应内容长度: ${(llmResponse.content || '').length} 字符`);
        this.logger.info(`🛠️ 工具调用数量: ${llmResponse.tool_calls?.length || 0}`);

        if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {
          this.logger.info(
            `🔧 工具调用详情: ${llmResponse.tool_calls.map((call) => call.function.name).join(', ')}`
          );
        }

        if (llmResponse.usage) {
          this.logger.info(
            `📊 Token使用情况: prompt_tokens=${llmResponse.usage.prompt_tokens}, completion_tokens=${llmResponse.usage.completion_tokens}, total_tokens=${llmResponse.usage.total_tokens}`
          );
        }

        // 记录详细任务日志
        await this.logTaskDetails(options, llmResponse, undefined, executionTime);

        // 记录简单使用日志
        await this.logUsage(llmResponse, formattedMessages.length);

        return llmResponse;
      } catch (error: any) {
        lastError = error;
        const executionTime = Date.now() - startTime;

        // 打印错误信息
        this.logger.error(
          `❌ LLM调用失败 - 尝试次数: ${attempt + 1}, 执行时间: ${executionTime}ms`
        );
        this.logger.error(`🚨 错误详情: ${error.message || String(error)}`);
        this.logger.error(
          `🔍 错误类型: ${error.constructor.name}, 状态码: ${error.status || 'N/A'}`
        );

        // 如果是可重试的错误且还有重试次数
        if (
          this.retryConfig.enabled &&
          this.isRetryableError(error) &&
          attempt < this.retryConfig.maxRetries
        ) {
          this.logger.warn(
            `🔄 可重试错误，准备重试 (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}): ${error.message || error}`
          );
          continue;
        }

        // 如果不可重试或已达到最大重试次数，记录错误并抛出
        await this.logTaskDetails(options, undefined, error, executionTime);

        this.logger.error(
          `💥 LLM请求最终失败，已尝试 ${attempt + 1} 次: ${error.message || error}`
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
