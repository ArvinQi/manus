/**
 * 配置加载工具类
 * 负责加载和管理系统配置
 */

import fs from 'fs';
import path from 'path';
import toml from 'toml';
import { fileURLToPath } from 'url';
import { Logger } from './logger.js';
import { MemoryConfig } from '../core/mem0_memory_manager.js';
import { ConversationConfig } from '../core/conversation_context_manager.js';
import { McpServiceConfig, SimpleMcpServerConfig } from '../schema/multi_agent_config.js';
import { A2AAgentConfig } from '../schema/multi_agent_config.js';

// 获取项目根目录
function getProjectRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '../..');
}

// 项目根目录和工作空间根目录
const PROJECT_ROOT = getProjectRoot();
const WORKSPACE_ROOT = PROJECT_ROOT; // path.join(PROJECT_ROOT, 'workspace');

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

// 统一配置接口
interface UnifiedConfig {
  llm: Record<string, LLMSettings>;
  browser?: BrowserSettings;
  search?: SearchSettings;
  memory?: MemoryConfig;
  conversation?: ConversationConfig;
  workspace?: {
    root: string;
  };
  mcpServers?: Record<string, SimpleMcpServerConfig>;
  a2a_agents?: A2AAgentConfig[];
}

// 应用配置接口
interface AppConfig {
  llm: Record<string, LLMSettings>;
  browser_config?: BrowserSettings;
  search_config?: SearchSettings;
  memory_config?: MemoryConfig;
  conversation_config?: ConversationConfig;
  workspace_root?: string;
  mcpServers?: Record<string, SimpleMcpServerConfig>;
  a2a_agents?: A2AAgentConfig[];
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
   * 获取统一配置文件路径
   */
  private getUnifiedConfigPath(): string {
    // 项目目录优先
    const projectConfigPath = path.join(PROJECT_ROOT, 'config', 'config.json');
    if (fs.existsSync(projectConfigPath)) {
      return projectConfigPath;
    }

    // 用户家目录 ~/.manus/config.json
    const homeConfigPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '~',
      '.manus',
      'config.json'
    );
    if (fs.existsSync(homeConfigPath)) {
      return homeConfigPath;
    }

    throw new Error('未找到配置文件 config.json');
  }

  /**
   * 获取TOML配置文件路径
   */
  private getTomlConfigPath(): string {
    // 项目目录优先
    const projectConfigPath = path.join(PROJECT_ROOT, 'config', 'config.toml');
    if (fs.existsSync(projectConfigPath)) {
      return projectConfigPath;
    }

    // 用户家目录 ~/.manus/config.toml
    const homeConfigPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '~',
      '.manus',
      'config.toml'
    );
    if (fs.existsSync(homeConfigPath)) {
      return homeConfigPath;
    }

    throw new Error('未找到配置文件 config.toml');
  }

  /**
   * 加载统一配置文件
   */
  private loadUnifiedConfig(): UnifiedConfig | null {
    const configPath = this.getUnifiedConfigPath();

    if (!fs.existsSync(configPath)) {
      this.logger.info('未找到统一配置文件 config.json，将使用传统配置方式');
      return null;
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent) as UnifiedConfig;

      this.logger.info('统一配置文件加载成功');
      return config;
    } catch (error) {
      this.logger.error(`加载统一配置文件失败: ${error}`);
      throw error;
    }
  }

  /**
   * 加载TOML配置文件
   */
  private loadTomlConfig(): Record<string, unknown> {
    const configPath = this.getTomlConfigPath();
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      this.logger.info('TOML配置文件加载成功');
      return toml.parse(configContent);
    } catch (error) {
      this.logger.error(`加载TOML配置文件失败: ${error}`);
      throw error;
    }
  }

  /**
   * 获取默认记忆配置
   */
  private getDefaultMemoryConfig(): MemoryConfig {
    return {
      enabled: true,
      searchLimit: 10,
      searchThreshold: 0.7,
      maxContextMessages: 15,
      compressionThreshold: 50,
      autoSaveMessages: true,
      historyDbPath: '.manus/memory.db',
      vectorDbPath: '.manus/vector_db',
    };
  }

  /**
   * 获取默认对话配置
   */
  private getDefaultConversationConfig(): ConversationConfig {
    return {
      maxContextMessages: 10,
      maxTokenLimit: 4000,
      relevanceThreshold: 0.5,
      importanceThreshold: 0.6,
      sessionTimeoutMs: 120 * 60 * 1000, // 2小时 (原来是30分钟)
      summarizationThreshold: 20,
    };
  }

  /**
   * 加载初始配置
   */
  private loadInitialConfig(): void {
    try {
      // 首先尝试加载统一配置文件
      const unifiedConfig = this.loadUnifiedConfig();
      if (unifiedConfig) {
        // 使用统一配置文件
        this.config = {
          llm: unifiedConfig.llm,
          browser_config: unifiedConfig.browser,
          search_config: unifiedConfig.search,
          memory_config: unifiedConfig.memory || this.getDefaultMemoryConfig(),
          conversation_config: unifiedConfig.conversation || this.getDefaultConversationConfig(),
          workspace_root: unifiedConfig.workspace?.root || WORKSPACE_ROOT,
          mcpServers: unifiedConfig.mcpServers || {},
          a2a_agents: unifiedConfig.a2a_agents || [],
        };
      } else {
        // 使用传统的分离配置方式
        const tomlConfig = this.loadTomlConfig();

        // 转换为应用配置
        this.config = {
          llm: {},
          memory_config: this.getDefaultMemoryConfig(),
          conversation_config: this.getDefaultConversationConfig(),
          workspace_root: WORKSPACE_ROOT,
          mcpServers: {},
          a2a_agents: [],
        };

        // 加载 LLM 配置
        if (tomlConfig.llm) {
          for (const [key, value] of Object.entries(tomlConfig.llm)) {
            this.config.llm[key] = value as LLMSettings;
          }
        }

        // 加载浏览器配置
        if (tomlConfig.browser) {
          this.config.browser_config = tomlConfig.browser as BrowserSettings;
        }

        // 加载搜索配置
        if (tomlConfig.search) {
          this.config.search_config = tomlConfig.search as SearchSettings;
        }

        // 加载记忆配置
        if (tomlConfig.memory) {
          this.config.memory_config = {
            ...this.getDefaultMemoryConfig(),
            ...(tomlConfig.memory as Partial<MemoryConfig>),
          };
        }

        // 加载对话配置
        if (tomlConfig.conversation) {
          this.config.conversation_config = {
            ...this.getDefaultConversationConfig(),
            ...(tomlConfig.conversation as Partial<ConversationConfig>),
          };
        }

        // 加载工作空间配置
        if (
          typeof tomlConfig.workspace === 'object' &&
          tomlConfig.workspace &&
          'root' in tomlConfig.workspace
        ) {
          this.config.workspace_root = (tomlConfig.workspace as Record<string, string>).root;
        }
      }
      this.logger.info('初始化配置成功');
    } catch (error) {
      this.logger.error(`初始化配置失败: ${error}`);
      throw error;
    }
  }

  /**
   * 重新加载配置
   */
  public reloadConfig(): void {
    this.logger.info('重新加载配置...');
    this.loadInitialConfig();
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
   * 获取记忆配置
   */
  public getMemoryConfig(): MemoryConfig {
    return this.config?.memory_config || this.getDefaultMemoryConfig();
  }

  /**
   * 获取对话配置
   */
  public getConversationConfig(): ConversationConfig {
    return this.config?.conversation_config || this.getDefaultConversationConfig();
  }

  /**
   * 更新记忆配置
   */
  public updateMemoryConfig(memoryConfig: Partial<MemoryConfig>): void {
    if (this.config) {
      this.config.memory_config = {
        ...this.getDefaultMemoryConfig(),
        ...this.config.memory_config,
        ...memoryConfig,
      };
      this.logger.info('记忆配置已更新');
    }
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

  /**
   * 获取MCP服务器配置
   */
  public getMcpServersConfig(): Record<string, SimpleMcpServerConfig> {
    return this.config?.mcpServers || {};
  }

  /**
   * 获取A2A代理配置
   */
  public getAgentsConfig(): A2AAgentConfig[] {
    return this.config?.a2a_agents || [];
  }

  /**
   * 保存配置到统一配置文件
   */
  private async saveUnifiedConfig(): Promise<void> {
    if (!this.config) {
      return;
    }

    let configPath: string;

    try {
      // 尝试获取现有配置文件路径
      configPath = this.getUnifiedConfigPath();
    } catch (error) {
      // 如果没有找到配置文件，默认保存到项目目录
      configPath = path.join(PROJECT_ROOT, 'config', 'config.json');
      // 确保目录存在
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
    }

    try {
      const unifiedConfig: UnifiedConfig = {
        llm: this.config.llm,
        browser: this.config.browser_config,
        search: this.config.search_config,
        memory: this.config.memory_config,
        conversation: this.config.conversation_config,
        workspace: {
          root: this.config.workspace_root || WORKSPACE_ROOT,
        },
        mcpServers: this.config.mcpServers,
        a2a_agents: this.config.a2a_agents,
      };

      const configContent = JSON.stringify(unifiedConfig, null, 2);
      fs.writeFileSync(configPath, configContent, 'utf-8');
      this.logger.info(`统一配置已保存到文件: ${configPath}`);
    } catch (error) {
      this.logger.error(`保存统一配置失败: ${error}`);
      throw error;
    }
  }

  /**
   * 验证配置完整性
   */
  public validateConfig(): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 验证基础配置
    if (!this.config) {
      errors.push('配置未初始化');
      return { valid: false, errors, warnings };
    }

    // 验证LLM配置
    if (!this.config.llm || Object.keys(this.config.llm).length === 0) {
      errors.push('未找到LLM配置');
    }

    // 验证记忆配置
    if (this.config.memory_config?.enabled) {
      if (!process.env.OPENAI_API_KEY) {
        warnings.push('启用记忆管理但未设置 OPENAI_API_KEY 环境变量');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

// 导出配置实例
export const config = Config.getInstance();
