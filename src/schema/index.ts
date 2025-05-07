/**
 * 定义 Manus 系统中使用的核心数据结构和类型
 */

/**
 * 代理状态枚举
 */
export enum AgentState {
  IDLE = 0, // 空闲状态
  RUNNING = 1, // 运行中
  FINISHED = 2, // 已完成
  ERROR = 3, // 错误状态
}

/**
 * 消息角色枚举
 */
export enum Role {
  USER = 'user', // 用户消息
  SYSTEM = 'system', // 系统消息
  ASSISTANT = 'assistant', // 助手消息
  TOOL = 'tool', // 工具消息
}

/**
 * 工具选择类型
 */
export enum ToolChoice {
  NONE = 'none', // 不使用工具
  AUTO = 'auto', // 自动选择是否使用工具
  REQUIRED = 'required', // 必须使用工具
}

/**
 * 工具调用接口
 */
export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * 消息类
 */
export class Message {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  base64_image?: string;

  constructor(options: {
    role: Role;
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    name?: string;
    base64_image?: string;
  }) {
    this.role = options.role;
    this.content = options.content;
    this.tool_calls = options.tool_calls;
    this.tool_call_id = options.tool_call_id;
    this.name = options.name;
    this.base64_image = options.base64_image;
  }

  /**
   * 创建用户消息
   */
  static userMessage(content: string, base64_image?: string): Message {
    return new Message({
      role: Role.USER,
      content,
      base64_image,
    });
  }

  /**
   * 创建系统消息
   */
  static systemMessage(content: string): Message {
    return new Message({
      role: Role.SYSTEM,
      content,
    });
  }

  /**
   * 创建助手消息
   */
  static assistantMessage(content: string): Message {
    return new Message({
      role: Role.ASSISTANT,
      content,
    });
  }

  /**
   * 创建工具消息
   */
  static toolMessage(
    content: string,
    options?: { tool_call_id?: string; name?: string; base64_image?: string }
  ): Message {
    return new Message({
      role: Role.TOOL,
      content,
      tool_call_id: options?.tool_call_id,
      name: options?.name,
      base64_image: options?.base64_image,
    });
  }

  /**
   * 从工具调用创建消息
   */
  static fromToolCalls(options: { content: string | null; tool_calls: ToolCall[] }): Message {
    return new Message({
      role: Role.ASSISTANT,
      content: options.content,
      tool_calls: options.tool_calls,
    });
  }
}

/**
 * 内存类，用于存储代理的消息历史
 */
export class Memory {
  messages: Message[] = [];

  /**
   * 添加消息到内存
   */
  addMessage(message: Message): void {
    this.messages.push(message);
  }

  /**
   * 清空内存
   */
  clear(): void {
    this.messages = [];
  }
}
