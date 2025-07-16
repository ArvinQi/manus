/**
 * 多代理和多MCP配置架构定义
 */

import { z } from 'zod';

// 简化的MCP服务配置 (新的通用格式)
export const SimpleMcpServerConfigSchema = z.object({
  command: z.string().describe('启动命令'),
  args: z.array(z.string()).describe('命令参数'),
  enabled: z.boolean().default(true).describe('是否启用'),
  type: z.enum(['stdio', 'http', 'websocket']).default('stdio').describe('连接类型'),
  url: z.string().optional().describe('HTTP/WebSocket连接URL'),
  timeout: z.number().default(30000).describe('连接超时时间(ms)'),
  retry_count: z.number().default(3).describe('重试次数'),
  capabilities: z.array(z.string()).optional().describe('服务能力列表'),
  priority: z.number().default(1).describe('优先级，数字越大优先级越高'),
  metadata: z.record(z.any()).optional().describe('额外元数据')
});

// 原有的完整MCP服务配置 (向后兼容)
export const McpServiceConfigSchema = z.object({
  name: z.string().describe('MCP服务名称'),
  type: z.enum(['stdio', 'http', 'websocket']).describe('连接类型'),
  command: z.string().optional().describe('stdio类型的启动命令'),
  args: z.array(z.string()).optional().describe('命令参数'),
  url: z.string().optional().describe('HTTP/WebSocket连接URL'),
  capabilities: z.array(z.string()).describe('服务能力列表'),
  priority: z.number().default(1).describe('优先级，数字越大优先级越高'),
  enabled: z.boolean().default(true).describe('是否启用'),
  timeout: z.number().default(30000).describe('连接超时时间(ms)'),
  retry_count: z.number().default(3).describe('重试次数'),
  health_check_interval: z.number().default(60000).describe('健康检查间隔(ms)'),
  metadata: z.record(z.any()).optional().describe('额外元数据')
});

// A2A 代理配置
export const A2AAgentConfigSchema = z.object({
  name: z.string().describe('代理名称'),
  type: z.enum(['http', 'websocket', 'grpc', 'message_queue']).describe('通信协议类型'),
  endpoint: z.string().describe('代理端点地址'),
  capabilities: z.array(z.string()).describe('代理能力列表'),
  specialties: z.array(z.string()).describe('专业领域'),
  priority: z.number().default(1).describe('优先级'),
  enabled: z.boolean().default(true).describe('是否启用'),
  auth: z.object({
    type: z.enum(['none', 'api_key', 'oauth', 'jwt']).default('none'),
    credentials: z.record(z.string()).optional()
  }).optional().describe('认证配置'),
  timeout: z.number().default(30000).describe('请求超时时间(ms)'),
  retry_count: z.number().default(3).describe('重试次数'),
  health_check_interval: z.number().default(60000).describe('健康检查间隔(ms)'),
  load_balancing: z.object({
    strategy: z.enum(['round_robin', 'weighted', 'least_connections']).default('round_robin'),
    weight: z.number().default(1)
  }).optional().describe('负载均衡配置'),
  metadata: z.record(z.any()).optional().describe('额外元数据')
});

// 任务路由规则配置
export const TaskRoutingRuleSchema = z.object({
  name: z.string().describe('规则名称'),
  condition: z.object({
    keywords: z.array(z.string()).optional().describe('关键词匹配'),
    task_type: z.string().optional().describe('任务类型'),
    priority_level: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('优先级'),
    capabilities_required: z.array(z.string()).optional().describe('所需能力'),
    context_patterns: z.array(z.string()).optional().describe('上下文模式匹配')
  }).describe('路由条件'),
  target: z.object({
    type: z.enum(['mcp', 'agent', 'local']).describe('目标类型'),
    name: z.string().describe('目标名称'),
    fallback: z.array(z.string()).optional().describe('备选目标')
  }).describe('路由目标'),
  priority: z.number().default(1).describe('规则优先级'),
  enabled: z.boolean().default(true).describe('是否启用')
});

// 记忆管理配置
export const MemoryConfigSchema = z.object({
  provider: z.enum(['openmemory', 'local', 'redis', 'mongodb']).default('openmemory').describe('记忆提供者'),
  openmemory: z.object({
    mcp_name: z.string().default('openmemory').describe('OpenMemory MCP服务名称'),
    compression_threshold: z.number().default(1000).describe('压缩阈值(消息数)'),
    extraction_interval: z.number().default(3600000).describe('提取间隔(ms)'),
    retention_policy: z.object({
      max_messages: z.number().default(10000),
      max_age_days: z.number().default(30),
      importance_threshold: z.number().default(0.5)
    }).describe('保留策略')
  }).optional().describe('OpenMemory配置'),
  local: z.object({
    storage_path: z.string().default('./.manus/memory'),
    max_file_size: z.number().default(10485760) // 10MB
  }).optional().describe('本地存储配置')
});

// 任务管理配置
export const TaskManagementConfigSchema = z.object({
  max_concurrent_tasks: z.number().default(5).describe('最大并发任务数'),
  task_timeout: z.number().default(300000).describe('任务超时时间(ms)'),
  priority_queue_size: z.number().default(100).describe('优先级队列大小'),
  interruption_policy: z.enum(['immediate', 'at_checkpoint', 'after_current']).default('at_checkpoint').describe('中断策略'),
  checkpoint_interval: z.number().default(30000).describe('检查点间隔(ms)'),
  task_persistence: z.boolean().default(true).describe('任务持久化'),
  auto_recovery: z.boolean().default(true).describe('自动恢复')
});

// 决策引擎配置
export const DecisionEngineConfigSchema = z.object({
  strategy: z.enum(['rule_based', 'ml_based', 'hybrid']).default('rule_based').describe('决策策略'),
  confidence_threshold: z.number().default(0.7).describe('置信度阈值'),
  fallback_strategy: z.enum(['local', 'random', 'priority']).default('local').describe('回退策略'),
  learning_enabled: z.boolean().default(false).describe('是否启用学习'),
  metrics_collection: z.boolean().default(true).describe('是否收集指标')
});

// 多代理系统配置
export const MultiAgentSystemConfigSchema = z.object({
  mcpServers: z.record(SimpleMcpServerConfigSchema).optional().describe('MCP服务配置'),
  a2a_agents: z.array(A2AAgentConfigSchema).describe('A2A代理列表'),
  routing_rules: z.array(TaskRoutingRuleSchema).describe('任务路由规则'),
  memory_config: MemoryConfigSchema.describe('记忆管理配置'),
  task_management: TaskManagementConfigSchema.describe('任务管理配置'),
  decision_engine: DecisionEngineConfigSchema.describe('决策引擎配置'),
  system: z
    .object({
      name: z.string().default('Manus-MultiAgent').describe('系统名称'),
      version: z.string().default('2.0.0').describe('系统版本'),
      debug_mode: z.boolean().default(false).describe('调试模式'),
      log_level: z.enum(['debug', 'info', 'warn', 'error']).default('info').describe('日志级别'),
    })
    .describe('系统配置'),
});

// 导出类型
export type SimpleMcpServerConfig = z.infer<typeof SimpleMcpServerConfigSchema>;
export type McpServiceConfig = z.infer<typeof McpServiceConfigSchema>;
export type A2AAgentConfig = z.infer<typeof A2AAgentConfigSchema>;
export type TaskRoutingRule = z.infer<typeof TaskRoutingRuleSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type TaskManagementConfig = z.infer<typeof TaskManagementConfigSchema>;
export type DecisionEngineConfig = z.infer<typeof DecisionEngineConfigSchema>;
export type MultiAgentSystemConfig = z.infer<typeof MultiAgentSystemConfigSchema>;
