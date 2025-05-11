/**
 * Manus 类
 * 一个多功能的通用代理，支持多种工具
 */

import { ToolCallAgent } from './toolcall.js';
import { ToolCollection } from '../tool/tool_collection.js';
import { Logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { ToolCall, ToolChoice } from '../schema/index.js';
import { spawn } from 'child_process';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';

// 系统提示词
const SYSTEM_PROMPT = `你是一个功能强大的智能助手，可以帮助用户完成各种任务。
你可以使用多种工具来解决问题，包括搜索、浏览器操作、代码执行等。
当需要时，你应该主动使用这些工具来获取信息或执行操作。
如果当前存在任务计划，继续执行任务计划。
代码任务需要先分析需求和项目环境，然后使用合适的工具来生成代码。
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

  // MCP 客户端
  private mcpClient?: McpClient;

  // MCP 服务器进程
  private mcpServerProcess?: any;

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
      useMcpServer?: boolean;
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
      useMcpServer?: boolean;
    } = {}
  ): Promise<Manus> {
    const instance = new Manus(options);
    await instance.initialize(options.useMcpServer);
    return instance;
  }

  /**
   * 初始化 Manus 实例
   */
  private async initialize(useMcpServer: boolean = false): Promise<void> {
    // 如果使用 MCP Server，则启动服务器并连接客户端
    if (useMcpServer) {
      await this.initializeMcpServer();
    }

    this._initialized = true;
    this.logger.info('Manus 代理已初始化');
  }

  /**
   * 初始化 MCP 服务器和客户端
   */
  private async initializeMcpServer(): Promise<void> {
    try {
      // 读取 MCP Server 地址（可从配置或环境变量获取）
      // const serverUrl = process.env.MCP_SERVER_URL || 'http://localhost:41741/mcp';
      // this.logger.info(`连接到 MCP 服务器: ${serverUrl}`);
      this.logger.info(`连接到 MCP 服务器`);
      // 创建 MCP 客户端
      const transport = new StdioClientTransport({
        command: 'node',
        args: ['dist/mcp/server.js'],
      });

      // 创建 MCP 客户端
      this.mcpClient = new McpClient({
        name: 'manus-client',
        version: '1.0.0',
      });

      await this.mcpClient.connect(transport);

      this.mcpClient.onerror = (error: any) => {
        this.logger.error('MCP 客户端错误: ' + error);
      };

      // 使用 HTTP 传输层连接 MCP Server
      // const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
      // await this.mcpClient.connect(transport);
      // 获取可用工具
      const toolsResult = await this.mcpClient.request(
        { method: 'tools/list', params: {} },
        z.object({ tools: z.array(z.any()) })
      );
      const tools = toolsResult.tools || [];
      this.logger.info(
        `已连接到 MCP 服务器，可用工具: ${tools.map((t: any) => t.name).join(', ')}`
      );
    } catch (error) {
      this.logger.error(`MCP 服务器初始化失败: ${(error as Error).message}`);
      throw error;
    }
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
    // const originalPrompt = this.nextStepPrompt;

    // 获取最近的消息
    // const recentMessages = this.memory.messages.slice(-3);

    // 检查是否使用了浏览器工具
    // const browserInUse = recentMessages.some((msg) => {
    //   if (!msg.tool_calls) return false;
    //   return msg.tool_calls.some((tc) => tc.function.name === 'BrowserUse');
    // });

    // 如果使用了浏览器，添加浏览器上下文
    // if (browserInUse && this.browserContextHelper) {
    // 在实际实现中，这里会格式化浏览器上下文
    // this.nextStepPrompt = await this.browserContextHelper.formatNextStepPrompt();
    // }

    // 调用父类的 think 方法
    const result = await super.think();

    // 恢复原始提示词
    // this.nextStepPrompt = originalPrompt;

    return result;
  }

  /**
   * 执行工具调用
   * 如果使用 MCP 服务器，则通过 MCP 客户端调用工具
   * 否则使用父类的工具调用方法
   * @param commandOrName 工具调用命令或工具名称
   * @param args 工具参数（当第一个参数为工具名称时使用）
   */
  protected async executeToolCall(commandOrName: ToolCall | string, args?: any): Promise<any> {
    // 如果使用 MCP 客户端，则通过 MCP 调用工具
    if (this.mcpClient) {
      try {
        // 获取工具名称和参数
        let toolName: string;
        let toolArgs: any;

        if (typeof commandOrName === 'string') {
          toolName = commandOrName;
          toolArgs = args || {};
        } else {
          const command = commandOrName;
          if (!command || !command.function || !command.function.name) {
            return '错误: 无效的命令格式';
          }

          toolName = command.function.name;
          try {
            toolArgs = JSON.parse(command.function.arguments || '{}');
          } catch (error) {
            return `错误: 无法解析工具参数 - ${error}`;
          }
        }

        this.logger.info(`通过 MCP 调用工具: ${toolName}`);
        const result = await this.mcpClient.callTool({
          name: toolName,
          arguments: toolArgs,
        });

        // 如果是直接调用（通过工具名称和参数），返回处理后的结果
        if (typeof commandOrName === 'string') {
          return {
            output: (result as any).content?.[0]?.text || JSON.stringify(result),
            error: null,
          };
        }

        // 如果是通过 ToolCall 对象调用，返回格式化的观察结果
        return `观察到执行的命令 \`${toolName}\` 的输出:\n${(result as any).content?.[0]?.text || JSON.stringify(result)}`;
      } catch (error) {
        this.logger.error(`MCP 工具调用失败: ${(error as Error).message}`);

        // 如果是直接调用（通过工具名称和参数），返回错误结果
        if (typeof commandOrName === 'string') {
          return {
            output: null,
            error: (error as Error).message,
          };
        }

        // 如果是通过 ToolCall 对象调用，返回错误消息
        return `执行工具时出错: ${(error as Error).message}`;
      }
    }

    // 否则使用父类的工具调用方法
    return super.executeToolCall(commandOrName, args);
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    // 清理 MCP 资源
    if (this.mcpClient) {
      try {
        // await this.mcpClient.disconnect(); // SDK 没有 disconnect 方法
        this.mcpClient = undefined;
      } catch (error) {
        this.logger.error(`MCP 客户端断开连接失败: ${(error as Error).message}`);
      }
    }

    // 关闭 MCP 服务器进程
    if (this.mcpServerProcess) {
      try {
        this.mcpServerProcess.kill();
        this.mcpServerProcess = undefined;
      } catch (error) {
        this.logger.error(`MCP 服务器关闭失败: ${(error as Error).message}`);
      }
    }

    // 清理浏览器资源
    if (this.browserContextHelper) {
      // await this.browserContextHelper.cleanupBrowser();
    }

    // 清理其他资源
    this._initialized = false;
    this.logger.info('Manus 代理资源已清理');
  }
}
