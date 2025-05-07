/**
 * 配置加载工具类
 * 负责加载和管理系统配置
 */

import fs from 'fs';
import path from 'path';
import toml from 'toml';
import { fileURLToPath } from 'url';
import { Logger } from './logger.js';

// 获取项目根目录
function getProjectRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '../..');
}

// 项目根目录和工作空间根目录
const PROJECT_ROOT = getProjectRoot();
const WORKSPACE_ROOT = path.join(PROJECT_ROOT, 'workspace');

// LLM 设置接口
interface LLMSettings {
  model: string;
  base_url: string;
  api_key: string;
  max_tokens: number;
  max_input_tokens?: number;
  temperature: number;
  api_type: string;
  api_version: string;
}

// 代理设置接口
interface ProxySettings {
  server: string;
  username?: string;
  password?: string;
}

// 搜索设置接口
interface SearchSettings {
  engine: string;
  fallback_engines: string[];
  retry_delay: number;
  max_retries: number;
  lang: string;
  country: string;
}

// 浏览器设置接口
interface BrowserSettings {
  headless: boolean;
  disable_security: boolean;
  extra_args: string[];
  chrome_instance_path?: string;
  wss_url?: string;
  cdp_url?: string;
  proxy?: ProxySettings;
  max_content_length: number;
}

// 应用配置接口
interface AppConfig {
  llm: Record<string, LLMSettings>;
  browser_config?: BrowserSettings;
  search_config?: SearchSettings;
  workspace_root?: string;
}

/**
 * 配置类
 * 单例模式实现，负责加载和管理系统配置
 */
export class Config {
  private static instance: Config;
  private config: AppConfig | null = null;
  private logger = new Logger('Config');

  private constructor() {
    this.loadInitialConfig();
  }

  /**
   * 获取配置实例
   */
  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  /**
   * 获取配置文件路径
   */
  private getConfigPath(): string {
    const configPath = path.join(PROJECT_ROOT, 'config', 'config.toml');
    const examplePath = path.join(PROJECT_ROOT, 'config', 'config.example.toml');

    if (fs.existsSync(configPath)) {
      return configPath;
    } else if (fs.existsSync(examplePath)) {
      return examplePath;
    }

    throw new Error('未找到配置文件');
  }

  /**
   * 加载配置文件
   */
  private loadConfig(): Record<string, unknown> {
    const configPath = this.getConfigPath();
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      return toml.parse(configContent);
    } catch (error) {
      this.logger.error(`加载配置文件失败: ${error}`);
      throw error;
    }
  }

  /**
   * 加载初始配置
   */
  private loadInitialConfig(): void {
    try {
      const rawConfig = this.loadConfig();

      // 转换为应用配置
      this.config = {
        llm: {},
        workspace_root: WORKSPACE_ROOT,
      };

      // 加载 LLM 配置
      if (rawConfig.llm) {
        for (const [key, value] of Object.entries(rawConfig.llm)) {
          this.config.llm[key] = value as LLMSettings;
        }
      }

      // 加载浏览器配置
      if (rawConfig.browser) {
        this.config.browser_config = rawConfig.browser as BrowserSettings;
      }

      // 加载搜索配置
      if (rawConfig.search) {
        this.config.search_config = rawConfig.search as SearchSettings;
      }

      // 加载工作空间配置
      if (rawConfig.workspace?.root) {
        this.config.workspace_root = rawConfig.workspace.root;
      }

      this.logger.info('配置加载成功');
    } catch (error) {
      this.logger.error(`初始化配置失败: ${error}`);
      throw error;
    }
  }

  /**
   * 获取 LLM 配置
   */
  public getLLMConfig(name: string = 'default'): LLMSettings {
    if (!this.config || !this.config.llm[name]) {
      throw new Error(`LLM 配置 '${name}' 不存在`);
    }
    return this.config.llm[name];
  }

  /**
   * 获取浏览器配置
   */
  public getBrowserConfig(): BrowserSettings | undefined {
    return this.config?.browser_config;
  }

  /**
   * 获取搜索配置
   */
  public getSearchConfig(): SearchSettings | undefined {
    return this.config?.search_config;
  }

  /**
   * 获取工作空间根目录
   */
  public getWorkspaceRoot(): string {
    return this.config?.workspace_root || WORKSPACE_ROOT;
  }

  /**
   * 获取项目根目录
   */
  public getProjectRoot(): string {
    return PROJECT_ROOT;
  }
}

// 导出配置实例
export const config = Config.getInstance();
