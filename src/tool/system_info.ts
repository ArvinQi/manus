/**
 * 系统环境信息工具
 * 用于获取系统环境信息，帮助工具根据环境做出决策
 */

import * as os from 'os';
import { BaseTool, ToolResult } from './base.js';
import { Logger } from '../utils/logger.js';

/**
 * 系统环境信息工具
 * 提供系统环境信息，如操作系统类型、架构、环境变量等
 */
export class SystemInfoTool extends BaseTool {
  private logger = new Logger('SystemInfoTool');

  constructor() {
    super({
      name: 'system_info',
      description: '获取系统环境信息，帮助工具根据环境做出决策',
      parameters: {
        type: 'object',
        properties: {
          info_type: {
            type: 'string',
            description: '要获取的信息类型: os, arch, platform, env, cpu, memory, network, all',
            enum: ['os', 'arch', 'platform', 'env', 'cpu', 'memory', 'network', 'all'],
            default: 'all',
          },
          env_var: {
            type: 'string',
            description: '要获取的特定环境变量名称（仅当info_type为env时有效）',
          },
        },
        required: [],
      },
    });
  }

  /**
   * 执行系统信息获取工具
   * @param args 工具参数
   * @returns 系统信息
   */
  async run(args: {
    info_type?: 'os' | 'arch' | 'platform' | 'env' | 'cpu' | 'memory' | 'network' | 'all';
    env_var?: string;
  }): Promise<ToolResult> {
    const { info_type = 'all', env_var } = args;

    try {
      this.logger.info(`获取系统信息: ${info_type}`);

      let result: Record<string, any> = {};

      switch (info_type) {
        case 'os':
          result = this.getOSInfo();
          break;
        case 'arch':
          result = { architecture: os.arch() };
          break;
        case 'platform':
          result = { platform: os.platform() };
          break;
        case 'env':
          result = this.getEnvInfo(env_var);
          break;
        case 'cpu':
          result = this.getCPUInfo();
          break;
        case 'memory':
          result = this.getMemoryInfo();
          break;
        case 'network':
          result = this.getNetworkInfo();
          break;
        case 'all':
        default:
          result = {
            os: this.getOSInfo(),
            architecture: os.arch(),
            platform: os.platform(),
            cpu: this.getCPUInfo(),
            memory: this.getMemoryInfo(),
            network: this.getNetworkInfo(),
          };
          break;
      }

      return new ToolResult({ output: result });
    } catch (error) {
      this.logger.error(`获取系统信息失败: ${error}`);
      return new ToolResult({ error: `获取系统信息失败: ${error}` });
    }
  }

  /**
   * 获取操作系统信息
   */
  private getOSInfo(): Record<string, any> {
    return {
      type: os.type(),
      platform: os.platform(),
      release: os.release(),
      version: os.version(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      userInfo: os.userInfo({ encoding: 'utf8' }),
    };
  }

  /**
   * 获取环境变量信息
   */
  private getEnvInfo(envVar?: string): Record<string, any> {
    if (envVar) {
      return { [envVar]: process.env[envVar] };
    }
    return { ...process.env };
  }

  /**
   * 获取CPU信息
   */
  private getCPUInfo(): Record<string, any> {
    const cpus = os.cpus();
    return {
      count: cpus.length,
      model: cpus[0]?.model || 'Unknown',
      speed: cpus[0]?.speed || 0,
      details: cpus,
    };
  }

  /**
   * 获取内存信息
   */
  private getMemoryInfo(): Record<string, any> {
    return {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
      usagePercentage: (((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(2),
    };
  }

  /**
   * 获取网络信息
   */
  private getNetworkInfo(): Record<string, any> {
    return {
      interfaces: os.networkInterfaces(),
    };
  }

  /**
   * 静态方法：获取操作系统类型
   * 可以在不实例化工具的情况下使用
   */
  static getOSType(): string {
    return os.type();
  }

  /**
   * 静态方法：获取操作系统平台
   * 可以在不实例化工具的情况下使用
   */
  static getPlatform(): string {
    return os.platform();
  }

  /**
   * 静态方法：检查是否为Windows系统
   * 可以在不实例化工具的情况下使用
   */
  static isWindows(): boolean {
    return os.platform() === 'win32';
  }

  /**
   * 静态方法：检查是否为macOS系统
   * 可以在不实例化工具的情况下使用
   */
  static isMacOS(): boolean {
    return os.platform() === 'darwin';
  }

  /**
   * 静态方法：检查是否为Linux系统
   * 可以在不实例化工具的情况下使用
   */
  static isLinux(): boolean {
    return os.platform() === 'linux';
  }

  /**
   * 静态方法：获取环境变量值
   * 可以在不实例化工具的情况下使用
   */
  static getEnvVar(name: string): string | undefined {
    return process.env[name];
  }
}
