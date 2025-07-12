# 多智能体配置系统指南

本指南详细介绍如何使用Manus项目的多智能体配置系统，包括MCP服务和A2A代理的配置。

## 概述

多智能体配置系统允许您通过JSON配置文件来管理：
- **MCP服务**：多协议连接服务，用于外部工具集成
- **A2A代理**：代理到代理通信，用于分布式智能体协作
- **任务路由规则**：智能工具调用路由
- **记忆管理**：系统记忆和上下文管理
- **任务管理**：并发任务执行和优先级处理

## 配置文件结构

### 主配置文件位置

- **TOML配置**：`config/config.toml` (传统LLM、浏览器等配置)
- **JSON配置**：`config/multi_agent_config.json` (多智能体系统配置)

### JSON配置文件结构

```json
{
  "mcp_services": [...],      // MCP服务配置
  "a2a_agents": [...],        // A2A代理配置
  "routing_rules": [...],     // 任务路由规则
  "memory_config": {...},     // 记忆管理配置
  "task_management": {...},   // 任务管理配置
  "decision_engine": {...},   // 决策引擎配置
  "system": {...}             // 系统配置
}
```

## MCP服务配置

### 基本配置

```json
{
  "mcp_services": [
    {
      "name": "openmemory",
      "type": "stdio",
      "command": "npx",
      "args": ["@openmemory/mcp-server"],
      "capabilities": ["memory_management", "compression", "extraction", "search"],
      "priority": 10,
      "enabled": true,
      "timeout": 30000,
      "retry_count": 3,
      "health_check_interval": 60000,
      "metadata": {
        "description": "OpenMemory MCP服务",
        "version": "1.0.0"
      }
    }
  ]
}
```

### 支持的连接类型

#### 1. Stdio连接
```json
{
  "name": "filesystem",
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  "capabilities": ["file_operations"]
}
```

#### 2. HTTP连接
```json
{
  "name": "web-service",
  "type": "http",
  "url": "http://localhost:3001/mcp",
  "capabilities": ["web_operations"]
}
```

#### 3. WebSocket连接
```json
{
  "name": "realtime-service",
  "type": "websocket",
  "url": "ws://localhost:3002/mcp",
  "capabilities": ["realtime_operations"]
}
```

## A2A代理配置

### HTTP代理配置

```json
{
  "a2a_agents": [
    {
      "name": "coding_agent",
      "type": "http",
      "endpoint": "http://localhost:3001/api/agent",
      "capabilities": ["code_generation", "code_review", "debugging"],
      "specialties": ["javascript", "typescript", "python", "react"],
      "priority": 9,
      "enabled": true,
      "auth": {
        "type": "api_key",
        "credentials": {
          "api_key": "your-api-key-here"
        }
      },
      "timeout": 120000,
      "retry_count": 2,
      "load_balancing": {
        "strategy": "weighted",
        "weight": 3
      }
    }
  ]
}
```

### 支持的认证类型

- **none**: 无认证
- **api_key**: API密钥认证
- **oauth**: OAuth认证
- **jwt**: JWT令牌认证

## 任务路由规则

### 基于关键词的路由

```json
{
  "routing_rules": [
    {
      "name": "memory_operations",
      "condition": {
        "keywords": ["记忆", "存储", "回忆", "压缩", "提取"],
        "capabilities_required": ["memory_management"]
      },
      "target": {
        "type": "mcp",
        "name": "openmemory",
        "fallback": ["local"]
      },
      "priority": 10,
      "enabled": true
    }
  ]
}
```

### 基于任务类型的路由

```json
{
  "name": "coding_tasks",
  "condition": {
    "task_type": "development",
    "capabilities_required": ["code_generation"]
  },
  "target": {
    "type": "agent",
    "name": "coding_agent",
    "fallback": ["local"]
  }
}
```

## 记忆管理配置

### OpenMemory配置

```json
{
  "memory_config": {
    "provider": "openmemory",
    "openmemory": {
      "mcp_name": "openmemory",
      "compression_threshold": 1000,
      "extraction_interval": 3600000,
      "retention_policy": {
        "max_messages": 10000,
        "max_age_days": 30,
        "importance_threshold": 0.5
      }
    }
  }
}
```

### 本地存储配置

```json
{
  "memory_config": {
    "provider": "local",
    "local": {
      "storage_path": "./.manus/memory",
      "max_file_size": 10485760
    }
  }
}
```

## 任务管理配置

```json
{
  "task_management": {
    "max_concurrent_tasks": 8,
    "task_timeout": 300000,
    "priority_queue_size": 200,
    "interruption_policy": "at_checkpoint",
    "checkpoint_interval": 30000,
    "task_persistence": true,
    "auto_recovery": true
  }
}
```

### 中断策略说明

- **immediate**: 立即中断当前任务
- **at_checkpoint**: 在检查点中断
- **after_current**: 当前任务完成后中断

## 决策引擎配置

```json
{
  "decision_engine": {
    "strategy": "hybrid",
    "confidence_threshold": 0.7,
    "fallback_strategy": "priority",
    "learning_enabled": true,
    "metrics_collection": true
  }
}
```

## 使用示例

### 1. 基本使用

```typescript
import { Manus } from './src/agent/manus.js';
import { config } from './src/utils/config.js';

// 检查配置
if (config.isMultiAgentEnabled()) {
  // 创建启用多智能体的Manus实例
  const manus = await Manus.create({
    name: 'MyAgent',
    enableMultiAgent: true
  });

  // 使用智能路由的工具调用
  await manus.step();

  // 清理资源
  await manus.cleanup();
}
```

### 2. 直接使用多智能体系统

```typescript
import { MultiAgentSystem } from './src/core/multi_agent_system.js';

const multiAgentConfig = config.getMultiAgentConfig();
const system = new MultiAgentSystem(multiAgentConfig);

await system.start();

// 提交任务
const taskId = await system.submitTask('分析这段代码', {
  type: 'development',
  priority: 'high',
  requiredCapabilities: ['code_analysis']
});

// 检查任务状态
const status = system.getTaskStatus(taskId);
console.log('任务状态:', status);

await system.stop();
```

### 3. 配置验证

```typescript
import { config } from './src/utils/config.js';

const validation = config.validateConfig();

if (!validation.valid) {
  console.error('配置错误:', validation.errors);
} else {
  console.log('配置验证通过');
}
```

## 配置管理API

### 获取配置

```typescript
// 获取MCP服务配置
const mcpServices = config.getMcpServices();

// 获取A2A代理配置
const a2aAgents = config.getA2AAgents();

// 获取路由规则
const routingRules = config.getRoutingRules();

// 获取完整的多智能体配置
const multiAgentConfig = config.getMultiAgentConfig();
```

### 更新配置

```typescript
// 更新系统配置
await config.updateMultiAgentConfig({
  system: {
    debug_mode: true,
    log_level: 'debug'
  }
});

// 重新加载配置
config.reloadConfig();
```

## 最佳实践

### 1. 配置组织

- 将不同环境的配置分开管理
- 使用环境变量覆盖敏感信息
- 定期备份配置文件

### 2. 性能优化

- 合理设置并发任务数量
- 调整超时时间避免资源浪费
- 启用健康检查监控服务状态

### 3. 安全考虑

- 保护API密钥和认证信息
- 限制服务访问权限
- 使用HTTPS进行代理通信

### 4. 监控和调试

- 启用调试模式进行问题排查
- 收集系统指标监控性能
- 查看系统事件了解运行状态

## 故障排除

### 常见问题

1. **配置文件不存在**
   - 检查文件路径是否正确
   - 确保JSON格式有效

2. **MCP服务连接失败**
   - 验证命令和参数是否正确
   - 检查服务是否已安装
   - 查看服务日志

3. **A2A代理无响应**
   - 检查网络连接
   - 验证认证信息
   - 确认代理服务状态

4. **任务路由失败**
   - 检查路由规则配置
   - 验证能力匹配
   - 查看决策引擎日志

### 调试技巧

1. 启用调试模式：
```json
{
  "system": {
    "debug_mode": true,
    "log_level": "debug"
  }
}
```

2. 查看系统指标：
```typescript
const metrics = await system.getSystemMetrics();
console.log(metrics);
```

3. 检查配置验证：
```typescript
const validation = config.validateConfig();
if (!validation.valid) {
  console.log('配置问题:', validation.errors);
}
```

## 相关文档

- [工具路由器指南](./tool_router_guide.md)
- [Coder Agent使用指南](./coder_agent.md)
- [多智能体配置示例](../examples/multi_agent_config_example.ts)

## 总结

多智能体配置系统为Manus项目提供了强大的扩展能力，通过合理的配置可以实现：

- 灵活的工具路由和负载均衡
- 分布式智能体协作
- 智能记忆管理和压缩
- 高效的任务调度和优先级处理

配置系统采用JSON格式，便于理解和维护，同时提供了丰富的API用于动态配置管理。
