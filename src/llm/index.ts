/**
 * LLM 接口类
 * 负责与语言模型进行交互
 */

import OpenAI from 'openai';
import { Message, ToolChoice } from '../schema/index.js';
import { config } from '../utils/config.js';
import { Logger } from '../utils/logger.js';

// LLM 响应接口
interface LLMResponse {
  content: string | null;
  tool_calls?: any[];
  usage?: any;
}

/**
 * LLM 类
 * 处理与语言模型的交互
 */
export class LLM {
  private client: OpenAI;
  private logger: Logger;
  private configName: string;

  constructor(configName: string = 'default') {
    this.configName = configName;
    this.logger = new Logger('LLM');

    // 获取 LLM 配置
    const llmConfig = config.getLLMConfig(configName);

    // 初始化 OpenAI 客户端
    this.client = new OpenAI({
      apiKey: llmConfig.api_key,
      baseURL: llmConfig.base_url,
    });
  }

  /**
   * 发送请求到语言模型
   */
  private async sendRequest(options: {
    messages: Message[];
    systemMsgs?: Message[];
    tools?: any[];
    toolChoice?: ToolChoice;
  }): Promise<LLMResponse> {
    try {
      const llmConfig = config.getLLMConfig(this.configName);

      // 准备消息
      const allMessages = [...(options.systemMsgs || []), ...options.messages].map((msg) => {
        const result: any = {
          role: msg.role,
          content: msg.content,
        };

        // 添加工具调用信息
        if (msg.tool_calls) {
          result.tool_calls = msg.tool_calls;
        }

        // 添加工具调用 ID
        if (msg.tool_call_id) {
          result.tool_call_id = msg.tool_call_id;
        }

        // 添加名称
        if (msg.name) {
          result.name = msg.name;
        }

        return result;
      });

      // 发送请求
      const response = await this.client.chat.completions.create({
        model: llmConfig.model,
        messages: allMessages,
        tools: options.tools,
        tool_choice: options.toolChoice,
        temperature: llmConfig.temperature,
        max_tokens: llmConfig.max_tokens,
      });

      // 处理响应
      const choice = response.choices[0];
      // 记录任务执行日志到 .manus 目录，采用 JSON 行格式
      try {
        const fs = await import('fs');
        const logPath = './.manus/task_log.jsonl';
        const logObj = {
          timestamp: new Date().toISOString(),
          model: llmConfig.model,
          messages: allMessages,
          response: {
            content: choice.message.content,
            tool_calls: choice.message.tool_calls,
            usage: response.usage,
          },
        };
        fs.promises.appendFile(logPath, JSON.stringify(logObj) + '\n', 'utf-8');
      } catch (e) {
        this.logger.error(`记录任务执行日志失败: ${e}`);
      }
      // 记录 token 消耗到 .manus 目录，采用 JSON 行格式
      if (response.usage) {
        try {
          const fs = await import('fs');
          const path = './.manus/token_usage.jsonl';
          const logObj = {
            timestamp: new Date().toISOString(),
            model: llmConfig.model,
            prompt_tokens: response.usage.prompt_tokens,
            completion_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens,
          };
          fs.promises.appendFile(path, JSON.stringify(logObj) + '\n', 'utf-8');
        } catch (e) {
          this.logger.error(`记录 token 消耗失败: ${e}`);
        }
      }
      return {
        content: choice.message.content,
        tool_calls: choice.message.tool_calls,
        usage: response.usage,
      };
    } catch (error) {
      this.logger.error(`LLM 请求失败: ${error}`);
      throw error;
    }
  }

  /**
   * 向语言模型发送普通请求
   */
  async ask(options: { messages: Message[]; systemMsgs?: Message[] }): Promise<string> {
    const response = await this.sendRequest({
      messages: options.messages,
      systemMsgs: options.systemMsgs,
    });

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
  }): Promise<LLMResponse> {
    return await this.sendRequest({
      messages: options.messages,
      systemMsgs: options.systemMsgs,
      tools: options.tools,
      toolChoice: options.toolChoice,
    });
  }
}
