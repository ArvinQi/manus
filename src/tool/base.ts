/**
 * 工具系统基础类
 * 定义工具的基本接口和结果类型
 */

import * as os from 'os';
import * as path from 'path';

/**
 * 工具基类
 * 所有工具都应该继承此类
 */
export abstract class BaseTool {
  name: string;
  description: string;
  parameters?: Record<string, any>;

  constructor(options: { name: string; description: string; parameters?: Record<string, any> }) {
    this.name = options.name;
    this.description = options.description;
    this.parameters = options.parameters;
  }

  /**
   * 获取操作系统类型
   * 静态方法，可以在不实例化工具的情况下使用
   */
  static getOSType(): string {
    return os.type();
  }

  /**
   * 获取操作系统平台
   * 静态方法，可以在不实例化工具的情况下使用
   */
  static getPlatform(): string {
    return os.platform();
  }

  /**
   * 检查是否为Windows系统
   * 静态方法，可以在不实例化工具的情况下使用
   */
  static isWindows(): boolean {
    return os.platform() === 'win32';
  }

  /**
   * 检查是否为macOS系统
   * 静态方法，可以在不实例化工具的情况下使用
   */
  static isMacOS(): boolean {
    return os.platform() === 'darwin';
  }

  /**
   * 检查是否为Linux系统
   * 静态方法，可以在不实例化工具的情况下使用
   */
  static isLinux(): boolean {
    return os.platform() === 'linux';
  }

  /**
   * 获取环境变量值
   * 静态方法，可以在不实例化工具的情况下使用
   */
  static getEnvVar(name: string): string | undefined {
    return process.env[name];
  }

  /**
   * 获取系统路径分隔符
   * 静态方法，可以在不实例化工具的情况下使用
   */
  static getPathSeparator(): string {
    return path.sep;
  }

  /**
   * 获取系统临时目录
   * 静态方法，可以在不实例化工具的情况下使用
   */
  static getTempDir(): string {
    return os.tmpdir();
  }

  /**
   * 执行工具
   * @param args 工具参数
   */
  async execute(args: Record<string, any> = {}): Promise<ToolResult> {
    try {
      return await this.run(args);
    } catch (error) {
      return new ToolFailure({ error: `${error}` });
    }
  }

  /**
   * 运行工具的具体实现
   * 子类必须实现此方法
   * @param args 工具参数
   */
  abstract run(args: Record<string, any>): Promise<ToolResult>;

  /**
   * 转换工具为函数调用格式
   */
  toParam(): Record<string, any> {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }
}

/**
 * 工具结果类
 * 表示工具执行的结果
 */
export class ToolResult {
  output?: any;
  error?: string;
  base64Image?: string;
  system?: string;

  constructor(
    options: {
      output?: any;
      error?: string;
      base64Image?: string;
      system?: string;
    } = {}
  ) {
    this.output = options.output;
    this.error = options.error;
    this.base64Image = options.base64Image;
    this.system = options.system;
  }

  /**
   * 检查结果是否有效
   */
  hasValue(): boolean {
    return !!this.output || !!this.error || !!this.base64Image || !!this.system;
  }

  /**
   * 组合两个工具结果
   */
  combine(other: ToolResult): ToolResult {
    const combineFields = (
      field: string | undefined,
      otherField: string | undefined,
      concatenate: boolean = true
    ): string | undefined => {
      if (field && otherField) {
        if (concatenate) {
          return field + otherField;
        }
        throw new Error('无法组合工具结果');
      }
      return field || otherField;
    };

    return new ToolResult({
      output: combineFields(this.output, other.output),
      error: combineFields(this.error, other.error),
      base64Image: combineFields(this.base64Image, other.base64Image, false),
      system: combineFields(this.system, other.system),
    });
  }

  /**
   * 转换为字符串
   */
  toString(): string {
    return this.error ? `错误: ${this.error}` : String(this.output || '');
  }

  /**
   * 创建新的工具结果，替换指定字段
   */
  replace(options: {
    output?: any;
    error?: string;
    base64Image?: string;
    system?: string;
  }): ToolResult {
    return new ToolResult({
      output: options.output !== undefined ? options.output : this.output,
      error: options.error !== undefined ? options.error : this.error,
      base64Image: options.base64Image !== undefined ? options.base64Image : this.base64Image,
      system: options.system !== undefined ? options.system : this.system,
    });
  }
}

/**
 * 命令行结果类
 * 表示命令行工具执行的结果
 */
export class CLIResult extends ToolResult {}

/**
 * 工具失败类
 * 表示工具执行失败的结果
 */
export class ToolFailure extends ToolResult {
  constructor(options: { error: string }) {
    super({ error: options.error });
  }
}
